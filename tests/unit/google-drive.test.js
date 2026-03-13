'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// ─── Mock googleapis before requiring the module under test ──────────────────
jest.mock('googleapis', () => {
  const GoogleAuth = jest.fn(function ({ credentials } = {}) {
    this.credentials = credentials;
    this.scopes      = [];
  });

  const mockDrive = {
    files: {
      list:   jest.fn(),
      create: jest.fn(),
    },
  };

  return {
    google: {
      auth:  { GoogleAuth },
      drive: jest.fn(() => mockDrive),
    },
    _mockDrive: mockDrive,
  };
});

const { google, _mockDrive } = require('googleapis');
const {
  buildDriveClientFromApiKey,
  findFolder,
  ensureFolder,
  domainFromUrl,
  uploadToDrive,
} = require('../../src/google-drive');

// ─── buildDriveClientFromApiKey ───────────────────────────────────────────────
describe('buildDriveClientFromApiKey()', () => {
  it('constructs a Drive client from a JSON string key', () => {
    const key = JSON.stringify({ type: 'service_account', project_id: 'my-project' });
    buildDriveClientFromApiKey(key);
    expect(google.drive).toHaveBeenCalledWith(expect.objectContaining({ version: 'v3' }));
  });

  it('constructs a Drive client from a plain object key', () => {
    const key = { type: 'service_account', project_id: 'my-project' };
    buildDriveClientFromApiKey(key);
    expect(google.drive).toHaveBeenCalledWith(expect.objectContaining({ version: 'v3' }));
  });

  it('throws a SyntaxError when given an invalid JSON string', () => {
    expect(() => buildDriveClientFromApiKey('not-json')).toThrow(SyntaxError);
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
    // upload response – attach an error handler and destroy the body stream so
    // Node does not emit an unhandled ENOENT after afterEach deletes the temp file.
    _mockDrive.files.create.mockImplementationOnce(async (params) => {
      const body = params?.media?.body;
      if (body) { body.on('error', () => {}); body.destroy(); }
      return { data: { id: 'file-id-abc', size: String(driveSize !== null ? driveSize : localSize) } };
    });
    return localSize;
  }

  it('resolves with fileId, domain, folderId, localSize, driveSize on success', async () => {
    const localSize = setupMocks();
    const result = await uploadToDrive({
      apiKey:  JSON.stringify({ type: 'service_account' }),
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
      apiKey:  JSON.stringify({ type: 'service_account' }),
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
    _mockDrive.files.create.mockImplementationOnce(async (params) => {
      const body = params?.media?.body;
      if (body) { body.on('error', () => {}); body.destroy(); }
      return { data: { id: 'file-id', size: String(localSize + 1) } };
    });
    await expect(uploadToDrive({
      apiKey:  JSON.stringify({ type: 'service_account' }),
      filePath: tmpFile,
      jobUrl:   'https://example.com',
    })).rejects.toThrow(/validation failed/);
  });

  it('uploads with rootFolderId null when not provided (places domain folder at Drive root)', async () => {
    setupMocks();
    await uploadToDrive({
      apiKey:  JSON.stringify({ type: 'service_account' }),
      filePath: tmpFile,
      jobUrl:   'https://example.com',
    });
    const listCall = _mockDrive.files.list.mock.calls[0][0];
    expect(listCall.q).toContain("'root' in parents");
  });
});
