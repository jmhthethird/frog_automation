'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { db, DATA_DIR } = require('../db');

const router = express.Router();

const readLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const writeLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

const SPIDER_CONFIGS_DIR = path.join(DATA_DIR, 'spider_configs');
fs.mkdirSync(SPIDER_CONFIGS_DIR, { recursive: true });

// Default spider.config locations per OS
const SF_SPIDER_CONFIG_PATHS = [
  path.join(os.homedir(), '.ScreamingFrogSEOSpider', 'spider.config'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Screaming Frog SEO Spider', 'spider.config'),
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SPIDER_CONFIGS_DIR),
  filename: (req, file, cb) => {
    const base = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const unique = `${Date.now()}-${base}`;
    cb(null, unique);
  },
});

function fileFilter(req, file, cb) {
  const name = file.originalname.toLowerCase();
  const ext = path.extname(name);
  if (ext !== '.seospiderconfig' && ext !== '.config' && name !== 'spider.config') {
    return cb(new Error('Only .seospiderconfig or .config files are allowed'), false);
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

/**
 * Strip entries with machine-specific absolute path values from a
 * spider.config (Java Properties XML) file.  Returns the modified content.
 * Non-path entries are left unchanged.
 */
function sanitizeSpiderConfig(content) {
  return content.replace(
    /<entry key="([^"]+)">([^<]*)<\/entry>/g,
    (match, key, value) => {
      const trimmed = value.trim();
      // Detect Unix absolute paths, Windows drive paths, and UNC paths
      const isAbsPath =
        /^\//.test(trimmed) ||
        /^[A-Za-z]:[\\/]/.test(trimmed) ||
        /^\\\\/.test(trimmed);
      if (isAbsPath) {
        return `<entry key="${key}"></entry>`;
      }
      return match;
    }
  );
}

// ─── List spider configs ──────────────────────────────────────────────────────
router.get('/', readLimit, (req, res) => {
  const configs = db.prepare('SELECT * FROM spider_configs ORDER BY id DESC').all();
  res.json(configs);
});

// ─── Check for a local SF spider.config ──────────────────────────────────────
router.get('/local', readLimit, (req, res) => {
  for (const p of SF_SPIDER_CONFIG_PATHS) {
    try {
      fs.accessSync(p, fs.constants.R_OK);
      return res.json({ found: true, path: p });
    } catch { /* not found at this path */ }
  }
  res.json({ found: false });
});

// ─── Import local SF spider.config ───────────────────────────────────────────
router.post('/import-local', writeLimit, (req, res) => {
  let localPath = null;
  for (const p of SF_SPIDER_CONFIG_PATHS) {
    try {
      fs.accessSync(p, fs.constants.R_OK);
      localPath = p;
      break;
    } catch { /* try next */ }
  }

  if (!localPath) {
    return res.status(404).json({ error: 'No local spider.config found on this machine' });
  }

  const name = (req.body && req.body.name && req.body.name.trim())
    ? req.body.name.trim()
    : 'Local SF Installation';

  const unique = `${Date.now()}-spider.config`;
  const destPath = path.join(SPIDER_CONFIGS_DIR, unique);

  try {
    let content = fs.readFileSync(localPath, 'utf8');
    content = sanitizeSpiderConfig(content);
    fs.writeFileSync(destPath, content, 'utf8');
  } catch (err) {
    return res.status(500).json({ error: `Failed to import local spider.config: ${err.message}` });
  }

  const result = db.prepare(
    'INSERT INTO spider_configs (name, filename, filepath) VALUES (?, ?, ?)'
  ).run(name, unique, destPath);

  const config = db.prepare('SELECT * FROM spider_configs WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(config);
});

// ─── Upload new spider config ─────────────────────────────────────────────────
router.post('/', writeLimit, (req, res) => {
  upload.single('spider_config')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Spider config file too large (max 10 MB)' });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No spider config file provided' });
    }

    const nameBase = path.basename(req.file.originalname, '.seospiderconfig');
    const name = (req.body && req.body.name && req.body.name.trim())
      ? req.body.name.trim()
      : path.basename(nameBase, '.config');

    // Safety: ensure stored path is inside SPIDER_CONFIGS_DIR (defence-in-depth).
    /* istanbul ignore next */
    const realFile = path.resolve(req.file.path);
    /* istanbul ignore next */
    const realDir = path.resolve(SPIDER_CONFIGS_DIR);
    /* istanbul ignore next */
    if (!realFile.startsWith(realDir + path.sep)) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Sanitize – remove machine-specific absolute-path entries
    try {
      const content = fs.readFileSync(req.file.path, 'utf8');
      const sanitized = sanitizeSpiderConfig(content);
      fs.writeFileSync(req.file.path, sanitized, 'utf8');
    } catch (sanitizeErr) {
      /* Non-critical – proceed with original content */
      console.warn('[spider-configs] Sanitize failed:', sanitizeErr.message);
    }

    const result = db.prepare(
      'INSERT INTO spider_configs (name, filename, filepath) VALUES (?, ?, ?)'
    ).run(name, req.file.filename, req.file.path);

    const config = db.prepare('SELECT * FROM spider_configs WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(config);
  });
});

// ─── Delete spider config ─────────────────────────────────────────────────────
router.delete('/:id', writeLimit, (req, res) => {
  const config = db.prepare('SELECT * FROM spider_configs WHERE id = ?').get(req.params.id);
  if (!config) return res.status(404).json({ error: 'Spider config not found' });

  try { fs.unlinkSync(config.filepath); } catch { /* already gone */ }

  db.prepare('DELETE FROM spider_configs WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = { router, sanitizeSpiderConfig };
