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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Insert a minimal job row and return its id. */
function insertJob(database, baseDir, extra = {}) {
  const outputDir = path.join(baseDir, 'jobs', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const url    = extra.url    || 'https://example.com';
  const status = extra.status || 'queued';
  const row = database.prepare(`
    INSERT INTO jobs (url, export_tabs, status, output_dir, profile_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    url,
    'Internal:All',
    status,
    outputDir,
    extra.profile_id || null,
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
