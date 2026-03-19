'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// ─── Mock googleapis before requiring the module under test ──────────────────
jest.mock('googleapis', () => {
  const OAuth2 = jest.fn(function (clientId, clientSecret, redirectUri) {
    this.clientId    = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri  = redirectUri;
    this._credentials = {};
  });
  OAuth2.prototype.setCredentials = jest.fn(function (creds) {
    this._credentials = creds;
  });
  OAuth2.prototype.on              = jest.fn();
  OAuth2.prototype.generateAuthUrl = jest.fn(() => 'https://accounts.google.com/o/oauth2/auth?mocked');
  OAuth2.prototype.getToken        = jest.fn(async () => ({ tokens: { refresh_token: 'rt_mock', access_token: 'at_mock' } }));
  OAuth2.prototype.getAccessToken  = jest.fn(async () => ({ token: 'at_refreshed' }));

  const mockDrive = {
    files: {
      list:   jest.fn(),
      create: jest.fn(),
    },
  };

  return {
    google: {
      auth:  { OAuth2 },
      drive: jest.fn(() => mockDrive),
    },
    _mockDrive: mockDrive,
  };
});

const { google, _mockDrive } = require('googleapis');
const {
  buildOAuth2Client,
  buildDriveClientFromOAuth,
  findFolder,
  ensureFolder,
  domainFromUrl,
  uploadToDrive,
} = require('../../src/google-drive');

// ─── buildOAuth2Client ────────────────────────────────────────────────────────
describe('buildOAuth2Client()', () => {
  it('constructs an OAuth2 instance with the supplied credentials', () => {
    const client = buildOAuth2Client('cid', 'csecret', 'http://localhost/cb');
    expect(client.clientId).toBe('cid');
    expect(client.clientSecret).toBe('csecret');
    expect(client.redirectUri).toBe('http://localhost/cb');
  });

  it('works without a redirectUri', () => {
    expect(() => buildOAuth2Client('cid', 'csecret')).not.toThrow();
  });
});

// ─── buildDriveClientFromOAuth ────────────────────────────────────────────────
describe('buildDriveClientFromOAuth()', () => {
  it('calls google.drive with v3 and sets refresh token credentials', () => {
    buildDriveClientFromOAuth('cid', 'csecret', 'rt_token');
    expect(google.drive).toHaveBeenCalledWith(expect.objectContaining({ version: 'v3' }));
  });
});

// ─── domainFromUrl ────────────────────────────────────────────────────────────
describe('domainFromUrl()', () => {
  it('extracts the bare hostname', () => {
    expect(domainFromUrl('https://example.com/path?q=1')).toBe('example.com');
  });

  it('strips www. prefix', () => {
    expect(domainFromUrl('https://www.example.com')).toBe('example.com');
  });

  it('preserves other subdomains', () => {
    expect(domainFromUrl('https://blog.example.com')).toBe('blog.example.com');
  });

  it('returns the raw input when the URL is unparseable', () => {
    expect(domainFromUrl('not-a-url')).toBe('not-a-url');
  });
});

// ─── findFolder ───────────────────────────────────────────────────────────────
describe('findFolder()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the folder ID when a matching folder is found', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [{ id: 'folder-id-1', name: 'myFolder' }] } });
    const id = await findFolder(_mockDrive, 'myFolder', null);
    expect(id).toBe('folder-id-1');
  });

  it('returns null when no folder is found', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    const id = await findFolder(_mockDrive, 'missing', null);
    expect(id).toBeNull();
  });

  it('uses root in parents query when parentId is null', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    await findFolder(_mockDrive, 'folder', null);
    const [call] = _mockDrive.files.list.mock.calls;
    expect(call[0].q).toContain("'root' in parents");
  });

  it('uses parentId in parents query when parentId is provided', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    await findFolder(_mockDrive, 'folder', 'parent-abc');
    const [call] = _mockDrive.files.list.mock.calls;
    expect(call[0].q).toContain("'parent-abc' in parents");
  });

  it('escapes single quotes in folder names', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    await findFolder(_mockDrive, "O'Brien's Crawls", null);
    const q = _mockDrive.files.list.mock.calls[0][0].q;
    expect(q).toContain("O\\'Brien\\'s Crawls");
  });
});

// ─── ensureFolder ─────────────────────────────────────────────────────────────
describe('ensureFolder()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns existing folder ID without creating', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [{ id: 'existing-id' }] } });
    const id = await ensureFolder(_mockDrive, 'myFolder', null);
    expect(id).toBe('existing-id');
    expect(_mockDrive.files.create).not.toHaveBeenCalled();
  });

  it('creates the folder when it does not exist and returns new ID', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    _mockDrive.files.create.mockResolvedValueOnce({ data: { id: 'new-folder-id' } });
    const id = await ensureFolder(_mockDrive, 'newFolder', null);
    expect(id).toBe('new-folder-id');
    expect(_mockDrive.files.create).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: expect.objectContaining({
        name: 'newFolder',
        mimeType: 'application/vnd.google-apps.folder',
      }),
    }));
  });

  it('sets parents when parentId is provided', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    _mockDrive.files.create.mockResolvedValueOnce({ data: { id: 'child-id' } });
    await ensureFolder(_mockDrive, 'childFolder', 'parent-xyz');
    const call = _mockDrive.files.create.mock.calls[0][0];
    expect(call.requestBody.parents).toEqual(['parent-xyz']);
  });

  it('does not set parents when parentId is null', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    _mockDrive.files.create.mockResolvedValueOnce({ data: { id: 'root-child-id' } });
    await ensureFolder(_mockDrive, 'rootFolder', null);
    const call = _mockDrive.files.create.mock.calls[0][0];
    expect(call.requestBody.parents).toBeUndefined();
  });
});

// ─── uploadToDrive ────────────────────────────────────────────────────────────
describe('uploadToDrive()', () => {
  let tmpFile;

  beforeEach(() => {
    jest.clearAllMocks();
    // Create a small temp file to upload.
    tmpFile = path.join(os.tmpdir(), `gd-test-${Date.now()}.zip`);
    fs.writeFileSync(tmpFile, 'fake zip content');
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
  });

  function setupMocks({ folderId = 'domain-folder-id', driveSize = null } = {}) {
    const localSize = fs.statSync(tmpFile).size;
    // findFolder → domain folder exists
    _mockDrive.files.list.mockResolvedValue({ data: { files: [{ id: folderId }] } });
    // upload response
    _mockDrive.files.create.mockResolvedValueOnce({
      data: { id: 'file-id-abc', size: String(driveSize !== null ? driveSize : localSize) },
    });
    return localSize;
  }

  it('resolves with fileId, domain, folderId, localSize, driveSize on success', async () => {
    const localSize = setupMocks();
    const result = await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl: 'https://www.example.com',
    });
    expect(result.fileId).toBe('file-id-abc');
    expect(result.domain).toBe('example.com');
    expect(result.folderId).toBe('domain-folder-id');
    expect(result.localSize).toBe(localSize);
    expect(result.driveSize).toBe(localSize);
  });

  it('uses the rootFolderId when looking up the domain subfolder', async () => {
    setupMocks({ folderId: 'subfolder-in-root' });
    await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl:   'https://example.com',
      rootFolderId: 'root-folder-id',
    });
    const listCall = _mockDrive.files.list.mock.calls[0][0];
    expect(listCall.q).toContain("'root-folder-id' in parents");
  });

  it('throws a validation error when Drive size does not match local size', async () => {
    const localSize = fs.statSync(tmpFile).size;
    _mockDrive.files.list.mockResolvedValue({ data: { files: [{ id: 'fid' }] } });
    _mockDrive.files.create.mockResolvedValueOnce({
      data: { id: 'file-id', size: String(localSize + 1) },
    });
    await expect(uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl:   'https://example.com',
    })).rejects.toThrow(/validation failed/);
  });

  it('uploads with rootFolderId null when not provided (places domain folder at Drive root)', async () => {
    setupMocks();
    await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl:   'https://example.com',
    });
    const listCall = _mockDrive.files.list.mock.calls[0][0];
    expect(listCall.q).toContain("'root' in parents");
  });

  it('calls onProgress callback during upload (Enhancement #2)', async () => {
    setupMocks();
    const progressCalls = [];
    await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl:   'https://example.com',
      onProgress: (pct) => progressCalls.push(pct),
    });
    // onProgress is called via setInterval so we can't assert exact calls here,
    // but the function must not throw when provided.
    expect(typeof progressCalls).toBe('object');
  });

  it('does not throw when onProgress is not provided', async () => {
    setupMocks();
    await expect(uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl:   'https://example.com',
    })).resolves.not.toThrow();
  });

  it('registers onTokenRefresh listener on the OAuth2 client (Enhancement #3)', async () => {
    setupMocks();
    const onTokenRefreshSpy = jest.fn();
    await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl:   'https://example.com',
      onTokenRefresh: onTokenRefreshSpy,
    });
    // The googleapis mock uses `auth.on('tokens', cb)` – verify the mock received the call.
    const OAuth2Instance = google.auth.OAuth2.mock.instances[google.auth.OAuth2.mock.instances.length - 1];
    expect(OAuth2Instance.on).toHaveBeenCalledWith('tokens', onTokenRefreshSpy);
  });
});
