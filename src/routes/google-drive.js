'use strict';

const crypto    = require('crypto');
const express   = require('express');
const rateLimit = require('express-rate-limit');
const { db }    = require('../db');
const { buildOAuth2Client } = require('../google-drive');

const router = express.Router();

const readLimit  = rateLimit({ windowMs: 60_000, max: 60,  standardHeaders: true, legacyHeaders: false });
const writeLimit = rateLimit({ windowMs: 60_000, max: 10,  standardHeaders: true, legacyHeaders: false });

// ─── OAuth CSRF state store ───────────────────────────────────────────────────

/** In-memory map of state token → expiry timestamp (ms). One-time use. */
const _pendingStates = new Map();
const STATE_TTL_MS   = 10 * 60 * 1_000; // 10 minutes

/** Generate a one-time cryptographically-random CSRF state token. */
function _generateState() {
  // Prune expired entries only when the map is large to avoid overhead on
  // every call (in practice the map holds at most a handful of entries).
  const now = Date.now();
  if (_pendingStates.size > 10) {
    for (const [k, exp] of _pendingStates) {
      if (exp < now) _pendingStates.delete(k);
    }
  }
  const state = crypto.randomBytes(32).toString('hex');
  _pendingStates.set(state, now + STATE_TTL_MS);
  return state;
}

/**
 * Validate and consume a state token.
 * Returns true when the token is known and unexpired; false otherwise.
 * Each token may only be used once (deleted on first successful validation).
 */
function _consumeState(state) {
  if (!state) return false;
  const expiry = _pendingStates.get(state);
  if (!expiry) return false;
  _pendingStates.delete(state); // one-time use
  return Date.now() < expiry;
}

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

/** Build the OAuth2 redirect URI from the incoming request.
 *
 * Priority:
 *  1. GOOGLE_DRIVE_REDIRECT_URI env var – explicit override, useful when the
 *     auto-detected URI doesn't match what is registered in Google Cloud Console.
 *  2. X-Forwarded-Proto header – respected when the app runs behind a reverse
 *     proxy (e.g. nginx) that terminates TLS so that `req.protocol` would
 *     otherwise return `http` even though clients access over `https`.
 *  3. req.protocol + req.get('host') – default for direct connections.
 */
function buildRedirectUri(req) {
  if (process.env.GOOGLE_DRIVE_REDIRECT_URI) {
    return process.env.GOOGLE_DRIVE_REDIRECT_URI;
  }
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}/api/google-drive/callback`;
}

/**
 * Return an HTML page that sends a postMessage to the window opener and closes.
 * Used as the OAuth2 callback response so it works inside a popup window.
 *
 * The JSON payload has <, >, and & escaped to their Unicode equivalents so
 * that no injected error message (e.g. containing </script>) can break out of
 * the <script> block and inject HTML.
 */
function popupResponse(res, type, extra = {}) {
  const payload = JSON.stringify({ type, ...extra })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
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
// authCompletedAt is the Unix timestamp (ms) of the last successful OAuth flow;
// the frontend uses it to detect new authorizations via polling.
router.get('/status', readLimit, (req, res) => {
  const creds = getCredentials();
  res.json({
    connected:       !!(creds.client_id && creds.client_secret && creds.refresh_token),
    rootFolderId:    creds.root_folder_id    || null,
    rootFolderName:  creds.root_folder_name  || null,
    authCompletedAt: creds.auth_completed_at || null,
  });
});

// ─── GET /api/google-drive/auth-url ───────────────────────────────────────────
// Generates and returns the Google OAuth2 authorization URL.
// A one-time CSRF state token is generated, stored server-side, and included
// in the URL. The browser should open this URL in a popup window.
router.get('/auth-url', readLimit, (req, res) => {
  const creds = getCredentials();
  if (!creds.client_id || !creds.client_secret) {
    return res.status(400).json({
      error: 'Save an OAuth2 Client ID and Client Secret before connecting',
    });
  }

  const redirectUri  = buildRedirectUri(req);
  const oauth2Client = buildOAuth2Client(creds.client_id, creds.client_secret, redirectUri);
  const state        = _generateState();

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope:       ['https://www.googleapis.com/auth/drive'],
    // prompt:'consent' guarantees a refresh_token is returned on every auth.
    prompt: 'consent',
    state,
  });

  // Return both the auth URL and the redirect URI so the client can display
  // the exact URI that must be registered in Google Cloud Console.
  res.json({ url, redirectUri });
});

// ─── GET /api/google-drive/callback ───────────────────────────────────────────
// OAuth2 redirect target. Validates the CSRF state, exchanges the authorization
// code for tokens, stores the refresh token, then signals the opener via
// postMessage and closes itself.
router.get('/callback', readLimit, async (req, res) => {
  const { code, error, state } = req.query;

  if (error) return popupResponse(res, 'drive-auth-error', { error: String(error) });
  if (!code)  return popupResponse(res, 'drive-auth-error', { error: 'Missing authorization code' });

  // Validate the CSRF state token before exchanging the code.
  if (!_consumeState(state)) {
    return popupResponse(res, 'drive-auth-error', {
      error: 'Invalid or expired state parameter; please try connecting again.',
    });
  }

  const creds = getCredentials();
  if (!creds.client_id || !creds.client_secret) {
    return popupResponse(res, 'drive-auth-error', { error: 'OAuth2 credentials not configured' });
  }

  const redirectUri  = buildRedirectUri(req);
  const oauth2Client = buildOAuth2Client(creds.client_id, creds.client_secret, redirectUri);

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (tokens.refresh_token) {
      // Store the newly issued refresh token and record the completion timestamp.
      // auth_completed_at lets the frontend detect a new authorization via polling
      // even when window.opener is unavailable (e.g. after cross-origin navigation).
      persistCredentials({ refresh_token: tokens.refresh_token, auth_completed_at: Date.now() });
      return popupResponse(res, 'drive-auth-success');
    }

    // Google did not return a new refresh_token (common on re-auth when the
    // existing grant is still valid). If we already have a stored token the
    // session remains usable — report success and update the timestamp.
    if (creds.refresh_token) {
      persistCredentials({ auth_completed_at: Date.now() });
      return popupResponse(res, 'drive-auth-success');
    }

    // No usable token at all: tell the user to disconnect and try again.
    popupResponse(res, 'drive-auth-error', {
      error: 'Google did not return a refresh token. Please disconnect and connect again.',
    });
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
    if (!token) {
      return res.status(401).json({
        error: 'Failed to obtain a valid Google access token; try reconnecting.',
      });
    }
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
