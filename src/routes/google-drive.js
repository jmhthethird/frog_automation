'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const { db }    = require('../db');
const { buildOAuth2Client } = require('../google-drive');

const router = express.Router();

const readLimit  = rateLimit({ windowMs: 60_000, max: 60,  standardHeaders: true, legacyHeaders: false });
const writeLimit = rateLimit({ windowMs: 60_000, max: 10,  standardHeaders: true, legacyHeaders: false });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read the raw credentials object stored for the google_drive service. */
function getCredentials() {
  const row = db.prepare("SELECT credentials FROM api_credentials WHERE service = 'google_drive'").get();
  return JSON.parse(row?.credentials || '{}');
}

/**
 * Merge `updates` into the existing google_drive credentials object and persist.
 * Keys present in `updates` overwrite existing values; all other keys are kept.
 */
function persistCredentials(updates) {
  const current = getCredentials();
  const merged  = { ...current, ...updates };
  db.prepare(`
    INSERT INTO api_credentials (service, enabled, credentials)
    VALUES ('google_drive', 0, ?)
    ON CONFLICT(service) DO UPDATE SET credentials = excluded.credentials
  `).run(JSON.stringify(merged));
}

/** Build the OAuth2 redirect URI from the incoming request. */
function buildRedirectUri(req) {
  return `${req.protocol}://${req.get('host')}/api/google-drive/callback`;
}

/**
 * Return an HTML page that sends a postMessage to the window opener and closes.
 * Used as the OAuth2 callback response so it works inside a popup window.
 */
function popupResponse(res, type, extra = {}) {
  const payload = JSON.stringify({ type, ...extra });
  // The targetOrigin is window.location.origin so the message is scoped to
  // the same server that opened the popup.
  res.send(`<!doctype html><html><body><script>
    (function () {
      var msg = ${payload};
      try { window.opener.postMessage(msg, window.location.origin); } catch (e) { /* opener gone */ }
      window.close();
    })();
  </script></body></html>`);
}

// ─── GET /api/google-drive/status ─────────────────────────────────────────────
// Returns whether the user is authenticated and which root folder is selected.
router.get('/status', readLimit, (req, res) => {
  const creds = getCredentials();
  res.json({
    connected:      !!(creds.client_id && creds.client_secret && creds.refresh_token),
    rootFolderId:   creds.root_folder_id   || null,
    rootFolderName: creds.root_folder_name || null,
  });
});

// ─── GET /api/google-drive/auth-url ───────────────────────────────────────────
// Generates and returns the Google OAuth2 authorization URL.
// The browser should open this URL in a popup window.
router.get('/auth-url', readLimit, (req, res) => {
  const creds = getCredentials();
  if (!creds.client_id || !creds.client_secret) {
    return res.status(400).json({
      error: 'Save an OAuth2 Client ID and Client Secret before connecting',
    });
  }

  const redirectUri   = buildRedirectUri(req);
  const oauth2Client  = buildOAuth2Client(creds.client_id, creds.client_secret, redirectUri);

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope:       ['https://www.googleapis.com/auth/drive'],
    // prompt:'consent' guarantees a refresh_token is returned on every auth.
    prompt: 'consent',
  });

  res.json({ url });
});

// ─── GET /api/google-drive/callback ───────────────────────────────────────────
// OAuth2 redirect target. Exchanges the authorization code for tokens, stores
// the refresh token, then signals the opener via postMessage and closes itself.
router.get('/callback', readLimit, async (req, res) => {
  const { code, error } = req.query;

  if (error) return popupResponse(res, 'drive-auth-error', { error: String(error) });
  if (!code)  return res.status(400).send('Missing authorization code');

  const creds = getCredentials();
  if (!creds.client_id || !creds.client_secret) {
    return res.status(400).send('OAuth2 credentials not configured');
  }

  const redirectUri  = buildRedirectUri(req);
  const oauth2Client = buildOAuth2Client(creds.client_id, creds.client_secret, redirectUri);

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (tokens.refresh_token) {
      persistCredentials({ refresh_token: tokens.refresh_token });
    }
    popupResponse(res, 'drive-auth-success');
  } catch (err) {
    popupResponse(res, 'drive-auth-error', { error: err.message });
  }
});

// ─── GET /api/google-drive/token ──────────────────────────────────────────────
// Returns a fresh OAuth2 access token and the stored API key.
// The browser uses these to open the Google Drive folder picker.
router.get('/token', readLimit, async (req, res) => {
  const creds = getCredentials();
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    return res.status(401).json({
      error: 'Google Drive is not authenticated – please connect via the API Settings panel',
    });
  }

  const oauth2Client = buildOAuth2Client(creds.client_id, creds.client_secret);
  oauth2Client.setCredentials({ refresh_token: creds.refresh_token });

  try {
    const { token } = await oauth2Client.getAccessToken();
    res.json({ accessToken: token, apiKey: creds.api_key || '' });
  } catch (err) {
    res.status(401).json({ error: `Failed to refresh Google access token: ${err.message}` });
  }
});

// ─── POST /api/google-drive/root-folder ───────────────────────────────────────
// Stores the root folder chosen via the Google Drive Picker.
router.post('/root-folder', writeLimit, (req, res) => {
  const { folderId, folderName } = req.body || {};

  if (!folderId || typeof folderId !== 'string') {
    return res.status(400).json({ error: '"folderId" is required and must be a string' });
  }

  persistCredentials({
    root_folder_id:   folderId.trim(),
    root_folder_name: (folderName || folderId).trim(),
  });

  res.json({ folderId: folderId.trim(), folderName: (folderName || folderId).trim() });
});

// ─── DELETE /api/google-drive/auth ────────────────────────────────────────────
// Clears the stored OAuth2 tokens and root folder selection.
// User-entered credentials (api_key, client_id, client_secret) are preserved.
router.delete('/auth', writeLimit, (req, res) => {
  const { api_key, client_id, client_secret } = getCredentials();
  db.prepare("UPDATE api_credentials SET credentials = ? WHERE service = 'google_drive'")
    .run(JSON.stringify({
      api_key:       api_key       || '',
      client_id:     client_id     || '',
      client_secret: client_secret || '',
    }));
  res.json({ ok: true });
});

module.exports = router;
