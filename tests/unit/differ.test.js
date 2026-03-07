'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { computeDiff, diffCSV, parseCSV, parseCSVLine, readCSVsFromDir } = require('../../src/differ');

// ─── parseCSVLine ─────────────────────────────────────────────────────────────
describe('parseCSVLine()', () => {
  it('splits a simple line by commas', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields containing commas', () => {
    expect(parseCSVLine('"hello, world",foo,bar')).toEqual(['hello, world', 'foo', 'bar']);
  });

  it('handles escaped double-quotes inside quoted fields', () => {
    expect(parseCSVLine('"say ""hi""",ok')).toEqual(['say "hi"', 'ok']);
  });

  it('returns a single-element array for a line with no commas', () => {
    expect(parseCSVLine('single')).toEqual(['single']);
  });

  it('trims field whitespace', () => {
    expect(parseCSVLine(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });
});

// ─── parseCSV ─────────────────────────────────────────────────────────────────
describe('parseCSV()', () => {
  it('returns an empty array for content with fewer than 2 lines', () => {
    expect(parseCSV('')).toEqual([]);
    expect(parseCSV('Address,Status Code')).toEqual([]);
  });

  it('parses header + data rows into objects', () => {
    const csv = 'Address,Status Code\nhttps://example.com,200\nhttps://example.com/page,404\n';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Address: 'https://example.com', 'Status Code': '200' });
    expect(rows[1]).toEqual({ Address: 'https://example.com/page', 'Status Code': '404' });
  });

  it('skips blank lines', () => {
    const csv = 'Address,Status Code\nhttps://example.com,200\n\n\n';
    expect(parseCSV(csv)).toHaveLength(1);
  });

  it('handles Windows-style line endings', () => {
    const csv = 'Address,Status Code\r\nhttps://example.com,200\r\n';
    expect(parseCSV(csv)).toHaveLength(1);
  });
});

// ─── readCSVsFromDir ──────────────────────────────────────────────────────────
describe('readCSVsFromDir()', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-differ-test-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns an empty object when directory does not exist', () => {
    expect(readCSVsFromDir('/nonexistent/path/xyz')).toEqual({});
  });

  it('returns an empty object when passed null/undefined', () => {
    expect(readCSVsFromDir(null)).toEqual({});
    expect(readCSVsFromDir(undefined)).toEqual({});
  });

  it('reads CSV files from a directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'internal_all.csv'), 'Address,Status Code\nhttps://example.com,200\n');
    fs.writeFileSync(path.join(tmpDir, 'crawler.log'), 'some log');

    const result = readCSVsFromDir(tmpDir);
    expect(Object.keys(result)).toEqual(['internal_all.csv']);
    expect(result['internal_all.csv']).toHaveLength(1);
  });

  it('skips non-CSV files', () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'hello');
    expect(readCSVsFromDir(tmpDir)).toEqual({});
  });
});

// ─── diffCSV ─────────────────────────────────────────────────────────────────
describe('diffCSV()', () => {
  const oldRows = [
    { Address: 'https://example.com',       'Status Code': '200', Title: 'Home' },
    { Address: 'https://example.com/about', 'Status Code': '200', Title: 'About' },
    { Address: 'https://example.com/old',   'Status Code': '200', Title: 'Old' },
  ];

  const newRows = [
    { Address: 'https://example.com',       'Status Code': '200', Title: 'Home' },
    { Address: 'https://example.com/about', 'Status Code': '404', Title: 'About' }, // changed
    { Address: 'https://example.com/new',   'Status Code': '200', Title: 'New' },   // added
    // /old is removed
  ];

  it('detects added URLs', () => {
    const diff = diffCSV(oldRows, newRows);
    expect(diff.added).toContain('https://example.com/new');
    expect(diff.added).not.toContain('https://example.com');
  });

  it('detects removed URLs', () => {
    const diff = diffCSV(oldRows, newRows);
    expect(diff.removed).toContain('https://example.com/old');
    expect(diff.removed).not.toContain('https://example.com');
  });

  it('detects changed URLs with per-field diffs', () => {
    const diff = diffCSV(oldRows, newRows);
    const changed = diff.changed.find(c => c.url === 'https://example.com/about');
    expect(changed).toBeDefined();
    expect(changed.changes['Status Code']).toEqual({ from: '200', to: '404' });
  });

  it('counts unchanged URLs correctly', () => {
    const diff = diffCSV(oldRows, newRows);
    expect(diff.unchanged_count).toBe(1); // only https://example.com unchanged
  });

  it('returns empty arrays when both sets are identical', () => {
    const diff = diffCSV(oldRows, oldRows);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged_count).toBe(oldRows.length);
  });

  it('handles empty old and new rows', () => {
    const diff = diffCSV([], []);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it('treats every URL as added when oldRows is empty', () => {
    const diff = diffCSV([], newRows);
    expect(diff.added).toHaveLength(newRows.length);
    expect(diff.removed).toHaveLength(0);
  });

  it('treats every URL as removed when newRows is empty', () => {
    const diff = diffCSV(oldRows, []);
    expect(diff.removed).toHaveLength(oldRows.length);
    expect(diff.added).toHaveLength(0);
  });
});

// ─── computeDiff ─────────────────────────────────────────────────────────────
describe('computeDiff()', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-diff-compute-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function makeJobDir(suffix, csvContent) {
    const dir = path.join(tmpDir, suffix);
    fs.mkdirSync(dir, { recursive: true });
    if (csvContent) {
      fs.writeFileSync(path.join(dir, 'internal_all.csv'), csvContent);
    }
    return dir;
  }

  it('returns null when both output dirs are empty', () => {
    const prevDir = makeJobDir('prev');
    const newDir  = makeJobDir('new');
    const result  = computeDiff(
      { id: 2, output_dir: newDir,  completed_at: '2024-02-01' },
      { id: 1, output_dir: prevDir, completed_at: '2024-01-01' },
    );
    expect(result).toBeNull();
  });

  it('returns null when CSV files have no Address column', () => {
    const csv = 'Col1,Col2\nfoo,bar\n';
    const prevDir = makeJobDir('prev2', csv);
    const newDir  = makeJobDir('new2', csv);
    const result  = computeDiff(
      { id: 2, output_dir: newDir,  completed_at: '2024-02-01' },
      { id: 1, output_dir: prevDir, completed_at: '2024-01-01' },
    );
    expect(result).toBeNull();
  });

  it('treats all new URLs as added when prevJob output_dir does not exist', () => {
    const newDir = makeJobDir('new3', 'Address,Status Code\nhttps://example.com,200\n');
    const result = computeDiff(
      { id: 2, output_dir: newDir,            completed_at: '2024-02-01' },
      { id: 1, output_dir: '/nonexistent/xyz', completed_at: '2024-01-01' },
    );
    // Previous dir is absent – all new URLs are reported as "added".
    expect(result).not.toBeNull();
    expect(result.total_added).toBe(1);
    expect(result.total_removed).toBe(0);
  });

  it('computes correct totals across CSV files', () => {
    const prevCsv = 'Address,Status Code\nhttps://example.com,200\nhttps://example.com/old,200\n';
    const newCsv  = 'Address,Status Code\nhttps://example.com,200\nhttps://example.com/new,200\nhttps://example.com/changed,404\n';
    // Test data: /old is removed, /new is added (not in prev), /changed is also added (not in prev)

    const prevCsvB = 'Address,Status Code\nhttps://example.com/b,200\n';
    const newCsvB  = 'Address,Status Code\nhttps://example.com/b,301\n';

    const prevDir = makeJobDir('prevFull');
    const newDir  = makeJobDir('newFull');
    fs.writeFileSync(path.join(prevDir, 'a.csv'), prevCsv);
    fs.writeFileSync(path.join(newDir,  'a.csv'), newCsv);
    fs.writeFileSync(path.join(prevDir, 'b.csv'), prevCsvB);
    fs.writeFileSync(path.join(newDir,  'b.csv'), newCsvB);

    const result = computeDiff(
      { id: 2, output_dir: newDir,  completed_at: '2024-02-01' },
      { id: 1, output_dir: prevDir, completed_at: '2024-01-01' },
    );

    expect(result).not.toBeNull();
    expect(result.prev_job_id).toBe(1);
    expect(result.total_added).toBeGreaterThan(0);
    expect(result.total_removed).toBeGreaterThan(0);
    expect(result.total_changed).toBeGreaterThan(0);
    expect(result.files['a.csv']).toBeDefined();
    expect(result.files['b.csv']).toBeDefined();
  });

  it('includes prev_job_id and prev_completed_at in output', () => {
    const csv = 'Address,Status Code\nhttps://example.com,200\n';
    const prevDir = makeJobDir('prevMeta', csv);
    const newDir  = makeJobDir('newMeta', 'Address,Status Code\nhttps://example.com,404\n');

    const result = computeDiff(
      { id: 10, output_dir: newDir,  completed_at: '2024-02-01' },
      { id: 5,  output_dir: prevDir, completed_at: '2024-01-15' },
    );

    expect(result.prev_job_id).toBe(5);
    expect(result.prev_completed_at).toBe('2024-01-15');
  });
});
