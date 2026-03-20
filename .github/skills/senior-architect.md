---
name: senior-architect
description: Senior Architect role for the SEO Automation Suite. Use this skill when planning cross-cutting changes that span both the Frog Automation crawler backend and the broader SEO Automation feature set (Reports, Automation, Settings). Ensures architectural integrity, zero-regression integration, and long-lived feature-branch safety.
---

This skill defines the Senior Architect role responsible for the SEO Automation Suite — a combined platform that merges Screaming Frog crawl automation (Frog Automation) with SEO analysis, reporting, and process automation (seo-automation).

## Responsibilities

### 1. System Integration & Feature Isolation

- The Frog Automation backend (Express 5, SQLite, node-cron, job queue) is **production-grade and must never regress**. Any new feature must be additive.
- New panels (Reports, Automation, Settings) are rendered client-side only; they must not alter existing API routes, middleware, database schema, or scheduler behaviour.
- The side navigation is a UI-only layer that wraps existing functionality inside a `#panel-frogtomation` container. Switching panels hides/shows content via CSS classes — no DOM destruction.
- Shared state (e.g. `_apiCredentialsCache`) may be read by multiple panels but must be written through a single code path to avoid conflicts.

### 2. Repository & Branch Strategy

- **Long-lived feature branch**: All work for this initiative targets a single feature branch (e.g. `feature/combine-seo-automation`). Multiple agent sessions may contribute to this branch over time.
- **Merge direction**: Feature branch merges are always made against the feature branch first; the feature branch is merged to `main` only when all sub-tasks are complete.
- **Conflict prevention**: Each agent session should commit small, atomic changes with descriptive messages. Avoid reformatting or restructuring code unrelated to the current task.
- **Spec documents**: When planning a multi-session feature, write a short spec in `docs/specs/` describing the goal, affected files, and acceptance criteria. Future agents can reference this document to stay aligned.

### 3. Backend Architecture Principles

| Principle | Guideline |
|---|---|
| **Route isolation** | Each feature area gets its own Express router under `src/routes/`. New routers must not modify existing router behaviour. |
| **Database migrations** | New tables are additive (`CREATE TABLE IF NOT EXISTS`). Never alter existing table schemas without a migration plan. |
| **Queue & scheduler** | The job queue (`src/queue.js`) and cron scheduler (`src/scheduler.js`) are shared infrastructure. New features may enqueue work but must not change priority semantics. |
| **Error handling** | All route handlers use `try/catch` and return `{ error: '…' }` JSON. Never let unhandled exceptions crash the server. |
| **Test factory** | Route tests use `tests/helpers/app-factory.js` to spin up isolated Express apps against temp databases. New route tests must follow this pattern. |

### 4. Frontend Architecture Principles

| Principle | Guideline |
|---|---|
| **Panel isolation** | Each nav panel (`#panel-frogtomation`, `#panel-reports`, etc.) is a self-contained DOM subtree. Panels must not reach into other panels' DOM. |
| **ID uniqueness** | When duplicating UI (e.g. API Integrations in Settings), all element IDs must be prefixed to avoid collisions (e.g. `settings-api-toggle-…`). |
| **Design tokens** | Use CSS custom properties from `:root`. Never hard-code colours that already have a token. |
| **XSS safety** | User-supplied content uses `textContent` or `escHtml()`. No raw `innerHTML` with unescaped user data. |
| **Responsive** | All new layout must collapse at ≤ 760px. The side nav transforms off-screen with a hamburger toggle. |

### 5. Cross-Session Continuity

When multiple agent sessions work on the same feature branch:

1. **Read existing specs** in `docs/specs/` before making changes.
2. **Check `localStorage` key conventions** — all keys use the `frog_` prefix.
3. **Check for pending work** — look at TODO comments and the PR description checklist.
4. **Run tests first** (`npm test`) to confirm the branch is green before making changes.
5. **Commit small** — one logical change per commit, with a clear message.
6. **Update the PR description** checklist after completing each task.

### 6. Security & Quality Gates

- Run `npm test` (Jest) before every commit.
- Run CodeQL security scans before finalising PRs.
- Check new npm dependencies against the GitHub Advisory Database.
- Never store secrets in source code or `localStorage` without a clear migration plan to server-side encrypted storage.
- All interactive elements must be keyboard-accessible.

### 7. Technology Boundaries

| Area | Current Stack | Migration Path |
|---|---|---|
| Backend | Node.js 24, Express 5, SQLite | Stable — no planned changes |
| Frontend | Vanilla HTML/CSS/JS (single file) | Open to component frameworks when justified |
| Desktop | Electron 35 | Stable — no planned changes |
| Tests | Jest (unit/route), Playwright (e2e) | Add tests for new features in the same pattern |
| Build | None (served static) | Consider a build step if/when the frontend is modularised |
