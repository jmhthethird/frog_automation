'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { EventEmitter } = require('events');

// We need a fresh crawler + DB for every test, so we reset modules in
// beforeEach and re-require everything.
let dataDir;
let db;
let crawler;
let cp; // child_process mock handle

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-crawler-test-'));
  process.env.DATA_DIR = dataDir;

  jest.resetModules();

  // child_process is a built-in (not reset by resetModules) – spy on it.
  cp = require('child_process');
  jest.spyOn(cp, 'spawn');

  const dbMod = require('../../src/db');
  db = dbMod.db;
  crawler = require('../../src/crawler');

  // Suppress expected console.error noise from the crawler's error handler.
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.DATA_DIR;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ─── detectLauncher ───────────────────────────────────────────────────────────
describe('detectLauncher()', () => {
  it('returns found: false when the launcher binary does not exist', () => {
    // In the CI/Linux environment the macOS binary is absent.
    const result = crawler.detectLauncher();
    expect(result).toMatchObject({ found: false });
    expect(typeof result.path).toBe('string');
  });

  it('returns found: true when the launcher is executable', () => {
    // Create a dummy executable file to stand in for the launcher.
    const fakeExe = path.join(dataDir, 'FakeLauncher');
    fs.writeFileSync(fakeExe, '#!/bin/sh\necho ok');
    fs.chmodSync(fakeExe, 0o755);

    // Temporarily override SF_LAUNCHER
    jest.resetModules();
    process.env.SF_LAUNCHER = fakeExe;
    const c = require('../../src/crawler');
    const result = c.detectLauncher();
    delete process.env.SF_LAUNCHER;

    expect(result).toMatchObject({ found: true, path: fakeExe });
  });
});

// ─── findSeospiderFile() ──────────────────────────────────────────────────────
describe('findSeospiderFile()', () => {
  it('returns null when the directory does not exist', () => {
    expect(crawler.findSeospiderFile(path.join(dataDir, 'nonexistent'))).toBeNull();
  });

  it('returns null when passed a falsy value', () => {
    expect(crawler.findSeospiderFile(null)).toBeNull();
    expect(crawler.findSeospiderFile('')).toBeNull();
  });

  it('returns null when no .seospider file is present', () => {
    const dir = path.join(dataDir, 'no-seospider');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'results.csv'), 'col\nval\n');
    expect(crawler.findSeospiderFile(dir)).toBeNull();
  });

  it('returns the .seospider file path when one is present', () => {
    const dir = path.join(dataDir, 'has-seospider');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'crawl.seospider'), 'db-data');
    const result = crawler.findSeospiderFile(dir);
    expect(result).toBe(path.join(dir, 'crawl.seospider'));
  });
});

// ─── spawnCompare() ───────────────────────────────────────────────────────────
describe('spawnCompare()', () => {
  const makeLogStream = () => {
    const lines = [];
    const stream = {
      writable: true,
      write: (line) => lines.push(line),
      end: () => {},
    };
    return { stream, lines };
  };

  it('resolves when the compare process exits with code 0', async () => {
    const { stream } = makeLogStream();
    fakeProcExit(cp, 0, 'compare done', '');
    await expect(
      crawler.spawnCompare('/prev.seospider', '/new.seospider', dataDir, stream)
    ).resolves.toBeUndefined();
  });

  it('passes --compare and --output-folder arguments to spawn', async () => {
    const { stream } = makeLogStream();
    fakeProcExit(cp, 0);
    await crawler.spawnCompare('/prev.seospider', '/new.seospider', dataDir, stream);
    const args = cp.spawn.mock.calls[0][1];
    expect(args[0]).toBe('--compare');
    expect(args[1]).toBe('/prev.seospider');
    expect(args[2]).toBe('/new.seospider');
    expect(args).toContain('--output-folder');
    expect(args[args.indexOf('--output-folder') + 1]).toBe(dataDir);
    expect(args).toContain('--overwrite');
  });

  it('rejects when the compare process exits with non-zero code', async () => {
    const { stream } = makeLogStream();
    fakeProcExit(cp, 2);
    await expect(
      crawler.spawnCompare('/prev.seospider', '/new.seospider', dataDir, stream)
    ).rejects.toThrow(/non-zero code: 2/i);
  });

  it('rejects when spawn throws (ENOENT)', async () => {
    const { stream } = makeLogStream();
    cp.spawn.mockImplementationOnce(() => {
      throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    });
    await expect(
      crawler.spawnCompare('/prev.seospider', '/new.seospider', dataDir, stream)
    ).rejects.toThrow(/spawn/i);
  });

  it('rejects when the compare process emits an error event', async () => {
    const { stream } = makeLogStream();
    fakeProcError(cp, new Error('compare crash'));
    await expect(
      crawler.spawnCompare('/prev.seospider', '/new.seospider', dataDir, stream)
    ).rejects.toThrow(/compare crash/i);
  });
});

// ─── swapInSpiderConfig() / restoreSpiderConfig() ────────────────────────────
describe('swapInSpiderConfig() / restoreSpiderConfig()', () => {
  const makeLogStream = () => {
    const lines = [];
    const stream = { writable: true, write: (l) => lines.push(l), end: () => {} };
    return { stream, lines };
  };

  it('writes the stored config to the live path and returns swizzle state', () => {
    const fakeSfDir = path.join(dataDir, 'swap-sf');
    fs.mkdirSync(fakeSfDir, { recursive: true });
    const liveConfigPath = path.join(fakeSfDir, 'spider.config');
    fs.writeFileSync(liveConfigPath, 'ORIGINAL');
    process.env.SF_DATA_DIR = fakeSfDir;

    const storedPath = path.join(dataDir, 'swap-stored.config');
    fs.writeFileSync(storedPath, 'SELECTED');

    const { stream } = makeLogStream();
    const state = crawler.swapInSpiderConfig(storedPath, stream);

    expect(state).not.toBeNull();
    expect(state.liveConfigPath).toBe(liveConfigPath);
    expect(state.backupContent).toBe('ORIGINAL');
    expect(fs.readFileSync(liveConfigPath, 'utf8')).toBe('SELECTED');

    delete process.env.SF_DATA_DIR;
  });

  it('returns null and logs a warning when the SF data dir is not found', () => {
    // Point SF_DATA_DIR at an empty temp dir (no spider.config) to guarantee
    // getLocalSfDataDir() still returns a dir but the swap has nothing to back
    // up, and to ensure the test is hermetic on machines with a real SF install.
    // Actually, to simulate "no SF data dir at all" we need SF_DATA_DIR to
    // resolve to null, so we point it at a path that does NOT exist.
    const nonexistentDir = path.join(dataDir, 'does-not-exist-sf-dir');
    process.env.SF_DATA_DIR = nonexistentDir;
    const storedPath = path.join(dataDir, 'swap-no-sf.config');
    fs.writeFileSync(storedPath, 'DATA');
    const { stream, lines } = makeLogStream();
    const state = crawler.swapInSpiderConfig(storedPath, stream);
    expect(state).toBeNull();
    expect(lines.some((l) => /not found/i.test(l))).toBe(true);
    delete process.env.SF_DATA_DIR;
  });

  it('returns null and logs a warning when the stored config file is unreadable', () => {
    const fakeSfDir = path.join(dataDir, 'swap-unreadable');
    fs.mkdirSync(fakeSfDir, { recursive: true });
    process.env.SF_DATA_DIR = fakeSfDir;

    const { stream, lines } = makeLogStream();
    const state = crawler.swapInSpiderConfig('/nonexistent/path.config', stream);
    expect(state).toBeNull();
    expect(lines.some((l) => /skip/i.test(l))).toBe(true);

    delete process.env.SF_DATA_DIR;
  });

  it('backupContent is null when no live spider.config existed yet', () => {
    const fakeSfDir = path.join(dataDir, 'swap-noexist');
    fs.mkdirSync(fakeSfDir, { recursive: true });
    // Deliberately do NOT create a spider.config in the dir.
    process.env.SF_DATA_DIR = fakeSfDir;

    const storedPath = path.join(dataDir, 'swap-new.config');
    fs.writeFileSync(storedPath, 'NEW');
    const { stream } = makeLogStream();
    const state = crawler.swapInSpiderConfig(storedPath, stream);

    expect(state).not.toBeNull();
    expect(state.backupContent).toBeNull();

    delete process.env.SF_DATA_DIR;
  });

  it('restoreSpiderConfig restores the original file', () => {
    const liveConfigPath = path.join(dataDir, 'restore-live.config');
    fs.writeFileSync(liveConfigPath, 'SWAPPED');
    const { stream } = makeLogStream();
    crawler.restoreSpiderConfig({ liveConfigPath, backupContent: 'ORIGINAL' }, stream);
    expect(fs.readFileSync(liveConfigPath, 'utf8')).toBe('ORIGINAL');
  });

  it('restoreSpiderConfig removes the live file when backupContent is null', () => {
    const liveConfigPath = path.join(dataDir, 'restore-remove.config');
    fs.writeFileSync(liveConfigPath, 'SWAPPED');
    const { stream } = makeLogStream();
    crawler.restoreSpiderConfig({ liveConfigPath, backupContent: null }, stream);
    expect(fs.existsSync(liveConfigPath)).toBe(false);
  });

  it('restoreSpiderConfig is a no-op when passed null', () => {
    // Should not throw.
    const { stream } = makeLogStream();
    expect(() => crawler.restoreSpiderConfig(null, stream)).not.toThrow();
  });
});

// ─── zipOutput() ─────────────────────────────────────────────────────────────
describe('zipOutput()', () => {
  it('creates a valid ZIP archive containing all files in the source directory', async () => {
    const srcDir = path.join(dataDir, 'job-output');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'crawler.log'), 'log line\n');
    fs.writeFileSync(path.join(srcDir, 'results.csv'), 'col1,col2\nval1,val2\n');

    const zipPath = await crawler.zipOutput(srcDir, 42);

    expect(zipPath).toBe(`${srcDir}.zip`);
    expect(fs.existsSync(zipPath)).toBe(true);
    expect(fs.statSync(zipPath).size).toBeGreaterThan(0);

    // Extract and verify contents using the system unzip command.
    const extractDir = path.join(dataDir, 'extracted');
    fs.mkdirSync(extractDir);
    require('child_process').execSync(`unzip -q "${zipPath}" -d "${extractDir}"`);

    expect(fs.existsSync(path.join(extractDir, 'job-42', 'crawler.log'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'job-42', 'results.csv'))).toBe(true);
  });

  it('rejects when the source directory does not exist', async () => {
    await expect(
      crawler.zipOutput(path.join(dataDir, 'nonexistent'), 1)
    ).rejects.toThrow(/not found/i);
  });

  it('rejects when the zip destination is not writable (archive error path)', async () => {
    const srcDir = path.join(dataDir, 'archive-err-src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'file.txt'), 'hello');

    // Place a directory at the expected zip path so fs.createWriteStream fails.
    const badZipPath = `${srcDir}.zip`;
    fs.mkdirSync(badZipPath);

    await expect(crawler.zipOutput(srcDir, 5)).rejects.toThrow();
  });
});

// ─── runJob() ────────────────────────────────────────────────────────────────
describe('runJob()', () => {
  it('throws when the job id is not in the database', async () => {
    await expect(crawler.runJob(9999)).rejects.toThrow('Job 9999 not found');
  });

  it('marks the job as "failed" when the launcher is not found (ENOENT spawn)', async () => {
    // Create a real job row in the test DB.
    const jobId = insertJob(db, dataDir);

    // spawn throws ENOENT (binary not on path)
    cp.spawn.mockImplementationOnce(() => {
      throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    });

    await crawler.runJob(jobId);

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/spawn/i);
  });

  it('marks the job as "failed" when the process emits an error event', async () => {
    const jobId = insertJob(db, dataDir);
    const proc = fakeProcError(cp, new Error('process crash'));

    await crawler.runJob(jobId);

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/process crash/i);
  });

  it('marks the job as "failed" when the process exits with non-zero code', async () => {
    const jobId = insertJob(db, dataDir);
    fakeProcExit(cp, 2);

    await crawler.runJob(jobId);

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/non-zero code: 2/i);
  });

  it('marks the job as "failed" when Screaming Frog outputs a FATAL error (exits 0)', async () => {
    // Screaming Frog outputs a FATAL message and exits with code 0 when given
    // an unknown --export-tabs value (e.g. the old "Redirect Chains:All" tab).
    const jobId = insertJob(db, dataDir);
    const fatalOutput = '2026-03-06 19:08:08,857 [8915] [main] FATAL - Problems with --export-tabs:\nUnknown tab: Redirect Chains';
    fakeProcExit(cp, 0, fatalOutput, '');

    await crawler.runJob(jobId);

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/fatal/i);
  });

  it('marks the job as "completed" and creates a ZIP when process exits 0', async () => {
    const jobId = insertJob(db, dataDir);
    fakeProcExit(cp, 0, 'crawl complete', '');

    await crawler.runJob(jobId);

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.status).toBe('completed');
    expect(job.zip_path).toBeTruthy();
    expect(fs.existsSync(job.zip_path)).toBe(true);
  });

  it('sets started_at and completed_at timestamps', async () => {
    const jobId = insertJob(db, dataDir);
    fakeProcExit(cp, 0);

    await crawler.runJob(jobId);

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.started_at).toBeTruthy();
    expect(job.completed_at).toBeTruthy();
  });

  it('logs stdout and stderr output to crawler.log', async () => {
    const jobId = insertJob(db, dataDir);
    fakeProcExit(cp, 0, 'stdout line', 'stderr line');

    await crawler.runJob(jobId);

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    const log = fs.readFileSync(path.join(job.output_dir, 'crawler.log'), 'utf8');
    expect(log).toContain('[STDOUT] stdout line');
    expect(log).toContain('[STDERR] stderr line');
  });

  it('passes --save-crawl flag to the Screaming Frog process', async () => {
    const jobId = insertJob(db, dataDir);
    fakeProcExit(cp, 0);

    await crawler.runJob(jobId);

    const spawnArgs = cp.spawn.mock.calls[0][1];
    expect(spawnArgs).toContain('--save-crawl');
  });

  it('passes --use-pagespeed when pagespeed integration is enabled', async () => {
    db.prepare("UPDATE api_credentials SET enabled = 1 WHERE service = 'pagespeed'").run();
    const jobId = insertJob(db, dataDir);
    fakeProcExit(cp, 0);

    await crawler.runJob(jobId);

    const spawnArgs = cp.spawn.mock.calls[0][1];
    expect(spawnArgs).toContain('--use-pagespeed');
  });

  it('does not pass --use-pagespeed when pagespeed integration is disabled', async () => {
    db.prepare("UPDATE api_credentials SET enabled = 0 WHERE service = 'pagespeed'").run();
    const jobId = insertJob(db, dataDir);
    fakeProcExit(cp, 0);

    await crawler.runJob(jobId);

    const spawnArgs = cp.spawn.mock.calls[0][1];
    expect(spawnArgs).not.toContain('--use-pagespeed');
  });

  it('passes multiple --use-* flags when multiple integrations are enabled', async () => {
    db.prepare("UPDATE api_credentials SET enabled = 1 WHERE service IN ('majestic', 'ahrefs')").run();
    const jobId = insertJob(db, dataDir);
    fakeProcExit(cp, 0);

    await crawler.runJob(jobId);

    const spawnArgs = cp.spawn.mock.calls[0][1];
    expect(spawnArgs).toContain('--use-majestic');
    expect(spawnArgs).toContain('--use-ahrefs');
  });

  it('runs a job that has a profile_path', async () => {
    // Insert a profile and attach it to the job.
    const profilePath = path.join(dataDir, 'test.seospiderconfig');
    fs.writeFileSync(profilePath, '<config/>');
    const profResult = db.prepare(
      "INSERT INTO profiles (name, filename, filepath) VALUES ('p', 'p.seospiderconfig', ?)"
    ).run(profilePath);
    const profileId = profResult.lastInsertRowid;

    const jobId = insertJob(db, dataDir, { profile_id: profileId });
    fakeProcExit(cp, 0);

    await crawler.runJob(jobId);

    // Verify that --config was passed
    const spawnArgs = cp.spawn.mock.calls[0][1];
    expect(spawnArgs).toContain('--config');
    expect(spawnArgs).toContain(profilePath);
  });

  it('does not pass --spider-config as a CLI argument (swizzle via filesystem instead)', async () => {
    // Create a spider config and attach it to the job.
    const scPath = path.join(dataDir, 'spider.config');
    fs.writeFileSync(scPath, '<properties/>');
    const scResult = db.prepare(
      "INSERT INTO spider_configs (name, filename, filepath, is_local) VALUES ('sc', 'spider.config', ?, 0)"
    ).run(scPath);
    const scId = scResult.lastInsertRowid;

    const jobId = insertJob(db, dataDir, { spider_config_id: scId });
    fakeProcExit(cp, 0);

    await crawler.runJob(jobId);

    const spawnArgs = cp.spawn.mock.calls[0][1];
    expect(spawnArgs).not.toContain('--spider-config');
  });

  it('swaps in the spider config before the crawl and restores it after', async () => {
    // Create a fake SF data dir and set it as the override.
    const fakeSfDir = path.join(dataDir, 'fake-sf');
    fs.mkdirSync(fakeSfDir, { recursive: true });
    const liveConfigPath = path.join(fakeSfDir, 'spider.config');
    const originalContent = '<properties><entry key="crawl.threads">2</entry></properties>';
    fs.writeFileSync(liveConfigPath, originalContent);
    process.env.SF_DATA_DIR = fakeSfDir;

    // Create a stored spider config with different content.
    const storedContent = '<properties><entry key="crawl.threads">8</entry></properties>';
    const scPath = path.join(dataDir, 'stored.config');
    fs.writeFileSync(scPath, storedContent);
    const scResult = db.prepare(
      "INSERT INTO spider_configs (name, filename, filepath, is_local) VALUES ('sc2', 'stored.config', ?, 0)"
    ).run(scPath);
    const scId = scResult.lastInsertRowid;

    const jobId = insertJob(db, dataDir, { spider_config_id: scId });

    // Capture what the live spider.config looks like DURING the crawl.
    let contentDuringCrawl = null;
    cp.spawn.mockImplementationOnce((cmd, args, opts) => {
      const proc = new (require('events').EventEmitter)();
      proc.stdout = new (require('events').EventEmitter)();
      proc.stderr = new (require('events').EventEmitter)();
      // Read the live config at the moment spawn() is called.
      try { contentDuringCrawl = fs.readFileSync(liveConfigPath, 'utf8'); } catch { /* ignore */ }
      setImmediate(() => proc.emit('close', 0));
      return proc;
    });

    await crawler.runJob(jobId);

    // During the crawl the stored config should have been active.
    expect(contentDuringCrawl).toBe(storedContent);

    // After the crawl the original config should be restored.
    const contentAfterCrawl = fs.readFileSync(liveConfigPath, 'utf8');
    expect(contentAfterCrawl).toBe(originalContent);

    delete process.env.SF_DATA_DIR;
  });

  it('restores spider config even when the crawl fails', async () => {
    const fakeSfDir = path.join(dataDir, 'fake-sf-fail');
    fs.mkdirSync(fakeSfDir, { recursive: true });
    const liveConfigPath = path.join(fakeSfDir, 'spider.config');
    const originalContent = '<properties><entry key="crawl.threads">1</entry></properties>';
    fs.writeFileSync(liveConfigPath, originalContent);
    process.env.SF_DATA_DIR = fakeSfDir;

    const storedContent = '<properties><entry key="crawl.threads">99</entry></properties>';
    const scPath = path.join(dataDir, 'fail-stored.config');
    fs.writeFileSync(scPath, storedContent);
    const scResult = db.prepare(
      "INSERT INTO spider_configs (name, filename, filepath, is_local) VALUES ('sc3', 'fail-stored.config', ?, 0)"
    ).run(scPath);
    const scId = scResult.lastInsertRowid;

    const jobId = insertJob(db, dataDir, { spider_config_id: scId });
    fakeProcExit(cp, 1); // Fail the crawl.

    await crawler.runJob(jobId);

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.status).toBe('failed');

    // Original config must be restored even after failure.
    const contentAfterCrawl = fs.readFileSync(liveConfigPath, 'utf8');
    expect(contentAfterCrawl).toBe(originalContent);

    delete process.env.SF_DATA_DIR;
  });

  it('skips the swap when no spider config is selected (runs normally)', async () => {
    const jobId = insertJob(db, dataDir);
    fakeProcExit(cp, 0);
    await crawler.runJob(jobId);
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.status).toBe('completed');
  });

  it('diff is scoped to same-URL jobs – prev_job_id matches the earlier same-URL job, not a different-URL job', async () => {
    const TARGET_URL = 'https://url-a.example.com';
    const OTHER_URL  = 'https://url-b.example.com';
    const csv        = 'Address,Status Code\nhttps://url-a.example.com/page,200\n';

    // A completed job for the target URL (this is the one the diff should reference).
    const prevJobId = insertJob(db, dataDir, { url: TARGET_URL, status: 'completed' });
    const prevJob   = db.prepare('SELECT * FROM jobs WHERE id = ?').get(prevJobId);
    fs.mkdirSync(prevJob.output_dir, { recursive: true });
    fs.writeFileSync(path.join(prevJob.output_dir, 'internal_all.csv'), csv);

    // Several completed jobs for a DIFFERENT URL inserted after the target-URL job.
    // These must never be chosen as the diff baseline.
    for (let i = 0; i < 3; i++) {
      const otherId  = insertJob(db, dataDir, { url: OTHER_URL, status: 'completed' });
      const otherJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(otherId);
      fs.mkdirSync(otherJob.output_dir, { recursive: true });
      fs.writeFileSync(path.join(otherJob.output_dir, 'internal_all.csv'),
        'Address,Status Code\nhttps://url-b.example.com/page,200\n');
    }

    // New job for the target URL.  Pre-populate its output dir so computeDiff
    // has CSV rows to compare (the mocked spawn produces no real files).
    const jobId  = insertJob(db, dataDir, { url: TARGET_URL });
    const newJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    fs.mkdirSync(newJob.output_dir, { recursive: true });
    fs.writeFileSync(path.join(newJob.output_dir, 'internal_all.csv'), csv);

    fakeProcExit(cp, 0);
    await crawler.runJob(jobId);

    const result = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(result.status).toBe('completed');
    expect(result.diff_summary).not.toBeNull();

    const diff = JSON.parse(result.diff_summary);
    // Must reference the same-URL job, not any of the different-URL jobs.
    expect(diff.prev_job_id).toBe(prevJobId);
  });

  it('does not set diff_summary when only different-URL completed jobs exist', async () => {
    const TARGET_URL = 'https://url-a-only.example.com';
    const OTHER_URL  = 'https://url-b-only.example.com';

    // Several completed jobs for a DIFFERENT URL – no prior same-URL job exists.
    for (let i = 0; i < 3; i++) {
      const otherId  = insertJob(db, dataDir, { url: OTHER_URL, status: 'completed' });
      const otherJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(otherId);
      fs.mkdirSync(otherJob.output_dir, { recursive: true });
      fs.writeFileSync(path.join(otherJob.output_dir, 'internal_all.csv'),
        'Address,Status Code\nhttps://url-b.example.com/page,200\n');
    }

    // New job for the target URL with no prior same-URL job in the DB.
    const jobId  = insertJob(db, dataDir, { url: TARGET_URL });
    const newJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    fs.mkdirSync(newJob.output_dir, { recursive: true });
    fs.writeFileSync(path.join(newJob.output_dir, 'internal_all.csv'),
      'Address,Status Code\nhttps://url-a.example.com/page,200\n');

    fakeProcExit(cp, 0);
    await crawler.runJob(jobId);

    const result = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(result.status).toBe('completed');
    // No previous crawl exists for this URL, so no diff should be stored.
    expect(result.diff_summary).toBeNull();
  });

  it('runs SF compare when both .seospider files exist in prev and new output dirs', async () => {
    const TARGET_URL = 'https://compare-test.example.com';
    const csv = 'Address,Status Code\nhttps://compare-test.example.com/page,200\n';

    // Create the previous completed job with a .seospider file.
    const prevJobId = insertJob(db, dataDir, { url: TARGET_URL, status: 'completed' });
    const prevJob   = db.prepare('SELECT * FROM jobs WHERE id = ?').get(prevJobId);
    fs.mkdirSync(prevJob.output_dir, { recursive: true });
    fs.writeFileSync(path.join(prevJob.output_dir, 'internal_all.csv'), csv);
    fs.writeFileSync(path.join(prevJob.output_dir, 'prev.seospider'), 'db-data-prev');

    // New job with a .seospider file in its output dir.
    const jobId  = insertJob(db, dataDir, { url: TARGET_URL });
    const newJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    fs.mkdirSync(newJob.output_dir, { recursive: true });
    fs.writeFileSync(path.join(newJob.output_dir, 'internal_all.csv'), csv);
    fs.writeFileSync(path.join(newJob.output_dir, 'new.seospider'), 'db-data-new');

    // First spawn call: main crawl (succeeds).
    fakeProcExit(cp, 0, 'crawl ok', '');

    // Second spawn call: compare. Use mockImplementationOnce so the setImmediate
    // is only scheduled when spawn() is actually called, ensuring listeners are
    // attached before the 'close' event fires.
    let compareArgs;
    cp.spawn.mockImplementationOnce((cmd, args, opts) => {
      compareArgs = args;
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      setImmediate(() => proc.emit('close', 0));
      return proc;
    });

    await crawler.runJob(jobId);

    const result = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(result.status).toBe('completed');

    // spawn should have been called twice: once for crawl, once for compare.
    expect(cp.spawn.mock.calls.length).toBe(2);

    // The second call should use the --compare flag.
    expect(compareArgs[0]).toBe('--compare');
    // The compare output folder arg should point to a 'compare' subdirectory.
    const outputFolderIdx = compareArgs.indexOf('--output-folder');
    expect(outputFolderIdx).toBeGreaterThan(-1);
    expect(compareArgs[outputFolderIdx + 1]).toMatch(/compare$/);
  });

  it('does not fail the job when SF compare exits with non-zero code', async () => {
    const TARGET_URL = 'https://compare-fail-test.example.com';
    const csv = 'Address,Status Code\nhttps://compare-fail-test.example.com/page,200\n';

    const prevJobId = insertJob(db, dataDir, { url: TARGET_URL, status: 'completed' });
    const prevJob   = db.prepare('SELECT * FROM jobs WHERE id = ?').get(prevJobId);
    fs.mkdirSync(prevJob.output_dir, { recursive: true });
    fs.writeFileSync(path.join(prevJob.output_dir, 'internal_all.csv'), csv);
    fs.writeFileSync(path.join(prevJob.output_dir, 'prev.seospider'), 'db-data-prev');

    const jobId  = insertJob(db, dataDir, { url: TARGET_URL });
    const newJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    fs.mkdirSync(newJob.output_dir, { recursive: true });
    fs.writeFileSync(path.join(newJob.output_dir, 'internal_all.csv'), csv);
    fs.writeFileSync(path.join(newJob.output_dir, 'new.seospider'), 'db-data-new');

    // Main crawl succeeds; compare fails with non-zero exit code.
    fakeProcExit(cp, 0, 'crawl ok', '');
    cp.spawn.mockImplementationOnce(() => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      setImmediate(() => proc.emit('close', 1));
      return proc;
    });

    await crawler.runJob(jobId);

    // Job should still be completed even though compare failed.
    const result = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(result.status).toBe('completed');
  });
});

// ─── Google Drive upload in runJob() ─────────────────────────────────────────
describe('runJob() – Google Drive upload', () => {
  // Mock the google-drive module before each test so we never hit the network.
  // jest.doMock() is the non-hoisted variant intended for use after jest.resetModules().
  let mockUploadToDrive;

  beforeEach(() => {
    jest.resetModules();
    cp = require('child_process');
    jest.spyOn(cp, 'spawn');
    const dbMod = require('../../src/db');
    db = dbMod.db;

    mockUploadToDrive = jest.fn();
    jest.doMock('../../src/google-drive', () => ({
      uploadToDrive:             mockUploadToDrive,
      buildOAuth2Client:         jest.fn(),
      buildDriveClientFromOAuth: jest.fn(),
      ensureFolder:              jest.fn(),
      findFolder:                jest.fn(),
      // Mirror the real implementation's try-catch so invalid URLs fall back gracefully.
      domainFromUrl: (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } },
    }));

    crawler = require('../../src/crawler');
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('calls uploadToDrive with correct OAuth2 args when google_drive is enabled and authenticated', async () => {
    db.prepare(`
      INSERT INTO api_credentials (service, enabled, credentials)
      VALUES ('google_drive', 1, ?)
      ON CONFLICT(service) DO UPDATE SET enabled=excluded.enabled, credentials=excluded.credentials
    `).run(JSON.stringify({
      client_id: 'cid', client_secret: 'cs', refresh_token: 'rt',
      root_folder_id: 'root-folder-xyz',
    }));

    mockUploadToDrive.mockResolvedValueOnce({
      fileId: 'f1', domain: 'example.com', folderId: 'fd1', localSize: 100, driveSize: 100,
      folderResult: { folderId: 'folder-1', fileCount: 3, totalSize: 500 },
    });

    const jobId = insertJob(db, dataDir, { url: 'https://example.com' });
    fakeProcExit(cp, 0, 'crawl ok', '');
    await crawler.runJob(jobId);

    expect(mockUploadToDrive).toHaveBeenCalledWith(expect.objectContaining({
      clientId:     'cid',
      clientSecret: 'cs',
      refreshToken: 'rt',
      rootFolderId: 'root-folder-xyz',
      jobUrl:       'https://example.com',
    }));
    // New parameters should also be passed
    const callArgs = mockUploadToDrive.mock.calls[0][0];
    expect(callArgs.outputDir).toBeDefined();
    expect(callArgs.jobLabel).toBeDefined();
    expect(callArgs.jobLabel).toMatch(/^example_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(AM|PM)-job\d+$/);

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.status).toBe('completed');
  });

  it('skips upload and logs a warning when google_drive is enabled but not authenticated', async () => {
    db.prepare(`
      INSERT INTO api_credentials (service, enabled, credentials)
      VALUES ('google_drive', 1, ?)
      ON CONFLICT(service) DO UPDATE SET enabled=excluded.enabled, credentials=excluded.credentials
    `).run(JSON.stringify({ client_id: 'cid', client_secret: 'cs' }));

    const jobId = insertJob(db, dataDir, { url: 'https://example.com' });
    fakeProcExit(cp, 0, 'crawl ok', '');
    await crawler.runJob(jobId);

    expect(mockUploadToDrive).not.toHaveBeenCalled();
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.status).toBe('completed');
  });

  it('does not call uploadToDrive when google_drive integration is disabled', async () => {
    db.prepare(`
      INSERT INTO api_credentials (service, enabled, credentials)
      VALUES ('google_drive', 0, ?)
      ON CONFLICT(service) DO UPDATE SET enabled=excluded.enabled, credentials=excluded.credentials
    `).run(JSON.stringify({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' }));

    const jobId = insertJob(db, dataDir, { url: 'https://example.com' });
    fakeProcExit(cp, 0, 'crawl ok', '');
    await crawler.runJob(jobId);

    expect(mockUploadToDrive).not.toHaveBeenCalled();
  });

  it('does not fail the job when the Drive upload throws an error', async () => {
    db.prepare(`
      INSERT INTO api_credentials (service, enabled, credentials)
      VALUES ('google_drive', 1, ?)
      ON CONFLICT(service) DO UPDATE SET enabled=excluded.enabled, credentials=excluded.credentials
    `).run(JSON.stringify({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' }));

    mockUploadToDrive.mockRejectedValueOnce(new Error('Drive quota exceeded'));

    const jobId = insertJob(db, dataDir, { url: 'https://example.com' });
    fakeProcExit(cp, 0, 'crawl ok', '');
    await crawler.runJob(jobId);

    // Job completes despite the upload failure.
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    expect(job.status).toBe('completed');
  });

  it('passes rootFolderId as undefined when root_folder_id is not set', async () => {
    db.prepare(`
      INSERT INTO api_credentials (service, enabled, credentials)
      VALUES ('google_drive', 1, ?)
      ON CONFLICT(service) DO UPDATE SET enabled=excluded.enabled, credentials=excluded.credentials
    `).run(JSON.stringify({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' }));

    mockUploadToDrive.mockResolvedValueOnce({
      fileId: 'f1', domain: 'example.com', folderId: 'fd1', localSize: 50, driveSize: 50,
    });

    const jobId = insertJob(db, dataDir, { url: 'https://example.com' });
    fakeProcExit(cp, 0, 'crawl ok', '');
    await crawler.runJob(jobId);

    expect(mockUploadToDrive).toHaveBeenCalledWith(expect.objectContaining({
      rootFolderId: undefined,
    }));
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Insert a minimal job row and return its id. */
function insertJob(database, baseDir, extra = {}) {
  const outputDir = path.join(baseDir, 'jobs', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const url    = extra.url    || 'https://example.com';
  const status = extra.status || 'queued';
  const row = database.prepare(`
    INSERT INTO jobs (url, export_tabs, status, output_dir, profile_id, spider_config_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    url,
    'Internal:All',
    status,
    outputDir,
    extra.profile_id || null,
    extra.spider_config_id || null,
  );
  return row.lastInsertRowid;
}

/** Make spawn return a process that closes with the given exit code. */
function fakeProcExit(cpModule, code, stdoutData = '', stderrData = '') {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  cpModule.spawn.mockReturnValueOnce(proc);

  setImmediate(() => {
    if (stdoutData) proc.stdout.emit('data', Buffer.from(stdoutData));
    if (stderrData) proc.stderr.emit('data', Buffer.from(stderrData));
    proc.emit('close', code);
  });

  return proc;
}

/** Make spawn return a process that emits an 'error' event. */
function fakeProcError(cpModule, err) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  cpModule.spawn.mockReturnValueOnce(proc);

  setImmediate(() => proc.emit('error', err));

  return proc;
}
