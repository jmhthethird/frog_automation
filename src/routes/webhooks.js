'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const { db }    = require('../db');

const router = express.Router();

const readLimit  = rateLimit({ windowMs: 60_000, max: 60,  standardHeaders: true, legacyHeaders: false });
const writeLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

// ─── GET /api/webhooks ────────────────────────────────────────────────────────
// Returns all registered webhooks.
router.get('/', readLimit, (req, res) => {
  const webhooks = db.prepare(`
    SELECT id, url, event_type, enabled, created_at
    FROM webhooks
    ORDER BY created_at DESC
  `).all();

  res.json(webhooks);
});

// ─── POST /api/webhooks ───────────────────────────────────────────────────────
// Create a new webhook.
router.post('/', writeLimit, (req, res) => {
  const { url, event_type, enabled } = req.body || {};

  // Validation
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: '"url" is required and must be a non-empty string' });
  }

  if (!event_type || typeof event_type !== 'string') {
    return res.status(400).json({ error: '"event_type" is required and must be a string' });
  }

  // Validate event_type against allowed values
  const allowedEvents = ['upload.success', 'upload.failure'];
  if (!allowedEvents.includes(event_type)) {
    return res.status(400).json({
      error: `"event_type" must be one of: ${allowedEvents.join(', ')}`,
    });
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: '"url" must be a valid HTTP/HTTPS URL' });
  }

  const enabledValue = enabled === false ? 0 : 1;

  const result = db.prepare(`
    INSERT INTO webhooks (url, event_type, enabled)
    VALUES (?, ?, ?)
  `).run(url.trim(), event_type, enabledValue);

  const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(result.lastInsertRowid);

  res.status(201).json(webhook);
});

// ─── PUT /api/webhooks/:id ────────────────────────────────────────────────────
// Update a webhook's enabled status.
router.put('/:id', writeLimit, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { enabled } = req.body || {};

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid webhook ID' });
  }

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: '"enabled" must be a boolean' });
  }

  const existing = db.prepare('SELECT id FROM webhooks WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Webhook not found' });
  }

  db.prepare('UPDATE webhooks SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);

  const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
  res.json(webhook);
});

// ─── DELETE /api/webhooks/:id ─────────────────────────────────────────────────
// Delete a webhook.
router.delete('/:id', writeLimit, (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid webhook ID' });
  }

  const existing = db.prepare('SELECT id FROM webhooks WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Webhook not found' });
  }

  db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);

  res.json({ ok: true });
});

module.exports = router;
