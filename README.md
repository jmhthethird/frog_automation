# Frog Automation 🐸

A macOS LAN-only web app that lets any computer on your local network submit
crawl jobs to [Screaming Frog SEO Spider](https://www.screamingfrog.co.uk/seo-spider/)
running headlessly on your Mac.

Available as a **standalone Electron desktop app** (no Node.js installation
required on the host machine) or as a plain **Node.js server**.

---

## Getting Started — Electron App (recommended)

### Download a pre-built release

Every merge to `main` automatically builds and publishes a new GitHub Release
with signed `.dmg` installers for both Apple Silicon and Intel Macs.

1. Go to [**Releases**](../../releases) and download the latest `.dmg`:
   - **Apple Silicon (M1 / M2 / M3 / M4)** → `Frog Automation-x.y.z-arm64.dmg`
   - **Intel Mac** → `Frog Automation-x.y.z.dmg`
2. Open the DMG and drag **Frog Automation** to your Applications folder.
3. On first launch macOS may warn *"app is from an unidentified developer"*.
   Right-click the app → **Open** → **Open** to bypass Gatekeeper,
   or go to **System Settings → Privacy & Security → Open Anyway**.
4. The app starts the web server and opens the UI in a window automatically.
5. A system-tray icon (🟢) lets you reopen the window, open in your system
   browser, show the data folder, or quit.

> **Requires:** Screaming Frog SEO Spider installed at `/Applications/Screaming Frog SEO Spider.app`

---

## Features

- **Standalone Electron app** – no Node.js or npm needed on the destination Mac.
- **Web UI** – submit crawl jobs, upload / manage saved config profiles, view job
  status and logs, download results as a ZIP.
- **Single-worker queue** – jobs run one at a time; queued / running / completed /
  failed states are visible in the UI.
- **Cron scheduling** – attach a standard cron expression to any job to delay its
  first run or repeat it automatically on a schedule.
- **Profile library** – upload `.seospiderconfig` files once and reuse them across
  jobs.  Metadata is persisted in SQLite.
- **Configurable exports** – default tabs are pre-selected; customise per-job in
  the UI.
- **Health page** – `/api/health` shows whether the SF launcher is found on disk.
- **Auto-release CI** – every merge to `main` bumps the patch version and
  publishes a new GitHub Release with macOS DMG installers.
- **Security** – URL scheme validation, restricted file uploads, path-traversal
  prevention, rate limiting; no internet exposure needed.

---

## Prerequisites

### 1 – Install Screaming Frog SEO Spider

**macOS** — Download the DMG from <https://www.screamingfrog.co.uk/seo-spider/> and
install it to `/Applications`.  The server expects the launcher at:

```
/Applications/Screaming Frog SEO Spider.app/Contents/MacOS/ScreamingFrogSEOSpiderLauncher
```

**Linux (Debian / Ubuntu)** — Use the provided helper script to download and
install the `.deb` package:

```bash
bash scripts/install-sf-linux.sh          # installs v23.3 (default)
SF_VERSION=23.3 bash scripts/install-sf-linux.sh  # explicit version
```

After installation the launcher is available at
`/usr/bin/ScreamingFrogSEOSpiderLauncher`.

Override either default with the `SF_LAUNCHER` environment variable.

### 2 – Ensure a CLI / headless licence

Headless / CLI usage requires a **paid licence**.  Make sure Screaming Frog is
activated on the Mac that will run the server.  See the
[Screaming Frog documentation](https://www.screamingfrog.co.uk/seo-spider/user-guide/general/#cli)
for details.

### 3 – Install Node.js ≥ 18

Download from <https://nodejs.org/> or install via [Homebrew](https://brew.sh/):

```bash
brew install node
```

---

## Setup

```bash
# Clone the repo
git clone https://github.com/jmhthethird/frog_automation.git
cd frog_automation

# Install dependencies
npm install
```

---

## Starting the Server

```bash
npm start
```

The server binds to `0.0.0.0` (all interfaces) on port **3000** by default.

```
Frog Automation server running on http://0.0.0.0:3000
Access from this machine:  http://localhost:3000
Access from LAN:           http://<your-ip>:3000
```

### Accessing from Other LAN Machines

Find your Mac's LAN IP address:

```bash
ipconfig getifaddr en0   # Wi-Fi
# or
ipconfig getifaddr en1   # Ethernet
```

Then open `http://<mac-ip>:3000` in any browser on the same network.

---

## Configuration

All configuration is via environment variables:

| Variable          | Default                                                                                                         | Description                         |
|-------------------|-----------------------------------------------------------------------------------------------------------------|-------------------------------------|
| `PORT`            | `3000`                                                                                                          | HTTP port to listen on              |
| `DATA_DIR`        | `./data`                                                                                                        | Directory for SQLite DB, profiles, job outputs |
| `SF_LAUNCHER`     | macOS: `/Applications/Screaming Frog SEO Spider.app/Contents/MacOS/ScreamingFrogSEOSpiderLauncher`<br>Linux: `/usr/bin/ScreamingFrogSEOSpiderLauncher` | Path to the SF CLI launcher |

**Example – non-standard install path:**

```bash
SF_LAUNCHER="/opt/ScreamingFrog/ScreamingFrogSEOSpiderLauncher" PORT=8080 npm start
```

---

## Usage

1. Open the web UI in a browser.
2. Enter the URL you want to crawl.
3. Choose a profile:
   - **Use saved profile** – pick from previously uploaded `.seospiderconfig` files.
   - **Upload new profile** – select a `.seospiderconfig` file; it will be saved to
     the profile library for future use.
   - **No profile** – use Screaming Frog defaults.
4. Optionally edit the export tabs (comma-separated `Tab:Report` pairs).
5. Optionally enter a **Cron Schedule** expression to delay or repeat the crawl:
   - Leave blank to run immediately.
   - Enter a 5-field cron expression (e.g. `0 2 * * *` for daily at 02:00) to
     schedule the job for a future time and repeat it on that schedule.
   - The job status will show as **scheduled** until the next cron tick fires it.
6. Click **Run Crawl**.
7. Watch the job progress in the **Jobs** table.  Click **View** to see the log tail.
8. When the job completes, click **⬇ Download Results ZIP**.

---

## Default Export Tabs

All available tab categories are selected by default (each with `:All`):

| Tab Name                    |
|-----------------------------|
| `AMP:All`                   |
| `Analytics:All`             |
| `Canonicals:All`            |
| `Change Detection:All`      |
| `Content:All`               |
| `Custom Extraction:All`     |
| `Directives:All`            |
| `External:All`              |
| `H1:All`                    |
| `H2:All`                    |
| `Hreflang:All`              |
| `Images:All`                |
| `Internal:All`              |
| `JavaScript:All`            |
| `Link Metrics:All`          |
| `Links:All`                 |
| `Meta Description:All`      |
| `Meta Keywords:All`         |
| `Page Titles:All`           |
| `PageSpeed:All`             |
| `Pagination:All`            |
| `Response Codes:All`        |
| `Search Console:All`        |
| `Security:All`              |
| `Sitemaps:All`              |
| `Structured Data:All`       |
| `URL:All`                   |
| `Validation:All`            |

---

## API Reference

| Method | Path                     | Description                       |
|--------|--------------------------|-----------------------------------|
| GET    | `/api/health`            | Launcher detection + uptime       |
| GET    | `/api/jobs`              | List all jobs (newest first)      |
| POST   | `/api/jobs`              | Submit a new job (JSON body)      |
| GET    | `/api/jobs/:id`          | Get job details + log tail        |
| GET    | `/api/jobs/:id/download` | Download results ZIP              |
| GET    | `/api/profiles`          | List saved profiles               |
| POST   | `/api/profiles`          | Upload a new profile (multipart)  |
| DELETE | `/api/profiles/:id`      | Delete a profile                  |

### POST `/api/jobs` body

```json
{
  "url": "https://example.com",
  "profile_id": 1,
  "export_tabs": "Internal:All,Response Codes:All",
  "cron_expression": "0 2 * * *"
}
```

`profile_id`, `export_tabs`, and `cron_expression` are optional.

When `cron_expression` is omitted (or empty) the job is queued and runs
immediately.  When a valid 5-field cron expression is provided the job starts
in `scheduled` status and is pushed to the worker queue each time the cron
fires.  After each run completes the job automatically resets to `scheduled` so
it repeats on the defined schedule.

---

## Data Directory Layout

```
data/
├── frog_automation.db      ← SQLite database
├── profiles/               ← Uploaded .seospiderconfig files
│   └── 1712345678-my-site.seospiderconfig
└── jobs/
    └── 1/                  ← Output files from Screaming Frog
        ├── crawler.log     ← Captured stdout/stderr
        └── *.csv           ← Exported reports
    └── 1.zip               ← Downloadable archive
```

---

## Testing

### Unit + route tests (Jest)

```bash
npm test                  # run all unit/route/integration tests
npm run test:coverage     # run with coverage report (thresholds enforced)
```

The 9 Screaming Frog integration tests are **skipped by default** because they require the SF binary. To opt-in:

```bash
RUN_SF_INTEGRATION=1 npm test
```

#### Running SF integration tests on Linux

1. Install Screaming Frog using the provided script:

   ```bash
   bash scripts/install-sf-linux.sh
   ```

   The script always writes the EULA acceptance so the binary can run headlessly.
   No licence is needed — Screaming Frog runs in free mode (up to 500 URLs per
   crawl), which is sufficient for all integration tests.  If you have a paid
   licence and want to unlock unlimited crawling, supply your credentials:

   ```bash
   SF_LICENSE_USERNAME=me@example.com \
   SF_LICENSE_KEY=XXXX-XXXX-XXXX-XXXX-XXXX \
   bash scripts/install-sf-linux.sh
   ```

2. Run the integration tests:

   ```bash
   RUN_SF_INTEGRATION=1 npm test
   ```

#### Running SF integration tests on macOS

```bash
RUN_SF_INTEGRATION=1 npm test
```

Screaming Frog must be installed at the default path (see [Prerequisites](#prerequisites)).
No licence is required — free mode (500-URL limit) is sufficient.

### End-to-end UI tests (Playwright)

Playwright tests start the Express server automatically and drive a headless Chromium browser.

```bash
# First time only – download the Chromium browser binary
npx playwright install chromium

# Run all E2E tests
npm run test:e2e

# Open Playwright's interactive UI explorer
npm run test:e2e:ui
```

### Run everything at once

```bash
npm run test:all     # jest --coverage && playwright test
```

---

## CI and Branch Protection

Every pull request runs all tests automatically via **GitHub Actions CI** (`.github/workflows/ci.yml`).  PRs **cannot be merged** until the `CI / test` status check passes.

### CI jobs

| Job | Description |
|-----|-------------|
| `test` | Unit, route, and E2E tests — always runs on every PR and push to `main` |
| `SF integration tests (Linux)` | Downloads and installs Screaming Frog on Linux (free mode — no licence required), accepts the EULA, and runs both the Jest crawl tests and the Playwright UI tests. Runs on PRs from the same repository only. |

#### SF integration tests in CI

The `sf-integration` CI job runs on every same-repo PR and push to `main`.  It
installs Screaming Frog and immediately runs both the Jest and Playwright
integration tests without any additional secrets.

Screaming Frog's free mode (up to 500 URLs per crawl) is sufficient for all
integration test crawls — no paid licence is required.

If you have a paid licence and want to enable unlimited crawling in CI, add two
optional repository secrets:

1. Go to **Settings → Secrets and variables → Actions** in the GitHub repository.
2. Add:
   - `SF_LICENSE_USERNAME` — your Screaming Frog account e-mail address
   - `SF_LICENSE_KEY` — your Screaming Frog licence key

When present the install step will activate the licence automatically.  The
tests pass regardless of whether the secrets are set.

### Enabling branch protection (one-time admin step)

After pushing this repository for the first time:

1. Go to **Settings → Branches** in the GitHub repository.
2. Click **Add branch protection rule**.
3. Set **Branch name pattern** to `main`.
4. Tick **Require status checks to pass before merging**.
5. Search for and select **`CI / test`**.
6. Optionally tick **Require branches to be up to date before merging**.
7. Save.

Or use the `gh` CLI (requires admin token):

```bash
gh api repos/{owner}/{repo}/branches/main/protection \
  --method PUT \
  --field 'required_status_checks[strict]=true' \
  --field 'required_status_checks[contexts][]=CI / test' \
  --field 'enforce_admins=false' \
  --field 'required_pull_request_reviews=null' \
  --field 'restrictions=null'
```

Once enabled, the merge button is automatically blocked until `CI / test` turns green.

---



| Symptom | Fix |
|---------|-----|
| `⚠ SF Launcher not found` badge in UI | Ensure Screaming Frog is installed at the expected path, or set `SF_LAUNCHER` env var. |
| Jobs stay in **queued** state forever | Check the `crawler.log` inside `data/jobs/<id>/` for error output. |
| `Screaming Frog exited with non-zero code` | Verify your licence is activated on this Mac. Run the launcher manually to confirm. |
| Port already in use | Set `PORT=<other-port>` when starting. |

---

## Licence

MIT