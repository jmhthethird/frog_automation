'use strict';

const { makeApp } = require('../helpers/app-factory');

let ctx;
let db;

beforeAll(() => {
  ctx = makeApp('automation');
  ({ db } = require('../../src/db'));
});

afterAll(() => ctx.cleanup());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedDriveCreds(overrides = {}) {
  const defaults = {
    client_id: 'test-client-id',
    client_secret: 'test-client-secret',
    refresh_token: 'test-refresh-token',
    root_folder_id: 'root123',
  };
  const creds = { ...defaults, ...overrides };
  db.prepare(`
    INSERT INTO api_credentials (service, enabled, credentials)
    VALUES ('google_drive', 1, ?)
    ON CONFLICT(service) DO UPDATE SET enabled = 1, credentials = excluded.credentials
  `).run(JSON.stringify(creds));
}

function resetLock() {
  // Reset lock state between tests by re-requiring the module
  const lock = require('../../src/automation-lock');
  // Release any held lock
  const state = lock.getLockState();
  if (state.isRunning) lock.releaseLock(null, 'test reset');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/automation/status', () => {
  it('returns the lock state', async () => {
    const res = await ctx.request.get('/api/automation/status').expect(200);
    expect(res.body).toMatchObject({
      isRunning: expect.any(Boolean),
      automationId: null,
    });
  });
});

describe('GET /api/automation/domains', () => {
  it('returns 503 when Drive is not connected', async () => {
    const res = await ctx.request.get('/api/automation/domains').expect(503);
    expect(res.body.error).toMatch(/not connected/i);
  });
});

describe('POST /api/automation/run', () => {
  afterEach(() => resetLock());

  it('returns 400 when automationId is missing', async () => {
    seedDriveCreds();
    const res = await ctx.request
      .post('/api/automation/run')
      .send({ domains: ['example.com'] })
      .expect(400);
    expect(res.body.error).toMatch(/automationId/);
  });

  it('returns 400 when domains is empty', async () => {
    seedDriveCreds();
    const res = await ctx.request
      .post('/api/automation/run')
      .send({ automationId: 'content-architecture-audit', domains: [] })
      .expect(400);
    expect(res.body.error).toMatch(/domains/);
  });

  it('returns 503 when Drive is not connected', async () => {
    // Remove drive creds
    db.prepare("DELETE FROM api_credentials WHERE service = 'google_drive'").run();
    const res = await ctx.request
      .post('/api/automation/run')
      .send({ automationId: 'content-architecture-audit', domains: ['example.com'] })
      .expect(503);
    expect(res.body.error).toMatch(/not connected/i);
  });

  it('returns 409 when lock is already held', async () => {
    seedDriveCreds();
    const lock = require('../../src/automation-lock');
    lock.acquireLock('test-automation', ['test.com']);

    const res = await ctx.request
      .post('/api/automation/run')
      .send({ automationId: 'content-architecture-audit', domains: ['example.com'] })
      .expect(409);
    expect(res.body.error).toMatch(/already running/i);
  });

  it('returns 202 with started:true when automation is accepted', async () => {
    seedDriveCreds();
    const googleDrive = require('../../src/google-drive');
    // Stub sheets client: scope-check probe returns 404 (scope valid, sheet not found).
    const sheetsStub = {
      spreadsheets: {
        get: jest.fn().mockRejectedValue(
          Object.assign(new Error('Not Found'), { response: { status: 404 } })
        ),
      },
    };
    jest.spyOn(googleDrive, 'buildSheetsClient').mockReturnValue(sheetsStub);

    const res = await ctx.request
      .post('/api/automation/run')
      .send({ automationId: 'content-architecture-audit', domains: ['example.com'] })
      .expect(202);
    expect(res.body).toEqual({ started: true });

    jest.restoreAllMocks();
  });

  it('returns 503 when Sheets scope is missing', async () => {
    seedDriveCreds();
    const googleDrive = require('../../src/google-drive');
    // Stub sheets client: probe returns 403 (scope absent).
    const sheetsStub = {
      spreadsheets: {
        get: jest.fn().mockRejectedValue(
          Object.assign(new Error('Forbidden'), { response: { status: 403 } })
        ),
      },
    };
    jest.spyOn(googleDrive, 'buildSheetsClient').mockReturnValue(sheetsStub);

    const res = await ctx.request
      .post('/api/automation/run')
      .send({ automationId: 'content-architecture-audit', domains: ['example.com'] })
      .expect(503);
    expect(res.body.error).toMatch(/re-authorize/i);

    jest.restoreAllMocks();
  });
});

describe('DELETE /api/automation/cancel', () => {
  afterEach(() => resetLock());

  it('sets cancelled flag', async () => {
    const lock = require('../../src/automation-lock');
    lock.acquireLock('test-automation', ['test.com']);

    const res = await ctx.request.delete('/api/automation/cancel').expect(200);
    expect(res.body.cancelled).toBe(true);

    const state = lock.getLockState();
    expect(state.cancelled).toBe(true);
  });
});
