'use strict';

const { makeApp } = require('../helpers/app-factory');

let ctx;
let db;

beforeAll(() => {
  ctx = makeApp('google-drive');
  ({ db } = require('../../src/db'));
});

afterAll(() => ctx.cleanup());

// ─── Helper ───────────────────────────────────────────────────────────────────

function seedDriveCreds(overrides = {}) {
  const defaults = {
    api_key:       '',
    client_id:     '',
    client_secret: '',
  };
  const creds = { ...defaults, ...overrides };
  db.prepare(`
    INSERT INTO api_credentials (service, enabled, credentials)
    VALUES ('google_drive', 0, ?)
    ON CONFLICT(service) DO UPDATE SET credentials = excluded.credentials
  `).run(JSON.stringify(creds));
}

// ─── GET /api/google-drive/status ────────────────────────────────────────────
describe('GET /api/google-drive/status', () => {
  it('returns connected=false when no credentials are stored', async () => {
    const res = await ctx.request.get('/api/google-drive/status').expect(200);
    expect(res.body.connected).toBe(false);
    expect(res.body.rootFolderId).toBeNull();
    expect(res.body.rootFolderName).toBeNull();
  });

  it('returns connected=true when client_id, client_secret, and refresh_token are present', async () => {
    seedDriveCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' });
    const res = await ctx.request.get('/api/google-drive/status').expect(200);
    expect(res.body.connected).toBe(true);
  });

  it('returns rootFolderName when a root folder has been selected', async () => {
    seedDriveCreds({
      client_id: 'cid', client_secret: 'cs', refresh_token: 'rt',
      root_folder_id: 'folder-abc', root_folder_name: 'SEO Crawls',
    });
    const res = await ctx.request.get('/api/google-drive/status').expect(200);
    expect(res.body.rootFolderId).toBe('folder-abc');
    expect(res.body.rootFolderName).toBe('SEO Crawls');
  });
});

// ─── GET /api/google-drive/auth-url ──────────────────────────────────────────
describe('GET /api/google-drive/auth-url', () => {
  it('returns 400 when client_id or client_secret are missing', async () => {
    seedDriveCreds({ client_id: '', client_secret: '' });
    const res = await ctx.request.get('/api/google-drive/auth-url').expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns a URL when credentials are present', async () => {
    seedDriveCreds({ client_id: 'my-client-id', client_secret: 'my-secret' });
    const res = await ctx.request.get('/api/google-drive/auth-url').expect(200);
    expect(typeof res.body.url).toBe('string');
    expect(res.body.url.length).toBeGreaterThan(0);
  });
});

// ─── POST /api/google-drive/root-folder ──────────────────────────────────────
describe('POST /api/google-drive/root-folder', () => {
  it('returns 400 when folderId is missing', async () => {
    const res = await ctx.request.post('/api/google-drive/root-folder')
      .send({})
      .expect(400);
    expect(res.body.error).toMatch(/folderId/i);
  });

  it('returns 400 when folderId is not a string', async () => {
    const res = await ctx.request.post('/api/google-drive/root-folder')
      .send({ folderId: 123 })
      .expect(400);
    expect(res.body.error).toMatch(/folderId/i);
  });

  it('stores folderId and folderName and echoes them back', async () => {
    const res = await ctx.request.post('/api/google-drive/root-folder')
      .send({ folderId: 'folder-xyz', folderName: 'My SEO Uploads' })
      .expect(200);
    expect(res.body.folderId).toBe('folder-xyz');
    expect(res.body.folderName).toBe('My SEO Uploads');

    // Verify persisted.
    const row = db.prepare("SELECT credentials FROM api_credentials WHERE service='google_drive'").get();
    const creds = JSON.parse(row.credentials);
    expect(creds.root_folder_id).toBe('folder-xyz');
    expect(creds.root_folder_name).toBe('My SEO Uploads');
  });

  it('falls back to folderId as folderName when folderName is omitted', async () => {
    const res = await ctx.request.post('/api/google-drive/root-folder')
      .send({ folderId: 'folder-no-name' })
      .expect(200);
    expect(res.body.folderName).toBe('folder-no-name');
  });

  it('trims whitespace from folderId and folderName', async () => {
    const res = await ctx.request.post('/api/google-drive/root-folder')
      .send({ folderId: '  folder-trim  ', folderName: '  Trimmed Name  ' })
      .expect(200);
    expect(res.body.folderId).toBe('folder-trim');
    expect(res.body.folderName).toBe('Trimmed Name');
  });

  it('preserves other stored credentials when updating the root folder', async () => {
    seedDriveCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' });
    await ctx.request.post('/api/google-drive/root-folder')
      .send({ folderId: 'f1', folderName: 'Folder One' })
      .expect(200);
    const row  = db.prepare("SELECT credentials FROM api_credentials WHERE service='google_drive'").get();
    const creds = JSON.parse(row.credentials);
    expect(creds.client_id).toBe('cid');
    expect(creds.refresh_token).toBe('rt');
    expect(creds.root_folder_id).toBe('f1');
  });
});

// ─── DELETE /api/google-drive/auth ───────────────────────────────────────────
describe('DELETE /api/google-drive/auth', () => {
  it('clears refresh_token, root_folder_id, root_folder_name', async () => {
    seedDriveCreds({
      api_key: 'apikey', client_id: 'cid', client_secret: 'cs',
      refresh_token: 'rt', root_folder_id: 'fid', root_folder_name: 'Folder',
    });

    const res = await ctx.request.delete('/api/google-drive/auth').expect(200);
    expect(res.body.ok).toBe(true);

    const row   = db.prepare("SELECT credentials FROM api_credentials WHERE service='google_drive'").get();
    const creds = JSON.parse(row.credentials);
    expect(creds.refresh_token).toBeUndefined();
    expect(creds.root_folder_id).toBeUndefined();
    expect(creds.root_folder_name).toBeUndefined();
  });

  it('preserves api_key, client_id, and client_secret after disconnect', async () => {
    seedDriveCreds({ api_key: 'mykey', client_id: 'mycid', client_secret: 'mycs', refresh_token: 'rt' });

    await ctx.request.delete('/api/google-drive/auth').expect(200);

    const row   = db.prepare("SELECT credentials FROM api_credentials WHERE service='google_drive'").get();
    const creds = JSON.parse(row.credentials);
    expect(creds.api_key).toBe('mykey');
    expect(creds.client_id).toBe('mycid');
    expect(creds.client_secret).toBe('mycs');
  });

  it('status reflects disconnected after DELETE', async () => {
    seedDriveCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' });
    await ctx.request.delete('/api/google-drive/auth').expect(200);
    const status = await ctx.request.get('/api/google-drive/status').expect(200);
    expect(status.body.connected).toBe(false);
  });
});

// ─── GET /api/google-drive/token ─────────────────────────────────────────────
describe('GET /api/google-drive/token', () => {
  it('returns 401 when not authenticated', async () => {
    seedDriveCreds({ client_id: '', client_secret: '', refresh_token: undefined });
    const res = await ctx.request.get('/api/google-drive/token').expect(401);
    expect(res.body.error).toBeTruthy();
  });
});
