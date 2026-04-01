---
name: business-grade-quality
description: >
  Business-grade quality standard for the Frog Automation / SEO Automation Suite.
  Invoke before planning any change that touches public/, src/, electron/, or tests/.
  Use as a pre-flight checklist when starting work, as a mid-flight reference during
  implementation, and as a final gate before opening a PR. Covers architecture safety,
  UI/UX quality, accessibility, Google Drive integration, security, and testing.
---

This skill is the single authoritative quality reference for the Frog Automation / SEO Automation Suite. It synthesises `senior-architect`, `senior-ui-developer`, `senior-ux-developer`, and guidance from `.github/copilot-instructions.md` into a phased workflow. For Google Drive / OAuth2 work, invoke `google-drive-oauth` in addition to this skill. For greenfield UI design requiring a bold aesthetic direction, invoke `frontend-design` in addition.

Work through each phase in order. Use the checkbox blocks as your working state — mark items `[x]` as you complete them.

---

## Phase 0 — Orient

Run this phase at the start of every session before writing any code.

1. Run `npm test` and confirm the branch is green. Never proceed on a red branch.
2. Read `docs/specs/` for any open spec that covers the feature area you are about to touch.
3. Scan TODO comments in the files you plan to modify.
4. Confirm the active branch follows the naming convention: `feature/…` for long-lived multi-session work; `claude/…` for short-lived Claude-driven tasks.
5. Note: all `localStorage` keys in this project use the `frog_` prefix.
6. If you are continuing a prior session, check the open PR description checklist for pending items.

**Phase 0 checklist:**
- [ ] `npm test` is green
- [ ] `docs/specs/` checked for open specs
- [ ] TODO comments in target files reviewed
- [ ] Branch name confirmed
- [ ] `frog_` localStorage convention noted
- [ ] Open PR checklist reviewed (if applicable)

---

## Phase 1 — Plan

Complete this phase before writing any code. These are the architecture decision gates.

### 1.1 Backend Safety Rules

| Rule | Pass condition |
|---|---|
| New routes live under `src/routes/` as isolated Express routers | New router does not import or mutate any existing router |
| DB changes use `CREATE TABLE IF NOT EXISTS` | No existing column is altered or dropped without a migration plan |
| Queue/scheduler changes are additive only | `src/queue.js` priority semantics are unchanged |
| All route handlers wrap logic in `try/catch` returning `{ error: '…' }` JSON | No unhandled promise rejections in new routes |
| Route tests use `tests/helpers/app-factory.js` | No new test calls `startServer()` directly |

### 1.2 Frontend Safety Rules

| Rule | Pass condition |
|---|---|
| Each panel is a self-contained DOM subtree | No code queries outside its own `#panel-*` container |
| New element IDs are prefixed per the namespacing table (Appendix A) | No ID collision with existing elements |
| `_apiCredentialsCache` is written through a single canonical code path | No parallel write path introduced |
| User-supplied values use `escHtml()` or `textContent` — never raw `innerHTML` | XSS safe |

### 1.3 Security Gate

- Check any new npm dependency against the GitHub Advisory Database before adding it.
- Never store secrets in `localStorage`. For Google Drive: only `client_id` and `client_secret` are user-supplied; `refresh_token` is server-side only.
- Any new OAuth-style callback flow requires CSRF state tokens (one-time, 10-minute TTL).

**Phase 1 checklist:**
- [ ] Backend safety rules reviewed for all planned changes
- [ ] Frontend safety rules reviewed for all planned changes
- [ ] New npm dependencies (if any) checked for advisories
- [ ] Secret storage approach confirmed (server-side only)
- [ ] CSRF protection planned for any new OAuth flow

---

## Phase 2 — Implement: Backend

Follow these conventions for all server-side code.

**Error handling (non-negotiable):**
```javascript
try {
  // ...
  res.json({ result });
} catch (err) {
  res.status(500).json({ error: err.message });
}
```
Never let an unhandled exception crash the server.

**SQLite timestamps:** Store with `datetime('now')` (no timezone). Parse in JavaScript by appending `'Z'`:
```javascript
new Date(row.created_at + 'Z')
```

**New route registration:** Add the new router to `index.js` under the correct base path (e.g. `app.use('/api/automation', automationRouter)`). Register it alongside existing routes in the same block.

**Google Drive uploads:** Always pass a `DRIVE_CATEGORIES.*` constant from `src/constants/driveCategories.js` as the `driveCategory` option to `uploadToDrive()`. Never hard-code folder names.

**Google Drive / OAuth work:** When implementing any Drive or OAuth2 feature, invoke the `google-drive-oauth` skill in addition to this one. That skill contains the authoritative CSRF token pattern, dual-mode OAuth flow, server-side folder browsing implementation, and the full implementation checklist.

**Phase 2 checklist:**
- [ ] All route handlers use `try/catch` + `res.status(N).json({ error })`
- [ ] SQLite timestamps stored and parsed correctly
- [ ] New router registered in `index.js`
- [ ] Drive uploads pass `DRIVE_CATEGORIES.*` constant
- [ ] `google-drive-oauth` skill invoked if Drive/OAuth work is in scope

---

## Phase 3 — Implement: Frontend

This is the highest-risk phase. Three source skills (`senior-ui-developer`, `senior-ux-developer`, and the UI/UX instructions) converge here. Work through every sub-section.

### 3.1 Design Tokens

The dark theme is the application's identity — it is not optional. All colours must come from `:root` CSS custom properties. The only intentional exception is `#0d0d1f` for the side nav background (slightly darker than `--bg` to create visual separation).

Critical tokens:
| Token | Value | Usage |
|---|---|---|
| `--bg` | `#1a1a2e` | Page background |
| `--surface` | `#16213e` | Card / panel background |
| `--surface2` | `#0f3460` | Header, elevated surfaces, secondary buttons |
| `--text` | `#e0e0e0` | Primary body text |
| `--text-dim` | `#a0a0a0` | Labels, secondary/hint text |
| `--border` | `#2a2a4e` | All borders, separators |
| `--green` | `#2ecc71` | Success, primary action, completed |
| `--red` | `#e74c3c` | Error, destructive action, failed |
| `--orange` | `#e67e22` | Warning, stopped |
| `--blue` | `#3498db` | Info, links, focus rings, running |

If a new colour is genuinely needed, define it as a new CSS custom property in `:root` — never introduce a hard-coded hex that duplicates or conflicts with an existing token.

For the full token list see `senior-ui-developer.md §1`.

### 3.2 Layout and Panel Architecture

```
body
  └── .app-layout (flex, min-height: 100vh)
       ├── .side-nav (220px, background: #0d0d1f, collapsible)
       └── .app-content (flex: 1, margin-left: 220px)
            ├── #panel-frogtomation.nav-panel
            ├── #panel-reports.nav-panel
            ├── #panel-automation.nav-panel
            └── #panel-settings.nav-panel
```

**Panel switching:** Toggle the `.active` class on `.nav-panel` elements — never destroy and recreate DOM. One panel is active at a time. Persist state in `localStorage` under `frog_lastNavPanel`.

**Breakpoint:** Every new layout region must collapse gracefully at `≤ 760px`. The side nav becomes a full-screen overlay at mobile width.

**Transitions:** Always target specific properties — `background .15s`, `color .15s`. Never write `transition: all`.

### 3.3 Components and Patterns

Reuse existing components — do not invent parallel implementations:

| Component | Class / element |
|---|---|
| Card container | `.placeholder-card` or `.settings-section` |
| Primary button | `.btn.btn-primary` (green) |
| Secondary button | `.btn.btn-secondary` (surface2) |
| Danger button | `.btn.btn-danger` (red) |
| Disabled / coming soon | `.btn-soon` (`opacity: .6`, `cursor: default`) |
| Job status badge | `.badge-{queued|running|completed|failed|scheduled|stopped}` |
| Success message | `.msg-ok` (auto-dismiss 3–5 seconds) |
| Error message | `.msg-err` (persist until next user action) |
| Collapsible section | `<details class="sect">` |
| Modal | `.modal-overlay` wrapping `.modal-content` |

**Polling / intervals:** Extend the existing `_tick()` / `loadJobs()` cycle for data that refreshes on a timer. Do not add a new `setInterval` loop.

**Lazy loading:** Load panel-specific data on first visit, not on page load. Use a flag (e.g. `_settingsApiLoaded`) to prevent redundant fetches.

**Shared cache:** `_apiCredentialsCache` is shared between the Frogtomation and Settings panels. Write to it through one canonical function; read from it in both render functions.

### 3.4 Interaction Standards

**Loading state (non-negotiable pattern):**
```javascript
btn.disabled = true;
btn.textContent = 'Saving…';
try {
  await fetch(/* … */);
} finally {
  btn.disabled = false;
  btn.textContent = 'Save';
}
```

**Feedback messages:**
- `.msg-ok` — green, auto-dismiss after 3–5 seconds.
- `.msg-err` — red, persists until next user action or next interaction.

**Modals (all three close mechanisms are required):**
```html
<!-- 1. Close button -->
<button onclick="closeModal()" aria-label="Close">×</button>

<!-- 2. Backdrop click -->
<div class="modal-overlay" onclick="if(event.target===this) closeModal()">
```
```javascript
// 3. Escape key
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
```

### 3.5 Accessibility (WCAG 2.1 AA — non-negotiable)

| Requirement | Implementation |
|---|---|
| Keyboard access | All interactive elements are `<button>` or `<a>`. Never `<div onclick>`. |
| Icon-only buttons | Must have `aria-label`. |
| Focus indicator | `border-color: var(--blue)` for inputs; `outline: 2px solid var(--blue)` for all other focusable elements. |
| Colour independence | Status badges include a text label — colour is never the sole signal. |
| Reduced motion | No infinite animations. All CSS transitions ≤ 250ms. Respect `prefers-reduced-motion`. |
| Touch targets | 44×44px minimum for mobile. Nav items must have adequate padding. |
| Semantic HTML | Use `<header>`, `<main>`, `<nav>`, `<section>` appropriately. |

### 3.6 XSS Safety (mandatory)

```javascript
// Safe — use for user-supplied strings in innerHTML contexts
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Prefer textContent when not building HTML
el.textContent = userSuppliedValue;

// Never do this with external data
el.innerHTML = userSuppliedValue; // ← XSS risk
```

### 3.7 Design Intent

Commit to a bold, intentional aesthetic direction native to this dark tool-oriented application. This is professional software for power users — design with precision, density, and purpose. Do not default to generic AI aesthetics (overused font stacks, purple gradients, cookie-cutter layouts). Every visual decision should feel deliberate.

**Phase 3 checklist:**
- [ ] All colours use CSS tokens (no new hard-coded hex values)
- [ ] Panel switching uses `.active` class toggle — no DOM destruction
- [ ] New layout collapses at ≤ 760px
- [ ] Transitions target specific properties, not `transition: all`
- [ ] Existing component classes reused — no parallel implementations
- [ ] No new `setInterval` loop — extends existing `_tick()` cycle
- [ ] Loading state pattern implemented (disable → label → finally re-enable)
- [ ] `.msg-ok` and `.msg-err` used for all feedback
- [ ] All modals have close button + Escape key + backdrop click
- [ ] All interactive elements are `<button>` or `<a>` with keyboard access
- [ ] `aria-label` on every icon-only button
- [ ] User-supplied data uses `escHtml()` or `textContent` — never raw `innerHTML`

---

## Phase 4 — Verify

Run these checks before every commit and before every PR.

### 4.1 Test Commands

```bash
npm test                  # Jest unit + route tests — must be green (90/80/90/90 thresholds)
npm run test:coverage     # Run in CI; run before PR to catch threshold regressions
npm run test:e2e          # Playwright — run for any change that touches public/
PORT=3456 node index.js   # Manual verification — navigate all four panels
```

### 4.2 UI Verification Checklist (manual)

- Dark theme is correct on all new surfaces — no white/light backgrounds introduced.
- Mobile breakpoint (≤ 760px): layout collapses, side nav works as overlay.
- Keyboard navigation: pressing Tab reaches all new interactive elements in logical order.
- All new status indicators use `.badge-{status}` — no ad-hoc coloured spans.
- All new feedback uses `.msg-ok` / `.msg-err` — no `alert()` or console.log-only feedback.
- Before/after screenshots taken.

### 4.3 Screenshot Requirement

Required for every PR that touches `public/` (HTML, CSS, or client-side JS):

```bash
mkdir -p docs/screenshots/PR-<NUMBER>-<description>
cp docs/screenshots/_TEMPLATE/README.md docs/screenshots/PR-<NUMBER>-<description>/
# Add your screenshots, then reference them in the PR body
```

Screenshots must be committed to the repository in the PR-specific directory, not pasted as external image URLs.

**Phase 4 checklist:**
- [ ] `npm test` passes
- [ ] `npm run test:coverage` passes (thresholds not regressed)
- [ ] `npm run test:e2e` passes (if UI was changed)
- [ ] All four panels manually verified in browser
- [ ] Mobile breakpoint manually verified
- [ ] Keyboard navigation verified
- [ ] Before/after screenshots committed to `docs/screenshots/PR-<NUMBER>-<description>/`

---

## Phase 5 — Ship

Final gate before opening or finalising a PR.

- **Commit discipline:** One logical change per commit. Descriptive message. Do not reformat or restructure code unrelated to the current task.
- **PR description:** Update the checklist in the open PR description after completing each task.
- **Spec document:** If a spec exists in `docs/specs/` for this feature, update it to reflect what was implemented.
- **CodeQL:** The CI `pr-build.yml` workflow runs CodeQL automatically. Review any findings before marking the PR ready for review.
- **Dependencies:** If any new npm package was added, confirm it was checked against the GitHub Advisory Database (Phase 1.3). Record the check in the PR description.
- **Merge direction:** Feature branch → feature branch → `main` only when all sub-tasks across all sessions are complete. Never merge a partial implementation to `main`.

**Phase 5 checklist:**
- [ ] Commits are atomic and descriptive
- [ ] PR description checklist updated
- [ ] `docs/specs/` updated (if applicable)
- [ ] CodeQL results reviewed
- [ ] New npm packages confirmed advisory-clean

---

## Appendix A — DOM ID Namespacing

Identical UI elements appear in multiple panels. All new IDs must be prefixed to prevent collisions.

| Panel | ID Prefix | Example |
|---|---|---|
| Frogtomation | (none — original IDs preserved) | `api-toggle-google_drive` |
| Settings | `settings-` | `settings-api-toggle-google_drive` |
| Reports | `reports-` | `reports-chart-title` |
| Automation | `automation-` | `automation-status-badge` |

---

## Appendix B — Technology Boundaries

| Area | Current Stack | Status |
|---|---|---|
| Backend | Node.js 24, Express 5, SQLite (better-sqlite3) | Stable — no planned changes |
| Frontend | Vanilla HTML/CSS/JS (single file in `public/`) | Open to modernisation when justified |
| Desktop | Electron 35 (`electron/main.js`) | Stable — no planned changes |
| Tests | Jest (unit/route), Playwright (e2e) | Add tests per existing pattern |
| Build | None (static files served directly) | Consider build step if frontend is modularised |

---

## Appendix C — Related Skills

When this skill's guidance is insufficient, defer to the source skill for full detail:

| Skill | When to invoke it |
|---|---|
| `senior-architect.md` | Cross-cutting changes spanning multiple systems; full architectural principles |
| `senior-ui-developer.md` | Full design token table, component CSS snippets, layout code |
| `senior-ux-developer.md` | Full workflow maps, information architecture decisions, future UX opportunities |
| `google-drive-oauth.md` | **Always invoke for any Google Drive or OAuth2 work** — contains full code patterns and the implementation checklist |
| `frontend-design.md` | Greenfield UI panels requiring bold aesthetic direction from scratch |
