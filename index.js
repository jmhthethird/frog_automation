'use strict';

const path = require('path');
const express = require('express');
const { db } = require('./src/db');
const Queue = require('./src/queue');
const { runJob } = require('./src/crawler');
const { scheduler } = require('./src/scheduler');
const { autoImportLocalConfig } = require('./src/routes/spider-configs');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Job queue ────────────────────────────────────────────────────────────────
const queue = new Queue(runJob);
queue.on('error', (err, jobId) => {
  console.error(`[queue] Unhandled error for job ${jobId}:`, err);
});
app.set('queue', queue);

// ─── Cron scheduler ───────────────────────────────────────────────────────────
scheduler.init(queue);
app.set('scheduler', scheduler);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/jobs', require('./src/routes/jobs'));
app.use('/api/profiles', require('./src/routes/profiles'));
app.use('/api/spider-configs', require('./src/routes/spider-configs').router);
app.use('/api/health', require('./src/routes/health'));
app.use('/api/update', require('./src/routes/update'));
app.use('/api/api-credentials', require('./src/routes/api-credentials'));

// ─── startServer ─────────────────────────────────────────────────────────────
/**
 * Bind the HTTP server, re-queue stale jobs, and resolve when listening.
 * @param {number} port
 * @returns {Promise<import('http').Server>}
 */
function startServer(port) {
  // Auto-import (or refresh) the laptop's spider.config into the library.
  autoImportLocalConfig(db);

  // Re-queue any non-cron jobs that were left running/queued when the process last exited.
  const stale = db.prepare(
    "UPDATE jobs SET status='queued', started_at=NULL WHERE status IN ('running','queued') AND cron_expression IS NULL"
  ).run();
  // Reset stale cron jobs back to 'scheduled' – they will be picked up by the scheduler.
  db.prepare(
    "UPDATE jobs SET status='scheduled', started_at=NULL WHERE status IN ('running','queued') AND cron_expression IS NOT NULL"
  ).run();
  if (stale.changes > 0) {
    console.log(`[startup] Re-queued ${stale.changes} stale job(s)`);
  }
  const pendingJobs = db.prepare("SELECT id FROM jobs WHERE status='queued' ORDER BY id ASC").all();
  for (const { id } of pendingJobs) {
    queue.push(id);
  }

  return new Promise((resolve) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`Frog Automation server running on http://0.0.0.0:${port}`);
      console.log(`Access from this machine: http://localhost:${port}`);
      console.log(`Access from LAN: http://<your-ip>:${port}`);
      resolve(server);
    });
  });
}

// ─── Auto-start when executed directly (node index.js / npm start) ───────────
/* istanbul ignore next */
if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  startServer(PORT);
}

module.exports = { app, startServer };

