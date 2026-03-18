'use strict';

/**
 * Route tests for GET/POST /api/update/*.
 *
 * The updater module is mocked so no real network or system calls are made.
 */

jest.mock('../../src/updater');

const { makeApp } = require('../helpers/app-factory');

let ctx;
let updater;

beforeAll(() => {
  ctx     = makeApp('update');
  // Obtain the mock instance that the routes are using (same module registry
  // as the freshly-required index.js after makeApp's resetModules()).
  updater = require('../../src/updater');
});

afterAll(() => ctx.cleanup());

// Default mock state returned by getState().
const defaultState = () => ({
  status:         'idle',
  currentVersion: '1.0.0',
  latestVersion:  null,
  releaseUrl:     null,
  releaseNotes:   null,
  downloadUrl:    null,
  downloadPath:   null,
  progress:       0,
  error:          null,
});

beforeEach(() => {
  updater.getState.mockReturnValue(defaultState());
  updater.checkForUpdate.mockResolvedValue({ ...defaultState(), status: 'up-to-date', latestVersion: '1.0.0' });
  updater.downloadUpdate.mockResolvedValue('/tmp/frog-update-test.dmg');
  updater.installUpdate.mockResolvedValue();
  updater.listAllReleases.mockResolvedValue([]);
  updater.selectVersionForInstall.mockImplementation(() => {});
  updater.resolvePRBuild.mockResolvedValue({ ...defaultState(), status: 'available', latestVersion: 'pr-42-preview' });
});

// ─── GET /api/update ──────────────────────────────────────────────────────────

describe('GET /api/update', () => {
  it('returns 200 with the update state', async () => {
    const res = await ctx.request.get('/api/update').expect(200);
    expect(res.body).toMatchObject({
      status:         'idle',
      currentVersion: '1.0.0',
    });
  });

  it('reflects the state reported by the updater', async () => {
    updater.getState.mockReturnValue({
      ...defaultState(),
      status:        'available',
      latestVersion: '2.0.0',
      downloadUrl:   'https://github.com/jmhthethird/frog_automation/releases/download/v2.0.0/app.dmg',
    });
    const res = await ctx.request.get('/api/update').expect(200);
    expect(res.body.status).toBe('available');
    expect(res.body.latestVersion).toBe('2.0.0');
  });
});

// ─── POST /api/update/check ───────────────────────────────────────────────────

describe('POST /api/update/check', () => {
  it('returns 200 with up-to-date state', async () => {
    updater.checkForUpdate.mockResolvedValue({
      ...defaultState(),
      status:        'up-to-date',
      latestVersion: '1.0.0',
    });
    const res = await ctx.request.post('/api/update/check').expect(200);
    expect(res.body.status).toBe('up-to-date');
  });

  it('returns 200 with available state when newer version exists', async () => {
    updater.checkForUpdate.mockResolvedValue({
      ...defaultState(),
      status:        'available',
      latestVersion: '1.0.2',
      downloadUrl:   'https://github.com/jmhthethird/frog_automation/releases/download/v1.0.2/app.dmg',
    });
    const res = await ctx.request.post('/api/update/check').expect(200);
    expect(res.body.status).toBe('available');
    expect(res.body.latestVersion).toBe('1.0.2');
  });

  it('returns 500 when checkForUpdate throws', async () => {
    updater.checkForUpdate.mockRejectedValue(new Error('Network error'));
    const res = await ctx.request.post('/api/update/check').expect(500);
    expect(res.body.error).toMatch(/Network error/);
  });
});

// ─── POST /api/update/download ────────────────────────────────────────────────

describe('POST /api/update/download', () => {
  it('returns 400 when no update is available', async () => {
    updater.getState.mockReturnValue(defaultState()); // status: idle
    const res = await ctx.request.post('/api/update/download').expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when status is up-to-date', async () => {
    updater.getState.mockReturnValue({ ...defaultState(), status: 'up-to-date' });
    const res = await ctx.request.post('/api/update/download').expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when available but no download URL', async () => {
    updater.getState.mockReturnValue({
      ...defaultState(),
      status:      'available',
      latestVersion: '2.0.0',
      downloadUrl: null,
      releaseUrl:  'https://github.com/jmhthethird/frog_automation/releases/tag/v2.0.0',
    });
    const res = await ctx.request.post('/api/update/download').expect(400);
    expect(res.body.error).toBeTruthy();
    expect(res.body.releaseUrl).toBeTruthy();
  });

  it('starts the download and returns {started:true} when update is available', async () => {
    updater.getState.mockReturnValue({
      ...defaultState(),
      status:      'available',
      latestVersion: '1.0.2',
      downloadUrl: 'https://github.com/jmhthethird/frog_automation/releases/download/v1.0.2/app.dmg',
    });
    const res = await ctx.request.post('/api/update/download').expect(200);
    expect(res.body.started).toBe(true);
  });
});

// ─── GET /api/update/status ───────────────────────────────────────────────────

describe('GET /api/update/status', () => {
  it('returns 200 with the current state', async () => {
    updater.getState.mockReturnValue({
      ...defaultState(),
      status:   'downloading',
      progress: 42,
    });
    const res = await ctx.request.get('/api/update/status').expect(200);
    expect(res.body.status).toBe('downloading');
    expect(res.body.progress).toBe(42);
  });
});

// ─── POST /api/update/install ─────────────────────────────────────────────────

describe('POST /api/update/install', () => {
  it('returns 400 when no update is ready', async () => {
    updater.getState.mockReturnValue(defaultState()); // status: idle
    const res = await ctx.request.post('/api/update/install').expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when downloading (not yet ready)', async () => {
    updater.getState.mockReturnValue({ ...defaultState(), status: 'downloading', progress: 80 });
    const res = await ctx.request.post('/api/update/install').expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 on non-macOS platforms when update is ready', async () => {
    updater.getState.mockReturnValue({
      ...defaultState(),
      status:       'ready',
      downloadPath: '/tmp/update.dmg',
    });
    // In the test environment (Linux / CI), process.platform !== 'darwin'.
    if (process.platform !== 'darwin') {
      const res = await ctx.request.post('/api/update/install').expect(400);
      expect(res.body.error).toMatch(/macOS/i);
    }
  });

  it('returns {installing:true} on macOS when update is ready', async () => {
    // Only meaningful on macOS; skip on other platforms.
    if (process.platform !== 'darwin') return;
    updater.getState.mockReturnValue({
      ...defaultState(),
      status:       'ready',
      downloadPath: '/tmp/update.dmg',
    });
    const res = await ctx.request.post('/api/update/install').expect(200);
    expect(res.body.installing).toBe(true);
  });
});

// ─── GET /api/update/releases ─────────────────────────────────────────────────

describe('GET /api/update/releases', () => {
  it('returns 200 with an array of releases', async () => {
    const fakeReleases = [
      { version: '2.0.0', tag: 'v2.0.0', releaseUrl: 'https://github.com/jmhthethird/frog_automation/releases/tag/v2.0.0', releaseNotes: null, downloadUrl: 'https://github.com/jmhthethird/frog_automation/releases/download/v2.0.0/app.dmg', publishedAt: '2025-01-01T00:00:00Z' },
      { version: '1.0.0', tag: 'v1.0.0', releaseUrl: 'https://github.com/jmhthethird/frog_automation/releases/tag/v1.0.0', releaseNotes: null, downloadUrl: null, publishedAt: '2024-01-01T00:00:00Z' },
    ];
    updater.listAllReleases.mockResolvedValue(fakeReleases);
    const res = await ctx.request.get('/api/update/releases').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].version).toBe('2.0.0');
  });

  it('returns 200 with an empty array when no releases exist', async () => {
    updater.listAllReleases.mockResolvedValue([]);
    const res = await ctx.request.get('/api/update/releases').expect(200);
    expect(res.body).toEqual([]);
  });

  it('returns 500 when listAllReleases throws', async () => {
    updater.listAllReleases.mockRejectedValue(new Error('Network failure'));
    const res = await ctx.request.get('/api/update/releases').expect(500);
    expect(res.body.error).toMatch(/Network failure/);
  });
});

// ─── POST /api/update/select ──────────────────────────────────────────────────

describe('POST /api/update/select', () => {
  it('returns 400 when version is missing', async () => {
    const res = await ctx.request.post('/api/update/select').send({}).expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('calls selectVersionForInstall and returns the new state', async () => {
    updater.getState.mockReturnValue({
      ...defaultState(),
      status:        'available',
      latestVersion: '0.9.0',
      downloadUrl:   'https://github.com/jmhthethird/frog_automation/releases/download/v0.9.0/app.dmg',
    });
    const res = await ctx.request.post('/api/update/select')
      .send({ version: '0.9.0', downloadUrl: 'https://github.com/jmhthethird/frog_automation/releases/download/v0.9.0/app.dmg', releaseUrl: null, releaseNotes: null })
      .expect(200);
    expect(updater.selectVersionForInstall).toHaveBeenCalledWith(
      '0.9.0',
      'https://github.com/jmhthethird/frog_automation/releases/download/v0.9.0/app.dmg',
      null,
      null
    );
    expect(res.body.status).toBe('available');
    expect(res.body.latestVersion).toBe('0.9.0');
  });

  it('allows rollback — accepts versions older than current', async () => {
    updater.getState.mockReturnValue({
      ...defaultState(),
      status:        'available',
      latestVersion: '0.5.0',
    });
    const res = await ctx.request.post('/api/update/select')
      .send({ version: '0.5.0' })
      .expect(200);
    expect(res.body.status).toBe('available');
  });
});

// ─── POST /api/update/pr ──────────────────────────────────────────────────────

describe('POST /api/update/pr', () => {
  const prUrl = 'https://github.com/jmhthethird/frog_automation/pull/42';

  it('returns 400 when prUrl is missing', async () => {
    const res = await ctx.request.post('/api/update/pr').send({}).expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when prUrl is not a string', async () => {
    const res = await ctx.request.post('/api/update/pr').send({ prUrl: 123 }).expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('calls resolvePRBuild with the prUrl and returns the state', async () => {
    const state = { ...defaultState(), status: 'available', latestVersion: 'pr-42-preview' };
    updater.resolvePRBuild.mockResolvedValue(state);
    const res = await ctx.request.post('/api/update/pr').send({ prUrl }).expect(200);
    expect(updater.resolvePRBuild).toHaveBeenCalledWith(prUrl);
    expect(res.body.status).toBe('available');
    expect(res.body.latestVersion).toBe('pr-42-preview');
  });

  it('returns the error state from resolvePRBuild when no build is found', async () => {
    updater.resolvePRBuild.mockResolvedValue({
      ...defaultState(),
      status: 'error',
      error:  'No test build found for PR #42',
    });
    const res = await ctx.request.post('/api/update/pr').send({ prUrl }).expect(200);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toMatch(/PR #42/);
  });

  it('returns 500 when resolvePRBuild throws', async () => {
    updater.resolvePRBuild.mockRejectedValue(new Error('Network failure'));
    const res = await ctx.request.post('/api/update/pr').send({ prUrl }).expect(500);
    expect(res.body.error).toMatch(/Network failure/);
  });
});
