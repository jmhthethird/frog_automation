'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { acquireLock, releaseLock, cancelLock, setProgress, getLockState } = require('../automation-lock');
const {
  buildDriveClientFromOAuth, listDomainsWithCrawlData,
} = require('../google-drive');

const router = express.Router();

// ─── Rate limiting (skipped in test env) ──────────────────────────────────────
const skipRateLimitInTest = process.env.NODE_ENV === 'test' ? { skip: () => true } : {};
const readLimit  = rateLimit({ windowMs: 60_000, max: 120, ...skipRateLimitInTest });
const writeLimit = rateLimit({ windowMs: 60_000, max: 30,  ...skipRateLimitInTest });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read Google Drive credentials from the DB.
 * @returns {{ client_id: string, client_secret: string, refresh_token: string, root_folder_id: string }|null}
 */
function getDriveCreds() {
  const row = db.prepare("SELECT credentials FROM api_credentials WHERE service = 'google_drive'").get();
  if (!row) return null;
  const creds = JSON.parse(row.credentials);
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) return null;
  return creds;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * GET /api/automation/domains
 * List domains that have crawl data in Google Drive.
 */
router.get('/domains', readLimit, async (req, res) => {
  try {
    const creds = getDriveCreds();
    if (!creds) return res.status(503).json({ error: 'Google Drive not connected' });

    const drive = buildDriveClientFromOAuth(creds.client_id, creds.client_secret, creds.refresh_token);
    const domains = await listDomainsWithCrawlData(creds.root_folder_id, drive);
    res.json({ domains });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * GET /api/automation/status
 * Return the current automation lock state.
 */
router.get('/status', readLimit, (_req, res) => {
  res.json(getLockState());
});

/**
 * DELETE /api/automation/cancel
 * Signal cancellation to the running automation.
 */
router.delete('/cancel', writeLimit, (_req, res) => {
  cancelLock();
  res.json({ cancelled: true });
});

/**
 * POST /api/automation/run
 * Start an automation run asynchronously.
 * Body: { automationId: string, domains: string[] }
 */
router.post('/run', writeLimit, async (req, res) => {
  try {
    const { automationId, domains } = req.body || {};
    if (!automationId || !Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({ error: 'automationId and a non-empty domains array are required' });
    }

    const creds = getDriveCreds();
    if (!creds) return res.status(503).json({ error: 'Google Drive not connected' });

    const acquired = acquireLock(automationId, domains);
    if (!acquired) return res.status(409).json({ error: 'Automation already running' });

    // Kick off the automation asynchronously — do NOT await.
    _runAutomation(automationId, domains, creds).catch(() => {});

    res.status(202).json({ started: true });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ─── Async runner (fire-and-forget) ───────────────────────────────────────────

async function _runAutomation(automationId, domains, creds) {
  try {
    let runner;
    if (automationId === 'content-architecture-audit') {
      runner = require('../automations/content-architecture-audit');
    } else {
      throw new Error(`Unknown automation: ${automationId}`);
    }

    const progressCallback = (msg) => { setProgress(msg); };
    const results = await runner.run(domains, creds, progressCallback);
    releaseLock(results, null);
  } catch (err) {
    releaseLock(null, err.message || String(err));
  }
}

module.exports = router;
