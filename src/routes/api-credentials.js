'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const { db }    = require('../db');

const router = express.Router();

const readLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const writeLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

/**
 * Credential field definitions per service.
 * Fields marked `sensitive: true` are masked in GET responses.
 */
const SERVICE_FIELDS = {
  google_search_console: [],
  pagespeed:             [{ name: 'api_key',    label: 'API Key',    sensitive: true }],
  majestic:              [{ name: 'api_key',    label: 'API Key',    sensitive: true }],
  mozscape:              [
    { name: 'access_id',  label: 'Access ID',   sensitive: false },
    { name: 'secret_key', label: 'Secret Key',  sensitive: true  },
  ],
  ahrefs:                [{ name: 'api_key',    label: 'API Key',    sensitive: true }],
  google_analytics:      [],
  google_analytics_4:    [],
};

const KNOWN_SERVICES = Object.keys(SERVICE_FIELDS);

/** Mask a single credential value for display (keep first 4 chars, rest as ●). */
function maskValue(value) {
  if (!value) return '';
  if (value.length <= 4) return '●'.repeat(value.length);
  return value.slice(0, 4) + '●'.repeat(Math.min(value.length - 4, 8));
}

// ─── GET /api/api-credentials ──────────────────────────────────────────────
// Returns all services with credentials masked for display.
router.get('/', readLimit, (req, res) => {
  const rows = db.prepare('SELECT service, enabled, credentials FROM api_credentials ORDER BY service').all();

  const result = KNOWN_SERVICES.map((svc) => {
    const row  = rows.find(r => r.service === svc) || { service: svc, enabled: 0, credentials: '{}' };
    const creds = JSON.parse(row.credentials || '{}');
    const fields = SERVICE_FIELDS[svc] || [];

    const maskedCreds = {};
    for (const field of fields) {
      maskedCreds[field.name] = field.sensitive ? maskValue(creds[field.name]) : (creds[field.name] || '');
    }

    return {
      service:     row.service,
      enabled:     row.enabled === 1,
      credentials: maskedCreds,
      fields,
    };
  });

  res.json(result);
});

// ─── PUT /api/api-credentials/:service ────────────────────────────────────
// Update enabled state and/or credentials for one service.
// Credential fields set to "" or null are cleared; fields set to a MASK value
// (starts with the original first-4 chars and contains ●) are left unchanged
// (i.e. the client should send the exact masked string to signal "no change",
// but an empty string to clear the value).
router.put('/:service', writeLimit, (req, res) => {
  const { service } = req.params;

  if (!KNOWN_SERVICES.includes(service)) {
    return res.status(404).json({ error: 'Unknown service' });
  }

  const { enabled, credentials } = req.body;

  if (enabled !== undefined && typeof enabled !== 'boolean') {
    return res.status(400).json({ error: '"enabled" must be a boolean' });
  }
  if (credentials !== undefined && (typeof credentials !== 'object' || Array.isArray(credentials))) {
    return res.status(400).json({ error: '"credentials" must be an object' });
  }

  const row = db.prepare('SELECT enabled, credentials FROM api_credentials WHERE service = ?').get(service);
  const existingCreds = JSON.parse(row ? (row.credentials || '{}') : '{}');
  const existingEnabled = row ? row.enabled : 0;

  const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : existingEnabled;

  // Merge credentials: if a field value contains any ● (bullet) characters it is
  // a masked display value returned by the GET endpoint – keep the existing stored
  // value instead of overwriting it.  An empty string clears the value.
  const newCreds = Object.assign({}, existingCreds);
  if (credentials) {
    for (const [key, val] of Object.entries(credentials)) {
      if (typeof val === 'string' && /[●•]/.test(val)) {
        // Contains mask characters – keep existing
      } else {
        newCreds[key] = val || '';
      }
    }
  }

  db.prepare(`
    INSERT INTO api_credentials (service, enabled, credentials)
    VALUES (?, ?, ?)
    ON CONFLICT(service) DO UPDATE SET enabled = excluded.enabled, credentials = excluded.credentials
  `).run(service, newEnabled, JSON.stringify(newCreds));

  const updated = db.prepare('SELECT service, enabled, credentials FROM api_credentials WHERE service = ?').get(service);
  const updatedCreds = JSON.parse(updated.credentials || '{}');
  const fields = SERVICE_FIELDS[service] || [];

  const maskedCreds = {};
  for (const field of fields) {
    maskedCreds[field.name] = field.sensitive ? maskValue(updatedCreds[field.name]) : (updatedCreds[field.name] || '');
  }

  res.json({
    service:     updated.service,
    enabled:     updated.enabled === 1,
    credentials: maskedCreds,
    fields,
  });
});

module.exports = router;
module.exports.SERVICE_FIELDS = SERVICE_FIELDS;
module.exports.KNOWN_SERVICES = KNOWN_SERVICES;
