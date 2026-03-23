# Plan: Automation System + Content Architecture Audit

## TL;DR
Add a working automation framework to the Process Automation panel and implement the first automation — "Audit: Content Architecture" — which fetches SF crawl CSVs from Google Drive, runs 12 SEO checks, creates an 8-tab Google Sheet matching the provided template, and uploads it to `Reports/<domain>/` on Drive.

---

## Template Structure (Confirmed from HTM export)

**8 tabs: Scorecard & Summary | Overview | Content Metadata | Image Metadata | Raw Crawl (Content) | Raw Crawl (Images) | Custom JS | config**

### Overview tab — Issues list (Issue / Priority / SEO Impact):
| Issue | Priority | SEO Impact |
|---|---|---|
| Duplicate Title Tags | High | High |
| Missing/Empty Meta Description | High | High |
| Duplicate Meta Description | High | High |
| Missing H1 | High | High |
| Excessively Long or Short Title Tags | Medium | Medium |
| Excessively Long or Short Meta Description | Medium | Medium |
| Titles Use Bad Delimiters (dashes in use) | Medium | Medium |
| Duplicate H1 | Medium | Medium |
| Multiple H1 | Medium | Medium |
| Excessively Long or Short H1 | Medium | Medium |
| Image ALT Text Missing | Low | Low |
| Excessively Long Image ALT Text | Low | Low |

### Overview tab — Summary block:
- Titles to Rewrite: `COUNT`
- Meta Descriptions to Rewrite: `COUNT`
- H1s to Rewrite: `COUNT`
- Image ALT Text to Rewrite: `COUNT`

### Content Metadata columns:
`Address | Status | Priority | Notes | [spacer] | Title Rewrite | Description Rewrite | H1 Rewrite | [spacer] | Title Length | Title Duplicate | Missing Title | Description Length | Description Duplicate | Missing Description | H1 Length | H1 Duplicate | Missing H1 | Multiple H1 | [spacer] | Title 1 | Title 1 Length | New Title | New Title Length | Meta Description 1 | Meta Description 1 Length | New Description | New Description Length | H1-1 | H1-1 Length | New H1 | New H1 Length | H1-2 | H1-2 Length`

### Image Metadata columns:
`Destination (Image URL) | Status | Priority | Notes | [spacer] | Rewrite | Missing ALT | Alt Text Length | [spacer] | Alt Text | Alt Text Length | New Alt Text | New Alt Text Length`

### config tab lookup values:
- **pass/fail**: Pass, Needs Improvement, New Opportunity, Not Applicable, In Progress, To Discuss
- **Status**: Resolved, See Notes, In Progress, Pending, Ignore, No-Index
- **Priority**: 1. High, 2. Medium, 3. Low, Not applicable

### Raw Crawl (Content) instructions in template:
1. Run Screaming Frog crawl
2. From Internal Tab, filter: content type contains "html", status 200, indexability "indexable", and address does not contain "/page/"

---

## Key Decisions
- **Domain source**: Google Drive — list folders under `Crawls/` (Drive-authoritative, matches what was uploaded)
- **Output location**: `Reports/<domain>/` using `DRIVE_CATEGORIES.REPORTS` (existing constant)
- **Automation lock**: In-memory singleton (resets on restart) — simple, sufficient
- **Progress communication**: Client-side polling of `GET /api/automation/status` every 1.5s
- **OAuth scope addition**: `https://www.googleapis.com/auth/spreadsheets` must be added alongside existing Drive scope. Existing users must re-authenticate.
- **SF CSV source**: `internal_html.csv` (from `Internal:HTML` export tab) for content data; `images_all.csv` or `all_image_inlinks.csv` (from Images exports) for image data; optional `all_anchor_text.csv` (Links export) for manual anchor-text review. Preserve `Source`, `Destination`, and `Alt Text` fields to support manual image relevance review. Strategy: list files in latest crawl folder, match by name case-insensitively.
- **Internal URL filter parity with process doc**: include only rows where content type contains `html`, status is `200`, indexability is `indexable`, and `Address` does **not** contain `/page/`.
- **V1 scope boundary**: fully automate the template population + all machine-deterministic checks; preserve manual/qualitative checks as explicit reviewer tasks in the output. In ALT analysis, `Missing ALT` and `Long ALT` are automated; `Contextually Rich ALT` and `Irrelevant ALT` remain manual in V1. Accessibility/behavioral checks (`Text in Images`, `Text in Video`, `Text hidden by JavaScript`, `Text hidden by CSS`, `Tabbed Content`, `Missing Anchor Text`, `User-Agent Cloaking`, `Foreground/Background Contrast`) are manual in V1. Eyeball-phase content strategy checks are manual in V1.
- **H2 policy parity**: do not flag duplicate H2 as a defect in V1 (process guidance says cross-page H2 duplication is generally acceptable).
- **Threshold policy from process docs**: expose thresholds as config constants (title chars, meta chars, H1/H2 chars, ALT chars). Initial defaults from pages 10–40: title short `< 30`, title long `> 60`, meta long `> 155` (or 160 via config toggle), H1 long `> 70`, H2 long `> 70`, ALT long `> 100`; all remain configurable.
- **Accessibility benchmark**: manual contrast review should target WCAG AA contrast ratio `>= 4.5:1` for normal text.
- **New Title / New H1 / New Description / New Alt Text columns**: Pre-populated with the existing value as a starting point (analyst fills in rewrites). If Custom JS exports include generated rewrites, prefer those values over originals.

---

## Relevant Files

- `public/index.html` — Automation panel HTML (lines ~696–734), nav button (line ~444)
- `src/google-drive.js` — Drive client factory, `uploadToDrive()`, `ensureCategoryFolders()` — extend with download/list helpers
- `src/routes/google-drive.js` — OAuth scope declared here — must add Sheets scope
- `src/constants/driveCategories.js` — `DRIVE_CATEGORIES.REPORTS` for output folder
- `index.js` — Register new `/api/automation` route (line ~30–37)
- `tests/helpers/app-factory.js` — Pattern for test factories

**New files to create:**
- `src/automations/content-architecture-audit.js`
- `src/automations/sheets-builder.js`
- `src/automations/utils/csv-parser.js`
- `src/routes/automation.js`
- `src/automation-lock.js`

---

## Phase 1 — OAuth & Infrastructure Setup

**Step 1** — Add `https://www.googleapis.com/auth/spreadsheets` scope in `src/routes/google-drive.js` where OAuth scopes are currently defined. The scope array should include both Drive and Sheets permissions. Add a UI notice in Settings that users must re-authorize to enable automation.

**Step 2** — Create `src/automation-lock.js` as a singleton module exporting a plain `lock` object:
```
{ isRunning: false, automationId: null, domains: [], startedAt: null, progress: '', cancelled: false }
```
Export `acquireLock(automationId, domains)`, `releaseLock()`, `cancelLock()`, `getLockState()`.

**Step 3** — Register `app.use('/api/automation', require('./src/routes/automation'))` in `index.js` following the existing mount pattern.

---

## Phase 2 — Google Drive Download Utilities

**Step 4** — Add to `src/google-drive.js`:
- `getAuthenticatedDriveClient()` — already exists as `getDriveClient()`, reuse
- `getAuthenticatedSheetsClient(credentials)` — creates `google.sheets({ version: 'v4', auth: oauth2Client })` using the same refresh token
- `downloadFileAsText(fileId, drive)` — `drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })` — return full text content
- `listFolderContents(folderId, drive)` — `drive.files.list({ q: "'folderId' in parents", fields: 'files(id,name,mimeType,modifiedTime)' })`
- `findFolderByName(parentId, name, drive)` — search for folder by exact name in parent
- `listDomainsWithCrawlData(rootFolderId, drive)` — navigates to `Crawls/` category folder, lists its subdirectories, returns `[{ name, folderId }]`
- `getLatestCrawlFolder(domainFolderId, drive)` — lists subfolders of domain folder, sorts by `modifiedTime` DESC, returns most recent folder's `{ id, name }`

**Note**: `rootFolderId` must be read from `api_credentials` table (the saved root folder). Use existing DB query pattern from the google-drive route.

---

## Phase 3 — CSV Parsing Utilities

**Step 5** — Create `src/automations/utils/csv-parser.js`:
- Reuse the CSV parsing logic from `src/differ.js` (the quoted-field + embedded-comma handler)
- Export `parseCsvText(text)` → `[{ columnName: value, ... }, ...]` (first row = headers)
- Export `filterInternalHtmlPages(rows)` — filter where `Status Code === '200'` AND `Content Type` contains `'text/html'` AND `Indexability === 'Indexable'` AND `Address` does not contain `'/page/'`

**Step 6** — Create `src/automations/utils/sf-columns.js`:
Map of common SF column name aliases to canonical names:
```
ADDRESS: ['Address', 'address', 'URL', 'url'],
TITLE: ['Title 1', 'Page Title'],
TITLE_LENGTH: ['Title 1 Length', 'Page Title Length'],
META_DESC: ['Meta Description 1'],
META_DESC_LENGTH: ['Meta Description 1 Length'],
H1_1: ['H1-1'],
H1_1_LENGTH: ['H1-1 Length'],
H1_2: ['H1-2'],
H1_2_LENGTH: ['H1-2 Length'],
H2_1: ['H2-1'],
H2_1_LENGTH: ['H2-1 Length'],
STATUS_CODE: ['Status Code', 'Status'],
INDEXABILITY: ['Indexability'],
CONTENT_TYPE: ['Content Type'],
ALT_TEXT: ['Alt Text'],
ALT_TEXT_LENGTH: ['Alt Text Length'],
IMAGE_DEST: ['Destination', 'Destination URL']
```
Export `getColumn(row, canonicalName)` helper.

---

## Phase 4 — Automation Route

**Step 7** — Create `src/routes/automation.js` with these endpoints (follow Express Router pattern from `src/routes/jobs.js`):

```
GET  /api/automation/domains
  → acquires Drive client, reads root folder ID from db, navigates to Crawls/ category, 
    lists domain subfolders. Returns: { domains: ['example.com', 'other.com'] }
  → 503 if Drive not connected

GET  /api/automation/status
  → returns getLockState() as JSON

DELETE /api/automation/cancel
  → calls cancelLock(), returns { cancelled: true }

POST /api/automation/run
  → body: { automationId: 'content-architecture-audit', domains: ['example.com'] }
  → if lock is acquired → 409 { error: 'Automation already running' }
  → acquireLock(), kick off async run (do NOT await), return 202 { started: true }
  → async run: imports content-architecture-audit.js, calls run(), on finish calls releaseLock()
  → error in async: updates lock.progress with error msg, releases lock
```

---

## Phase 5 — Analysis Engine

**Step 8** — Create `src/automations/content-architecture-audit.js`:

```
async function run(domains, rootFolderId, credentials, progressCallback)
```

For each domain:
1. `progressCallback('Connecting to Google Drive...')`
2. Get Drive + Sheets clients using `credentials`
3. `progressCallback('Finding latest crawl for <domain>...')`  
4. Call `getLatestCrawlFolder(domainFolderId, drive)` to get folder
5. `progressCallback('Downloading crawl data for <domain>...')`
6. List files in that folder, find `internal_html.csv` (case-insensitive), download + parse
7. Find and download `images_all.csv` — parse
8. Find and download Custom JavaScript export CSV (filename-matched by `custom` + `javascript` tokens, fallback to header inspection) and parse
9. `progressCallback('Analyzing data for <domain>...')`
10. Filter HTML pages using `filterInternalHtmlPages()`
11. Build a lookup map from Custom JS export keyed by Address to suggested rewritten title/meta description values
12. Run all 12 audit checks — compute per-URL flags + issue counts
13. `progressCallback('Creating Google Sheet for <domain>...')`
14. Call `sheetsBuilder.createContentArchitectureAudit(domain, contentRows, imageRows, customJsRows, issueCounts, drive, sheets)`
15. `progressCallback('Uploading results for <domain>...')`
16. Store sheet under `Reports/<domain>/` (the Sheets API creates the file directly in Drive)
17. Return `{ domain, spreadsheetId, spreadsheetUrl, issueCounts }`

**Audit Logic** (per page row):
- `missingTitle` = title is empty/null
- `duplicateTitle` = title appears in more than one row (pre-compute frequency map)
- `titleLengthFail` = title length < `TITLE_MIN` OR > `TITLE_MAX` (defaults: 30/60)
- `titleBadDelimiter` = title uses discouraged separators for keyphrases (for V1: detect ` - `, ` – `, `:`, `_`; allow `|` and no-separator formats)
- `missingDescription` = meta desc is empty/null
- `duplicateDescription` = meta desc appears in more than one row
- `descLengthFail` = desc length > `META_LONG_MAX` (default `155`, configurable)
- `missingH1` = H1-1 is empty/null
- `duplicateH1` = H1-1 appears in more than one row
- `h1LengthFail` = H1-1 length > `H1_LONG_MAX` (default `70`; optional short-threshold disabled by default)
- `multipleH1` = H1-2 is not empty
- `titleRewrite` = missingTitle OR duplicateTitle OR titleLengthFail OR titleBadDelimiter
- `descRewrite` = missingDescription OR duplicateDescription OR descLengthFail
- `h1Rewrite` = missingH1 OR duplicateH1 OR h1LengthFail OR multipleH1
- `rowPriority` = any high-issue → '1. High'; any medium-issue → '2. Medium'; any low → '3. Low'; else ''
- `rowStatus` = any flag set → 'Pending'; else ''

**Per-image row**:
- `missingAlt` = alt text is empty/null/missing attribute (normalize null, undefined, empty string, and whitespace-only)
- `altLengthFail` = alt text length > `ALT_LONG_MAX` (default `100`)
- `altRewrite` = missingAlt OR altLengthFail
- `rowPriority` + `rowStatus` same logic as above (both are Low priority)

**Issue counts** for Overview:
- `duplicateTitles`: count of pages where `duplicateTitle`
- `missingDesc`: count of pages where `missingDescription`
- `duplicateDesc`: count of pages where `duplicateDescription`
- `missingH1`: count where `missingH1`
- `titleLengthIssues`: count where `titleLengthFail`
- `descLengthIssues`: count where `descLengthFail`
- `titleBadDelimiters`: count where `titleBadDelimiter`
- `duplicateH1`: count where `duplicateH1`
- `multipleH1`: count where `multipleH1`
- `h1LengthIssues`: count where `h1LengthFail`
- `missingImageAlt`: count of images where `missingAlt`
- `longImageAlt`: count of images where `altLengthFail`

---

## Phase 6 — Google Sheets Builder

**Step 9** — Create `src/automations/sheets-builder.js`:

```
async function createContentArchitectureAudit(domain, contentRows, imageRows, customJsRows, issueCounts, drive, sheets)
```

1. Create new spreadsheet via `sheets.spreadsheets.create({ resource: { properties: { title: 'Content Architecture Audit — domain.com — YYYY-MM-DD' }, sheets: [{ properties: { title: 'Scorecard & Summary' } }, ...8 sheets] } })`
2. Rename all 8 sheets to match template names
3. Populate each sheet via `sheets.spreadsheets.values.batchUpdate()`:
   - **Scorecard & Summary**: Write title "Content Architecture Audit" + domain + date + issue count summary table + a "Manual Review Required" checklist block for non-deterministic process checks. Seed this block with page-10–40 checks: `Titles Lead with Primary Keyphrase`, `Title Provides Clear Semantic Label`, `Meta Descriptions Lead with Keyphrase`, `Meta Keyword Abuse`, `Primary Keyword in H1`, `Missing H2 (contextual)`, `H2/H3 phrased as user questions`, `H3/H4/H5 opportunities`, `TL;DR summary block for long-form`, `Heading size`, `Heading tag stuffing`, `Image Cloaking`, `Contextually Rich ALT`, `Irrelevant ALT`, `Keywords Early in URLs`, `Hyphen-Separated URL words`, `Image URLs`, `Navigation Elements Non-image-based`, `Text in Images`, `Text in Video`, `Text hidden by JavaScript`, `Text hidden by CSS`, `Tabbed Content`, `Missing Anchor Text`, `User-Agent Cloaking`, `Foreground/Background Contrast`, `Emphasis`, `Emphasis Abuse`, `Target Keywords Higher on Pages`, `Other Areas Lead with Intended Keywords`, `Rich Media Supported (No Flash)`, `No Isolated Keyword Blocks`, `No Duplicate Text Across Pages`, `Content Freshness`, plus free-text `Why`/`How` columns.
   - **Overview**: Issues Detailed table (12 rows, columns: Issue, Priority, SEO Impact, Count) + Summary block (4 totals)
   - **Content Metadata**: Header row + one row per filtered HTML page. All computed flags as text (e.g. "Fail", "Pass", "Rewrite", ""). New Title/Desc/H1 pre-populated with current value.
   - **Image Metadata**: Header row + one row per image. Flags as text.
   - **Raw Crawl (Content)**: Header row + raw filtered SF data (all columns from internal_html.csv)
   - **Raw Crawl (Images)**: Header row + raw image data (must include Source URL, Destination URL, and Alt Text when present)
   - **Custom JS**: Header + raw Custom JavaScript export data used for rewrite lookups (Address + generated title/description fields)
   - **config**: Write lookup table (pass/fail, Status, Priority columns with their values)
4. Apply basic formatting via `sheets.spreadsheets.batchUpdate()`:
   - Freeze row 1 on Content Metadata, Image Metadata, Raw Crawl sheets
   - Bold header rows
   - Set background color on header row (#B7E1CD for green-ish, #FCE8B2 for yellow action columns) — approximate the template colors
5. Move spreadsheet to the correct Drive folder:
   - Use `drive.files.update({ fileId: spreadsheetId, addParents: reportsFolderIdForDomain, removeParents: 'root', fields: 'id, parents' })`
6. Return `{ spreadsheetId, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/...' }`

---

## Phase 7 — Frontend Updates

**Step 10** — In `public/index.html`, update the Automation panel (`#panel-automation`):

**Nav button** (line ~444): Remove `<span class="soon-badge">Soon</span>` from nav item.

**Panel cards**: Replace the 4 placeholder cards with the actual Automation system. The "Audit: Content Architecture" card replaces the first placeholder. The remaining 3 stay as "Coming Soon".

New card HTML pattern:
```html
<div class="automation-card">
  <div class="automation-card-icon">📋</div>
  <div class="automation-card-body">
    <h3>Audit: Content Architecture</h3>
    <p>Fetch crawl data from Google Drive. Audit page titles, meta descriptions, H1s, and image alt text. Generates a formatted Google Sheet uploaded to Reports.</p>
  </div>
  <button class="btn btn-primary" id="btn-run-content-audit" onclick="openAutomationModal('content-architecture-audit')">Go</button>
</div>
```

**Step 11** — Add domain selection modal (inside `#panel-automation`, hidden by default):
```html
<div id="automation-modal" class="modal-overlay" style="display:none">
  <div class="modal-box">
    <div class="modal-header">
      <h2>Select Domains to Audit</h2>
      <button class="btn-icon" onclick="closeAutomationModal()">✕</button>
    </div>
    <div id="automation-domain-list"><!-- checkboxes injected by JS --></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeAutomationModal()">Cancel</button>
      <button class="btn btn-primary" id="btn-start-automation" disabled onclick="startAutomation()">Run Audit</button>
    </div>
  </div>
</div>
```

**Step 12** — Add progress overlay (shown while automation is running):
```html
<div id="automation-progress" class="automation-progress-overlay" style="display:none">
  <div class="automation-progress-box">
    <h3 id="automation-progress-title">Running Audit...</h3>
    <div class="automation-progress-spinner"></div>
    <p id="automation-progress-msg">Connecting...</p>
    <button class="btn btn-danger" onclick="cancelAutomation()">✕ Cancel</button>
  </div>
</div>
```

**Step 13** — Add results display (shown on completion):
```html
<div id="automation-results" style="display:none">
  <h3>Audit Complete</h3>
  <div id="automation-results-list"><!-- injected by JS --></div>
  <button class="btn btn-secondary" onclick="dismissAutomationResults()">Done</button>
</div>
```

**Step 14** — JavaScript functions to add (inline in `public/index.html`):
```javascript
async function openAutomationModal(automationId) {
  // show modal, fetch /api/automation/domains, render checkboxes
}
function closeAutomationModal() { ... }
async function startAutomation() {
  // POST /api/automation/run with selected domains
  // hide modal, show progress  
  // start polling /api/automation/status every 1500ms
}
async function cancelAutomation() {
  // DELETE /api/automation/cancel
}
function pollAutomationStatus() {
  // GET /api/automation/status
  // update #automation-progress-msg
  // if !isRunning → stop polling, show results
}
function showAutomationResults(results) { ... }
function dismissAutomationResults() { ... }
```

---

## Phase 8 — Tests

**Step 15** — `tests/routes/automation.test.js`:
- `GET /api/automation/domains` returns 503 when Drive not connected
- `GET /api/automation/status` returns lock state
- `POST /api/automation/run` returns 409 when lock is held
- `DELETE /api/automation/cancel` sets cancelled flag

Follow `tests/helpers/app-factory.js` pattern. Mock `src/automation-lock.js` and `src/google-drive.js`.

**Step 16** — `tests/unit/content-architecture-audit.test.js`:
- `filterInternalHtmlPages()` correctly filters
- Duplicate title detection works across rows
- `titleLengthFail` logic correct for edge cases (30 chars, 60 chars)
- Missing H1 detected
- Multiple H1 detected (H1-2 non-empty)
- Issue counts aggregate correctly

---

## Verification

1. With Google Drive connected, Automation nav button shows without "Soon" badge
2. Click "Go" on Audit card → domain list loads from Drive `Crawls/` folder
3. Select a domain, click "Run Audit" → progress overlay appears with status updates
4. On completion, results panel shows issue counts with a link to the sheet on Drive
5. Opening the Drive link shows a Google Sheet with 8 tabs, all populated with crawl data
6. Overview tab counts match Content Metadata row counts for each issue type
7. While running, clicking "Go" on any automation is blocked (409 on API, UI disables button)
8. Cancel mid-run sets `lock.cancelled = true`, automation stops gracefully, results show cancelled state
9. Run `npm test` — new unit + route tests pass

---

## Further Considerations

1. **Re-auth UX**: When Sheets scope is added, existing users will see their Drive connection show as "connected" but automation will fail with a 403 until they re-authorize. Recommend showing a persistent warning banner in the Automation panel if Drive is connected but Sheets scope is missing (detect by attempting a `sheets.spreadsheets.list` with a catch).

2. **CSV file discovery**: SF CLI may name files differently depending on export tab configuration. Strategy: scan all `.csv` files in the latest crawl folder and match by checking first-row headers. `internal_html.csv` is the primary target for content data; fallback to `internal_all.csv` and apply the HTML filter client-side.

3. **Large crawls**: For sites with thousands of pages, Google Sheets API has a limit of ~5M cells per spreadsheet and batch write limits. If `contentRows.length > 10000`, split into multiple sheet files or add a truncation warning.
