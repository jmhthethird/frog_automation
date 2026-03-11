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

// Candidate paths for the SF data directory (the folder that contains spider.config)
const SF_DATA_DIR_CANDIDATES = [
  path.join(os.homedir(), '.ScreamingFrogSEOSpider'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Screaming Frog SEO Spider'),
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

// ─── Path utilities ───────────────────────────────────────────────────────────

/**
 * Return the first accessible SF data directory on this machine, or null.
 * Respects the SF_DATA_DIR env var so tests can override the detection.
 */
function getLocalSfDataDir() {
  if (process.env.SF_DATA_DIR) return process.env.SF_DATA_DIR;
  for (const dir of SF_DATA_DIR_CANDIDATES) {
    try {
      fs.accessSync(dir, fs.constants.R_OK);
      return dir;
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Parse a spider.config (Java Properties XML) into a plain { key: value } map.
 * Only captures <entry key="...">...</entry> elements.
 */
function parseSpiderConfigEntries(content) {
  const entries = {};
  const re = /<entry key="([^"]+)">([^<]*)<\/entry>/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    entries[m[1]] = m[2];
  }
  return entries;
}

/**
 * Read the laptop's live spider.config and return its entries as a map.
 * Returns an empty object when no local SF installation is found.
 */
function getLaptopConfigEntries() {
  const sfDataDir = getLocalSfDataDir();
  if (!sfDataDir) return {};
  try {
    const content = fs.readFileSync(path.join(sfDataDir, 'spider.config'), 'utf8');
    return parseSpiderConfigEntries(content);
  } catch {
    return {};
  }
}

/**
 * Patch a spider.config so that every entry whose value is a machine-specific
 * absolute path is replaced with the corresponding value from the laptop's own
 * spider.config.  This ensures paths like storage.db_dir and ui.recent_config_0
 * resolve correctly on the machine running the crawl.
 *
 * When laptopEntries is not supplied (or is empty) - e.g. because no local
 * SF installation was found - absolute-path entries are simply cleared so that
 * Screaming Frog falls back to its built-in defaults.
 *
 * Non-path entries are always left unchanged.
 *
 * @param {string} content            - Raw spider.config XML content.
 * @param {Object} [laptopEntries={}] - Key->value map parsed from the laptop config.
 * @returns {string} Patched content.
 */
function sanitizeSpiderConfig(content, laptopEntries = {}) {
  return content.replace(
    /<entry key="([^"]+)">([^<]*)<\/entry>/g,
    (match, key, value) => {
      const trimmed = value.trim();
      // Detect Unix absolute paths, Windows drive paths, and UNC paths.
      const isAbsPath =
        /^\//.test(trimmed) ||
        /^[A-Za-z]:[\\/]/.test(trimmed) ||
        /^\\\\/.test(trimmed);
      if (!isAbsPath) return match;

      // Replace with the laptop's value for this key, or clear if unavailable.
      const laptopVal = laptopEntries[key];
      const hasLaptopVal = laptopVal !== undefined && String(laptopVal).trim() !== '';
      return `<entry key="${key}">${hasLaptopVal ? laptopVal : ''}</entry>`;
    }
  );
}

// ─── Auto-import helper (shared by startup and the /import-local endpoint) ───

/**
 * Import (or refresh) the laptop's live spider.config into the DB library.
 *
 * - First call: creates a new record with is_local = 1.
 * - Subsequent calls: refreshes the stored file content so it stays current.
 *
 * The laptop config is saved as-is - no path sanitization - because its paths
 * are already correct for this machine and it serves as the reference when
 * patching uploaded configs.
 *
 * @param {import('better-sqlite3').Database} database
 * @param {string} [name]  Display name (only applied on first-time import).
 * @returns {Object|null}  The DB record, or null if no local config was found.
 */
function doImportLocal(database, name) {
  const sfDataDir = getLocalSfDataDir();
  if (!sfDataDir) return null;

  const localConfigPath = path.join(sfDataDir, 'spider.config');
  let content;
  try {
    content = fs.readFileSync(localConfigPath, 'utf8');
  } catch {
    return null; // spider.config not readable
  }

  const existing = database.prepare('SELECT * FROM spider_configs WHERE is_local = 1').get();
  if (existing) {
    // Refresh the stored file so it reflects any SF config changes since last import.
    try { fs.writeFileSync(existing.filepath, content, 'utf8'); } catch { /* non-critical */ }
    return database.prepare('SELECT * FROM spider_configs WHERE id = ?').get(existing.id);
  }

  // First-time import - create the directory entry and DB record.
  const displayName = (name && name.trim()) ? name.trim() : 'Laptop (auto-imported)';
  const unique = `${Date.now()}-spider.config`;
  const destPath = path.join(SPIDER_CONFIGS_DIR, unique);
  fs.writeFileSync(destPath, content, 'utf8');
  const result = database.prepare(
    'INSERT INTO spider_configs (name, filename, filepath, is_local) VALUES (?, ?, ?, 1)'
  ).run(displayName, unique, destPath);
  return database.prepare('SELECT * FROM spider_configs WHERE id = ?').get(result.lastInsertRowid);
}

/**
 * Called once at server startup.  Silently auto-imports (or refreshes) the
 * laptop's spider.config.  No-op when no local SF installation is found.
 *
 * @param {import('better-sqlite3').Database} database
 */
function autoImportLocalConfig(database) {
  try {
    doImportLocal(database);
  } catch (err) {
    console.warn('[spider-configs] Auto-import of local spider.config failed:', err.message);
  }
}

// ─── List spider configs ──────────────────────────────────────────────────────
// Laptop config (is_local=1) is listed first so it always appears at the top.
router.get('/', readLimit, (req, res) => {
  const configs = db.prepare('SELECT * FROM spider_configs ORDER BY is_local DESC, id DESC').all();
  res.json(configs);
});

// ─── Check for a local SF spider.config ──────────────────────────────────────
router.get('/local', readLimit, (req, res) => {
  const sfDataDir = getLocalSfDataDir();
  if (!sfDataDir) return res.json({ found: false });
  const configPath = path.join(sfDataDir, 'spider.config');
  try {
    fs.accessSync(configPath, fs.constants.R_OK);
    return res.json({ found: true, path: configPath });
  } catch {
    return res.json({ found: false });
  }
});

// ─── Import / refresh the local SF spider.config ──────────────────────────────
router.post('/import-local', writeLimit, (req, res) => {
  const name = (req.body && req.body.name && req.body.name.trim())
    ? req.body.name.trim()
    : undefined;

  try {
    const config = doImportLocal(db, name);
    if (!config) {
      return res.status(404).json({ error: 'No local spider.config found on this machine' });
    }
    res.status(201).json(config);
  } catch (err) {
    res.status(500).json({ error: `Failed to import local spider.config: ${err.message}` });
  }
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

    // Patch absolute-path entries using the laptop's spider.config as the
    // reference, so paths like storage.db_dir and ui.recent_config_0 resolve
    // correctly on the machine running the crawl.
    try {
      const content = fs.readFileSync(req.file.path, 'utf8');
      const laptopEntries = getLaptopConfigEntries();
      const patched = sanitizeSpiderConfig(content, laptopEntries);
      fs.writeFileSync(req.file.path, patched, 'utf8');
    } catch (patchErr) {
      /* Non-critical – proceed with original content */
      console.warn('[spider-configs] Path patch failed:', patchErr.message);
    }

    const result = db.prepare(
      'INSERT INTO spider_configs (name, filename, filepath, is_local) VALUES (?, ?, ?, 0)'
    ).run(name, req.file.filename, req.file.path);

    const config = db.prepare('SELECT * FROM spider_configs WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(config);
  });
});

// ─── Delete spider config ─────────────────────────────────────────────────────
router.delete('/:id', writeLimit, (req, res) => {
  const config = db.prepare('SELECT * FROM spider_configs WHERE id = ?').get(req.params.id);
  if (!config) return res.status(404).json({ error: 'Spider config not found' });

  // The laptop config serves as the reference for patching uploaded configs.
  // Block accidental deletion; use the re-import button to refresh it instead.
  if (config.is_local) {
    return res.status(403).json({
      error: 'The laptop spider config cannot be deleted. Use the re-import button to refresh it.',
    });
  }

  try { fs.unlinkSync(config.filepath); } catch { /* already gone */ }

  db.prepare('DELETE FROM spider_configs WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = {
  router,
  sanitizeSpiderConfig,
  parseSpiderConfigEntries,
  getLocalSfDataDir,
  getLaptopConfigEntries,
  autoImportLocalConfig,
};
