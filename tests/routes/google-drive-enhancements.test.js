'use strict';

/**
 * Route-level tests for the four Google Drive future enhancements:
 *   #1 – Persistent OAuth Session (refresh_token encryption at rest)
 *   #2 – Upload Progress (drive_upload_progress column + API field)
 *   #3 – Auto Token Refresh (cached access_token, onTokenRefresh callback)
 *   #4 – Webhook Integration (webhook_url field in API credentials)
 *
 * These tests live in their own file so each suite gets a fresh Express app
 * instance with an independent rate limiter and SQLite database.
 */

// ─── Mock googleapis so the OAuth token endpoint works without a real token ──
const mockGetAccessToken = jest.fn();

jest.mock('googleapis', () => {
  const OAuth2 = jest.fn(function () {
    this.setCredentials = jest.fn();
    this.on = jest.fn();
  });
  OAuth2.prototype.generateAuthUrl = jest.fn(opts =>
    'https://accounts.google.com/mock-auth?state=' + encodeURIComponent(opts?.state || '')
  );
  OAuth2.prototype.getToken       = jest.fn(async () => ({ tokens: { refresh_token: 'rt_mock' } }));
  OAuth2.prototype.getAccessToken = mockGetAccessToken;

  return {
    google: {
      auth:  { OAuth2 },
      drive: jest.fn(() => ({ files: { list: jest.fn(), create: jest.fn() } })),
    },
  };
});

const { makeApp } = require('../helpers/app-factory');

let ctx;
let db;

beforeAll(() => {
  ctx = makeApp('gd-enhancements');
  ({ db } = require('../../src/db'));
});

afterAll(() => ctx.cleanup());

beforeEach(() => {
  mockGetAccessToken.mockReset();
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function seedDriveCreds(overrides = {}) {
  const defaults = { api_key: '', client_id: '', client_secret: '' };
  const creds = { ...defaults, ...overrides };
  db.prepare(`
    INSERT INTO api_credentials (service, enabled, credentials)
    VALUES ('google_drive', 0, ?)
    ON CONFLICT(service) DO UPDATE SET credentials = excluded.credentials
  `).run(JSON.stringify(creds));
}

// ─── Enhancement #1: refresh_token encryption at rest ────────────────────────
describe('Enhancement #1 – refresh_token encryption at rest', () => {
  const ORIG_SECRET = process.env.ENCRYPTION_SECRET;

  afterEach(() => {
    if (ORIG_SECRET === undefined) {
      delete process.env.ENCRYPTION_SECRET;
    } else {
      process.env.ENCRYPTION_SECRET = ORIG_SECRET;
    }
  });

  it('stores a plain-text refresh_token unchanged when ENCRYPTION_SECRET is not set', async () => {
    delete process.env.ENCRYPTION_SECRET;
    seedDriveCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'plain_rt' });

    // POST /root-folder calls persistCredentials internally, which should leave the token as-is.
    await ctx.request.post('/api/google-drive/root-folder')
      .send({ folderId: 'f1', folderName: 'Folder' })
      .expect(200);

    const row = db.prepare("SELECT credentials FROM api_credentials WHERE service='google_drive'").get();
    const creds = JSON.parse(row.credentials);
    expect(creds.refresh_token).toBe('plain_rt');
  });

  it('encrypts the refresh_token (enc: prefix) when ENCRYPTION_SECRET is set', async () => {
    process.env.ENCRYPTION_SECRET = 'test-enc-secret';
    seedDriveCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'plain_rt_to_encrypt' });

    await ctx.request.post('/api/google-drive/root-folder')
      .send({ folderId: 'f2', folderName: 'Folder 2' })
      .expect(200);

    const row = db.prepare("SELECT credentials FROM api_credentials WHERE service='google_drive'").get();
    const raw = JSON.parse(row.credentials).refresh_token;
    expect(raw).toMatch(/^enc:/);
    expect(raw).not.toBe('plain_rt_to_encrypt');
  });

  it('GET /status returns connected=true even when refresh_token is stored encrypted', async () => {
    process.env.ENCRYPTION_SECRET = 'test-enc-secret';
    seedDriveCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'plain_rt' });

    await ctx.request.post('/api/google-drive/root-folder')
      .send({ folderId: 'f3', folderName: 'Folder 3' })
      .expect(200);

    const res = await ctx.request.get('/api/google-drive/status').expect(200);
    expect(res.body.connected).toBe(true);
  });

  it('an existing plain-text token (pre-migration) is still readable via /status', async () => {
    // Simulate a database that was written BEFORE encryption was enabled.
    delete process.env.ENCRYPTION_SECRET;
    seedDriveCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'legacy_plain_rt' });

    // Now enable encryption – the token is still plain-text in the DB.
    process.env.ENCRYPTION_SECRET = 'some-secret';
    const res = await ctx.request.get('/api/google-drive/status').expect(200);
    // Should still be connected because decrypt() passes through non-enc: values.
    expect(res.body.connected).toBe(true);
  });
});

// ─── Enhancement #2: drive_upload_progress in job detail ─────────────────────
describe('Enhancement #2 – drive_upload_progress column', () => {
  it('drive_upload_progress is returned by GET /api/jobs/:id', async () => {
    const row = db.prepare(`
      INSERT INTO jobs (url, export_tabs, status) VALUES ('https://example.com', 'Internal:All', 'completed')
    `).run();
    const jobId = row.lastInsertRowid;

    db.prepare('UPDATE jobs SET drive_upload_progress = 75 WHERE id = ?').run(jobId);

    const res = await ctx.request.get(`/api/jobs/${jobId}`).expect(200);
    expect(res.body.drive_upload_progress).toBe(75);
  });

  it('drive_upload_progress is null when not set', async () => {
    const row = db.prepare(`
      INSERT INTO jobs (url, export_tabs, status) VALUES ('https://example.com', 'Internal:All', 'completed')
    `).run();
    const jobId = row.lastInsertRowid;

    const res = await ctx.request.get(`/api/jobs/${jobId}`).expect(200);
    expect(res.body.drive_upload_progress).toBeNull();
  });
});

// ─── Enhancement #3: cached access token ─────────────────────────────────────
describe('Enhancement #3 – cached access token in GET /api/google-drive/token', () => {
  it('returns the cached access_token without calling getAccessToken when expiry is in the future', async () => {
    seedDriveCreds({
      client_id:    'cid',
      client_secret: 'cs',
      refresh_token: 'rt',
      access_token:  'cached_at_value',
      token_expiry:  Date.now() + 10 * 60_000, // 10 minutes in the future
    });

    const res = await ctx.request.get('/api/google-drive/token').expect(200);
    expect(res.body.accessToken).toBe('cached_at_value');
    // getAccessToken must NOT have been called.
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes when the cached access_token is within 60 s of expiry', async () => {
    seedDriveCreds({
      client_id:    'cid',
      client_secret: 'cs',
      refresh_token: 'rt',
      access_token:  'nearly_expired_at',
      token_expiry:  Date.now() + 30_000, // only 30 s left
    });

    mockGetAccessToken.mockResolvedValueOnce({ token: 'freshly_issued_at' });

    const res = await ctx.request.get('/api/google-drive/token').expect(200);
    expect(res.body.accessToken).toBe('freshly_issued_at');
    expect(mockGetAccessToken).toHaveBeenCalled();
  });

  it('refreshes when no cached access_token is stored', async () => {
    seedDriveCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' });

    mockGetAccessToken.mockResolvedValueOnce({ token: 'brand_new_at' });

    const res = await ctx.request.get('/api/google-drive/token').expect(200);
    expect(res.body.accessToken).toBe('brand_new_at');
    expect(mockGetAccessToken).toHaveBeenCalled();
  });

  it('persists a new access_token when the tokens event fires', async () => {
    seedDriveCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' });

    // Capture the `tokens` listener that the /token endpoint registers via oauth2Client.on().
    const { google } = require('googleapis');
    let tokensCallback = null;
    google.auth.OAuth2.mockImplementationOnce(function () {
      this.setCredentials = jest.fn();
      this.on = jest.fn((event, cb) => {
        if (event === 'tokens') tokensCallback = cb;
      });
    });

    mockGetAccessToken.mockImplementationOnce(async function () {
      // Fire the tokens event as googleapis would, after the listener is registered.
      if (tokensCallback) {
        tokensCallback({ access_token: 'persisted_at', expiry_date: Date.now() + 3600_000 });
      }
      return { token: 'persisted_at' };
    });

    await ctx.request.get('/api/google-drive/token').expect(200);

    // The new access_token should be persisted to the database.
    const row = db.prepare("SELECT credentials FROM api_credentials WHERE service='google_drive'").get();
    const creds = JSON.parse(row.credentials);
    expect(creds.access_token).toBe('persisted_at');
    expect(typeof creds.token_expiry).toBe('number');
  });
});

// ─── Enhancement #4: webhook_url field ────────────────────────────────────────
describe('Enhancement #4 – webhook_url in API credentials', () => {
  it('webhook_url field is present in the google_drive fields list', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    const gd  = res.body.find(s => s.service === 'google_drive');
    expect(gd).toBeDefined();
    const fieldNames = gd.fields.map(f => f.name);
    expect(fieldNames).toContain('webhook_url');
  });

  it('stores and retrieves webhook_url via PUT /api/api-credentials/google_drive', async () => {
    const r = await ctx.request
      .put('/api/api-credentials/google_drive')
      .send({
        enabled:     true,
        credentials: { webhook_url: 'https://hooks.example.com/notify' },
      })
      .expect(200);

    expect(r.body.credentials.webhook_url).toBe('https://hooks.example.com/notify');
  });

  it('webhook_url is preserved when other credential fields are updated', async () => {
    // Set webhook_url.
    await ctx.request
      .put('/api/api-credentials/google_drive')
      .send({ credentials: { webhook_url: 'https://hooks.example.com/notify' } })
      .expect(200);

    // Update only client_id – webhook_url should still be there.
    const r = await ctx.request
      .put('/api/api-credentials/google_drive')
      .send({ credentials: { client_id: 'new-client-id' } })
      .expect(200);

    expect(r.body.credentials.webhook_url).toBe('https://hooks.example.com/notify');
    expect(r.body.credentials.client_id).toBe('new-client-id');
  });

  it('webhook_url is not marked sensitive (shown in plain-text in GET response)', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    const gd  = res.body.find(s => s.service === 'google_drive');
    const webhookField = gd.fields.find(f => f.name === 'webhook_url');
    expect(webhookField.sensitive).toBe(false);
  });
});
