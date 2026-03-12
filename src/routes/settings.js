'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');

const router = express.Router();

const readLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const writeLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

/** Maximum allowed queue concurrency. */
const MAX_CONCURRENCY = 8;

// ─── GET /api/settings ────────────────────────────────────────────────────────
router.get('/', readLimit, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const { key, value } of rows) settings[key] = value;
  res.json(settings);
});

// ─── PATCH /api/settings ──────────────────────────────────────────────────────
router.patch('/', writeLimit, (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  const VALID_KEYS = new Set(['queue_concurrency']);
  const errors = {};
  const applied = {};

  for (const [key, value] of Object.entries(updates)) {
    if (!VALID_KEYS.has(key)) {
      errors[key] = `Unknown setting "${key}"`;
      continue;
    }

    if (key === 'queue_concurrency') {
      const n = parseInt(value, 10);
      if (!Number.isInteger(n) || n < 1 || n > MAX_CONCURRENCY) {
        errors[key] = `queue_concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`;
        continue;
      }
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(n));
      applied[key] = String(n);
      // Apply to the live queue immediately if it is attached to the app.
      try {
        const queue = req.app.get('queue');
        if (queue) queue.concurrency = n;
      } catch { /* queue not attached in isolated tests */ }
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ errors });
  }

  res.json(applied);
});

module.exports = router;
