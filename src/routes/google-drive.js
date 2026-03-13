'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const { db }    = require('../db');

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

// ─── GET /api/google-drive/status ─────────────────────────────────────────────
// Returns whether the integration is configured (api_key + root_folder_id present).
router.get('/status', readLimit, (req, res) => {
  const creds = getCredentials();
  res.json({
    connected:      !!(creds.api_key && creds.root_folder_id),
    rootFolderId:   creds.root_folder_id   || null,
    rootFolderName: creds.root_folder_name || null,
  });
});

// ─── POST /api/google-drive/root-folder ───────────────────────────────────────
// Stores the root folder ID entered by the user.
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
// Clears the stored root folder selection.
// The api_key is preserved.
router.delete('/auth', writeLimit, (req, res) => {
  const { api_key } = getCredentials();
  db.prepare("UPDATE api_credentials SET credentials = ? WHERE service = 'google_drive'")
    .run(JSON.stringify({
      api_key: api_key || '',
    }));
  res.json({ ok: true });
});

module.exports = router;

