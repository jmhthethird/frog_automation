'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const archiver = require('archiver');
const { db } = require('./db');
const { computeDiff } = require('./differ');
const { scheduler } = require('./scheduler');

const SF_LAUNCHER =
  process.env.SF_LAUNCHER ||
  '/Applications/Screaming Frog SEO Spider.app/Contents/MacOS/ScreamingFrogSEOSpiderLauncher';

/**
 * Return the path of the first `.seospider` file found in `dir`, or `null`.
 * @param {string} dir
 * @returns {string|null}
 */
function findSeospiderFile(dir) {
  if (!dir) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.seospider')) {
        return path.join(dir, entry.name);
      }
    }
  } catch { /* dir missing or unreadable */ }
  return null;
}

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
  // Open the log file synchronously so the WriteStream has an fd immediately.
  // This eliminates any race between the async 'open' event and test cleanup.
  const logFd = fs.openSync(logFile, 'a');
  const logStream = fs.createWriteStream(null, { fd: logFd, autoClose: true });
  logStream.on('error', (err) => console.error(`[crawler] logStream error (job ${jobId}):`, err));

  try {
    await spawnCrawl(job, outputDir, logStream);
    const zipPath = await zipOutput(outputDir, jobId);
    db.prepare("UPDATE jobs SET status='completed', completed_at=datetime('now'), zip_path=? WHERE id=?")
      .run(zipPath, jobId);

    // Compute a diff against the most recent previous completed crawl of the same URL.
    try {
      const prevJob = db.prepare(`
        SELECT id, output_dir, completed_at FROM jobs
        WHERE url = ? AND status = 'completed' AND id != ?
        ORDER BY id DESC LIMIT 1
      `).get(job.url, jobId);

      if (prevJob && prevJob.output_dir) {
        const updatedJob = db.prepare('SELECT id, output_dir, completed_at FROM jobs WHERE id = ?').get(jobId);
        const diff = computeDiff(updatedJob, prevJob);
        if (diff) {
          db.prepare('UPDATE jobs SET diff_summary = ? WHERE id = ?')
            .run(JSON.stringify(diff), jobId);
        }

        // Run the native SF --compare feature when both .seospider databases exist.
        try {
          const prevSeospider = findSeospiderFile(prevJob.output_dir);
          const newSeospider  = findSeospiderFile(outputDir);
          if (prevSeospider && newSeospider) {
            const compareDir = path.join(outputDir, 'compare');
            fs.mkdirSync(compareDir, { recursive: true });
            await spawnCompare(prevSeospider, newSeospider, compareDir, logStream);
          }
        } catch (compareErr) {
          // Compare is non-critical – log but don't fail the job.
          console.error(`[crawler] SF compare failed for job ${jobId}:`, compareErr);
        }
      }
    } catch (diffErr) {
      // Diff is non-critical – log but don't fail the job.
      console.error(`[crawler] diff computation failed for job ${jobId}:`, diffErr);
    }
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err);
    db.prepare("UPDATE jobs SET status='failed', completed_at=datetime('now'), error=? WHERE id=?")
      .run(errMsg, jobId);
  } finally {
    logStream.end();
    // For recurring cron jobs, reset back to 'scheduled' so the next tick can run.
    if (job.cron_expression) {
      scheduler.reschedule(jobId, job.cron_expression);
    }
  }
}

/**
 * Spawn the Screaming Frog CLI process.
 */
function spawnCrawl(job, outputDir, logStream) {
  return new Promise((resolve, reject) => {
    const exportTabs = job.export_tabs || 'AMP:All,Analytics:All,Canonicals:All,Change Detection:All,Content:All,Custom Extraction:All,Directives:All,External:All,H1:All,H2:All,Hreflang:All,Images:All,Internal:All,JavaScript:All,Link Metrics:All,Links:All,Meta Description:All,Meta Keywords:All,Page Titles:All,PageSpeed:All,Pagination:All,Response Codes:All,Search Console:All,Security:All,Sitemaps:All,Structured Data:All,URL:All,Validation:All';

    const args = [
      '--headless',
      '--crawl', job.url,
      '--output-folder', outputDir,
      '--export-tabs', exportTabs,
      '--overwrite',
      '--save-crawl',
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

    // Accumulate output lines so we can detect FATAL errors reported by SF even
    // when the process exits with code 0 (a known SF quirk for bad --export-tabs).
    let fatalMessage = null;

    const handleData = (prefix, data) => {
      const text = data.toString();
      logLine(prefix, data);
      for (const line of text.split('\n')) {
        if (/\bFATAL\b/.test(line) && fatalMessage === null) {
          fatalMessage = line.trim();
        }
      }
    };

    proc.stdout.on('data', (d) => handleData('STDOUT', d));
    proc.stderr.on('data', (d) => handleData('STDERR', d));

    proc.on('error', (err) => {
      reject(new Error(`Crawler process error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (logStream.writable) logStream.write(`[INFO] Process exited with code ${code}\n`);
      if (fatalMessage) {
        reject(new Error(`Screaming Frog fatal error: ${fatalMessage}`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Screaming Frog exited with non-zero code: ${code}`));
      }
    });
  });
}

/**
 * Run the Screaming Frog --compare command against two .seospider databases.
 * Output files (comparison CSVs) are written to `compareOutputDir`.
 */
function spawnCompare(prevSeospiderPath, newSeospiderPath, compareOutputDir, logStream) {
  return new Promise((resolve, reject) => {
    const args = [
      '--compare', prevSeospiderPath, newSeospiderPath,
      '--output-folder', compareOutputDir,
      '--overwrite',
    ];

    const logLine = (prefix, data) => {
      if (!logStream.writable) return;
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) logStream.write(`[COMPARE:${prefix}] ${line}\n`);
      }
    };

    logStream.write(`[INFO] Running SF compare: ${SF_LAUNCHER} ${args.map(a => JSON.stringify(a)).join(' ')}\n`);

    let proc;
    try {
      proc = spawn(SF_LAUNCHER, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (spawnErr) {
      return reject(new Error(`Failed to spawn compare: ${spawnErr.message}`));
    }

    proc.stdout.on('data', (d) => logLine('STDOUT', d));
    proc.stderr.on('data', (d) => logLine('STDERR', d));

    proc.on('error', (err) => {
      reject(new Error(`Compare process error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (logStream.writable) logStream.write(`[INFO] Compare process exited with code ${code}\n`);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Screaming Frog compare exited with non-zero code: ${code}`));
      }
    });
  });
}

/**
 * Zip the output directory into <outputDir>.zip (placed alongside the dir).
 */
function zipOutput(outputDir, jobId) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) {
      return reject(new Error(`Output directory not found: ${outputDir}`));
    }
    const zipPath = `${outputDir}.zip`;
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(zipPath));
    output.on('error', reject);
    /* istanbul ignore next */
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

module.exports = { runJob, detectLauncher, zipOutput, findSeospiderFile, spawnCompare, SF_LAUNCHER };
