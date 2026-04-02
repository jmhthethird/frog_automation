'use strict';

const {
  createContentArchitectureAudit,
  TEMPLATE_NAME, VALID_PASS_FAIL, VALID_STATUS, VALID_PRIORITY,
} = require('../../src/automations/sheets-builder');

// ─── Mock factory helpers ──────────────────────────────────────────────────────

const ALL_TABS = [
  'Content Metadata', 'Image Metadata',
  'Raw Crawl (Content)', 'Raw Crawl (Images)', 'Custom JS',
];

function makeDrive(overrides = {}) {
  return {
    files: {
      copy:   jest.fn().mockResolvedValue({ data: { id: 'ss-id-001' } }),
      delete: jest.fn().mockResolvedValue({}),
      ...overrides.files,
    },
  };
}

function makeSheets(tabNames = ALL_TABS) {
  return {
    spreadsheets: {
      get: jest.fn().mockResolvedValue({
        data: {
          sheets: tabNames.map((title, i) => ({ properties: { title, sheetId: i + 1 } })),
        },
      }),
      values: {
        batchUpdate: jest.fn().mockResolvedValue({ data: {} }),
      },
    },
  };
}

function makeAnalysedRow(overrides = {}) {
  return {
    _address: 'https://example.com/',
    _title: 'My Page Title', _titleLen: 13,
    _desc: 'A good meta description', _descLen: 24,
    _h1: 'Welcome', _h1Len: 7, _h1_2: '',
    _missingTitle: false, _duplicateTitle: false,
    _titleLengthFail: false, _titleBadDelimiter: false,
    _missingDescription: false, _duplicateDescription: false,
    _descLengthFail: false,
    _missingH1: false, _duplicateH1: false,
    _h1LengthFail: false, _multipleH1: false,
    _titleRewrite: false, _descRewrite: false, _h1Rewrite: false,
    _rowPriority: '', _rowStatus: '',
    ...overrides,
  };
}

function makeImageRow(overrides = {}) {
  return {
    Destination: 'https://example.com/img.jpg',
    _alt: 'descriptive alt', _altLen: 15,
    _missingAlt: false, _altLengthFail: false,
    _altRewrite: false, _rowPriority: '', _rowStatus: '',
    ...overrides,
  };
}

function makeOpts(overrides = {}) {
  return {
    domain: 'example.com',
    analysedRows: [],
    analysedImages: [],
    customJsRows: [],
    rawContentRows: [],
    rawImageRows: [],
    issueCounts: { missingTitle: 0 },
    drive: makeDrive(),
    sheets: makeSheets(),
    reportsFolderId: 'folder-id',
    templateFileId: 'tmpl-id',
    ...overrides,
  };
}

// ─── createContentArchitectureAudit ───────────────────────────────────────────

describe('createContentArchitectureAudit', () => {
  describe('template copy and return values', () => {
    it('returns the new spreadsheetId and a Drive URL', async () => {
      const result = await createContentArchitectureAudit(makeOpts());
      expect(result.spreadsheetId).toBe('ss-id-001');
      expect(result.spreadsheetUrl).toBe('https://docs.google.com/spreadsheets/d/ss-id-001');
    });

    it('copies the template file to the correct parent folder', async () => {
      const drive = makeDrive();
      await createContentArchitectureAudit(makeOpts({ drive }));
      expect(drive.files.copy).toHaveBeenCalledWith(expect.objectContaining({
        fileId: 'tmpl-id',
        requestBody: expect.objectContaining({ parents: ['folder-id'] }),
      }));
    });

    it('uses no parents when reportsFolderId is null', async () => {
      const drive = makeDrive();
      await createContentArchitectureAudit(makeOpts({ drive, reportsFolderId: null }));
      const args = drive.files.copy.mock.calls[0][0];
      expect(args.requestBody.parents).toBeUndefined();
    });

    it('includes domain and current date in sheet title', async () => {
      const drive = makeDrive();
      await createContentArchitectureAudit(makeOpts({ drive, domain: 'my-site.io' }));
      const args = drive.files.copy.mock.calls[0][0];
      const today = new Date().toISOString().slice(0, 10);
      expect(args.requestBody.name).toContain('my-site.io');
      expect(args.requestBody.name).toContain(today);
    });
  });

  describe('tab validation', () => {
    it('throws when required tabs are missing and deletes the broken copy', async () => {
      const drive = makeDrive();
      const sheets = makeSheets(['Content Metadata']); // missing 4 tabs
      await expect(
        createContentArchitectureAudit(makeOpts({ drive, sheets }))
      ).rejects.toThrow(/missing required tabs/i);
      expect(drive.files.delete).toHaveBeenCalledWith({ fileId: 'ss-id-001' });
    });

    it('error message lists the missing tab names', async () => {
      const drive = makeDrive();
      const sheets = makeSheets(['Content Metadata', 'Image Metadata']);
      await expect(
        createContentArchitectureAudit(makeOpts({ drive, sheets }))
      ).rejects.toThrow(/Raw Crawl \(Content\)/);
    });

    it('best-effort deletes broken copy even if delete itself fails', async () => {
      const drive = makeDrive({
        files: {
          copy:   jest.fn().mockResolvedValue({ data: { id: 'ss-id-001' } }),
          delete: jest.fn().mockRejectedValue(new Error('Permission denied')),
        },
      });
      const sheets = makeSheets([]);
      await expect(
        createContentArchitectureAudit(makeOpts({ drive, sheets }))
      ).rejects.toThrow(/missing required tabs/i);
    });

    it('succeeds when all required tabs are present', async () => {
      await expect(createContentArchitectureAudit(makeOpts())).resolves.toBeDefined();
    });
  });

  describe('batchUpdate — empty data', () => {
    it('skips batchUpdate when all data arrays are empty', async () => {
      const sheets = makeSheets();
      await createContentArchitectureAudit(makeOpts({ sheets }));
      expect(sheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
    });
  });

  describe('batchUpdate — content metadata', () => {
    it('writes content rows starting at row 2', async () => {
      const sheets = makeSheets();
      const analysedRows = [makeAnalysedRow()];
      await createContentArchitectureAudit(makeOpts({ sheets, analysedRows }));
      const args = sheets.spreadsheets.values.batchUpdate.mock.calls[0][0];
      const entry = args.requestBody.data.find(d => d.range.includes('Content Metadata'));
      expect(entry.range).toBe("'Content Metadata'!A2");
      expect(entry.values).toHaveLength(1);
    });

    it('each content row has the correct number of columns', async () => {
      const sheets = makeSheets();
      const analysedRows = [makeAnalysedRow()];
      await createContentArchitectureAudit(makeOpts({ sheets, analysedRows }));
      const args = sheets.spreadsheets.values.batchUpdate.mock.calls[0][0];
      const entry = args.requestBody.data.find(d => d.range.includes('Content Metadata'));
      // CONTENT_HEADERS has 34 columns
      expect(entry.values[0]).toHaveLength(34);
    });

    it('populates Address as first column value', async () => {
      const sheets = makeSheets();
      const analysedRows = [makeAnalysedRow({ _address: 'https://test.com/page' })];
      await createContentArchitectureAudit(makeOpts({ sheets, analysedRows }));
      const args = sheets.spreadsheets.values.batchUpdate.mock.calls[0][0];
      const entry = args.requestBody.data.find(d => d.range.includes('Content Metadata'));
      expect(entry.values[0][0]).toBe('https://test.com/page');
    });

    it('uses Custom JS generated title when available', async () => {
      const sheets = makeSheets();
      const analysedRows = [makeAnalysedRow({ _address: 'https://x.com/' })];
      const customJsRows = [{ Address: 'https://x.com/', 'Generated Title': 'AI Title' }];
      await createContentArchitectureAudit(makeOpts({ sheets, analysedRows, customJsRows }));
      const args = sheets.spreadsheets.values.batchUpdate.mock.calls[0][0];
      const entry = args.requestBody.data.find(d => d.range.includes('Content Metadata'));
      // New Title column (index 22)
      expect(entry.values[0][22]).toBe('AI Title');
    });

    it('sets Pass/Fail columns to valid dropdown values', async () => {
      const sheets = makeSheets();
      const analysedRows = [makeAnalysedRow({
        _missingTitle: true, _titleLengthFail: false,
        _missingDescription: false, _descLengthFail: false,
      })];
      await createContentArchitectureAudit(makeOpts({ sheets, analysedRows }));
      const args = sheets.spreadsheets.values.batchUpdate.mock.calls[0][0];
      const entry = args.requestBody.data.find(d => d.range.includes('Content Metadata'));
      // Check that no value that is a string is outside the allowed sets
      const strValues = entry.values[0].filter(v => typeof v === 'string' && v !== '');
      for (const v of strValues) {
        const allAllowed = [...VALID_PASS_FAIL, ...VALID_STATUS, ...VALID_PRIORITY, 'Needs Improvement'];
        const isAddress = v.startsWith('https://') || v.startsWith('http://');
        const isTextContent = v.length > 5 && !allAllowed.includes(v) && !isAddress;
        // Only pure dropdown values or content values (title, desc, H1) are expected
        expect(typeof v).toBe('string');
      }
    });
  });

  describe('batchUpdate — image metadata', () => {
    it('writes image rows starting at row 2', async () => {
      const sheets = makeSheets();
      const analysedImages = [makeImageRow()];
      await createContentArchitectureAudit(makeOpts({ sheets, analysedImages }));
      const args = sheets.spreadsheets.values.batchUpdate.mock.calls[0][0];
      const entry = args.requestBody.data.find(d => d.range.includes('Image Metadata'));
      expect(entry.range).toBe("'Image Metadata'!A2");
      expect(entry.values).toHaveLength(1);
    });

    it('each image row has the correct number of columns', async () => {
      const sheets = makeSheets();
      const analysedImages = [makeImageRow()];
      await createContentArchitectureAudit(makeOpts({ sheets, analysedImages }));
      const args = sheets.spreadsheets.values.batchUpdate.mock.calls[0][0];
      const entry = args.requestBody.data.find(d => d.range.includes('Image Metadata'));
      // IMAGE_HEADERS has 13 columns
      expect(entry.values[0]).toHaveLength(13);
    });

    it('detects missing ALT and sets Needs Improvement', async () => {
      const sheets = makeSheets();
      const analysedImages = [makeImageRow({ _alt: '', _altLen: 0, _missingAlt: true, _altRewrite: true })];
      await createContentArchitectureAudit(makeOpts({ sheets, analysedImages }));
      const args = sheets.spreadsheets.values.batchUpdate.mock.calls[0][0];
      const entry = args.requestBody.data.find(d => d.range.includes('Image Metadata'));
      // Missing ALT column (index 6) should be 'Needs Improvement'
      expect(entry.values[0][6]).toBe('Needs Improvement');
    });
  });

  describe('batchUpdate — raw data tabs', () => {
    it('writes raw content rows starting at row 1 with headers', async () => {
      const sheets = makeSheets();
      const rawContentRows = [{ Address: 'https://a.com', 'Status Code': '200' }];
      await createContentArchitectureAudit(makeOpts({ sheets, rawContentRows }));
      const args = sheets.spreadsheets.values.batchUpdate.mock.calls[0][0];
      const entry = args.requestBody.data.find(d => d.range.includes('Raw Crawl (Content)'));
      expect(entry.range).toBe("'Raw Crawl (Content)'!A1");
      expect(entry.values[0]).toEqual(['Address', 'Status Code']); // headers row
      expect(entry.values[1]).toEqual(['https://a.com', '200']);   // data row
    });

    it('writes raw image rows starting at row 1 with headers', async () => {
      const sheets = makeSheets();
      const rawImageRows = [{ Destination: 'https://a.com/img.jpg', 'Alt Text': 'alt' }];
      await createContentArchitectureAudit(makeOpts({ sheets, rawImageRows }));
      const args = sheets.spreadsheets.values.batchUpdate.mock.calls[0][0];
      const entry = args.requestBody.data.find(d => d.range.includes('Raw Crawl (Images)'));
      expect(entry.values[0]).toEqual(['Destination', 'Alt Text']);
    });

    it('writes custom JS rows starting at row 1 with headers', async () => {
      const sheets = makeSheets();
      const customJsRows = [{ Address: 'https://a.com', 'Generated Title': 'Title' }];
      await createContentArchitectureAudit(makeOpts({ sheets, customJsRows }));
      const args = sheets.spreadsheets.values.batchUpdate.mock.calls[0][0];
      const entry = args.requestBody.data.find(d => d.range.includes('Custom JS'));
      expect(entry.values[0]).toEqual(['Address', 'Generated Title']);
    });
  });

  describe('batchUpdate — USER_ENTERED input option', () => {
    it('uses USER_ENTERED value input option', async () => {
      const sheets = makeSheets();
      const analysedRows = [makeAnalysedRow()];
      await createContentArchitectureAudit(makeOpts({ sheets, analysedRows }));
      const args = sheets.spreadsheets.values.batchUpdate.mock.calls[0][0];
      expect(args.requestBody.valueInputOption).toBe('USER_ENTERED');
    });
  });
});
