'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Parse a single CSV line, handling double-quoted fields (including embedded
 * commas and escaped quotes).
 *
 * @param {string} line
 * @returns {string[]}
 */
function parseCSVLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote inside a quoted field.
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

/**
 * Parse CSV text into an array of row objects keyed by the header row.
 *
 * @param {string} content  Raw CSV text.
 * @returns {Object[]}
 */
function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length === 0 || (cols.length === 1 && !cols[0])) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] !== undefined ? cols[idx] : ''; });
    rows.push(row);
  }

  return rows;
}

/**
 * Read every `.csv` file from `outputDir` and return a map of
 * `basename → parsed rows`.
 *
 * @param {string} outputDir
 * @returns {Object.<string, Object[]>}
 */
function readCSVsFromDir(outputDir) {
  if (!outputDir) return {};
  try {
    if (!fs.existsSync(outputDir)) return {};
  } catch {
    return {};
  }

  const result = {};
  let entries;
  try {
    entries = fs.readdirSync(outputDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.csv')) continue;
    try {
      const content = fs.readFileSync(path.join(outputDir, entry.name), 'utf8');
      result[entry.name] = parseCSV(content);
    } catch { /* skip unreadable files */ }
  }

  return result;
}

/**
 * Build a URL-keyed map from parsed CSV rows.
 * Screaming Frog uses "Address" as the canonical URL column.
 *
 * @param {Object[]} rows
 * @returns {Object.<string, Object>}
 */
function buildURLMap(rows) {
  const map = {};
  for (const row of rows) {
    const addr = row['Address'] || row['address'] || row['URL'] || row['url'];
    if (addr) map[addr] = row;
  }
  return map;
}

/**
 * Determine whether a CSV file has a URL-like address column.
 *
 * @param {Object[]} rows
 * @returns {boolean}
 */
function hasAddressColumn(rows) {
  return rows.some(r => 'Address' in r || 'address' in r || 'URL' in r || 'url' in r);
}

/**
 * Diff two sets of parsed CSV rows.
 *
 * @param {Object[]} oldRows
 * @param {Object[]} newRows
 * @returns {{ added: string[], removed: string[], changed: Array<{url:string,changes:Object}>, unchanged_count: number }}
 */
function diffCSV(oldRows, newRows) {
  const oldMap = buildURLMap(oldRows);
  const newMap = buildURLMap(newRows);

  const oldURLs = new Set(Object.keys(oldMap));
  const newURLs = new Set(Object.keys(newMap));

  const added   = [...newURLs].filter(u => !oldURLs.has(u));
  const removed = [...oldURLs].filter(u => !newURLs.has(u));
  const changed = [];
  let   unchangedCount = 0;

  for (const url of newURLs) {
    if (!oldURLs.has(url)) continue; // handled in `added`

    const oldRow = oldMap[url];
    const newRow = newMap[url];
    const rowChanges = {};
    const allKeys = new Set([...Object.keys(oldRow), ...Object.keys(newRow)]);

    for (const key of allKeys) {
      const oldVal = oldRow[key] !== undefined ? oldRow[key] : '';
      const newVal = newRow[key] !== undefined ? newRow[key] : '';
      if (oldVal !== newVal) {
        rowChanges[key] = { from: oldVal, to: newVal };
      }
    }

    if (Object.keys(rowChanges).length > 0) {
      changed.push({ url, changes: rowChanges });
    } else {
      unchangedCount++;
    }
  }

  return { added, removed, changed, unchanged_count: unchangedCount };
}

/**
 * Compute a diff summary between two crawl jobs by comparing their CSV output
 * directories.  Returns `null` when no comparable CSV data is found.
 *
 * The returned object is JSON-serialisable and intended to be stored in the
 * `diff_summary` column of the `jobs` table.
 *
 * @param {{ id: number, output_dir: string, completed_at: string }} newJob
 * @param {{ id: number, output_dir: string, completed_at: string }} prevJob
 * @returns {Object|null}
 */
function computeDiff(newJob, prevJob) {
  const newCSVs  = readCSVsFromDir(newJob.output_dir);
  const prevCSVs = readCSVsFromDir(prevJob.output_dir);

  const csvNames = new Set([...Object.keys(newCSVs), ...Object.keys(prevCSVs)]);
  if (csvNames.size === 0) return null;

  const fileDiffs  = {};
  let totalAdded   = 0;
  let totalRemoved = 0;
  let totalChanged = 0;

  for (const name of csvNames) {
    const oldRows = prevCSVs[name] || [];
    const newRows = newCSVs[name]  || [];

    if (!hasAddressColumn(oldRows) && !hasAddressColumn(newRows)) continue;

    const diff = diffCSV(oldRows, newRows);
    fileDiffs[name] = diff;
    totalAdded   += diff.added.length;
    totalRemoved += diff.removed.length;
    totalChanged += diff.changed.length;
  }

  if (Object.keys(fileDiffs).length === 0) return null;

  return {
    prev_job_id:        prevJob.id,
    prev_completed_at:  prevJob.completed_at,
    total_added:        totalAdded,
    total_removed:      totalRemoved,
    total_changed:      totalChanged,
    files:              fileDiffs,
  };
}

module.exports = { computeDiff, diffCSV, parseCSV, parseCSVLine, readCSVsFromDir };
