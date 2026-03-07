'use strict';

const path = require('path');
const express = require('express');
const { db } = require('./src/db');
const Queue = require('./src/queue');
const { runJob } = require('./src/crawler');

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

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/jobs', require('./src/routes/jobs'));
app.use('/api/profiles', require('./src/routes/profiles'));
app.use('/api/health', require('./src/routes/health'));
app.use('/api/update', require('./src/routes/update'));

// ─── startServer ─────────────────────────────────────────────────────────────
/**
 * Bind the HTTP server, re-queue stale jobs, and resolve when listening.
 * @param {number} port
 * @returns {Promise<import('http').Server>}
 */
function startServer(port) {
  // Re-queue any jobs that were left running/queued when the process last exited.
  const stale = db.prepare(
    "UPDATE jobs SET status='queued', started_at=NULL WHERE status IN ('running','queued')"
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

