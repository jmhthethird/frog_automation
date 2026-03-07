'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const archiver = require('archiver');
const { db } = require('./db');

const SF_LAUNCHER =
  process.env.SF_LAUNCHER ||
  '/Applications/Screaming Frog SEO Spider.app/Contents/MacOS/ScreamingFrogSEOSpiderLauncher';

/**
 * Run a crawl job end-to-end.
 * @param {number} jobId
 */
async function runJob(jobId) {
  const job = db
    .prepare('SELECT jobs.*, profiles.filepath AS profile_path FROM jobs LEFT JOIN profiles ON jobs.profile_id = profiles.id WHERE jobs.id = ?')
    .get(jobId);

  if (!job) throw new Error(`Job ${jobId} not found`);

  db.prepare("UPDATE jobs SET status='running', started_at=datetime('now') WHERE id=?").run(jobId);

  const outputDir = job.output_dir;
  fs.mkdirSync(outputDir, { recursive: true });

  const logFile = path.join(outputDir, 'crawler.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  logStream.on('error', (err) => console.error(`[crawler] logStream error (job ${jobId}):`, err));

  try {
    await spawnCrawl(job, outputDir, logStream);
    const zipPath = await zipOutput(outputDir, jobId);
    db.prepare("UPDATE jobs SET status='completed', completed_at=datetime('now'), zip_path=? WHERE id=?")
      .run(zipPath, jobId);
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err);
    db.prepare("UPDATE jobs SET status='failed', completed_at=datetime('now'), error=? WHERE id=?")
      .run(errMsg, jobId);
  } finally {
    logStream.end();
  }
}

/**
 * Spawn the Screaming Frog CLI process.
 */
function spawnCrawl(job, outputDir, logStream) {
  return new Promise((resolve, reject) => {
    const exportTabs = job.export_tabs || 'Internal:All,Response Codes:All,Response Codes:Client Error (4xx),Redirects:All';

    const args = [
      '--headless',
      '--crawl', job.url,
      '--output-folder', outputDir,
      '--export-tabs', exportTabs,
      '--overwrite',
    ];

    if (job.profile_path) {
      args.push('--config', job.profile_path);
    }

    const logLine = (prefix, data) => {
      if (!logStream.writable) return;
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) logStream.write(`[${prefix}] ${line}\n`);
      }
    };

    logStream.write(`[INFO] Spawning: ${SF_LAUNCHER} ${args.map(a => JSON.stringify(a)).join(' ')}\n`);

    let proc;
    try {
      proc = spawn(SF_LAUNCHER, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (spawnErr) {
      return reject(new Error(`Failed to spawn crawler: ${spawnErr.message}`));
    }

    proc.stdout.on('data', (d) => logLine('STDOUT', d));
    proc.stderr.on('data', (d) => logLine('STDERR', d));

    proc.on('error', (err) => {
      reject(new Error(`Crawler process error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (logStream.writable) logStream.write(`[INFO] Process exited with code ${code}\n`);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Screaming Frog exited with non-zero code: ${code}`));
      }
    });
  });
}

/**
 * Zip the output directory into <outputDir>.zip (placed alongside the dir).
 */
function zipOutput(outputDir, jobId) {
  return new Promise((resolve, reject) => {
    const zipPath = `${outputDir}.zip`;
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(outputDir, `job-${jobId}`);
    archive.finalize();
  });
}

/** Detect if the SF launcher exists on this machine. */
function detectLauncher() {
  try {
    fs.accessSync(SF_LAUNCHER, fs.constants.X_OK);
    return { found: true, path: SF_LAUNCHER };
  } catch {
    return { found: false, path: SF_LAUNCHER };
  }
}

module.exports = { runJob, detectLauncher, zipOutput, SF_LAUNCHER };
