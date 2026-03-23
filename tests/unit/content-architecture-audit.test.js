'use strict';

const { parseCsvText, filterInternalHtmlPages } = require('../../src/automations/utils/csv-parser');
const { getColumn } = require('../../src/automations/utils/sf-columns');
const { analyseContentRows, analyseImageRows, THRESHOLDS } = require('../../src/automations/content-architecture-audit');
const { TEMPLATE_NAME, VALID_PASS_FAIL, VALID_STATUS, VALID_PRIORITY } = require('../../src/automations/sheets-builder');

// ─── CSV Parser tests ─────────────────────────────────────────────────────────

describe('parseCsvText', () => {
  it('parses simple CSV with headers', () => {
    const csv = 'Name,Value\nAlpha,1\nBravo,2';
    const rows = parseCsvText(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Name: 'Alpha', Value: '1' });
    expect(rows[1]).toEqual({ Name: 'Bravo', Value: '2' });
  });

  it('handles quoted fields with commas', () => {
    const csv = 'Title,URL\n"Hello, World",https://example.com';
    const rows = parseCsvText(csv);
    expect(rows[0].Title).toBe('Hello, World');
  });

  it('handles escaped quotes inside quoted fields', () => {
    const csv = 'Title\n"She said ""hello"""\n';
    const rows = parseCsvText(csv);
    expect(rows[0].Title).toBe('She said "hello"');
  });

  it('returns empty array for header-only CSV', () => {
    const csv = 'A,B,C';
    expect(parseCsvText(csv)).toEqual([]);
  });
});

describe('filterInternalHtmlPages', () => {
  const makeRow = (overrides = {}) => ({
    'Address': 'https://example.com/page1',
    'Status Code': '200',
    'Content Type': 'text/html; charset=utf-8',
    'Indexability': 'Indexable',
    ...overrides,
  });

  it('includes rows matching all criteria', () => {
    const rows = [makeRow()];
    expect(filterInternalHtmlPages(rows)).toHaveLength(1);
  });

  it('excludes non-200 status codes', () => {
    const rows = [makeRow({ 'Status Code': '301' })];
    expect(filterInternalHtmlPages(rows)).toHaveLength(0);
  });

  it('excludes non-HTML content types', () => {
    const rows = [makeRow({ 'Content Type': 'application/pdf' })];
    expect(filterInternalHtmlPages(rows)).toHaveLength(0);
  });

  it('excludes non-indexable pages', () => {
    const rows = [makeRow({ 'Indexability': 'Non-Indexable' })];
    expect(filterInternalHtmlPages(rows)).toHaveLength(0);
  });

  it('excludes URLs containing /page/', () => {
    const rows = [makeRow({ 'Address': 'https://example.com/page/2' })];
    expect(filterInternalHtmlPages(rows)).toHaveLength(0);
  });

  it('includes URLs with "page" not in /page/ path', () => {
    const rows = [makeRow({ 'Address': 'https://example.com/pages/about' })];
    expect(filterInternalHtmlPages(rows)).toHaveLength(1);
  });
});

// ─── SF Column Alias tests ────────────────────────────────────────────────────

describe('getColumn', () => {
  it('resolves the first matching alias', () => {
    const row = { 'Title 1': 'My Title', 'Title 1 Length': '8' };
    expect(getColumn(row, 'TITLE')).toBe('My Title');
    expect(getColumn(row, 'TITLE_LENGTH')).toBe('8');
  });

  it('falls back to secondary alias', () => {
    const row = { 'Page Title': 'Alt Title' };
    expect(getColumn(row, 'TITLE')).toBe('Alt Title');
  });

  it('returns empty string for missing columns', () => {
    expect(getColumn({}, 'TITLE')).toBe('');
  });

  it('returns empty string for unknown canonical names', () => {
    expect(getColumn({ foo: 'bar' }, 'NONEXISTENT')).toBe('');
  });
});

// ─── Content Analysis tests ───────────────────────────────────────────────────

describe('analyseContentRows', () => {
  const makeContentRow = (overrides = {}) => ({
    'Address': 'https://example.com/',
    'Title 1': 'A Good Title For Testing SEO',
    'Title 1 Length': '28',
    'Meta Description 1': 'A helpful description of the page content that is not too long.',
    'Meta Description 1 Length': '63',
    'H1-1': 'Welcome to Example',
    'H1-1 Length': '18',
    'H1-2': '',
    'H1-2 Length': '',
    'Status Code': '200',
    'Content Type': 'text/html',
    'Indexability': 'Indexable',
    ...overrides,
  });

  it('detects missing title', () => {
    const rows = [makeContentRow({ 'Title 1': '', 'Title 1 Length': '0' })];
    const { analysedRows, issueCounts } = analyseContentRows(rows);
    expect(analysedRows[0]._missingTitle).toBe(true);
    expect(issueCounts.missingTitle).toBe(1);
  });

  it('detects duplicate titles', () => {
    const rows = [
      makeContentRow({ 'Address': 'https://example.com/a' }),
      makeContentRow({ 'Address': 'https://example.com/b' }),
    ];
    const { analysedRows, issueCounts } = analyseContentRows(rows);
    expect(analysedRows[0]._duplicateTitle).toBe(true);
    expect(analysedRows[1]._duplicateTitle).toBe(true);
    expect(issueCounts.duplicateTitles).toBe(2);
  });

  it('detects title length fail — too short', () => {
    const rows = [makeContentRow({ 'Title 1': 'Short', 'Title 1 Length': '5' })];
    const { analysedRows, issueCounts } = analyseContentRows(rows);
    expect(analysedRows[0]._titleLengthFail).toBe(true);
    expect(issueCounts.titleLengthIssues).toBe(1);
  });

  it('detects title length fail — too long', () => {
    const longTitle = 'A'.repeat(61);
    const rows = [makeContentRow({ 'Title 1': longTitle, 'Title 1 Length': '61' })];
    const { analysedRows } = analyseContentRows(rows);
    expect(analysedRows[0]._titleLengthFail).toBe(true);
  });

  it('passes title at exact boundary (30 chars)', () => {
    const title = 'A'.repeat(30);
    const rows = [makeContentRow({ 'Title 1': title, 'Title 1 Length': '30' })];
    const { analysedRows } = analyseContentRows(rows);
    expect(analysedRows[0]._titleLengthFail).toBe(false);
  });

  it('passes title at exact boundary (60 chars)', () => {
    const title = 'A'.repeat(60);
    const rows = [makeContentRow({ 'Title 1': title, 'Title 1 Length': '60' })];
    const { analysedRows } = analyseContentRows(rows);
    expect(analysedRows[0]._titleLengthFail).toBe(false);
  });

  it('detects bad title delimiter', () => {
    const rows = [makeContentRow({ 'Title 1': 'Page Title - Brand Name', 'Title 1 Length': '23' })];
    const { analysedRows, issueCounts } = analyseContentRows(rows);
    expect(analysedRows[0]._titleBadDelimiter).toBe(true);
    expect(issueCounts.titleBadDelimiters).toBe(1);
  });

  it('allows pipe delimiter in title', () => {
    const rows = [makeContentRow({ 'Title 1': 'Page Title | Brand Name', 'Title 1 Length': '23' })];
    const { analysedRows } = analyseContentRows(rows);
    expect(analysedRows[0]._titleBadDelimiter).toBe(false);
  });

  it('detects missing meta description', () => {
    const rows = [makeContentRow({ 'Meta Description 1': '', 'Meta Description 1 Length': '0' })];
    const { analysedRows, issueCounts } = analyseContentRows(rows);
    expect(analysedRows[0]._missingDescription).toBe(true);
    expect(issueCounts.missingDesc).toBe(1);
  });

  it('detects missing H1', () => {
    const rows = [makeContentRow({ 'H1-1': '', 'H1-1 Length': '0' })];
    const { analysedRows, issueCounts } = analyseContentRows(rows);
    expect(analysedRows[0]._missingH1).toBe(true);
    expect(issueCounts.missingH1).toBe(1);
  });

  it('detects multiple H1', () => {
    const rows = [makeContentRow({ 'H1-2': 'Second Heading', 'H1-2 Length': '14' })];
    const { analysedRows, issueCounts } = analyseContentRows(rows);
    expect(analysedRows[0]._multipleH1).toBe(true);
    expect(issueCounts.multipleH1).toBe(1);
  });

  it('correctly sets row priority for high-issue pages', () => {
    const rows = [makeContentRow({
      'Title 1': 'Test',
      'Title 1 Length': '4',
      'Meta Description 1': '',
      'Meta Description 1 Length': '0',
    })];
    const { analysedRows } = analyseContentRows(rows);
    expect(analysedRows[0]._rowPriority).toBe('1. High');
    expect(analysedRows[0]._rowStatus).toBe('Pending');
  });

  it('aggregates issue counts correctly across multiple rows', () => {
    const rows = [
      makeContentRow({ 'Address': 'https://a.com', 'H1-1': '', 'H1-1 Length': '0' }),
      makeContentRow({ 'Address': 'https://b.com', 'H1-1': '', 'H1-1 Length': '0' }),
      makeContentRow({ 'Address': 'https://c.com' }),
    ];
    const { issueCounts } = analyseContentRows(rows);
    expect(issueCounts.missingH1).toBe(2);
  });
});

// ─── Image Analysis tests ─────────────────────────────────────────────────────

describe('analyseImageRows', () => {
  const makeImageRow = (overrides = {}) => ({
    'Destination': 'https://example.com/image.jpg',
    'Alt Text': 'A descriptive alt text',
    'Alt Text Length': '22',
    ...overrides,
  });

  it('detects missing ALT text', () => {
    const rows = [makeImageRow({ 'Alt Text': '', 'Alt Text Length': '0' })];
    const { analysedImages, imageCounts } = analyseImageRows(rows);
    expect(analysedImages[0]._missingAlt).toBe(true);
    expect(imageCounts.missingImageAlt).toBe(1);
  });

  it('detects whitespace-only ALT as missing', () => {
    const rows = [makeImageRow({ 'Alt Text': '   ', 'Alt Text Length': '3' })];
    const { analysedImages } = analyseImageRows(rows);
    expect(analysedImages[0]._missingAlt).toBe(true);
  });

  it('detects excessively long ALT text', () => {
    const longAlt = 'A'.repeat(101);
    const rows = [makeImageRow({ 'Alt Text': longAlt, 'Alt Text Length': '101' })];
    const { analysedImages, imageCounts } = analyseImageRows(rows);
    expect(analysedImages[0]._altLengthFail).toBe(true);
    expect(imageCounts.longImageAlt).toBe(1);
  });

  it('passes ALT text at exact boundary (100 chars)', () => {
    const alt = 'A'.repeat(100);
    const rows = [makeImageRow({ 'Alt Text': alt, 'Alt Text Length': '100' })];
    const { analysedImages } = analyseImageRows(rows);
    expect(analysedImages[0]._altLengthFail).toBe(false);
  });

  it('sets low priority for image issues', () => {
    const rows = [makeImageRow({ 'Alt Text': '', 'Alt Text Length': '0' })];
    const { analysedImages } = analyseImageRows(rows);
    expect(analysedImages[0]._rowPriority).toBe('3. Low');
  });
});

// ─── Template & Dropdown Validation tests ─────────────────────────────────────

describe('sheets-builder exports', () => {
  it('exports the correct template name', () => {
    expect(TEMPLATE_NAME).toBe('TEMPLATE _ Content Architecture Audit');
  });

  it('VALID_PASS_FAIL includes Pass and Needs Improvement', () => {
    expect(VALID_PASS_FAIL).toContain('Pass');
    expect(VALID_PASS_FAIL).toContain('Needs Improvement');
    expect(VALID_PASS_FAIL).not.toContain('Fail');
  });

  it('VALID_STATUS includes Pending', () => {
    expect(VALID_STATUS).toContain('Pending');
    expect(VALID_STATUS).toContain('Resolved');
  });

  it('VALID_PRIORITY includes all priority levels', () => {
    expect(VALID_PRIORITY).toContain('1. High');
    expect(VALID_PRIORITY).toContain('2. Medium');
    expect(VALID_PRIORITY).toContain('3. Low');
  });
});

describe('analysed row values respect dropdown options', () => {
  const makeContentRow = (overrides = {}) => ({
    'Address': 'https://example.com/',
    'Title 1': 'A Good Title For Testing SEO',
    'Title 1 Length': '28',
    'Meta Description 1': 'A helpful description of the page content.',
    'Meta Description 1 Length': '42',
    'H1-1': 'Welcome to Example',
    'H1-1 Length': '18',
    'H1-2': '',
    'H1-2 Length': '',
    'Status Code': '200',
    'Content Type': 'text/html',
    'Indexability': 'Indexable',
    ...overrides,
  });

  it('row status uses only VALID_STATUS values or empty string', () => {
    const rows = [
      makeContentRow({ 'Title 1': '', 'Title 1 Length': '0' }),
      makeContentRow(),
    ];
    const { analysedRows } = analyseContentRows(rows);
    for (const row of analysedRows) {
      if (row._rowStatus) {
        expect(VALID_STATUS).toContain(row._rowStatus);
      }
    }
  });

  it('row priority uses only VALID_PRIORITY values or empty string', () => {
    const rows = [
      makeContentRow({ 'Title 1': '', 'Title 1 Length': '0' }),
      makeContentRow({ 'Meta Description 1': '', 'Meta Description 1 Length': '0' }),
      makeContentRow(),
    ];
    const { analysedRows } = analyseContentRows(rows);
    for (const row of analysedRows) {
      if (row._rowPriority) {
        expect(VALID_PRIORITY).toContain(row._rowPriority);
      }
    }
  });

  it('image row status uses only VALID_STATUS values or empty string', () => {
    const makeImageRow = (overrides = {}) => ({
      'Destination': 'https://example.com/image.jpg',
      'Alt Text': 'A descriptive alt text',
      'Alt Text Length': '22',
      ...overrides,
    });
    const rows = [
      makeImageRow({ 'Alt Text': '', 'Alt Text Length': '0' }),
      makeImageRow(),
    ];
    const { analysedImages } = analyseImageRows(rows);
    for (const row of analysedImages) {
      if (row._rowStatus) {
        expect(VALID_STATUS).toContain(row._rowStatus);
      }
    }
  });
});
