'use strict';

const { getColumn } = require('./utils/sf-columns');

// ─── Template name on Google Drive ────────────────────────────────────────────
const TEMPLATE_NAME = 'TEMPLATE _ Content Architecture Audit';

// ─── Valid dropdown values from the config tab ────────────────────────────────
// These are the only values allowed in cells that have data-validation dropdowns.
const VALID_PASS_FAIL = [
  'Pass', 'Needs Improvement', 'New Opportunity', 'Not Applicable', 'In Progress', 'To Discuss',
];
const VALID_STATUS = [
  'Resolved', 'See Notes', 'In Progress', 'Pending', 'Ignore', 'No-Index',
];
const VALID_PRIORITY = [
  '1. High', '2. Medium', '3. Low', 'Not applicable',
];

// ─── Content Metadata header row (matches template) ───────────────────────────
const CONTENT_HEADERS = [
  'Address', 'Status', 'Priority', 'Notes', '',
  'Title Rewrite', 'Description Rewrite', 'H1 Rewrite', '',
  'Title Length', 'Title Duplicate', 'Missing Title',
  'Description Length', 'Description Duplicate', 'Missing Description',
  'H1 Length', 'H1 Duplicate', 'Missing H1', 'Multiple H1', '',
  'Title 1', 'Title 1 Length', 'New Title', 'New Title Length',
  'Meta Description 1', 'Meta Description 1 Length', 'New Description', 'New Description Length',
  'H1-1', 'H1-1 Length', 'New H1', 'New H1 Length',
  'H1-2', 'H1-2 Length',
];

// ─── Image Metadata header row (matches template) ────────────────────────────
const IMAGE_HEADERS = [
  'Destination (Image URL)', 'Status', 'Priority', 'Notes', '',
  'Rewrite', 'Missing ALT', 'Alt Text Length', '',
  'Alt Text', 'Alt Text Length', 'New Alt Text', 'New Alt Text Length',
];

/**
 * Create the Content Architecture Audit Google Sheet by copying the template.
 *
 * Instead of building a sheet from scratch this function:
 * 1. Finds the template in `Templates/TEMPLATE _ Content Architecture Audit`
 * 2. Copies it to `Reports/<domain>/` with a timestamped name
 * 3. Writes data into the five data-entry tabs only (Content Metadata,
 *    Image Metadata, Raw Crawl (Content), Raw Crawl (Images), Custom JS)
 * 4. Leaves Scorecard & Summary, Overview, and config tabs untouched so that
 *    formulas in those tabs auto-populate from the data we write
 * 5. Respects dropdown data-validation — only uses values from the config tab
 *
 * @param {object} opts
 * @param {string}   opts.domain
 * @param {object[]} opts.analysedRows
 * @param {object[]} opts.analysedImages
 * @param {object[]} opts.customJsRows
 * @param {object[]} opts.rawContentRows
 * @param {object[]} opts.rawImageRows
 * @param {object}   opts.issueCounts
 * @param {object}   opts.drive            Google Drive v3 client
 * @param {object}   opts.sheets           Google Sheets v4 client
 * @param {string}   opts.reportsFolderId  Target folder ID in Reports/<domain>/
 * @param {string}   opts.templateFileId   Drive file ID of the template spreadsheet
 * @returns {Promise<{ spreadsheetId: string, spreadsheetUrl: string }>}
 */
async function createContentArchitectureAudit(opts) {
  const {
    domain, analysedRows, analysedImages, customJsRows,
    rawContentRows, rawImageRows,
    drive, sheets, reportsFolderId, templateFileId,
  } = opts;

  const dateStr = new Date().toISOString().slice(0, 10);
  const title = `Content Architecture Audit — ${domain} — ${dateStr}`;

  // 1. Copy the template to the Reports/<domain>/ folder
  const copyResp = await drive.files.copy({
    fileId: templateFileId,
    requestBody: {
      name: title,
      parents: reportsFolderId ? [reportsFolderId] : undefined,
    },
    fields: 'id',
  });
  const spreadsheetId = copyResp.data.id;

  // 2. Read the copied spreadsheet to discover sheet IDs (tab names → sheetId)
  const ssResp = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });
  const sheetMap = {};
  for (const s of ssResp.data.sheets) {
    sheetMap[s.properties.title] = s.properties.sheetId;
  }

  // 3. Write data into the five data-entry tabs (row 2 onward, preserving headers)
  const valueData = [];

  // ── Content Metadata ──────────────────────────────────────────────────────
  const contentDataRows = analysedRows.map(r => buildContentMetadataRow(r, customJsRows));
  if (contentDataRows.length > 0) {
    valueData.push({
      range: "'Content Metadata'!A2",
      values: contentDataRows,
    });
  }

  // ── Image Metadata ────────────────────────────────────────────────────────
  const imageDataRows = analysedImages.map(buildImageMetadataRow);
  if (imageDataRows.length > 0) {
    valueData.push({
      range: "'Image Metadata'!A2",
      values: imageDataRows,
    });
  }

  // ── Raw Crawl (Content) ───────────────────────────────────────────────────
  if (rawContentRows.length > 0) {
    const rawContentHeaders = Object.keys(rawContentRows[0]);
    const rawContentValues  = rawContentRows.map(r => rawContentHeaders.map(h => r[h] || ''));
    valueData.push({
      range: "'Raw Crawl (Content)'!A1",
      values: [rawContentHeaders, ...rawContentValues],
    });
  }

  // ── Raw Crawl (Images) ────────────────────────────────────────────────────
  if (rawImageRows.length > 0) {
    const rawImageHeaders = Object.keys(rawImageRows[0]);
    const rawImageValues  = rawImageRows.map(r => rawImageHeaders.map(h => r[h] || ''));
    valueData.push({
      range: "'Raw Crawl (Images)'!A1",
      values: [rawImageHeaders, ...rawImageValues],
    });
  }

  // ── Custom JS ─────────────────────────────────────────────────────────────
  if (customJsRows.length > 0) {
    const customHeaders = Object.keys(customJsRows[0]);
    const customValues  = customJsRows.map(r => customHeaders.map(h => r[h] || ''));
    valueData.push({
      range: "'Custom JS'!A1",
      values: [customHeaders, ...customValues],
    });
  }

  // 4. Batch-write all values (USER_ENTERED so numbers/dates are recognised,
  //    but we never write formulas ourselves — only plain values)
  if (valueData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: valueData,
      },
    });
  }

  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  return { spreadsheetId, spreadsheetUrl };
}

// ─── Row-builder helpers ──────────────────────────────────────────────────────

/**
 * Map an analysis flag to a valid Pass/Fail dropdown value.
 * Only returns values that exist in the config tab's Pass/Fail column.
 */
function passFail(isFail, hasValue) {
  if (isFail) return 'Needs Improvement';
  if (hasValue) return 'Pass';
  return '';
}

/**
 * Map a rewrite flag to a text indicator.
 * The Rewrite columns are free-text (not dropdown-validated).
 */
function rewriteFlag(needsRewrite) {
  return needsRewrite ? 'Needs Improvement' : '';
}

function buildContentMetadataRow(row, customJsRows) {
  // Look up Custom JS rewrite suggestions
  let newTitle = row._title || '';
  let newDesc  = row._desc || '';
  let newH1    = row._h1 || '';

  if (customJsRows && customJsRows.length > 0) {
    const cjsRow = customJsRows.find(c => getColumn(c, 'ADDRESS') === row._address);
    if (cjsRow) {
      // Prefer Custom JS values if present
      const cjTitle = cjsRow['Generated Title'] || cjsRow['New Title'] || '';
      const cjDesc  = cjsRow['Generated Description'] || cjsRow['New Description'] || '';
      if (cjTitle) newTitle = cjTitle;
      if (cjDesc) newDesc = cjDesc;
    }
  }

  return [
    row._address,                                                     // Address
    row._rowStatus,                                                   // Status (uses VALID_STATUS values)
    row._rowPriority,                                                 // Priority (uses VALID_PRIORITY values)
    '',                                                               // Notes
    '',                                                               // spacer
    rewriteFlag(row._titleRewrite),                                   // Title Rewrite
    rewriteFlag(row._descRewrite),                                    // Description Rewrite
    rewriteFlag(row._h1Rewrite),                                      // H1 Rewrite
    '',                                                               // spacer
    passFail(row._titleLengthFail, row._title),                       // Title Length
    passFail(row._duplicateTitle, row._title),                        // Title Duplicate
    passFail(row._missingTitle, true),                                // Missing Title
    passFail(row._descLengthFail, row._desc),                        // Description Length
    passFail(row._duplicateDescription, row._desc),                   // Description Duplicate
    passFail(row._missingDescription, true),                          // Missing Description
    passFail(row._h1LengthFail, row._h1),                            // H1 Length
    passFail(row._duplicateH1, row._h1),                              // H1 Duplicate
    passFail(row._missingH1, true),                                   // Missing H1
    passFail(row._multipleH1, true),                                  // Multiple H1
    '',                                                               // spacer
    row._title || '',                                                 // Title 1
    row._titleLen || '',                                              // Title 1 Length
    newTitle,                                                         // New Title
    newTitle ? newTitle.length : '',                                   // New Title Length
    row._desc || '',                                                  // Meta Description 1
    row._descLen || '',                                               // Meta Description 1 Length
    newDesc,                                                          // New Description
    newDesc ? newDesc.length : '',                                     // New Description Length
    row._h1 || '',                                                    // H1-1
    row._h1Len || '',                                                 // H1-1 Length
    newH1,                                                            // New H1
    newH1 ? newH1.length : '',                                        // New H1 Length
    row._h1_2 || '',                                                  // H1-2
    row._h1_2 ? (row._h1_2.length) : '',                             // H1-2 Length
  ];
}

function buildImageMetadataRow(row) {
  const newAlt = row._alt || '';

  return [
    getColumn(row, 'IMAGE_DEST'),                             // Destination (Image URL)
    row._rowStatus,                                            // Status (uses VALID_STATUS values)
    row._rowPriority,                                          // Priority (uses VALID_PRIORITY values)
    '',                                                        // Notes
    '',                                                        // spacer
    rewriteFlag(row._altRewrite),                              // Rewrite
    passFail(row._missingAlt, true),                           // Missing ALT
    passFail(row._altLengthFail, row._alt),                    // Alt Text Length
    '',                                                        // spacer
    row._alt || '',                                            // Alt Text
    row._altLen || '',                                         // Alt Text Length
    newAlt,                                                    // New Alt Text
    newAlt ? newAlt.length : '',                                // New Alt Text Length
  ];
}

module.exports = {
  createContentArchitectureAudit,
  TEMPLATE_NAME,
  VALID_PASS_FAIL, VALID_STATUS, VALID_PRIORITY,
};
