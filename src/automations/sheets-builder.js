'use strict';

const { getColumn } = require('./utils/sf-columns');

// ─── Manual review checklist items (from process docs pp.10–40) ───────────────
const MANUAL_REVIEW_ITEMS = [
  'Titles Lead with Primary Keyphrase',
  'Title Provides Clear Semantic Label',
  'Meta Descriptions Lead with Keyphrase',
  'Meta Keyword Abuse',
  'Primary Keyword in H1',
  'Missing H2 (contextual)',
  'H2/H3 phrased as user questions',
  'H3/H4/H5 opportunities',
  'TL;DR summary block for long-form',
  'Heading size',
  'Heading tag stuffing',
  'Image Cloaking',
  'Contextually Rich ALT',
  'Irrelevant ALT',
  'Keywords Early in URLs',
  'Hyphen-Separated URL words',
  'Image URLs',
  'Navigation Elements Non-image-based',
  'Text in Images',
  'Text in Video',
  'Text hidden by JavaScript',
  'Text hidden by CSS',
  'Tabbed Content',
  'Missing Anchor Text',
  'User-Agent Cloaking',
  'Foreground/Background Contrast',
  'Emphasis',
  'Emphasis Abuse',
  'Target Keywords Higher on Pages',
  'Other Areas Lead with Intended Keywords',
  'Rich Media Supported (No Flash)',
  'No Isolated Keyword Blocks',
  'No Duplicate Text Across Pages',
  'Content Freshness',
];

// ─── Overview issues table (12 rows) ──────────────────────────────────────────
const ISSUES_TABLE = [
  { issue: 'Duplicate Title Tags',                          priority: 'High',   seoImpact: 'High',   countKey: 'duplicateTitles' },
  { issue: 'Missing/Empty Meta Description',                priority: 'High',   seoImpact: 'High',   countKey: 'missingDesc' },
  { issue: 'Duplicate Meta Description',                    priority: 'High',   seoImpact: 'High',   countKey: 'duplicateDesc' },
  { issue: 'Missing H1',                                    priority: 'High',   seoImpact: 'High',   countKey: 'missingH1' },
  { issue: 'Excessively Long or Short Title Tags',          priority: 'Medium', seoImpact: 'Medium', countKey: 'titleLengthIssues' },
  { issue: 'Excessively Long or Short Meta Description',    priority: 'Medium', seoImpact: 'Medium', countKey: 'descLengthIssues' },
  { issue: 'Titles Use Bad Delimiters (dashes in use)',     priority: 'Medium', seoImpact: 'Medium', countKey: 'titleBadDelimiters' },
  { issue: 'Duplicate H1',                                  priority: 'Medium', seoImpact: 'Medium', countKey: 'duplicateH1' },
  { issue: 'Multiple H1',                                   priority: 'Medium', seoImpact: 'Medium', countKey: 'multipleH1' },
  { issue: 'Excessively Long or Short H1',                  priority: 'Medium', seoImpact: 'Medium', countKey: 'h1LengthIssues' },
  { issue: 'Image ALT Text Missing',                        priority: 'Low',    seoImpact: 'Low',    countKey: 'missingImageAlt' },
  { issue: 'Excessively Long Image ALT Text',               priority: 'Low',    seoImpact: 'Low',    countKey: 'longImageAlt' },
];

// ─── Config tab lookup values ─────────────────────────────────────────────────
const CONFIG_DATA = [
  ['Pass/Fail',        'Status',      'Priority'],
  ['Pass',             'Resolved',    '1. High'],
  ['Needs Improvement','See Notes',   '2. Medium'],
  ['New Opportunity',  'In Progress', '3. Low'],
  ['Not Applicable',   'Pending',     'Not applicable'],
  ['In Progress',      'Ignore',      ''],
  ['To Discuss',       'No-Index',    ''],
];

// ─── Content Metadata header row ──────────────────────────────────────────────
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

// ─── Image Metadata header row ────────────────────────────────────────────────
const IMAGE_HEADERS = [
  'Destination (Image URL)', 'Status', 'Priority', 'Notes', '',
  'Rewrite', 'Missing ALT', 'Alt Text Length', '',
  'Alt Text', 'Alt Text Length', 'New Alt Text', 'New Alt Text Length',
];

// ─── Colour helpers (Google Sheets API uses 0–1 float RGB) ────────────────────
const HEADER_GREEN  = { red: 0.718, green: 0.882, blue: 0.804 }; // #B7E1CD
const HEADER_YELLOW = { red: 0.988, green: 0.910, blue: 0.698 }; // #FCE8B2

/**
 * Create the Content Architecture Audit Google Sheet.
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
 * @param {string}   opts.reportsFolderId  Target folder ID
 * @returns {Promise<{ spreadsheetId: string, spreadsheetUrl: string }>}
 */
async function createContentArchitectureAudit(opts) {
  const {
    domain, analysedRows, analysedImages, customJsRows,
    rawContentRows, rawImageRows, issueCounts,
    drive, sheets, reportsFolderId,
  } = opts;

  const dateStr = new Date().toISOString().slice(0, 10);
  const title = `Content Architecture Audit — ${domain} — ${dateStr}`;

  const sheetNames = [
    'Scorecard & Summary',
    'Overview',
    'Content Metadata',
    'Image Metadata',
    'Raw Crawl (Content)',
    'Raw Crawl (Images)',
    'Custom JS',
    'config',
  ];

  // 1. Create spreadsheet with all 8 tabs
  const createResp = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: sheetNames.map((name, i) => ({
        properties: { sheetId: i, title: name, index: i },
      })),
    },
  });
  const spreadsheetId = createResp.data.spreadsheetId;

  // 2. Populate each sheet with batchUpdate values
  const valueData = [];

  // ── Scorecard & Summary ─────────────────────────────────────────────────
  const scorecardValues = [
    ['Content Architecture Audit'],
    ['Domain:', domain],
    ['Date:', dateStr],
    [''],
    ['Issue Summary'],
    ['Titles to Rewrite:', countTitlesToRewrite(issueCounts)],
    ['Meta Descriptions to Rewrite:', countDescsToRewrite(issueCounts)],
    ['H1s to Rewrite:', countH1sToRewrite(issueCounts)],
    ['Image ALT Text to Rewrite:', issueCounts.missingImageAlt + issueCounts.longImageAlt],
    [''],
    ['Manual Review Required', 'Status', 'Why', 'How'],
    ...MANUAL_REVIEW_ITEMS.map(item => [item, '', '', '']),
  ];
  valueData.push({ range: "'Scorecard & Summary'!A1", values: scorecardValues });

  // ── Overview ────────────────────────────────────────────────────────────
  const overviewValues = [
    ['Issues Detailed'],
    ['Issue', 'Priority', 'SEO Impact', 'Count'],
    ...ISSUES_TABLE.map(row => [
      row.issue, row.priority, row.seoImpact, issueCounts[row.countKey] || 0,
    ]),
    [''],
    ['Summary'],
    ['Titles to Rewrite:', countTitlesToRewrite(issueCounts)],
    ['Meta Descriptions to Rewrite:', countDescsToRewrite(issueCounts)],
    ['H1s to Rewrite:', countH1sToRewrite(issueCounts)],
    ['Image ALT Text to Rewrite:', issueCounts.missingImageAlt + issueCounts.longImageAlt],
  ];
  valueData.push({ range: "'Overview'!A1", values: overviewValues });

  // ── Content Metadata ────────────────────────────────────────────────────
  const contentDataRows = analysedRows.map(r => buildContentMetadataRow(r, customJsRows));
  valueData.push({
    range: "'Content Metadata'!A1",
    values: [CONTENT_HEADERS, ...contentDataRows],
  });

  // ── Image Metadata ──────────────────────────────────────────────────────
  const imageDataRows = analysedImages.map(buildImageMetadataRow);
  valueData.push({
    range: "'Image Metadata'!A1",
    values: [IMAGE_HEADERS, ...imageDataRows],
  });

  // ── Raw Crawl (Content) ─────────────────────────────────────────────────
  if (rawContentRows.length > 0) {
    const rawContentHeaders = Object.keys(rawContentRows[0]);
    const rawContentValues  = rawContentRows.map(r => rawContentHeaders.map(h => r[h] || ''));
    valueData.push({
      range: "'Raw Crawl (Content)'!A1",
      values: [rawContentHeaders, ...rawContentValues],
    });
  }

  // ── Raw Crawl (Images) ─────────────────────────────────────────────────
  if (rawImageRows.length > 0) {
    const rawImageHeaders = Object.keys(rawImageRows[0]);
    const rawImageValues  = rawImageRows.map(r => rawImageHeaders.map(h => r[h] || ''));
    valueData.push({
      range: "'Raw Crawl (Images)'!A1",
      values: [rawImageHeaders, ...rawImageValues],
    });
  }

  // ── Custom JS ───────────────────────────────────────────────────────────
  if (customJsRows.length > 0) {
    const customHeaders = Object.keys(customJsRows[0]);
    const customValues  = customJsRows.map(r => customHeaders.map(h => r[h] || ''));
    valueData.push({
      range: "'Custom JS'!A1",
      values: [customHeaders, ...customValues],
    });
  }

  // ── config ──────────────────────────────────────────────────────────────
  valueData.push({ range: "'config'!A1", values: CONFIG_DATA });

  // 3. Batch-write all values
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: valueData,
    },
  });

  // 4. Apply formatting (freeze rows, bold headers, header colours)
  const formatRequests = [];

  // Freeze row 1 on data sheets
  const freezeSheets = ['Content Metadata', 'Image Metadata', 'Raw Crawl (Content)', 'Raw Crawl (Images)', 'Custom JS'];
  for (const name of freezeSheets) {
    const idx = sheetNames.indexOf(name);
    if (idx >= 0) {
      formatRequests.push({
        updateSheetProperties: {
          properties: { sheetId: idx, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      });
    }
  }

  // Bold + colour header rows on data sheets
  const headerSheets = [
    { name: 'Content Metadata', color: HEADER_GREEN },
    { name: 'Image Metadata',   color: HEADER_GREEN },
    { name: 'Raw Crawl (Content)', color: HEADER_GREEN },
    { name: 'Raw Crawl (Images)',  color: HEADER_GREEN },
    { name: 'Overview',            color: HEADER_YELLOW },
  ];
  for (const { name, color } of headerSheets) {
    const idx = sheetNames.indexOf(name);
    if (idx >= 0) {
      formatRequests.push({
        repeatCell: {
          range: { sheetId: idx, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: color,
              textFormat: { bold: true },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat.bold)',
        },
      });
    }
  }

  if (formatRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: formatRequests },
    });
  }

  // 5. Move spreadsheet to the correct Drive folder
  if (reportsFolderId) {
    await drive.files.update({
      fileId: spreadsheetId,
      addParents: reportsFolderId,
      removeParents: 'root',
      fields: 'id, parents',
    });
  }

  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  return { spreadsheetId, spreadsheetUrl };
}

// ─── Row-builder helpers ──────────────────────────────────────────────────────

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
    row._rowStatus,                                                   // Status
    row._rowPriority,                                                 // Priority
    '',                                                               // Notes
    '',                                                               // spacer
    row._titleRewrite ? 'Rewrite' : '',                               // Title Rewrite
    row._descRewrite  ? 'Rewrite' : '',                               // Description Rewrite
    row._h1Rewrite    ? 'Rewrite' : '',                               // H1 Rewrite
    '',                                                               // spacer
    row._titleLengthFail ? 'Fail' : (row._title ? 'Pass' : ''),      // Title Length
    row._duplicateTitle  ? 'Fail' : (row._title ? 'Pass' : ''),      // Title Duplicate
    row._missingTitle    ? 'Fail' : 'Pass',                           // Missing Title
    row._descLengthFail  ? 'Fail' : (row._desc ? 'Pass' : ''),       // Description Length
    row._duplicateDescription ? 'Fail' : (row._desc ? 'Pass' : ''),  // Description Duplicate
    row._missingDescription   ? 'Fail' : 'Pass',                     // Missing Description
    row._h1LengthFail ? 'Fail' : (row._h1 ? 'Pass' : ''),           // H1 Length
    row._duplicateH1  ? 'Fail' : (row._h1 ? 'Pass' : ''),           // H1 Duplicate
    row._missingH1    ? 'Fail' : 'Pass',                             // Missing H1
    row._multipleH1   ? 'Fail' : 'Pass',                             // Multiple H1
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
    row._rowStatus,                                            // Status
    row._rowPriority,                                          // Priority
    '',                                                        // Notes
    '',                                                        // spacer
    row._altRewrite ? 'Rewrite' : '',                          // Rewrite
    row._missingAlt ? 'Fail' : 'Pass',                         // Missing ALT
    row._altLengthFail ? 'Fail' : (row._alt ? 'Pass' : ''),   // Alt Text Length
    '',                                                        // spacer
    row._alt || '',                                            // Alt Text
    row._altLen || '',                                         // Alt Text Length
    newAlt,                                                    // New Alt Text
    newAlt ? newAlt.length : '',                                // New Alt Text Length
  ];
}

// ─── Count helpers ────────────────────────────────────────────────────────────

function countTitlesToRewrite(c) {
  return (c.missingTitle || 0) + (c.duplicateTitles || 0) + (c.titleLengthIssues || 0) + (c.titleBadDelimiters || 0);
}

function countDescsToRewrite(c) {
  return (c.missingDesc || 0) + (c.duplicateDesc || 0) + (c.descLengthIssues || 0);
}

function countH1sToRewrite(c) {
  return (c.missingH1 || 0) + (c.duplicateH1 || 0) + (c.h1LengthIssues || 0) + (c.multipleH1 || 0);
}

module.exports = { createContentArchitectureAudit };
