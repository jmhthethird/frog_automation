'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');

const router = express.Router();

const skipRateLimitInTest = process.env.NODE_ENV === 'test' ? { skip: () => true } : {};
const readLimit = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false, ...skipRateLimitInTest });

// ─── GET /api/notifications ───────────────────────────────────────────────────
// Returns actionable notifications: failed jobs and failed Drive uploads.
router.get('/', readLimit, (req, res) => {
  const rows = db.prepare(`
    SELECT id, url, status, error, drive_upload_status, drive_upload_error,
           created_at, completed_at
    FROM jobs
    WHERE status = 'failed'
       OR drive_upload_status = 'upload_failed'
    ORDER BY id DESC
    LIMIT 50
  `).all();

  const notifications = [];

  for (const row of rows) {
    if (row.status === 'failed') {
      notifications.push({
        id:        `job-failed-${row.id}`,
        type:      'job_failed',
        jobId:     row.id,
        url:       row.url,
        message:   row.error || 'Crawl job failed',
        timestamp: row.completed_at || row.created_at,
      });
    }

    if (row.drive_upload_status === 'upload_failed') {
      notifications.push({
        id:        `drive-failed-${row.id}`,
        type:      'drive_upload_failed',
        jobId:     row.id,
        url:       row.url,
        message:   row.drive_upload_error || 'Google Drive upload failed',
        timestamp: row.completed_at || row.created_at,
      });
    }
  }

  res.json({ notifications });
});

module.exports = router;
