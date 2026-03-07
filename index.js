'use strict';

const path = require('path');
const express = require('express');
const { db } = require('./src/db');
const Queue = require('./src/queue');
const { runJob } = require('./src/crawler');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

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

// Re-queue any jobs that were left in 'queued' or 'running' state at startup
// (running → queued to restart interrupted jobs)
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

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Frog Automation server running on http://0.0.0.0:${PORT}`);
  console.log(`Access from this machine: http://localhost:${PORT}`);
  console.log(`Access from LAN: http://<your-ip>:${PORT}`);
});

module.exports = app; // for testing
