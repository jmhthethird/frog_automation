'use strict';

const crypto    = require('crypto');
const express   = require('express');
const rateLimit = require('express-rate-limit');
const { db }    = require('../db');
const { buildOAuth2Client, buildDriveClientFromOAuth, listSubfolders, migrateDriveFolders } = require('../google-drive');
const { DRIVE_CATEGORIES } = require('../constants/driveCategories');

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

/** Build the OAuth2 redirect URI from the incoming request. */
function buildRedirectUri(req) {
  return `${req.protocol}://${req.get('host')}/api/google-drive/callback`;
}

/**
 * Return an HTML page that handles OAuth callback response.
 * Supports both popup mode (postMessage) and redirect mode (sessionStorage).
 *
 * The JSON payload has <, >, and & escaped to their Unicode equivalents so
 * that no injected error message (e.g. containing </script>) can break out of
 * the <script> block and inject HTML.
 */
function callbackResponse(res, type, extra = {}) {
  const payload = JSON.stringify({ type, ...extra })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  res.set({
    'Content-Type':  'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Google Drive Authorization</title>
  <style>
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .container {
      text-align: center;
      max-width: 500px;
      background: #16213e;
      padding: 40px;
      border-radius: 8px;
      border: 1px solid #2a2a4e;
    }
    .icon { font-size: 48px; margin-bottom: 20px; }
    .icon.success { color: #2ecc71; }
    .icon.error { color: #e74c3c; }
    h1 { font-size: 20px; margin: 0 0 12px 0; }
    p { color: #a0a0a0; margin: 0 0 24px 0; line-height: 1.5; }
    .btn {
      display: inline-block;
      background: #3498db;
      color: #fff;
      padding: 10px 24px;
      border-radius: 4px;
      text-decoration: none;
      font-size: 14px;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .spinner {
      border: 3px solid #2a2a4e;
      border-top: 3px solid #3498db;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container" id="content">
    <div class="spinner"></div>
    <p>Completing authorization...</p>
  </div>
  <script>
    (function () {
      var msg = ${payload};
      var isPopup = window.opener && !window.opener.closed;

      // Store result in sessionStorage for redirect mode
      try {
        sessionStorage.setItem('gdrive_auth_result', JSON.stringify(msg));
      } catch (e) { /* storage unavailable */ }

      // If opened as popup, send postMessage and close
      if (isPopup) {
        try {
          window.opener.postMessage(msg, window.location.origin);
        } catch (e) { /* opener gone */ }
        window.close();
        return;
      }

      // Redirect mode: show result and redirect after brief delay
      var content = document.getElementById('content');
      if (msg.type === 'drive-auth-success') {
        content.innerHTML =
          '<div class="icon success">✓</div>' +
          '<h1>Authorization Successful</h1>' +
          '<p>Your Google Drive account has been connected. Redirecting...</p>';
        setTimeout(function() {
          window.location.href = '/?gdrive_auth=success';
        }, 1500);
      } else {
        var errorMsg = msg.error || 'Unknown error occurred';
        content.innerHTML =
          '<div class="icon error">✕</div>' +
          '<h1>Authorization Failed</h1>' +
          '<p>' + escapeHtml(errorMsg) + '</p>' +
          '<a href="/" class="btn">Return to Application</a>';
      }

      function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }
    })();
  </script>
</body>
</html>`);
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

  res.json({ url });
});

// ─── GET /api/google-drive/callback ───────────────────────────────────────────
// OAuth2 redirect target. Validates the CSRF state, exchanges the authorization
// code for tokens, stores the refresh token, then signals the opener via
// postMessage and closes itself.
router.get('/callback', readLimit, async (req, res) => {
  const { code, error, state } = req.query;

  if (error) return callbackResponse(res, 'drive-auth-error', { error: String(error) });
  if (!code)  return callbackResponse(res, 'drive-auth-error', { error: 'Missing authorization code' });

  // Validate the CSRF state token before exchanging the code.
  if (!_consumeState(state)) {
    return callbackResponse(res, 'drive-auth-error', {
      error: 'Invalid or expired state parameter; please try connecting again.',
    });
  }

  const creds = getCredentials();
  if (!creds.client_id || !creds.client_secret) {
    return callbackResponse(res, 'drive-auth-error', { error: 'OAuth2 credentials not configured' });
  }

  const redirectUri  = buildRedirectUri(req);
  const oauth2Client = buildOAuth2Client(creds.client_id, creds.client_secret, redirectUri);

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (tokens.refresh_token) {
      // Store the newly issued refresh token.
      persistCredentials({ refresh_token: tokens.refresh_token });
      return callbackResponse(res, 'drive-auth-success');
    }

    // Google did not return a new refresh_token (common on re-auth when the
    // existing grant is still valid). If we already have a stored token the
    // session remains usable — report success.
    if (creds.refresh_token) {
      return callbackResponse(res, 'drive-auth-success');
    }

    // No usable token at all: tell the user to disconnect and try again.
    callbackResponse(res, 'drive-auth-error', {
      error: 'Google did not return a refresh token. Please disconnect and connect again.',
    });
  } catch (err) {
    callbackResponse(res, 'drive-auth-error', { error: err.message });
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
    res.json({ accessToken: token });
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
// User-entered credentials (client_id, client_secret) are preserved.
router.delete('/auth', writeLimit, (req, res) => {
  const { client_id, client_secret } = getCredentials();
  db.prepare("UPDATE api_credentials SET credentials = ? WHERE service = 'google_drive'")
    .run(JSON.stringify({
      client_id:     client_id     || '',
      client_secret: client_secret || '',
    }));
  res.json({ ok: true });
});

// ─── GET /api/google-drive/folders ───────────────────────────────────────────
// Returns a list of immediate sub-folders within the specified Drive folder.
// Uses the OAuth2 refresh token directly — no API key required.
// Query param: parentId  (default: 'root' = My Drive root)
router.get('/folders', readLimit, async (req, res) => {
  const creds = getCredentials();
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    return res.status(401).json({
      error: 'Google Drive is not authenticated – please connect via the API Settings panel',
    });
  }

  const parentId = typeof req.query.parentId === 'string' ? req.query.parentId : 'root';

  // Drive folder IDs are alphanumeric with underscores and hyphens (max ~44 chars).
  // 'root' is a special alias for My Drive root.  Reject anything else to prevent
  // query-string injection into the Drive API filter.
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(parentId)) {
    return res.status(400).json({ error: 'Invalid parentId' });
  }

  try {
    const drive = buildDriveClientFromOAuth(creds.client_id, creds.client_secret, creds.refresh_token);
    const response = await drive.files.list({
      q:        `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields:   'files(id, name)',
      orderBy:  'name',
      pageSize: 200,
    });
    res.json({ folders: response.data.files || [] });
  } catch (err) {
    res.status(500).json({ error: `Failed to list folders: ${err.message}` });
  }
});

// ─── GET /api/google-drive/migrate/status ────────────────────────────────────
// Checks whether the root folder contains legacy domain folders that should be
// migrated into the new category-based structure.
router.get('/migrate/status', readLimit, async (req, res) => {
  const creds = getCredentials();
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    return res.status(401).json({
      error: 'Google Drive is not authenticated – please connect via the API Settings panel',
    });
  }

  // Validate the stored root folder ID before passing it to Drive helpers.
  const DRIVE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
  const rootFolderId = (creds.root_folder_id && DRIVE_ID_RE.test(creds.root_folder_id))
    ? creds.root_folder_id
    : null;

  try {
    const drive = buildDriveClientFromOAuth(creds.client_id, creds.client_secret, creds.refresh_token);

    const categoryNames = new Set(
      Object.values(DRIVE_CATEGORIES).map(c => c.folder)
    );

    // Domain-like name heuristic — matches the same pattern used by migrateDriveFolders().
    const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;

    const rootChildren = await listSubfolders(drive, rootFolderId);
    const legacy = rootChildren.filter(f => !categoryNames.has(f.name) && DOMAIN_RE.test(f.name));

    res.json({
      needed:       legacy.length > 0,
      legacyCount:  legacy.length,
      legacyNames:  legacy.map(f => f.name),
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to check migration status: ${err.message}` });
  }
});

// ─── POST /api/google-drive/migrate ──────────────────────────────────────────
// Moves legacy domain folders from the root folder into the "Crawls" category
// folder.  Idempotent: safe to call multiple times.
router.post('/migrate', writeLimit, async (req, res) => {
  const creds = getCredentials();
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    return res.status(401).json({
      error: 'Google Drive is not authenticated – please connect via the API Settings panel',
    });
  }

  try {
    const result = await migrateDriveFolders({
      clientId:     creds.client_id,
      clientSecret: creds.client_secret,
      refreshToken: creds.refresh_token,
      rootFolderId: creds.root_folder_id || undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Migration failed: ${err.message}` });
  }
});

module.exports = router;
