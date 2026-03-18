'use strict';

/**
 * update.js — Express routes for the self-update feature.
 *
 *   GET  /api/update            — current state + version info
 *   POST /api/update/check      — trigger a fresh check against the GitHub Releases API
 *   POST /api/update/download   — start downloading the available release asset
 *   GET  /api/update/status     — poll download / install progress
 *   POST /api/update/install    — install the downloaded update and restart
 *   GET  /api/update/releases   — list all GitHub releases (for rollback support)
 *   POST /api/update/select     — select a specific version for installation
 *   POST /api/update/pr         — resolve a GitHub PR URL to its test-build pre-release
 */

const express = require('express');
const updater = require('../updater');

const router = express.Router();

// ── GET /api/update ───────────────────────────────────────────────────────────
// Returns the current update state (including current app version).
router.get('/', (req, res) => {
  res.json(updater.getState());
});

// ── POST /api/update/check ────────────────────────────────────────────────────
// Triggers a fresh check against the GitHub Releases API.
router.post('/check', async (req, res) => {
  try {
    const state = await updater.checkForUpdate();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/update/download ─────────────────────────────────────────────────
// Begins downloading the release asset for the available update.
// Responds immediately; the client should poll /api/update/status for progress.
router.post('/download', (req, res) => {
  const state = updater.getState();
  if (state.status !== 'available') {
    return res.status(400).json({ error: 'No update available to download' });
  }
  if (!state.downloadUrl) {
    return res.status(400).json({
      error: 'No direct download URL available — visit the release page to download manually',
      releaseUrl: state.releaseUrl,
    });
  }

  // Fire-and-forget — the client polls /api/update/status for progress.
  updater.downloadUpdate(state.downloadUrl).catch(() => {});
  res.json({ started: true });
});

// ── GET /api/update/status ────────────────────────────────────────────────────
// Polls the current download / install progress.
router.get('/status', (req, res) => {
  res.json(updater.getState());
});

// ── POST /api/update/install ──────────────────────────────────────────────────
// Installs the downloaded update and restarts the app.  macOS only.
// Responds before initiating the restart so the client receives the reply.
router.post('/install', (req, res) => {
  const state = updater.getState();
  if (state.status !== 'ready') {
    return res.status(400).json({ error: 'No downloaded update ready to install' });
  }
  if (process.platform !== 'darwin') {
    return res.status(400).json({ error: 'Automatic install is only supported on macOS' });
  }

  // Respond before the app restarts.
  res.json({ installing: true });
  updater.installUpdate().catch(() => {
    // Errors are captured in updater state; client can check /api/update/status
  });
});

// ── GET /api/update/releases ──────────────────────────────────────────────────
// Returns all GitHub releases for version selection (supports rollback).
router.get('/releases', async (req, res) => {
  try {
    const releases = await updater.listAllReleases();
    res.json(releases);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/update/pr ───────────────────────────────────────────────────────
// Look up the pre-release test build for a GitHub PR URL and set it as the
// installation target, so the existing download / install flow can proceed.
router.post('/pr', async (req, res) => {
  const { prUrl } = req.body || {};
  if (!prUrl || typeof prUrl !== 'string') {
    return res.status(400).json({ error: 'prUrl is required' });
  }
  try {
    const state = await updater.resolvePRBuild(prUrl);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/update/select ───────────────────────────────────────────────────
// Select a specific version for installation, including older versions (rollback).
router.post('/select', (req, res) => {
  const { version, downloadUrl, releaseUrl, releaseNotes } = req.body || {};
  if (!version) {
    return res.status(400).json({ error: 'version is required' });
  }
  updater.selectVersionForInstall(
    version,
    downloadUrl  || null,
    releaseUrl   || null,
    releaseNotes || null
  );
  res.json(updater.getState());
});

module.exports = router;
