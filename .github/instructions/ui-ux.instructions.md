---
applyTo: "public/**"
---

# UI / UX & Design Skills — Frontend

> **Read [`.github/skills/frontend-design.md`](../skills/frontend-design.md) first.** It defines the design philosophy, visual identity, and UX goals that govern every decision in this file.

The frontend is a single-page application. Its current form is a single HTML file with embedded styles and scripts, but **the implementation is open to modernisation** — component frameworks, build tooling, and module architecture are all on the table when they serve the user and the design goals. Propose improvements with confidence.

---

## 1. Design Tokens (CSS Custom Properties)

All core colours, surfaces, and the shared border-radius live in `:root`. **When adding or updating styles, use these tokens instead of introducing new hard-coded colour values.** Some legacy styles still use non-token hex values; avoid adding new ones and prefer defining or reusing a token in `:root`, gradually migrating existing colours into tokens when you touch that code.

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#1a1a2e` | Page background |
| `--surface` | `#16213e` | Card / panel background |
| `--surface2` | `#0f3460` | Header, elevated surfaces, secondary buttons |
| `--text` | `#e0e0e0` | Primary body text |
| `--text-dim` | `#a0a0a0` | Labels, secondary/hint text |
| `--border` | `#2a2a4e` | All borders, separators |
| `--radius` | `8px` | Card border-radius |
| `--green` | `#2ecc71` | Success, primary action, completed status |
| `--red` | `#e74c3c` | Error, destructive action, failed status |
| `--orange` | `#e67e22` | Warning, stopped status |
| `--blue` | `#3498db` | Info, links, focus rings, running status |
| `--gray` | `#95a5a6` | Neutral/muted elements |

**Adding a new colour** — only do so when none of the tokens above fit, and define it as a new CSS custom property in `:root` alongside the existing tokens.

---

## 2. Typography & Spacing

- **Base font:** `'Segoe UI', system-ui, sans-serif` at `14px`
- **Scale used throughout:** `10px`, `11px`, `12px`, `13px`, `14px`, `15px`, `16px`, `20px`
- **Spacing increments:** `4px`, `6px`, `8px`, `10px`, `12px`, `14px`, `16px`, `20px`, `22px`, `24px`
- Use relative units (`em`, `%`, `fr`) for layout; `px` is acceptable for fine-grained spacing and font sizes because the design is already pixel-perfect at 14 px base.
- Uppercase labels use `text-transform: uppercase; letter-spacing: .05em; font-size: 11px; color: var(--text-dim)` — match this pattern for all new section labels.

---

## 3. Layout System

```
main { padding: 24px 16px; }
.grid { display: grid; grid-template-columns: 1fr 1.6fr; gap: 20px; }
@media(max-width:760px) { .grid { grid-template-columns: 1fr; } }
```

- The `main` element has **no `max-width`** — content fills the full available width so that Jobs and detail panels expand with the viewport.
- The left column (`1fr`) holds the job-submission form and library cards.
- The right column (`1.6fr`) holds the jobs list and detail panel.
- **Responsive rule:** every new layout region must collapse gracefully at ≤ 760 px. Use `grid-template-columns: repeat(auto-fill, minmax(…, 1fr))` for multi-column sub-grids that should reflow on small screens.

---

## 4. Component Patterns

### Cards
```html
<div class="card">
  <h2>Section Title</h2>
  …content…
</div>
```
Cards use `.card` (background `--surface`, border `--border`, `border-radius: var(--radius)`, `padding: 20px`). Card headings are `<h2>` at `16px / font-weight 600 / color #ccc`.

### Buttons
| Class | Appearance | When to use |
|---|---|---|
| `.btn.btn-primary` | Green fill, black text | Primary / submit action |
| `.btn.btn-secondary` | `--surface2` fill, white text, border | Secondary / neutral action |
| `.btn.btn-danger` | Red fill, white text, smaller padding | Destructive action |

All buttons already have `transition: opacity .15s` and `.btn:hover { opacity: .85 }` — do not override these. Use `.btn:disabled { opacity: .4; cursor: default }` for disabled states.

### Form Inputs
All text inputs, URL inputs, selects, and textareas share:
```css
background: #0a0a1e; border: 1px solid var(--border); border-radius: 4px;
color: var(--text); font-size: 13px; padding: 8px 10px;
```
Focus state: `border-color: var(--blue)` (no custom outline, use the border change).

Label pattern:
```html
<label>Field name</label>
<input type="text" …>
```
Labels are `display: block; font-size: 12px; color: var(--text-dim); margin-bottom: 4px; margin-top: 12px`. The very first label in a group has `margin-top: 0`.

### Status Badges
```html
<span class="badge badge-completed">completed</span>
```
Available modifiers: `badge-queued`, `badge-running`, `badge-completed`, `badge-failed`, `badge-scheduled`, `badge-stopped`. Always use these — never add ad-hoc inline colour for job status.

### Feedback Messages
```html
<span class="msg msg-ok">Saved successfully</span>
<span class="msg msg-err">Something went wrong</span>
```
Show inline, near the triggering action. Clear after a few seconds or on the next user interaction.

### Collapsible Sections (`<details>` / `<summary>`)
```html
<details class="sect" id="my-section">
  <summary>Section heading</summary>
  …content…
</details>
```
Auto-open logic (used in `loadProfiles` / `loadSpiderConfigs`):
```js
const sect = document.getElementById('my-section');
if (sect && data.length > 0) sect.open = true;
```
The `.et-details` variant (export tabs) uses `::before` pseudo-element triangles (`▶ ` / `▼ `) instead of the native marker — follow the same pattern for any new collapsible that lives inside a grid.

### Modals
```html
<div class="modal-overlay hidden" id="my-modal">
  <div class="modal-box">
    <h3>Modal Title</h3>
    …body…
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmModal()">Confirm</button>
    </div>
  </div>
</div>
```
Show/hide by toggling the `hidden` class. The cron-schedule modal also uses `.modal-tabs` / `.modal-tab.active` / `.modal-pane.active` for tabbed content — reuse this pattern for any new multi-tab modal.

### Slide-out Drawer (API Settings pattern)
```html
<div id="my-backdrop" class="…backdrop">…</div>
<div id="my-drawer" class="…drawer">
  <div class="…header">…</div>
  <div class="…body">…</div>
</div>
```
The drawer slides in from the right with `transform: translateX(100%)` → `translateX(0)` via `.open` class and `transition: transform .25s ease`. Use this pattern for any new off-canvas panel.

### Tables
```html
<table>
  <thead><tr><th>Col</th>…</tr></thead>
  <tbody id="my-tbody">…</tbody>
</table>
```
- `th`: `font-size: 11px; text-transform: uppercase; color: var(--text-dim); padding: 6px 8px; border-bottom: 1px solid var(--border)`
- `td`: `padding: 8px 8px; font-size: 13px; border-bottom: 1px solid var(--border)`
- Hover row highlight: `tr:hover td { background: #ffffff08 }`
- Long URL columns use `.url-cell` (`max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`).

### Separators & Section Labels
```html
<hr class="sep">
<div class="section-label">Label text</div>
```

---

## 5. Interaction & Animation Guidelines

- **Transitions:** Prefer short durations (`0.12s`–`0.25s`) on colour/opacity/transform changes. Use `ease` or `ease-in-out`. Do not add `transition: all` — target specific properties.
- **Hover states:** Opacity drop to `.85` for buttons; colour + border-colour shift for ghost buttons and tabs; subtle row highlight `#ffffff08` for table rows.
- **Focus:** Use `border-color: var(--blue)` for text inputs. For interactive non-input elements that need keyboard accessibility, use `outline: 2px solid var(--blue); outline-offset: 1px`.
- **Polling:** The jobs list refreshes via `setInterval`. Do not introduce new polling loops; extend the existing `_tick()` / `loadJobs()` cycle.
- **Loading states:** Disable the submit button and update its label (e.g. "Running…") while a fetch is in-flight. Re-enable in the `finally` block.

---

## 6. Accessibility

- All interactive elements must be keyboard-reachable. Buttons use `<button>`, not `<div onclick>`.
- Use `aria-label` for icon-only buttons (e.g. close `×` buttons).
- Use `<label>` elements properly associated with their inputs (either wrapping or `for`/`id` pair).
- Colour is never the sole means of conveying information — pair colour with text or an icon (e.g. badges include the status word, not just a coloured dot).
- The `<details>` / `<summary>` pattern is inherently keyboard-accessible; preserve that by not overriding default focus behaviour.

---

## 7. Frontend Implementation Guidance

**The current implementation uses a single-file approach (embedded HTML/CSS/JS), but this is a starting point, not a ceiling.**

When proposing or implementing changes to `public/`:

- **Suggest modern patterns** where they improve maintainability, performance, or user experience. A component model, a build step, or a lightweight framework are all worth proposing if the benefit is clear.
- **API communication** uses `fetch('/api/…')` with `async/await`. Always handle errors and surface them to the user via `.msg-err`. Re-enable any disabled buttons in `finally`.
- **XSS safety is mandatory.** Prefer `textContent` over `innerHTML` when rendering user-supplied data. If you use `innerHTML`, ensure the content is sanitised first.
- **State persistence** for UI preferences (last-used profile, last-used config, etc.) currently uses `localStorage` with the key prefix `frog_`. Maintain this convention or propose a migration path.
- **Initialisation order** matters in the current codebase: new init calls belong between `loadJobs()` and `_initUpdateCheck()` in the `// ── Init` section. If restructuring, document the new pattern clearly.
- **Polling:** The jobs list currently refreshes via `setInterval` / `_tick()`. If proposing a real-time alternative (WebSockets, SSE), document the trade-offs.

---

## 8. Adding a New UI Feature — Checklist

Before opening a PR for any frontend change, verify against the full quality bar in [`.github/skills/frontend-design.md`](../skills/frontend-design.md). At minimum:

- [ ] Uses design tokens from `:root` for all colours; no hard-coded colour values
- [ ] Dark theme looks correct — tested on the dark background
- [ ] HTML structure follows the card / form / table patterns above where applicable
- [ ] Status is shown with `.badge-*` classes; feedback uses `.msg-ok` / `.msg-err`
- [ ] Interactive elements are focusable and keyboard-operable
- [ ] Layout is responsive — tested at ≤ 760 px
- [ ] User-supplied content never injected as raw HTML (XSS safety)
- [ ] API calls handle errors and re-enable UI controls in `finally`
- [ ] Before/after screenshots committed to `docs/screenshots/PR-<NUMBER>-<description>/` and referenced in the PR (required by PR template)
