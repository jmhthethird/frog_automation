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
  OAuth2.prototype.generateAuthUrl = jest.fn(() => 'https://accounts.google.com/o/oauth2/auth?mocked');
  OAuth2.prototype.getToken        = jest.fn(async () => ({ tokens: { refresh_token: 'rt_mock', access_token: 'at_mock' } }));
  OAuth2.prototype.getAccessToken  = jest.fn(async () => ({ token: 'at_refreshed' }));

  const mockDrive = {
    files: {
      list:   jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      get:    jest.fn(),
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
  uploadFile,
  uploadFolder,
  listSubfolders,
  migrateDriveFolders,
  ensureCategoryFolders,
  downloadFileAsText,
  listFolderContents,
  listDomainsWithCrawlData,
  getLatestCrawlFolder,
  findFileByName,
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
  let tmpDir;

  beforeEach(() => {
    jest.clearAllMocks();
    // Create a small temp file to upload.
    tmpFile = path.join(os.tmpdir(), `gd-test-${Date.now()}.zip`);
    fs.writeFileSync(tmpFile, 'fake zip content');
    // Create a temp directory with files to test folder upload.
    tmpDir = path.join(os.tmpdir(), `gd-test-dir-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'content1');
    fs.writeFileSync(path.join(tmpDir, 'file2.txt'), 'content2');
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
  });

  function setupMocks({ folderId = 'domain-folder-id', driveSize = null } = {}) {
    const localSize = fs.statSync(tmpFile).size;
    // findFolder → domain folder exists
    _mockDrive.files.list.mockResolvedValue({ data: { files: [{ id: folderId }] } });
    // upload response for each file
    _mockDrive.files.create.mockImplementation(({ requestBody }) => {
      if (requestBody.mimeType === 'application/vnd.google-apps.folder') {
        return Promise.resolve({ data: { id: `folder-${requestBody.name}` } });
      }
      return Promise.resolve({
        data: { id: 'file-id-abc', size: String(driveSize !== null ? driveSize : fs.statSync(tmpFile).size) },
      });
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

  it('uses the rootFolderId when looking up the category subfolder', async () => {
    setupMocks({ folderId: 'subfolder-in-root' });
    await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl:   'https://example.com',
      rootFolderId: 'root-folder-id',
    });
    // First list call is for the category folder inside the root folder.
    const categoryCall = _mockDrive.files.list.mock.calls[0][0];
    expect(categoryCall.q).toContain("'root-folder-id' in parents");
    expect(categoryCall.q).toContain("name='Crawls'");
    // Second list call is for the domain folder inside the category folder.
    const domainCall = _mockDrive.files.list.mock.calls[1][0];
    expect(domainCall.q).toContain("'subfolder-in-root' in parents");
    expect(domainCall.q).toContain("name='example.com'");
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

  it('uploads with rootFolderId null when not provided (places category folder at Drive root)', async () => {
    setupMocks();
    await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl:   'https://example.com',
    });
    // First list call looks up the category folder in the Drive root.
    const categoryCall = _mockDrive.files.list.mock.calls[0][0];
    expect(categoryCall.q).toContain("'root' in parents");
    expect(categoryCall.q).toContain("name='Crawls'");
  });

  it('defaults driveCategory to "Crawls" when not specified', async () => {
    setupMocks();
    await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl:   'https://example.com',
    });
    const categoryCall = _mockDrive.files.list.mock.calls[0][0];
    expect(categoryCall.q).toContain("name='Crawls'");
  });

  it('uses a custom driveCategory when provided', async () => {
    setupMocks();
    await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl:   'https://example.com',
      driveCategory: { folder: 'Reports', useDomainSubfolder: true },
    });
    const categoryCall = _mockDrive.files.list.mock.calls[0][0];
    expect(categoryCall.q).toContain("name='Reports'");
  });

  it('skips domain subfolder when useDomainSubfolder is false', async () => {
    // Use mockResolvedValueOnce to return distinct IDs for the category folder lookup.
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [{ id: 'templates-folder-id' }] } });
    const localSize = fs.statSync(tmpFile).size;
    _mockDrive.files.create.mockResolvedValueOnce({
      data: { id: 'file-id-tmpl', size: String(localSize) },
    });

    const result = await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl:   'https://example.com',
      driveCategory: { folder: 'Templates', useDomainSubfolder: false },
    });

    // Only one files.list call for the category folder – no domain folder lookup.
    expect(_mockDrive.files.list).toHaveBeenCalledTimes(1);
    const categoryCall = _mockDrive.files.list.mock.calls[0][0];
    expect(categoryCall.q).toContain("name='Templates'");

    // File is uploaded directly into the category folder.
    expect(result.folderId).toBe('templates-folder-id');
    expect(result.fileId).toBe('file-id-tmpl');
  });

  it('uses jobLabel for the ZIP filename when provided', async () => {
    setupMocks();
    await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobLabel: 'google_2026-03-11_06-23PM-job25',
      jobUrl:   'https://example.com',
    });
    // Find the call that created the file (not a folder)
    const fileCalls = _mockDrive.files.create.mock.calls.filter(
      c => c[0].requestBody.mimeType !== 'application/vnd.google-apps.folder'
    );
    expect(fileCalls.length).toBeGreaterThan(0);
    expect(fileCalls[fileCalls.length - 1][0].requestBody.name).toBe('google_2026-03-11_06-23PM-job25.zip');
  });

  it('uploads both folder and ZIP when outputDir is provided', async () => {
    // Reset mock to track exact call order
    _mockDrive.files.list.mockResolvedValue({ data: { files: [{ id: 'domain-folder-id' }] } });
    _mockDrive.files.create.mockImplementation(({ requestBody }) => {
      if (requestBody.mimeType === 'application/vnd.google-apps.folder') {
        return Promise.resolve({ data: { id: `folder-${requestBody.name}` } });
      }
      const size = requestBody.name.endsWith('.zip')
        ? fs.statSync(tmpFile).size
        : 8; // 'content1' or 'content2'
      return Promise.resolve({ data: { id: `file-${requestBody.name}`, size: String(size) } });
    });

    const result = await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      outputDir: tmpDir,
      jobLabel: 'test-job-label',
      jobUrl:   'https://example.com',
    });

    // Should have folderResult with file count
    expect(result.folderResult).toBeDefined();
    expect(result.folderResult.fileCount).toBe(2);
    expect(result.folderResult.totalSize).toBe(16); // 8 + 8 bytes for 'content1' + 'content2'

    // Should also have uploaded the ZIP
    expect(result.fileId).toMatch(/^file-/);
    expect(result.localSize).toBe(fs.statSync(tmpFile).size);
  });

  it('skips folder upload when outputDir is not provided', async () => {
    setupMocks();
    const result = await uploadToDrive({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      filePath: tmpFile,
      jobUrl:   'https://example.com',
    });
    expect(result.folderResult).toBeNull();
  });
});

// ─── listSubfolders ───────────────────────────────────────────────────────────
describe('listSubfolders()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns all subfolders in a parent', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({
      data: { files: [{ id: 'f1', name: 'example.com' }, { id: 'f2', name: 'test.org' }] },
    });
    const folders = await listSubfolders(_mockDrive, 'parent-id');
    expect(folders).toEqual([
      { id: 'f1', name: 'example.com' },
      { id: 'f2', name: 'test.org' },
    ]);
    expect(_mockDrive.files.list.mock.calls[0][0].q).toContain("'parent-id' in parents");
  });

  it('uses root when parentId is null', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    await listSubfolders(_mockDrive, null);
    expect(_mockDrive.files.list.mock.calls[0][0].q).toContain("'root' in parents");
  });

  it('returns empty array when no subfolders exist', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    const folders = await listSubfolders(_mockDrive, 'parent-id');
    expect(folders).toEqual([]);
  });

  it('paginates through multiple pages', async () => {
    _mockDrive.files.list
      .mockResolvedValueOnce({
        data: { files: [{ id: 'f1', name: 'page1' }], nextPageToken: 'token2' },
      })
      .mockResolvedValueOnce({
        data: { files: [{ id: 'f2', name: 'page2' }] },
      });
    const folders = await listSubfolders(_mockDrive, 'parent-id');
    expect(folders).toHaveLength(2);
    expect(_mockDrive.files.list).toHaveBeenCalledTimes(2);
    // Second call should include pageToken
    expect(_mockDrive.files.list.mock.calls[1][0]).toHaveProperty('pageToken', 'token2');
  });

  it('falls back to Drive root when parentId is invalid', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    await listSubfolders(_mockDrive, "bad'value");
    expect(_mockDrive.files.list.mock.calls[0][0].q).toContain("'root' in parents");
  });
});

// ─── migrateDriveFolders ──────────────────────────────────────────────────────
describe('migrateDriveFolders()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('moves legacy domain folders into the Crawls folder', async () => {
    // Root contains two domain folders and nothing else.
    _mockDrive.files.list
      // listSubfolders call – root children
      .mockResolvedValueOnce({
        data: { files: [
          { id: 'dom1', name: 'example.com' },
          { id: 'dom2', name: 'test.org' },
        ]},
      })
      // ensureFolder(findFolder) for "Crawls" inside root
      .mockResolvedValueOnce({ data: { files: [{ id: 'crawls-folder' }] } })
      // ensureFolder(findFolder) for remaining categories
      .mockResolvedValueOnce({ data: { files: [{ id: 'reports-folder' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'automation-folder' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'templates-folder' }] } });

    _mockDrive.files.update.mockResolvedValue({ data: { id: 'ok', parents: ['crawls-folder'] } });

    const result = await migrateDriveFolders({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      rootFolderId: 'root-id',
    });

    expect(result.migrated).toBe(2);
    expect(result.skipped).toEqual([]);
    expect(result.crawlsFolderId).toBe('crawls-folder');

    // Both domain folders should have been moved.
    expect(_mockDrive.files.update).toHaveBeenCalledTimes(2);
    expect(_mockDrive.files.update).toHaveBeenCalledWith({
      fileId: 'dom1',
      addParents: 'crawls-folder',
      removeParents: 'root-id',
      fields: 'id, parents',
    });
    expect(_mockDrive.files.update).toHaveBeenCalledWith({
      fileId: 'dom2',
      addParents: 'crawls-folder',
      removeParents: 'root-id',
      fields: 'id, parents',
    });
  });

  it('skips known category folders', async () => {
    _mockDrive.files.list
      .mockResolvedValueOnce({
        data: { files: [
          { id: 'cat1', name: 'Crawls' },
          { id: 'cat2', name: 'Reports' },
          { id: 'dom1', name: 'example.com' },
        ]},
      })
      // ensureFolder for all 4 categories
      .mockResolvedValueOnce({ data: { files: [{ id: 'crawls-folder' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'reports-folder' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'automation-folder' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'templates-folder' }] } });

    _mockDrive.files.update.mockResolvedValue({ data: { id: 'ok', parents: ['crawls-folder'] } });

    const result = await migrateDriveFolders({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      rootFolderId: 'root-id',
    });

    expect(result.migrated).toBe(1);
    expect(result.skipped).toEqual(['Crawls', 'Reports']);
    expect(_mockDrive.files.update).toHaveBeenCalledTimes(1);
  });

  it('only migrates domain-like folder names and skips unrelated user folders', async () => {
    _mockDrive.files.list
      .mockResolvedValueOnce({
        data: { files: [
          { id: 'dom1', name: 'example.com' },
          { id: 'usr1', name: 'Invoices' },
          { id: 'usr2', name: 'SEO Assets' },
          { id: 'dom2', name: 'blog.test.org' },
        ]},
      })
      // ensureFolder for all 4 categories
      .mockResolvedValueOnce({ data: { files: [{ id: 'crawls-folder' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'reports-folder' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'automation-folder' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'templates-folder' }] } });

    _mockDrive.files.update.mockResolvedValue({ data: { id: 'ok', parents: ['crawls-folder'] } });

    const result = await migrateDriveFolders({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      rootFolderId: 'root-id',
    });

    // Only domain-like folders migrated; user folders skipped.
    expect(result.migrated).toBe(2);
    expect(result.skipped).toEqual(['Invoices', 'SEO Assets']);
    expect(_mockDrive.files.update).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when only category folders exist', async () => {
    _mockDrive.files.list
      .mockResolvedValueOnce({
        data: { files: [
          { id: 'cat1', name: 'Crawls' },
          { id: 'cat2', name: 'Templates' },
        ]},
      })
      // ensureFolder for all 4 categories
      .mockResolvedValueOnce({ data: { files: [{ id: 'crawls-folder' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'reports-folder' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'automation-folder' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'templates-folder' }] } });

    const result = await migrateDriveFolders({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
    });

    expect(result.migrated).toBe(0);
    expect(_mockDrive.files.update).not.toHaveBeenCalled();
  });

  it('uses Drive root when rootFolderId is not provided', async () => {
    _mockDrive.files.list
      .mockResolvedValueOnce({ data: { files: [] } })
      // ensureFolder for Crawls – not found, will create
      .mockResolvedValueOnce({ data: { files: [] } });
    _mockDrive.files.create
      .mockResolvedValueOnce({ data: { id: 'new-crawls' } })
      .mockResolvedValueOnce({ data: { id: 'new-reports' } })
      .mockResolvedValueOnce({ data: { id: 'new-automation' } })
      .mockResolvedValueOnce({ data: { id: 'new-templates' } });
    // ensureFolder for remaining categories – not found, will create
    _mockDrive.files.list
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { files: [] } });

    const result = await migrateDriveFolders({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
    });

    // listSubfolders should query root
    expect(_mockDrive.files.list.mock.calls[0][0].q).toContain("'root' in parents");
    expect(result.migrated).toBe(0);
    expect(result.crawlsFolderId).toBe('new-crawls');
  });
});

// ─── ensureCategoryFolders ────────────────────────────────────────────────────
describe('ensureCategoryFolders()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates all four category folders when none exist', async () => {
    // findFolder returns empty for each category → files.create called
    _mockDrive.files.list
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { files: [] } });
    _mockDrive.files.create
      .mockResolvedValueOnce({ data: { id: 'crawls-id' } })
      .mockResolvedValueOnce({ data: { id: 'reports-id' } })
      .mockResolvedValueOnce({ data: { id: 'automation-id' } })
      .mockResolvedValueOnce({ data: { id: 'templates-id' } });

    const result = await ensureCategoryFolders({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      rootFolderId: 'root-xyz',
    });

    expect(result).toEqual({
      Crawls: 'crawls-id',
      Reports: 'reports-id',
      Automation: 'automation-id',
      Templates: 'templates-id',
    });
    expect(_mockDrive.files.create).toHaveBeenCalledTimes(4);
  });

  it('reuses existing folders and only creates missing ones', async () => {
    // Crawls and Templates exist, Reports and Automation do not
    _mockDrive.files.list
      .mockResolvedValueOnce({ data: { files: [{ id: 'existing-crawls' }] } })
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'existing-templates' }] } });
    _mockDrive.files.create
      .mockResolvedValueOnce({ data: { id: 'new-reports' } })
      .mockResolvedValueOnce({ data: { id: 'new-automation' } });

    const result = await ensureCategoryFolders({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
      rootFolderId: 'root-xyz',
    });

    expect(result).toEqual({
      Crawls: 'existing-crawls',
      Reports: 'new-reports',
      Automation: 'new-automation',
      Templates: 'existing-templates',
    });
    expect(_mockDrive.files.create).toHaveBeenCalledTimes(2);
  });

  it('uses Drive root when rootFolderId is not provided', async () => {
    _mockDrive.files.list
      .mockResolvedValueOnce({ data: { files: [{ id: 'c1' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'r1' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'a1' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 't1' }] } });

    await ensureCategoryFolders({
      clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt',
    });

    // All findFolder calls should query Drive root
    for (const call of _mockDrive.files.list.mock.calls) {
      expect(call[0].q).toContain("'root' in parents");
    }
  });
});

// ─── downloadFileAsText ───────────────────────────────────────────────────────
describe('downloadFileAsText()', () => {
  const { EventEmitter } = require('events');

  beforeEach(() => jest.clearAllMocks());

  it('resolves with the file content as a UTF-8 string', async () => {
    const emitter = new EventEmitter();
    _mockDrive.files.get.mockResolvedValueOnce({ data: emitter });

    const promise = downloadFileAsText('file-id-123', _mockDrive);

    // Emit stream events synchronously after the promise is set up
    setImmediate(() => {
      emitter.emit('data', Buffer.from('hello '));
      emitter.emit('data', Buffer.from('world'));
      emitter.emit('end');
    });

    const result = await promise;
    expect(result).toBe('hello world');
  });

  it('rejects when the stream emits an error', async () => {
    const emitter = new EventEmitter();
    _mockDrive.files.get.mockResolvedValueOnce({ data: emitter });

    const promise = downloadFileAsText('file-id-123', _mockDrive);

    setImmediate(() => {
      emitter.emit('error', new Error('stream error'));
    });

    await expect(promise).rejects.toThrow('stream error');
  });

  it('calls files.get with alt:media and stream responseType', async () => {
    const emitter = new EventEmitter();
    _mockDrive.files.get.mockResolvedValueOnce({ data: emitter });

    const promise = downloadFileAsText('my-file-id', _mockDrive);
    setImmediate(() => { emitter.emit('data', Buffer.from('')); emitter.emit('end'); });
    await promise;

    expect(_mockDrive.files.get).toHaveBeenCalledWith(
      { fileId: 'my-file-id', alt: 'media' },
      { responseType: 'stream' },
    );
  });
});

// ─── listFolderContents ───────────────────────────────────────────────────────
describe('listFolderContents()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns all files in a folder', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({
      data: { files: [{ id: 'f1', name: 'a.csv', mimeType: 'text/csv', modifiedTime: '2026-01-01' }] },
    });
    const files = await listFolderContents('folder-id', _mockDrive);
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe('f1');
  });

  it('paginates through multiple pages', async () => {
    _mockDrive.files.list
      .mockResolvedValueOnce({ data: { files: [{ id: 'f1', name: 'a.csv', mimeType: 'text/csv', modifiedTime: '2026-01-01' }], nextPageToken: 'tok2' } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'f2', name: 'b.csv', mimeType: 'text/csv', modifiedTime: '2026-01-02' }] } });
    const files = await listFolderContents('folder-id', _mockDrive);
    expect(files).toHaveLength(2);
    expect(_mockDrive.files.list).toHaveBeenCalledTimes(2);
  });

  it('returns empty array when folder has no files', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    const files = await listFolderContents('folder-id', _mockDrive);
    expect(files).toEqual([]);
  });

  it('falls back to Drive root for invalid folder IDs', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    await listFolderContents("bad'id", _mockDrive);
    expect(_mockDrive.files.list.mock.calls[0][0].q).toContain("'root' in parents");
  });
});

// ─── listDomainsWithCrawlData ─────────────────────────────────────────────────
describe('listDomainsWithCrawlData()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns domain names and folder IDs from the Crawls subfolder', async () => {
    // findFolder for 'Crawls'
    _mockDrive.files.list
      .mockResolvedValueOnce({ data: { files: [{ id: 'crawls-folder-id' }] } })
      // listSubfolders inside Crawls
      .mockResolvedValueOnce({ data: { files: [
        { id: 'd1', name: 'example.com' },
        { id: 'd2', name: 'test.org' },
      ] } });

    const domains = await listDomainsWithCrawlData('root-id', _mockDrive);
    expect(domains).toEqual([
      { name: 'example.com', folderId: 'd1' },
      { name: 'test.org', folderId: 'd2' },
    ]);
  });

  it('returns empty array when the Crawls folder does not exist', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    const domains = await listDomainsWithCrawlData('root-id', _mockDrive);
    expect(domains).toEqual([]);
  });

  it('returns empty array when Crawls folder has no subfolders', async () => {
    _mockDrive.files.list
      .mockResolvedValueOnce({ data: { files: [{ id: 'crawls-folder' }] } })
      .mockResolvedValueOnce({ data: { files: [] } });
    const domains = await listDomainsWithCrawlData('root-id', _mockDrive);
    expect(domains).toEqual([]);
  });
});

// ─── getLatestCrawlFolder ─────────────────────────────────────────────────────
describe('getLatestCrawlFolder()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the most recently modified folder', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({
      data: { files: [
        { id: 'f1', name: 'crawl-old', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-01-01T00:00:00Z' },
        { id: 'f2', name: 'crawl-new', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-03-01T00:00:00Z' },
      ] },
    });
    const result = await getLatestCrawlFolder('domain-folder-id', _mockDrive);
    expect(result).toEqual({ id: 'f2', name: 'crawl-new' });
  });

  it('returns null when there are no folders', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    const result = await getLatestCrawlFolder('domain-folder-id', _mockDrive);
    expect(result).toBeNull();
  });

  it('ignores non-folder files', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({
      data: { files: [
        { id: 'f1', name: 'data.csv', mimeType: 'text/csv', modifiedTime: '2026-03-01T00:00:00Z' },
        { id: 'f2', name: 'crawl-folder', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-01-01T00:00:00Z' },
      ] },
    });
    const result = await getLatestCrawlFolder('domain-folder-id', _mockDrive);
    expect(result).toEqual({ id: 'f2', name: 'crawl-folder' });
  });
});

// ─── findFileByName ───────────────────────────────────────────────────────────
describe('findFileByName()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the file ID when a matching file is found', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [{ id: 'file-id-1', name: 'internal_all.csv' }] } });
    const id = await findFileByName('parent-id', 'internal_all.csv', _mockDrive);
    expect(id).toBe('file-id-1');
  });

  it('returns null when no matching file is found', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    const id = await findFileByName('parent-id', 'missing.csv', _mockDrive);
    expect(id).toBeNull();
  });

  it('falls back to Drive root for invalid parent IDs', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    await findFileByName("bad'id", 'file.csv', _mockDrive);
    expect(_mockDrive.files.list.mock.calls[0][0].q).toContain("'root' in parents");
  });

  it('escapes single quotes in the file name', async () => {
    _mockDrive.files.list.mockResolvedValueOnce({ data: { files: [] } });
    await findFileByName('parent-id', "O'Brien's data.csv", _mockDrive);
    const q = _mockDrive.files.list.mock.calls[0][0].q;
    expect(q).toContain("O\\'Brien\\'s data.csv");
  });
});
