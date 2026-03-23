'use strict';

/**
 * CSV parsing utilities for Screaming Frog export files.
 *
 * The parser handles quoted fields with embedded commas and escaped quotes,
 * matching the logic already used in src/differ.js.
 */

/**
 * Parse a single CSV line into an array of field values.
 *
 * Handles double-quoted fields with embedded commas and escaped quotes
 * (`""` inside a quoted field becomes a single `"`).
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
 * Parse CSV text content into an array of row objects.
 *
 * The first line is treated as the header row.  Each subsequent line becomes
 * an object keyed by the header values.
 *
 * @param {string} text  Raw CSV content
 * @returns {object[]}
 */
function parseCsvText(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
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
 * Filter parsed rows to only internal indexable HTML pages (matching SF
 * process doc criteria):
 *   - Status Code === '200'
 *   - Content Type contains 'text/html'
 *   - Indexability === 'Indexable'
 *   - Address does NOT contain '/page/'
 *
 * @param {object[]} rows  Parsed CSV rows
 * @returns {object[]}
 */
function filterInternalHtmlPages(rows) {
  return rows.filter(row => {
    const status      = (row['Status Code'] || '').trim();
    const contentType = (row['Content Type'] || '').trim().toLowerCase();
    const indexable   = (row['Indexability'] || '').trim().toLowerCase();
    const address     = (row['Address'] || '').trim();

    return status === '200'
      && contentType.includes('text/html')
      && indexable === 'indexable'
      && !address.includes('/page/');
  });
}

module.exports = { parseCsvText, parseCSVLine, filterInternalHtmlPages };
