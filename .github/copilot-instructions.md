# GitHub Copilot Instructions – Frog Automation

## Project Overview

Frog Automation is a self-hosted Node.js / Express web application that schedules and runs [Screaming Frog SEO Spider](https://www.screamingfrog.co.uk/seo-spider/) crawl jobs. It also ships as an Electron desktop app for macOS.

**Key tech stack:**
- **Backend:** Node.js 24, Express 5, SQLite (`better-sqlite3`)
- **Frontend:** Single-page app in `public/index.html` — vanilla JS, no framework, no build step
- **Desktop:** Electron 35 (`electron/main.js`)
- **Tests:** Jest (unit + route), Playwright (e2e)
- **Scheduler:** `node-cron`

## Repository Layout

```
public/index.html   – Entire SPA (HTML + embedded CSS + embedded JS)
src/                – Express route handlers, crawler orchestration, DB layer
  routes/           – Express routers (jobs, profiles, spider-configs, …)
  crawler.js        – Spawns Screaming Frog process
  db.js             – SQLite schema & queries
index.js            – Express entry point
electron/main.js    – Electron shell
tests/              – Jest unit/route tests + Playwright e2e
```

## General Coding Conventions

- **No external frontend libraries.** All UI lives in `public/index.html` with plain CSS and vanilla JS — do not add React, Vue, Tailwind, Bootstrap, or any npm frontend dependency.
- **No build pipeline for the frontend.** The HTML file is served as-is; keep it that way.
- **Minimal dependencies.** Prefer extending what already exists over adding new npm packages. Check for security advisories before adding any new dependency.
- **SQLite timestamps** are stored as `datetime('now')` (`YYYY-MM-DD HH:MM:SS`, no `Z`). Parse in JS by appending `'Z'` (e.g. `new Date(ts + 'Z')`).
- **Error handling:** Route handlers use `try/catch` and return JSON `{ error: '…' }` with an appropriate HTTP status. Surface errors to the user through the existing `.msg-err` message pattern in the UI.
- **Tests:** Unit/route tests use `tests/helpers/app-factory.js` to spin up an isolated Express app against a temp database. Do not call `startServer()` in tests.
- **PR checklist:** Every PR that touches the UI must include before/after screenshots (see `.github/pull_request_template.md`).

## UI / UX Design Principles

See [`.github/instructions/ui-ux.instructions.md`](.github/instructions/ui-ux.instructions.md) for the full UI/UX skill set applied to `public/index.html`.

The short version:
1. Use the CSS custom properties defined in `:root` — never hard-code colours or spacing that already have a token.
2. Follow the existing dark-theme aesthetic (`--bg`, `--surface`, `--surface2`).
3. Use `<details>` / `<summary>` with class `.sect` for collapsible sections.
4. Status is always shown with `.badge-{status}` classes (`queued`, `running`, `completed`, `failed`, `scheduled`, `stopped`).
5. Feedback messages use `.msg.msg-ok` / `.msg.msg-err`.
6. Keep the layout responsive: the main grid (`grid-template-columns: 1fr 1.6fr`) collapses to a single column below `760 px`.
