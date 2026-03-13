# GitHub Copilot Instructions – Frog Automation

## Project Overview

Frog Automation is a self-hosted Node.js / Express web application that schedules and runs [Screaming Frog SEO Spider](https://www.screamingfrog.co.uk/seo-spider/) crawl jobs. It also ships as an Electron desktop app for macOS.

**Be bold. Suggest improvements. This application is actively evolving and welcomes modern ideas for both design and implementation.**

## Tech Stack

- **Backend:** Node.js 24, Express 5, SQLite (`better-sqlite3`)
- **Frontend:** Single-page application served from `public/` — currently implemented as a single HTML file with embedded styles and scripts; open to modernisation
- **Desktop:** Electron 35 (`electron/main.js`)
- **Tests:** Jest (unit + route), Playwright (e2e)
- **Scheduler:** `node-cron`

## Repository Layout

```
public/             – Frontend assets (SPA entry point)
src/                – Express route handlers, crawler orchestration, DB layer
  routes/           – Express routers (jobs, profiles, spider-configs, …)
  crawler.js        – Spawns Screaming Frog process
  db.js             – SQLite schema & queries
index.js            – Express entry point
electron/main.js    – Electron shell
tests/              – Jest unit/route tests + Playwright e2e
```

## Backend Conventions

- **SQLite timestamps** are stored as `datetime('now')` (`YYYY-MM-DD HH:MM:SS`, no `Z`). Parse in JS by appending `'Z'` (e.g. `new Date(ts + 'Z')`).
- **Error handling:** Route handlers use `try/catch` and return JSON `{ error: '…' }` with an appropriate HTTP status.
- **Tests:** Unit/route tests use `tests/helpers/app-factory.js` to spin up an isolated Express app against a temp database. Do not call `startServer()` in tests.
- **New dependencies:** Check for security advisories before adding any new npm package.
- **PR checklist:** Every PR that touches the UI must include before/after screenshots (see `.github/pull_request_template.md`).

## Frontend & UI/UX Design

**The frontend is a first-class product surface. Design and implementation quality matter.**

Read the full skills and vision document before suggesting or making any frontend change:

- **[`.github/skills/frontend-design.md`](.github/skills/frontend-design.md)** — Design philosophy, visual identity, UX goals, and opportunities for innovation. This is your creative brief.
- **[`.github/instructions/ui-ux.instructions.md`](.github/instructions/ui-ux.instructions.md)** — Component patterns, design tokens, layout rules, and the quality bar every UI change must meet.

### Non-negotiable design constraints
1. **Dark theme is the identity.** All UI work must be designed for the dark theme (`--bg`, `--surface`, `--surface2` tokens).
2. **Design tokens are the palette.** Use the CSS custom properties in `:root` — never hard-code colour values that already have a token.
3. **Status vocabulary is fixed.** Job status is always one of: `queued`, `running`, `completed`, `failed`, `scheduled`, `stopped` — rendered with `.badge-{status}` classes.
4. **Accessibility is required.** Every interactive element must be keyboard-reachable. Colour is never the sole means of conveying information.
5. **XSS safety is mandatory.** User-supplied content must never be injected as raw HTML without sanitisation.
6. **Responsive layout is required.** The UI must work at any viewport width; the primary breakpoint is `760px`.
