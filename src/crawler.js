'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const archiver = require('archiver');
const { db } = require('./db');
const { computeDiff } = require('./differ');
const { scheduler } = require('./scheduler');
const { DEFAULT_EXPORT_TABS } = require('./constants/exportTabs');
const { buildJobLabel } = require('./utils');
const { getLocalSfDataDir } = require('./sf-paths');
const { uploadToDrive } = require('./google-drive');

const SF_LAUNCHER =
  process.env.SF_LAUNCHER ||
  (process.platform === 'linux'
    ? '/usr/bin/ScreamingFrogSEOSpiderLauncher'
    : '/Applications/Screaming Frog SEO Spider.app/Contents/MacOS/ScreamingFrogSEOSpiderLauncher');

/** Map from jobId (number) → ChildProcess for currently running crawl jobs. */
const runningProcs = new Map();

/**
 * Map from api_credentials.service to the CLI flag that enables it, plus
 * any extra credential flags to append.
 *
 * extraArgs(creds) returns an array of additional CLI arguments derived from
 * the stored credentials object.  Returns [] when no extras are needed.
 */
const API_SERVICE_FLAGS = {
  google_search_console: { flag: '--use-google-search-console', extraArgs: () => [] },
  pagespeed:             { flag: '--use-pagespeed',                extraArgs: () => [] },
  majestic:              { flag: '--use-majestic',              extraArgs: () => [] },
  mozscape:              { flag: '--use-mozscape',              extraArgs: () => [] },
  ahrefs:                { flag: '--use-ahrefs',                extraArgs: () => [] },
  google_analytics:      { flag: '--use-google-analytics',      extraArgs: () => [] },
  google_analytics_4:    { flag: '--use-google-analytics-4',    extraArgs: () => [] },
};

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
 * Before a crawl: physically replace ~/.ScreamingFrogSEOSpider/spider.config
 * with the selected config so SF picks it up on startup.
 *
 * Returns a swizzle-state object that restoreSpiderConfig() can use to undo
 * the swap, or null when no swap could be performed (SF data dir not found, or
 * the selected config file is unreadable).
 *
 * @param {string} storedConfigPath - Absolute path to the stored spider config.
 * @param {import('fs').WriteStream} logStream
 * @returns {{ liveConfigPath: string, backupContent: string|null }|null}
 */
function swapInSpiderConfig(storedConfigPath, logStream) {
  const sfDataDir = getLocalSfDataDir();
  if (!sfDataDir) {
    if (logStream && logStream.writable) {
      logStream.write('[WARN] SF data directory not found; spider config will not be applied\n');
    }
    return null;
  }

  const liveConfigPath = path.join(sfDataDir, 'spider.config');

  // Read selected config – bail out if unreadable.
  let selectedContent;
  try {
    selectedContent = fs.readFileSync(storedConfigPath, 'utf8');
  } catch (err) {
    if (logStream && logStream.writable) {
      logStream.write(`[WARN] Could not read stored spider config (${err.message}); skipping swap\n`);
    }
    return null;
  }

  // Back up the current live spider.config (may not exist yet).
  let backupContent = null;
  try {
    backupContent = fs.readFileSync(liveConfigPath, 'utf8');
  } catch { /* no existing config – that's fine */ }

  // Write the selected config to the live location.
  try {
    fs.mkdirSync(sfDataDir, { recursive: true });
    fs.writeFileSync(liveConfigPath, selectedContent, 'utf8');
    if (logStream && logStream.writable) {
      logStream.write(`[INFO] Spider config swapped in from ${storedConfigPath}\n`);
    }
  } catch (err) {
    if (logStream && logStream.writable) {
      logStream.write(`[WARN] Failed to swap in spider config: ${err.message}\n`);
    }
    return null;
  }

  return { liveConfigPath, backupContent };
}

/**
 * After a crawl: restore the spider.config that was in place before the swap.
 * Always called (even on failure) from the finally block in runJob().
 *
 * @param {{ liveConfigPath: string, backupContent: string|null }|null} swizzleState
 * @param {import('fs').WriteStream} logStream
 */
function restoreSpiderConfig(swizzleState, logStream) {
  if (!swizzleState) return;
  const { liveConfigPath, backupContent } = swizzleState;
  try {
    if (backupContent !== null) {
      fs.writeFileSync(liveConfigPath, backupContent, 'utf8');
    } else {
      // No config existed before the swap – remove the one we wrote.
      try { fs.unlinkSync(liveConfigPath); } catch { /* already gone */ }
    }
    if (logStream && logStream.writable) {
      logStream.write('[INFO] Original spider.config restored\n');
    }
  } catch (err) {
    console.error('[crawler] Failed to restore spider.config:', err);
  }
}

/**
 * Run a crawl job end-to-end.
 * @param {number} jobId
 */
async function runJob(jobId) {
  const job = db
    .prepare(`SELECT jobs.*,
                profiles.filepath AS profile_path,
                spider_configs.filepath AS spider_config_path
              FROM jobs
              LEFT JOIN profiles ON jobs.profile_id = profiles.id
              LEFT JOIN spider_configs ON jobs.spider_config_id = spider_configs.id
              WHERE jobs.id = ?`)
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

  let swizzleState = null;
  try {
    if (job.spider_config_path) {
      swizzleState = swapInSpiderConfig(job.spider_config_path, logStream);
    }
    await spawnCrawl(job, outputDir, logStream);
    const completedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const folderName = buildJobLabel(job.url, completedAt, jobId);
    const zipPath = await zipOutput(outputDir, jobId, folderName);
    db.prepare("UPDATE jobs SET status='completed', completed_at=?, zip_path=? WHERE id=?")
      .run(completedAt, zipPath, jobId);

    // Upload the ZIP to Google Drive when the integration is enabled.
    try {
      const gdRow = db.prepare(
        "SELECT enabled, credentials FROM api_credentials WHERE service = 'google_drive'"
      ).get();
      if (gdRow && gdRow.enabled === 1) {
        const creds = JSON.parse(gdRow.credentials || '{}');
        if (creds.client_id && creds.client_secret && creds.refresh_token) {
          logStream.write('[INFO] Uploading ZIP to Google Drive…\n');
          const result = await uploadToDrive({
            clientId:     creds.client_id,
            clientSecret: creds.client_secret,
            refreshToken: creds.refresh_token,
            filePath:     zipPath,
            jobUrl:       job.url,
            rootFolderId: creds.root_folder_id || undefined,
          });
          logStream.write(
            `[INFO] Google Drive upload complete: fileId=${result.fileId} ` +
            `domain="${result.domain}" size=${result.localSize} bytes\n`
          );
        } else {
          logStream.write('[WARN] Google Drive integration is enabled but not yet authenticated; skipping upload\n');
        }
      }
    } catch (driveErr) {
      // Drive upload is non-critical – log but don't fail the job.
      logStream.write(`[WARN] Google Drive upload failed: ${driveErr.message}\n`);
      console.error(`[crawler] Google Drive upload failed for job ${jobId}:`, driveErr);
    }

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
    // Don't overwrite a 'stopped' status set by stopJob().
    const currentJob = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId);
    if (!currentJob || currentJob.status !== 'stopped') {
      db.prepare("UPDATE jobs SET status='failed', completed_at=datetime('now'), error=? WHERE id=?")
        .run(errMsg, jobId);
    }
  } finally {
    restoreSpiderConfig(swizzleState, logStream);
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
    const exportTabs = job.export_tabs || DEFAULT_EXPORT_TABS;

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

    // Append --use-* flags for enabled API integrations.
    try {
      const enabledServices = db
        .prepare("SELECT service, credentials FROM api_credentials WHERE enabled = 1")
        .all();
      for (const row of enabledServices) {
        const svcCfg = API_SERVICE_FLAGS[row.service];
        if (!svcCfg) continue;
        args.push(svcCfg.flag);
        const creds = JSON.parse(row.credentials || '{}');
        for (const extra of svcCfg.extraArgs(creds)) {
          args.push(extra);
        }
      }
    } catch (credErr) {
      // Non-critical: log and proceed without API flags.
      if (logStream.writable) {
        logStream.write(`[WARN] Could not read API credentials: ${credErr.message}\n`);
      }
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

    runningProcs.set(job.id, proc);

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
      runningProcs.delete(job.id);
      reject(new Error(`Crawler process error: ${err.message}`));
    });

    proc.on('close', (code) => {
      runningProcs.delete(job.id);
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
 * Stop a currently running job by killing its child process.
 * Marks the job as 'stopped' in the database.
 * @param {number} jobId
 * @returns {boolean} true if the process was found and signalled, false otherwise.
 */
function stopJob(jobId) {
  const proc = runningProcs.get(Number(jobId));
  if (!proc) return false;
  proc.kill('SIGTERM');
  db.prepare("UPDATE jobs SET status='stopped', completed_at=datetime('now'), error='Stopped by user' WHERE id=?").run(jobId);
  return true;
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
 * @param {string} outputDir - Source directory to compress.
 * @param {number} jobId     - Job ID (used as default folder name).
 * @param {string} [folderName] - Name of the top-level folder inside the ZIP.
 *   Defaults to "job-{jobId}" when not provided.
 */
function zipOutput(outputDir, jobId, folderName) {
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
    archive.directory(outputDir, folderName || `job-${jobId}`);
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

module.exports = { runJob, stopJob, detectLauncher, zipOutput, findSeospiderFile, spawnCompare, swapInSpiderConfig, restoreSpiderConfig, SF_LAUNCHER };
