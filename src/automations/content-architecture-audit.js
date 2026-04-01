'use strict';

const {
  buildDriveClientFromOAuth, buildSheetsClient,
  listDomainsWithCrawlData, getLatestCrawlFolder,
  listFolderContents, downloadFileAsText,
  findFolder, ensureFolder, findFileByName,
} = require('../google-drive');
const { DRIVE_CATEGORIES } = require('../constants/driveCategories');
const { parseCsvText, filterInternalHtmlPages } = require('./utils/csv-parser');
const { getColumn } = require('./utils/sf-columns');
const { getLockState } = require('../automation-lock');
const sheetsBuilder = require('./sheets-builder');

// ─── Validation ───────────────────────────────────────────────────────────────
const DRIVE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

// ─── Configurable thresholds ──────────────────────────────────────────────────
const THRESHOLDS = {
  TITLE_MIN:    30,
  TITLE_MAX:    60,
  META_LONG_MAX: 155,
  H1_LONG_MAX:  70,
  ALT_LONG_MAX: 100,
};

// Bad delimiters for title tags (allow `|`, flag ` - `, ` – `, `:`, `_`)
const BAD_DELIMITER_RE = / [-–] |[:_]/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a frequency map for duplicate detection.
 * Returns a Map<string, number>.
 */
function frequencyMap(values) {
  const map = new Map();
  for (const v of values) {
    if (!v) continue;
    map.set(v, (map.get(v) || 0) + 1);
  }
  return map;
}

/**
 * Find a CSV file by partial name match (case-insensitive) in a list of files.
 */
function findCsvByName(files, ...tokens) {
  return files.find(f => {
    const lower = f.name.toLowerCase();
    return lower.endsWith('.csv') && tokens.every(t => lower.includes(t.toLowerCase()));
  });
}

// ─── Analysis functions ───────────────────────────────────────────────────────

/**
 * Run all 12 content audit checks against filtered HTML page rows.
 *
 * @param {object[]} rows  Filtered, parsed CSV rows
 * @returns {{ analysedRows: object[], issueCounts: object }}
 */
function analyseContentRows(rows) {
  // Pre-compute frequency maps for duplicate detection
  const titles = rows.map(r => getColumn(r, 'TITLE')).filter(Boolean);
  const descs  = rows.map(r => getColumn(r, 'META_DESC')).filter(Boolean);
  const h1s    = rows.map(r => getColumn(r, 'H1_1')).filter(Boolean);

  const titleFreq = frequencyMap(titles);
  const descFreq  = frequencyMap(descs);
  const h1Freq    = frequencyMap(h1s);

  const issueCounts = {
    duplicateTitles: 0, missingTitle: 0,
    missingDesc: 0, duplicateDesc: 0,
    missingH1: 0, duplicateH1: 0, multipleH1: 0,
    titleLengthIssues: 0, descLengthIssues: 0,
    titleBadDelimiters: 0, h1LengthIssues: 0,
    missingImageAlt: 0, longImageAlt: 0,
  };

  const analysedRows = rows.map(row => {
    const title     = getColumn(row, 'TITLE');
    const titleLen  = parseInt(getColumn(row, 'TITLE_LENGTH'), 10) || (title ? title.length : 0);
    const desc      = getColumn(row, 'META_DESC');
    const descLen   = parseInt(getColumn(row, 'META_DESC_LENGTH'), 10) || (desc ? desc.length : 0);
    const h1        = getColumn(row, 'H1_1');
    const h1Len     = parseInt(getColumn(row, 'H1_1_LENGTH'), 10) || (h1 ? h1.length : 0);
    const h1_2      = getColumn(row, 'H1_2');
    const address   = getColumn(row, 'ADDRESS');

    const missingTitle       = !title;
    const duplicateTitle     = !!title && (titleFreq.get(title) || 0) > 1;
    const titleLengthFail    = !!title && (titleLen < THRESHOLDS.TITLE_MIN || titleLen > THRESHOLDS.TITLE_MAX);
    const titleBadDelimiter  = !!title && BAD_DELIMITER_RE.test(title);

    const missingDescription   = !desc;
    const duplicateDescription = !!desc && (descFreq.get(desc) || 0) > 1;
    const descLengthFail       = !!desc && descLen > THRESHOLDS.META_LONG_MAX;

    const missingH1_flag  = !h1;
    const duplicateH1     = !!h1 && (h1Freq.get(h1) || 0) > 1;
    const h1LengthFail    = !!h1 && h1Len > THRESHOLDS.H1_LONG_MAX;
    const multipleH1      = !!h1_2;

    const titleRewrite = missingTitle || duplicateTitle || titleLengthFail || titleBadDelimiter;
    const descRewrite  = missingDescription || duplicateDescription || descLengthFail;
    const h1Rewrite    = missingH1_flag || duplicateH1 || h1LengthFail || multipleH1;

    // Priority: any high-issue → '1. High'; any medium → '2. Medium'; else ''
    const hasHigh   = missingTitle || duplicateTitle || missingDescription || duplicateDescription || missingH1_flag;
    const hasMedium = titleLengthFail || descLengthFail || titleBadDelimiter || duplicateH1 || multipleH1 || h1LengthFail;
    const rowPriority = hasHigh ? '1. High' : (hasMedium ? '2. Medium' : '');
    const rowStatus   = (titleRewrite || descRewrite || h1Rewrite) ? 'Pending' : '';

    // Accumulate issue counts
    if (missingTitle)           issueCounts.missingTitle++;
    if (duplicateTitle)         issueCounts.duplicateTitles++;
    if (missingDescription)     issueCounts.missingDesc++;
    if (duplicateDescription)   issueCounts.duplicateDesc++;
    if (missingH1_flag)         issueCounts.missingH1++;
    if (duplicateH1)            issueCounts.duplicateH1++;
    if (multipleH1)             issueCounts.multipleH1++;
    if (titleLengthFail)        issueCounts.titleLengthIssues++;
    if (descLengthFail)         issueCounts.descLengthIssues++;
    if (titleBadDelimiter)      issueCounts.titleBadDelimiters++;
    if (h1LengthFail)           issueCounts.h1LengthIssues++;

    return {
      ...row,
      _address: address,
      _title: title, _titleLen: titleLen,
      _desc: desc, _descLen: descLen,
      _h1: h1, _h1Len: h1Len, _h1_2: h1_2,
      _missingTitle: missingTitle, _duplicateTitle: duplicateTitle,
      _titleLengthFail: titleLengthFail, _titleBadDelimiter: titleBadDelimiter,
      _missingDescription: missingDescription, _duplicateDescription: duplicateDescription,
      _descLengthFail: descLengthFail,
      _missingH1: missingH1_flag, _duplicateH1: duplicateH1,
      _h1LengthFail: h1LengthFail, _multipleH1: multipleH1,
      _titleRewrite: titleRewrite, _descRewrite: descRewrite, _h1Rewrite: h1Rewrite,
      _rowPriority: rowPriority, _rowStatus: rowStatus,
    };
  });

  return { analysedRows, issueCounts };
}

/**
 * Analyse image rows for ALT text issues.
 *
 * @param {object[]} rows  Parsed image CSV rows
 * @returns {{ analysedImages: object[], imageCounts: { missingImageAlt: number, longImageAlt: number } }}
 */
function analyseImageRows(rows) {
  let missingImageAlt = 0;
  let longImageAlt = 0;

  const analysedImages = rows.map(row => {
    const alt = getColumn(row, 'ALT_TEXT');
    const altLen = parseInt(getColumn(row, 'ALT_TEXT_LENGTH'), 10) || (alt ? alt.length : 0);

    const missingAlt   = !alt || !alt.trim();
    const altLengthFail = !!alt && alt.trim() && altLen > THRESHOLDS.ALT_LONG_MAX;
    const altRewrite   = missingAlt || altLengthFail;

    const rowPriority = altRewrite ? '3. Low' : '';
    const rowStatus   = altRewrite ? 'Pending' : '';

    if (missingAlt)    missingImageAlt++;
    if (altLengthFail) longImageAlt++;

    return {
      ...row,
      _alt: alt, _altLen: altLen,
      _missingAlt: missingAlt, _altLengthFail: altLengthFail,
      _altRewrite: altRewrite,
      _rowPriority: rowPriority, _rowStatus: rowStatus,
    };
  });

  return { analysedImages, imageCounts: { missingImageAlt, longImageAlt } };
}

// ─── Main runner ──────────────────────────────────────────────────────────────

/**
 * Run the Content Architecture Audit for one or more domains.
 *
 * @param {string[]} domainNames   Domain names selected by the user
 * @param {object}   creds         Google Drive credentials from DB
 * @param {function} progress      Callback to update progress text
 * @returns {Promise<object[]>}    Array of per-domain result objects
 */
async function run(domainNames, creds, progress) {
  const update = progress || (() => {});
  const results = [];

  update('Connecting to Google Drive…');
  const drive  = buildDriveClientFromOAuth(creds.client_id, creds.client_secret, creds.refresh_token);
  const sheets = buildSheetsClient(creds.client_id, creds.client_secret, creds.refresh_token);

  // Locate the template spreadsheet in Templates/ folder
  update('Locating audit template…');
  const safeRootId = (creds.root_folder_id && DRIVE_ID_RE.test(creds.root_folder_id)) ? creds.root_folder_id : null;
  const templatesFolderId = await findFolder(drive, DRIVE_CATEGORIES.TEMPLATES.folder, safeRootId);
  if (!templatesFolderId) {
    return domainNames.map(d => ({ domain: d, error: 'Templates/ folder not found in Google Drive. Run "Ensure Folders" first.' }));
  }
  const templateFileId = await findFileByName(templatesFolderId, sheetsBuilder.TEMPLATE_NAME, drive);
  if (!templateFileId) {
    return domainNames.map(d => ({ domain: d, error: `Template "${sheetsBuilder.TEMPLATE_NAME}" not found in Templates/ folder on Google Drive.` }));
  }

  // Resolve domain name → folder ID
  update('Loading domain list…');
  const allDomains = await listDomainsWithCrawlData(creds.root_folder_id, drive);
  const domainMap = new Map(allDomains.map(d => [d.name, d.folderId]));

  for (const domain of domainNames) {
    // Check for cancellation
    if (getLockState().cancelled) {
      results.push({ domain, error: 'Cancelled' });
      break;
    }

    const domainFolderId = domainMap.get(domain);
    if (!domainFolderId) {
      results.push({ domain, error: `Domain folder "${domain}" not found in Crawls/` });
      continue;
    }

    try {
      update(`Finding latest crawl for ${domain}…`);
      const latestFolder = await getLatestCrawlFolder(domainFolderId, drive);
      if (!latestFolder) {
        results.push({ domain, error: 'No crawl folders found' });
        continue;
      }

      update(`Downloading crawl data for ${domain}…`);
      const files = await listFolderContents(latestFolder.id, drive);

      // Find and download internal_html.csv
      const contentFile = findCsvByName(files, 'internal', 'html')
                       || findCsvByName(files, 'internal_all');
      if (!contentFile) {
        results.push({ domain, error: 'No internal_html.csv found in latest crawl folder' });
        continue;
      }
      const contentCsvText = await downloadFileAsText(contentFile.id, drive);
      const contentRows = parseCsvText(contentCsvText);
      const filteredContent = filterInternalHtmlPages(contentRows);

      // Guard against excessively large crawls (Sheets API cell limit ~5M).
      const CRAWL_ROW_LIMIT = 10_000;
      let crawlTruncated = false;
      if (filteredContent.length > CRAWL_ROW_LIMIT) {
        crawlTruncated = true;
        update(`Warning: crawl has ${filteredContent.length} pages; truncating to ${CRAWL_ROW_LIMIT} for Sheets.`);
        filteredContent.splice(CRAWL_ROW_LIMIT);
      }

      // Find and download image CSV
      const imageFile = findCsvByName(files, 'image')
                     || findCsvByName(files, 'all_image');
      let imageRows = [];
      if (imageFile) {
        const imageCsvText = await downloadFileAsText(imageFile.id, drive);
        imageRows = parseCsvText(imageCsvText);
      }

      // Find and download Custom JS CSV (optional)
      const customJsFile = findCsvByName(files, 'custom', 'javascript')
                        || findCsvByName(files, 'custom_js')
                        || findCsvByName(files, 'custom_extraction');
      let customJsRows = [];
      if (customJsFile) {
        const customJsCsvText = await downloadFileAsText(customJsFile.id, drive);
        customJsRows = parseCsvText(customJsCsvText);
      }

      if (getLockState().cancelled) {
        results.push({ domain, error: 'Cancelled' });
        break;
      }

      update(`Analysing data for ${domain}…`);
      const { analysedRows, issueCounts } = analyseContentRows(filteredContent);
      const { analysedImages, imageCounts } = analyseImageRows(imageRows);
      issueCounts.missingImageAlt = imageCounts.missingImageAlt;
      issueCounts.longImageAlt    = imageCounts.longImageAlt;

      if (getLockState().cancelled) {
        results.push({ domain, error: 'Cancelled' });
        break;
      }

      update(`Creating Google Sheet for ${domain}…`);

      // Resolve Reports/<domain> folder
      const reportsCategoryId = await ensureFolder(drive, DRIVE_CATEGORIES.REPORTS.folder, safeRootId);
      const reportsDomainId   = await ensureFolder(drive, domain, reportsCategoryId);

      const sheetResult = await sheetsBuilder.createContentArchitectureAudit({
        domain,
        analysedRows,
        analysedImages,
        customJsRows,
        rawContentRows: filteredContent,
        rawImageRows: imageRows,
        issueCounts,
        drive,
        sheets,
        reportsFolderId: reportsDomainId,
        templateFileId,
      });

      results.push({
        domain,
        spreadsheetId: sheetResult.spreadsheetId,
        spreadsheetUrl: sheetResult.spreadsheetUrl,
        issueCounts,
        crawlFolder: latestFolder.name,
        crawlTruncated,
      });

    } catch (err) {
      results.push({ domain, error: err.message || String(err) });
    }
  }

  return results;
}

module.exports = { run, analyseContentRows, analyseImageRows, THRESHOLDS };
