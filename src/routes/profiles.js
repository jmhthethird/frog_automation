'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { db, DATA_DIR } = require('../db');

const router = express.Router();

const readLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const writeLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
fs.mkdirSync(PROFILES_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PROFILES_DIR),
  filename: (req, file, cb) => {
    // Sanitise: strip directory components, allow only safe characters
    const base = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const unique = `${Date.now()}-${base}`;
    cb(null, unique);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.seospiderconfig') {
    return cb(new Error('Only .seospiderconfig files are allowed'), false);
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

// ─── List profiles ────────────────────────────────────────────────────────────
router.get('/', readLimit, (req, res) => {
  const profiles = db.prepare('SELECT * FROM profiles ORDER BY id DESC').all();
  res.json(profiles);
});

// ─── Upload new profile ───────────────────────────────────────────────────────
router.post('/', writeLimit, (req, res, next) => {
  upload.single('profile')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Profile file too large (max 10 MB)' });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No profile file provided' });
    }

    const name = (req.body && req.body.name && req.body.name.trim())
      ? req.body.name.trim()
      : path.basename(req.file.originalname, '.seospiderconfig');

    // Safety: ensure stored path is inside PROFILES_DIR
    const realFile = path.resolve(req.file.path);
    const realProfiles = path.resolve(PROFILES_DIR);
    if (!realFile.startsWith(realProfiles + path.sep)) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = db.prepare(
      'INSERT INTO profiles (name, filename, filepath) VALUES (?, ?, ?)'
    ).run(name, req.file.filename, req.file.path);

    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(profile);
  });
});

// ─── Delete profile ───────────────────────────────────────────────────────────
router.delete('/:id', writeLimit, (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  // Remove file if it exists
  try { fs.unlinkSync(profile.filepath); } catch { /* already gone */ }

  db.prepare('DELETE FROM profiles WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
