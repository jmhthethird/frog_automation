'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const rateLimit = require('express-rate-limit');
const { db, DATA_DIR } = require('../db');
const { validateCronExpression, computeNextRun } = require('../scheduler');
const { parseCSV } = require('../differ');
const { DEFAULT_EXPORT_TABS } = require('../constants/exportTabs');
const { buildJobLabel } = require('../utils');
const { stopJob } = require('../crawler');

const router = express.Router();

// Allow generous limits – this is a LAN-only tool.
// The primary goal is to prevent accidental runaway automation.
const readLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const writeLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

// ─── Helpers ──────────────────────────────────────────────────────────────────
function computeDurationSeconds(started_at, completed_at) {
  if (!started_at || !completed_at) return undefined;
  const startMs = new Date(started_at + 'Z').getTime();
  const endMs   = new Date(completed_at + 'Z').getTime();
  return Math.round((endMs - startMs) / 1000);
}

// ─── List jobs ───────────────────────────────────────────────────────────────
router.get('/', readLimit, (req, res) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);

  const total = db.prepare('SELECT COUNT(*) AS cnt FROM jobs').get().cnt;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const safeOffset = (safePage - 1) * limit;

  const jobs = db.prepare(`
    SELECT jobs.*, profiles.name AS profile_name,
           spider_configs.name AS spider_config_name
    FROM jobs
    LEFT JOIN profiles ON jobs.profile_id = profiles.id
    LEFT JOIN spider_configs ON jobs.spider_config_id = spider_configs.id
    ORDER BY jobs.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, safeOffset);

  for (const job of jobs) {
    const dur = computeDurationSeconds(job.started_at, job.completed_at);
    if (dur !== undefined) job.duration_seconds = dur;
  }

  res.json({ jobs, total, page: safePage, totalPages });
});

// ─── Get single job ──────────────────────────────────────────────────────────
router.get('/:id', readLimit, (req, res) => {
  const job = db.prepare(`
    SELECT jobs.*, profiles.name AS profile_name,
           spider_configs.name AS spider_config_name
    FROM jobs
    LEFT JOIN profiles ON jobs.profile_id = profiles.id
    LEFT JOIN spider_configs ON jobs.spider_config_id = spider_configs.id
    WHERE jobs.id = ?
  `).get(req.params.id);

  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Compute duration whenever both timestamps are available
  const dur = computeDurationSeconds(job.started_at, job.completed_at);
  if (dur !== undefined) job.duration_seconds = dur;

  // Look up the most recent previous completed crawl for the same URL
  const prevJob = db.prepare(`
    SELECT started_at, completed_at FROM jobs
    WHERE url = ? AND status = 'completed' AND id != ?
    ORDER BY completed_at DESC LIMIT 1
  `).get(job.url, job.id);

  if (prevJob) {
    const prevDur = computeDurationSeconds(prevJob.started_at, prevJob.completed_at);
    if (prevDur !== undefined) {
      job.prev_duration_seconds = prevDur;
      job.prev_completed_at = prevJob.completed_at;
    }
  }

  res.json(job);
});

// ─── Stream job log ───────────────────────────────────────────────────────────
router.get('/:id/log', readLimit, (req, res) => {
  const job = db.prepare('SELECT id, output_dir FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (!job.output_dir) {
    return res.status(404).json({ error: 'No log available yet' });
  }

  const logFile = path.join(job.output_dir, 'crawler.log');

  // Safety: ensure logFile is inside DATA_DIR
  const realLog  = path.resolve(logFile);
  const realData = path.resolve(DATA_DIR);
  if (!realLog.startsWith(realData + path.sep)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!fs.existsSync(logFile)) {
    return res.status(404).json({ error: 'No log available yet' });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  const stream = fs.createReadStream(logFile, { encoding: 'utf8' });
  stream.on('error', () => res.end());
  stream.pipe(res);
});

// ─── Submit job ───────────────────────────────────────────────────────────────
router.post('/', writeLimit, (req, res) => {
  const { url, profile_id, spider_config_id, export_tabs, cron_expression } = req.body;

  // Validate URL
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'URL must use http or https scheme' });
  }

  // Validate profile_id if provided
  if (profile_id !== undefined && profile_id !== null && profile_id !== '') {
    const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profile_id);
    if (!profile) return res.status(400).json({ error: 'Profile not found' });
  }

  // Validate spider_config_id if provided
  if (spider_config_id !== undefined && spider_config_id !== null && spider_config_id !== '') {
    const sc = db.prepare('SELECT id FROM spider_configs WHERE id = ?').get(spider_config_id);
    if (!sc) return res.status(400).json({ error: 'Spider config not found' });
  }

  // Validate cron_expression if provided
  let cronExpr = null;
  let nextRunAt = null;
  if (cron_expression !== undefined && cron_expression !== null && cron_expression !== '') {
    if (typeof cron_expression !== 'string' || !validateCronExpression(cron_expression)) {
      return res.status(400).json({ error: 'Invalid cron expression' });
    }
    cronExpr = cron_expression.trim();
    nextRunAt = computeNextRun(cronExpr);
  }

  const tabs = (export_tabs && export_tabs.trim())
    ? export_tabs.trim()
    : DEFAULT_EXPORT_TABS;

  // Cron jobs start in 'scheduled' state; regular jobs go straight to 'queued'.
  const initialStatus = cronExpr ? 'scheduled' : 'queued';

  // Create output dir path (will be created when job runs)
  const jobRow = db.prepare(`
    INSERT INTO jobs (url, profile_id, spider_config_id, export_tabs, status, cron_expression, next_run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    url,
    profile_id || null,
    spider_config_id || null,
    tabs,
    initialStatus,
    cronExpr,
    nextRunAt,
  );

  const jobId = jobRow.lastInsertRowid;
  const outputDir = path.join(DATA_DIR, 'jobs', String(jobId));

  // Store the output dir path
  db.prepare('UPDATE jobs SET output_dir = ? WHERE id = ?').run(outputDir, jobId);

  if (cronExpr) {
    // Register the cron task; job will be pushed to queue when the schedule fires.
    req.app.get('scheduler').register(jobId, cronExpr);
  } else {
    // Enqueue immediately.
    req.app.get('queue').push(jobId);
  }

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  res.status(201).json(job);
});

// ─── Get diff summary ─────────────────────────────────────────────────────────
router.get('/:id/diff', readLimit, (req, res) => {
  const job = db.prepare('SELECT id, status, diff_summary FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status !== 'completed') {
    return res.status(409).json({ error: 'Diff is only available for completed jobs' });
  }

  if (!job.diff_summary) {
    return res.status(404).json({ error: 'No diff available – this may be the first crawl for this URL' });
  }

  try {
    res.json(JSON.parse(job.diff_summary));
  } catch {
    res.status(500).json({ error: 'Diff data is corrupt' });
  }
});

// ─── Download job zip ─────────────────────────────────────────────────────────
router.get('/:id/download', readLimit, (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'completed' || !job.zip_path) {
    return res.status(409).json({ error: 'Job results not available yet' });
  }

  // Safety: ensure zip_path is inside DATA_DIR
  const realZip = path.resolve(job.zip_path);
  const realData = path.resolve(DATA_DIR);
  if (!realZip.startsWith(realData + path.sep)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.download(realZip, `${buildJobLabel(job.url, job.completed_at, job.id)}.zip`);
});

// ─── SF Compare summary ───────────────────────────────────────────────────────
router.get('/:id/compare', readLimit, (req, res) => {
  const job = db.prepare('SELECT id, status, output_dir FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status !== 'completed') {
    return res.status(409).json({ error: 'Compare is only available for completed jobs' });
  }

  const compareDir = job.output_dir ? path.join(job.output_dir, 'compare') : null;

  if (!compareDir) {
    return res.status(404).json({ error: 'No compare output available – this may be the first crawl for this URL or .seospider files were not found' });
  }

  // Safety: ensure compareDir is inside DATA_DIR
  const realCompare = path.resolve(compareDir);
  const realData = path.resolve(DATA_DIR);
  if (!realCompare.startsWith(realData + path.sep)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!fs.existsSync(compareDir)) {
    return res.status(404).json({ error: 'No compare output available – this may be the first crawl for this URL or .seospider files were not found' });
  }

  // Read all CSV files from the compare directory and return their data.
  let entries;
  try {
    entries = fs.readdirSync(compareDir, { withFileTypes: true });
  } catch {
    return res.status(500).json({ error: 'Failed to read compare output directory' });
  }

  const files = {};
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.csv')) continue;
    try {
      const content = fs.readFileSync(path.join(compareDir, entry.name), 'utf8');
      files[entry.name] = parseCSV(content);
    } catch { /* skip unreadable files */ }
  }

  if (Object.keys(files).length === 0) {
    return res.status(404).json({ error: 'No compare output available – this may be the first crawl for this URL or .seospider files were not found' });
  }

  res.json({ files });
});

// ─── SF Compare download (zip of compare CSVs) ───────────────────────────────
router.get('/:id/compare/download', readLimit, (req, res) => {
  const job = db.prepare('SELECT id, status, url, completed_at, output_dir FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status !== 'completed') {
    return res.status(409).json({ error: 'Compare is only available for completed jobs' });
  }

  const compareDir = job.output_dir ? path.join(job.output_dir, 'compare') : null;

  if (!compareDir || !fs.existsSync(compareDir)) {
    return res.status(404).json({ error: 'No compare output available' });
  }

  // Safety: ensure compareDir is inside DATA_DIR
  const realCompare = path.resolve(compareDir);
  const realData = path.resolve(DATA_DIR);
  if (!realCompare.startsWith(realData + path.sep)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const label = buildJobLabel(job.url, job.completed_at, job.id);
  res.setHeader('Content-Disposition', `attachment; filename="${label}-compare.zip"`);
  res.setHeader('Content-Type', 'application/zip');

  const archive = archiver('zip', { zlib: { level: 6 } });
  /* istanbul ignore next */
  archive.on('error', (err) => {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create archive' });
    else res.destroy(err);
  });
  archive.pipe(res);
  archive.directory(compareDir, `${label}-compare`);
  archive.finalize();
});

// ─── Stop a running job ───────────────────────────────────────────────────────
router.post('/:id/stop', writeLimit, (req, res) => {
  const job = db.prepare('SELECT id, status FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'running') return res.status(409).json({ error: 'Job is not running' });

  const killed = stopJob(job.id);
  if (!killed) return res.status(409).json({ error: 'Job process not found' });

  const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id);
  res.json(updated);
});

// ─── Rerun a stopped/failed/completed job ─────────────────────────────────────
router.post('/:id/rerun', writeLimit, (req, res) => {
  const original = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Job not found' });

  const jobRow = db.prepare(`
    INSERT INTO jobs (url, profile_id, spider_config_id, export_tabs, status, output_dir)
    VALUES (?, ?, ?, ?, 'queued', ?)
  `).run(
    original.url,
    original.profile_id || null,
    original.spider_config_id || null,
    original.export_tabs || DEFAULT_EXPORT_TABS,
    null,
  );

  const jobId = jobRow.lastInsertRowid;
  const outputDir = path.join(DATA_DIR, 'jobs', String(jobId));
  db.prepare('UPDATE jobs SET output_dir = ? WHERE id = ?').run(outputDir, jobId);

  req.app.get('queue').push(jobId);

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  res.status(201).json(job);
});

module.exports = router;
