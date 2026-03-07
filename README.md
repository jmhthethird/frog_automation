# Frog Automation 🐸

A macOS LAN-only web app that lets any computer on your local network submit
crawl jobs to [Screaming Frog SEO Spider](https://www.screamingfrog.co.uk/seo-spider/)
running headlessly on your Mac.

---

## Features

- **Web UI** – submit crawl jobs, upload / manage saved config profiles, view job
  status and logs, download results as a ZIP.
- **Single-worker queue** – jobs run one at a time; queued / running / completed /
  failed states are visible in the UI.
- **Profile library** – upload `.seospiderconfig` files once and reuse them across
  jobs.  Metadata is persisted in SQLite.
- **Configurable exports** – default tabs are pre-selected; customise per-job in
  the UI.
- **Health page** – `/api/health` shows whether the SF launcher is found on disk.
- **Security** – URL scheme validation, restricted file uploads, path-traversal
  prevention; no internet exposure needed.

---

## Prerequisites

### 1 – Install Screaming Frog SEO Spider on macOS

Download the macOS DMG from <https://www.screamingfrog.co.uk/seo-spider/> and
install it to `/Applications`.  The server expects the launcher at:

```
/Applications/Screaming Frog SEO Spider.app/Contents/MacOS/ScreamingFrogSEOSpiderLauncher
```

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

| Variable      | Default                                                                                       | Description                         |
|---------------|-----------------------------------------------------------------------------------------------|-------------------------------------|
| `PORT`        | `3000`                                                                                        | HTTP port to listen on              |
| `DATA_DIR`    | `./data`                                                                                      | Directory for SQLite DB, profiles, job outputs |
| `SF_LAUNCHER` | `/Applications/Screaming Frog SEO Spider.app/Contents/MacOS/ScreamingFrogSEOSpiderLauncher` | Path to the SF CLI launcher         |

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
5. Click **Run Crawl**.
6. Watch the job progress in the **Jobs** table.  Click **View** to see the log tail.
7. When the job completes, click **⬇ Download Results ZIP**.

---

## Default Export Tabs

| Tab Name                              |
|---------------------------------------|
| `Internal:All`                        |
| `Response Codes:All`                  |
| `Response Codes:Client Error (4xx)`   |
| `Redirects:All`                       |

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
  "export_tabs": "Internal:All,Response Codes:All"
}
```

`profile_id` and `export_tabs` are optional.

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

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `⚠ SF Launcher not found` badge in UI | Ensure Screaming Frog is installed at the expected path, or set `SF_LAUNCHER` env var. |
| Jobs stay in **queued** state forever | Check the `crawler.log` inside `data/jobs/<id>/` for error output. |
| `Screaming Frog exited with non-zero code` | Verify your licence is activated on this Mac. Run the launcher manually to confirm. |
| Port already in use | Set `PORT=<other-port>` when starting. |

---

## Licence

MIT