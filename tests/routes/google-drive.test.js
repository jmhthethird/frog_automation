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
    api_key:        '',
    root_folder_id: '',
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

  it('returns connected=true when api_key and root_folder_id are present', async () => {
    seedDriveCreds({ api_key: '{"type":"service_account"}', root_folder_id: 'folder-abc' });
    const res = await ctx.request.get('/api/google-drive/status').expect(200);
    expect(res.body.connected).toBe(true);
  });

  it('returns connected=false when api_key is present but root_folder_id is missing', async () => {
    seedDriveCreds({ api_key: '{"type":"service_account"}', root_folder_id: '' });
    const res = await ctx.request.get('/api/google-drive/status').expect(200);
    expect(res.body.connected).toBe(false);
  });

  it('returns connected=false when root_folder_id is present but api_key is missing', async () => {
    seedDriveCreds({ api_key: '', root_folder_id: 'folder-abc' });
    const res = await ctx.request.get('/api/google-drive/status').expect(200);
    expect(res.body.connected).toBe(false);
  });

  it('returns rootFolderId when a root folder has been configured', async () => {
    seedDriveCreds({
      api_key: '{"type":"service_account"}',
      root_folder_id: 'folder-abc', root_folder_name: 'SEO Crawls',
    });
    const res = await ctx.request.get('/api/google-drive/status').expect(200);
    expect(res.body.rootFolderId).toBe('folder-abc');
    expect(res.body.rootFolderName).toBe('SEO Crawls');
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
    seedDriveCreds({ api_key: '{"type":"service_account"}' });
    await ctx.request.post('/api/google-drive/root-folder')
      .send({ folderId: 'f1', folderName: 'Folder One' })
      .expect(200);
    const row  = db.prepare("SELECT credentials FROM api_credentials WHERE service='google_drive'").get();
    const creds = JSON.parse(row.credentials);
    expect(creds.api_key).toBe('{"type":"service_account"}');
    expect(creds.root_folder_id).toBe('f1');
  });
});

// ─── DELETE /api/google-drive/auth ───────────────────────────────────────────
describe('DELETE /api/google-drive/auth', () => {
  it('clears root_folder_id and root_folder_name', async () => {
    seedDriveCreds({
      api_key: '{"type":"service_account"}',
      root_folder_id: 'fid', root_folder_name: 'Folder',
    });

    const res = await ctx.request.delete('/api/google-drive/auth').expect(200);
    expect(res.body.ok).toBe(true);

    const row   = db.prepare("SELECT credentials FROM api_credentials WHERE service='google_drive'").get();
    const creds = JSON.parse(row.credentials);
    expect(creds.root_folder_id).toBeUndefined();
    expect(creds.root_folder_name).toBeUndefined();
  });

  it('preserves api_key after clearing root folder', async () => {
    seedDriveCreds({ api_key: '{"type":"service_account"}', root_folder_id: 'fid' });

    await ctx.request.delete('/api/google-drive/auth').expect(200);

    const row   = db.prepare("SELECT credentials FROM api_credentials WHERE service='google_drive'").get();
    const creds = JSON.parse(row.credentials);
    expect(creds.api_key).toBe('{"type":"service_account"}');
  });

  it('status reflects not-configured after DELETE', async () => {
    seedDriveCreds({ api_key: '{"type":"service_account"}', root_folder_id: 'fid' });
    await ctx.request.delete('/api/google-drive/auth').expect(200);
    const status = await ctx.request.get('/api/google-drive/status').expect(200);
    expect(status.body.connected).toBe(false);
  });
});
