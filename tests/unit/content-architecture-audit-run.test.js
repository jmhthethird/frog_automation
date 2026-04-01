'use strict';

/**
 * Tests for content-architecture-audit run() function.
 * All Google Drive / Sheets API calls are mocked via jest.mock.
 */

// ─── Mock dependencies before require ─────────────────────────────────────────

const mockDrive = {};
const mockSheets = {};

jest.mock('../../src/google-drive', () => ({
  buildDriveClientFromOAuth: jest.fn(() => mockDrive),
  buildSheetsClient:         jest.fn(() => mockSheets),
  listDomainsWithCrawlData:  jest.fn(),
  getLatestCrawlFolder:      jest.fn(),
  listFolderContents:        jest.fn(),
  downloadFileAsText:        jest.fn(),
  findFolder:                jest.fn(),
  ensureFolder:              jest.fn(),
  findFileByName:            jest.fn(),
}));

jest.mock('../../src/automations/sheets-builder', () => ({
  TEMPLATE_NAME: 'TEMPLATE _ Content Architecture Audit',
  createContentArchitectureAudit: jest.fn(),
}));

jest.mock('../../src/automation-lock', () => ({
  getLockState: jest.fn(() => ({ cancelled: false })),
}));

const gd = require('../../src/google-drive');
const sheetsBuilder = require('../../src/automations/sheets-builder');
const lockModule = require('../../src/automation-lock');
const { run } = require('../../src/automations/content-architecture-audit');

// ─── Minimal CSV content ──────────────────────────────────────────────────────

const MINIMAL_CONTENT_CSV = [
  'Address,Status Code,Content Type,Indexability,Title 1,Meta Description 1,H1-1,H1-2',
  'https://example.com/,200,text/html; charset=utf-8,Indexable,Home Page Title,A description,Welcome,',
  'https://example.com/about,200,text/html; charset=utf-8,Indexable,About Us,About the company,About,,',
].join('\n');

const MINIMAL_IMAGE_CSV = [
  'Destination,Alt Text,Alt Text Length',
  'https://example.com/hero.jpg,Hero image,10',
].join('\n');

// ─── Default creds ────────────────────────────────────────────────────────────

const CREDS = {
  client_id: 'cid',
  client_secret: 'csecret',
  refresh_token: 'rtoken',
  root_folder_id: 'root-id',
};

// ─── Setup helper ─────────────────────────────────────────────────────────────

function setupHappyPath({ imageFile = null, customJsFile = null } = {}) {
  lockModule.getLockState.mockReturnValue({ cancelled: false });

  gd.findFolder.mockResolvedValue('templates-folder-id');
  gd.findFileByName.mockResolvedValue('template-file-id');
  gd.listDomainsWithCrawlData.mockResolvedValue([
    { name: 'example.com', folderId: 'domain-folder-id' },
  ]);
  gd.getLatestCrawlFolder.mockResolvedValue({ id: 'crawl-folder-id', name: '2026-03-01' });

  const files = [
    { id: 'content-file-id', name: 'internal_html.csv', mimeType: 'text/csv' },
  ];
  if (imageFile) files.push(imageFile);
  if (customJsFile) files.push(customJsFile);
  gd.listFolderContents.mockResolvedValue(files);

  gd.downloadFileAsText.mockImplementation((fileId) => {
    if (fileId === 'content-file-id')  return Promise.resolve(MINIMAL_CONTENT_CSV);
    if (fileId === 'image-file-id')    return Promise.resolve(MINIMAL_IMAGE_CSV);
    if (fileId === 'customjs-file-id') return Promise.resolve('Address,Generated Title\nhttps://example.com/,AI Title');
    return Promise.resolve('');
  });

  gd.ensureFolder.mockResolvedValue('reports-domain-folder-id');

  sheetsBuilder.createContentArchitectureAudit.mockResolvedValue({
    spreadsheetId: 'result-sheet-id',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/result-sheet-id',
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── run() tests ──────────────────────────────────────────────────────────────

describe('run() — template not found', () => {
  it('returns per-domain error when Templates/ folder is missing', async () => {
    gd.findFolder.mockResolvedValue(null);
    const results = await run(['example.com'], CREDS, () => {});
    expect(results).toHaveLength(1);
    expect(results[0].error).toMatch(/templates.*folder not found/i);
  });

  it('returns per-domain error when template file is missing', async () => {
    gd.findFolder.mockResolvedValue('templates-folder-id');
    gd.findFileByName.mockResolvedValue(null);
    const results = await run(['example.com'], CREDS, () => {});
    expect(results).toHaveLength(1);
    expect(results[0].error).toMatch(/not found in templates/i);
  });

  it('returns errors for all domains when template folder is missing', async () => {
    gd.findFolder.mockResolvedValue(null);
    const results = await run(['a.com', 'b.com', 'c.com'], CREDS, () => {});
    expect(results).toHaveLength(3);
    results.forEach(r => expect(r.error).toBeDefined());
  });
});

describe('run() — domain-level errors', () => {
  beforeEach(() => {
    gd.findFolder.mockResolvedValue('templates-folder-id');
    gd.findFileByName.mockResolvedValue('template-file-id');
    gd.listDomainsWithCrawlData.mockResolvedValue([
      { name: 'example.com', folderId: 'domain-folder-id' },
    ]);
    lockModule.getLockState.mockReturnValue({ cancelled: false });
  });

  it('returns per-domain error when domain folder is not in Drive', async () => {
    const results = await run(['unknown-domain.com'], CREDS, () => {});
    expect(results[0].error).toMatch(/not found in crawls/i);
  });

  it('returns per-domain error when no crawl folder exists', async () => {
    gd.getLatestCrawlFolder.mockResolvedValue(null);
    const results = await run(['example.com'], CREDS, () => {});
    expect(results[0].error).toMatch(/no crawl folders found/i);
  });

  it('returns per-domain error when no internal_html.csv exists', async () => {
    gd.getLatestCrawlFolder.mockResolvedValue({ id: 'crawl-id', name: '2026-01-01' });
    gd.listFolderContents.mockResolvedValue([
      { id: 'x', name: 'images_all.csv', mimeType: 'text/csv' },
    ]);
    const results = await run(['example.com'], CREDS, () => {});
    expect(results[0].error).toMatch(/no internal_html\.csv/i);
  });

  it('returns per-domain error when an exception is thrown during processing', async () => {
    gd.getLatestCrawlFolder.mockResolvedValue({ id: 'crawl-id', name: '2026-01-01' });
    gd.listFolderContents.mockResolvedValue([
      { id: 'content-file-id', name: 'internal_html.csv', mimeType: 'text/csv' },
    ]);
    gd.downloadFileAsText.mockRejectedValue(new Error('Network error'));
    const results = await run(['example.com'], CREDS, () => {});
    expect(results[0].error).toBe('Network error');
  });
});

describe('run() — successful single domain', () => {
  beforeEach(() => setupHappyPath());

  it('returns a result with spreadsheetId and spreadsheetUrl', async () => {
    const results = await run(['example.com'], CREDS, () => {});
    expect(results).toHaveLength(1);
    expect(results[0].spreadsheetId).toBe('result-sheet-id');
    expect(results[0].spreadsheetUrl).toContain('result-sheet-id');
  });

  it('includes crawlFolder name in the result', async () => {
    const results = await run(['example.com'], CREDS, () => {});
    expect(results[0].crawlFolder).toBe('2026-03-01');
  });

  it('includes issueCounts in the result', async () => {
    const results = await run(['example.com'], CREDS, () => {});
    expect(results[0].issueCounts).toBeDefined();
    expect(typeof results[0].issueCounts).toBe('object');
  });

  it('calls progress callback with status updates', async () => {
    const progress = jest.fn();
    await run(['example.com'], CREDS, progress);
    expect(progress).toHaveBeenCalledWith(expect.stringContaining('Connecting'));
    expect(progress).toHaveBeenCalledWith(expect.stringContaining('example.com'));
  });

  it('passes the correct templateFileId to sheetsBuilder', async () => {
    await run(['example.com'], CREDS, () => {});
    expect(sheetsBuilder.createContentArchitectureAudit).toHaveBeenCalledWith(
      expect.objectContaining({ templateFileId: 'template-file-id' })
    );
  });

  it('crawlTruncated is false for small crawls', async () => {
    const results = await run(['example.com'], CREDS, () => {});
    expect(results[0].crawlTruncated).toBe(false);
  });

  it('works when progress callback is omitted', async () => {
    await expect(run(['example.com'], CREDS)).resolves.toHaveLength(1);
  });
});

describe('run() — image and custom JS files', () => {
  it('downloads and passes image data when images_all.csv is present', async () => {
    setupHappyPath({
      imageFile: { id: 'image-file-id', name: 'images_all.csv', mimeType: 'text/csv' },
    });
    await run(['example.com'], CREDS, () => {});
    expect(sheetsBuilder.createContentArchitectureAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        analysedImages: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('downloads and passes custom JS data when custom_javascript.csv is present', async () => {
    setupHappyPath({
      customJsFile: { id: 'customjs-file-id', name: 'custom_javascript.csv', mimeType: 'text/csv' },
    });
    await run(['example.com'], CREDS, () => {});
    expect(sheetsBuilder.createContentArchitectureAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        customJsRows: expect.arrayContaining([expect.any(Object)]),
      })
    );
  });

  it('passes empty imageRows when no image file is found', async () => {
    setupHappyPath(); // no image file
    await run(['example.com'], CREDS, () => {});
    expect(sheetsBuilder.createContentArchitectureAudit).toHaveBeenCalledWith(
      expect.objectContaining({ rawImageRows: [] })
    );
  });
});

describe('run() — multiple domains', () => {
  it('processes multiple domains and returns a result per domain', async () => {
    gd.findFolder.mockResolvedValue('templates-folder-id');
    gd.findFileByName.mockResolvedValue('template-file-id');
    gd.listDomainsWithCrawlData.mockResolvedValue([
      { name: 'alpha.com', folderId: 'folder-alpha' },
      { name: 'beta.com', folderId: 'folder-beta' },
    ]);
    lockModule.getLockState.mockReturnValue({ cancelled: false });
    gd.getLatestCrawlFolder.mockResolvedValue({ id: 'crawl-id', name: '2026-01-01' });
    gd.listFolderContents.mockResolvedValue([
      { id: 'content-file-id', name: 'internal_html.csv', mimeType: 'text/csv' },
    ]);
    gd.downloadFileAsText.mockResolvedValue(MINIMAL_CONTENT_CSV);
    gd.ensureFolder.mockResolvedValue('reports-id');
    sheetsBuilder.createContentArchitectureAudit.mockResolvedValue({
      spreadsheetId: 'sheet-id',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id',
    });

    const results = await run(['alpha.com', 'beta.com'], CREDS, () => {});
    expect(results).toHaveLength(2);
    expect(results[0].domain).toBe('alpha.com');
    expect(results[1].domain).toBe('beta.com');
  });

  it('continues processing remaining domains after one fails', async () => {
    gd.findFolder.mockResolvedValue('templates-folder-id');
    gd.findFileByName.mockResolvedValue('template-file-id');
    gd.listDomainsWithCrawlData.mockResolvedValue([
      { name: 'good.com', folderId: 'folder-good' },
      { name: 'bad.com', folderId: 'folder-bad' },
    ]);
    lockModule.getLockState.mockReturnValue({ cancelled: false });
    gd.getLatestCrawlFolder
      .mockResolvedValueOnce(null)                                          // bad.com fails
      .mockResolvedValueOnce({ id: 'crawl-id', name: '2026-01-01' });      // good.com succeeds
    gd.listFolderContents.mockResolvedValue([
      { id: 'content-file-id', name: 'internal_html.csv', mimeType: 'text/csv' },
    ]);
    gd.downloadFileAsText.mockResolvedValue(MINIMAL_CONTENT_CSV);
    gd.ensureFolder.mockResolvedValue('reports-id');
    sheetsBuilder.createContentArchitectureAudit.mockResolvedValue({
      spreadsheetId: 'sheet-id',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id',
    });

    const results = await run(['bad.com', 'good.com'], CREDS, () => {});
    expect(results).toHaveLength(2);
    const badResult = results.find(r => r.domain === 'bad.com');
    expect(badResult.error).toBeDefined();
    const goodResult = results.find(r => r.domain === 'good.com');
    expect(goodResult.spreadsheetId).toBeDefined();
  });
});

describe('run() — cancellation', () => {
  it('stops after current domain when cancelled flag is set mid-loop', async () => {
    gd.findFolder.mockResolvedValue('templates-folder-id');
    gd.findFileByName.mockResolvedValue('template-file-id');
    gd.listDomainsWithCrawlData.mockResolvedValue([
      { name: 'first.com', folderId: 'f1' },
      { name: 'second.com', folderId: 'f2' },
    ]);
    // Return cancelled=true only on the second check (inside the loop)
    lockModule.getLockState
      .mockReturnValueOnce({ cancelled: false }) // template check
      .mockReturnValueOnce({ cancelled: true });  // first domain pre-check

    const results = await run(['first.com', 'second.com'], CREDS, () => {});
    expect(results.some(r => r.error === 'Cancelled')).toBe(true);
  });
});

describe('run() — large crawl truncation', () => {
  it('sets crawlTruncated=true and emits progress when rows exceed 10000', async () => {
    // Build a CSV with 10001 data rows
    const headers = 'Address,Status Code,Content Type,Indexability,Title 1,Meta Description 1,H1-1,H1-2';
    const dataRows = Array.from({ length: 10_001 }, (_, i) =>
      `https://example.com/page-${i},200,text/html; charset=utf-8,Indexable,Title ${i},Desc ${i},H1 ${i},`
    );
    const largeCsv = [headers, ...dataRows].join('\n');

    gd.findFolder.mockResolvedValue('templates-folder-id');
    gd.findFileByName.mockResolvedValue('template-file-id');
    gd.listDomainsWithCrawlData.mockResolvedValue([
      { name: 'example.com', folderId: 'domain-id' },
    ]);
    lockModule.getLockState.mockReturnValue({ cancelled: false });
    gd.getLatestCrawlFolder.mockResolvedValue({ id: 'crawl-id', name: '2026-01-01' });
    gd.listFolderContents.mockResolvedValue([
      { id: 'content-id', name: 'internal_html.csv', mimeType: 'text/csv' },
    ]);
    gd.downloadFileAsText.mockResolvedValue(largeCsv);
    gd.ensureFolder.mockResolvedValue('reports-id');
    sheetsBuilder.createContentArchitectureAudit.mockResolvedValue({
      spreadsheetId: 'sheet-id',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id',
    });

    const progress = jest.fn();
    const results = await run(['example.com'], CREDS, progress);

    expect(results[0].crawlTruncated).toBe(true);
    expect(progress).toHaveBeenCalledWith(expect.stringContaining('truncating'));

    // Verify sheetsBuilder received at most 10000 rows
    const call = sheetsBuilder.createContentArchitectureAudit.mock.calls[0][0];
    expect(call.rawContentRows.length).toBeLessThanOrEqual(10_000);
  });
});

describe('findCsvByName — indirect coverage via listFolderContents', () => {
  it('falls back to internal_all.csv when internal_html.csv is absent', async () => {
    gd.findFolder.mockResolvedValue('templates-folder-id');
    gd.findFileByName.mockResolvedValue('template-file-id');
    gd.listDomainsWithCrawlData.mockResolvedValue([
      { name: 'example.com', folderId: 'domain-id' },
    ]);
    lockModule.getLockState.mockReturnValue({ cancelled: false });
    gd.getLatestCrawlFolder.mockResolvedValue({ id: 'crawl-id', name: '2026-01-01' });
    gd.listFolderContents.mockResolvedValue([
      { id: 'fallback-id', name: 'internal_all.csv', mimeType: 'text/csv' },
    ]);
    gd.downloadFileAsText.mockResolvedValue(MINIMAL_CONTENT_CSV);
    gd.ensureFolder.mockResolvedValue('reports-id');
    sheetsBuilder.createContentArchitectureAudit.mockResolvedValue({
      spreadsheetId: 'sheet-id', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id',
    });

    const results = await run(['example.com'], CREDS, () => {});
    expect(results[0].spreadsheetId).toBe('sheet-id');
    expect(gd.downloadFileAsText).toHaveBeenCalledWith('fallback-id', mockDrive);
  });

  it('finds image CSV by "image" token match', async () => {
    setupHappyPath({
      imageFile: { id: 'image-file-id', name: 'image_inlinks.csv', mimeType: 'text/csv' },
    });
    await run(['example.com'], CREDS, () => {});
    expect(gd.downloadFileAsText).toHaveBeenCalledWith('image-file-id', mockDrive);
  });
});
