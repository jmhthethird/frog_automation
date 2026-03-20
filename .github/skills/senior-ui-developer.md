---
name: senior-ui-developer
description: Senior UI Developer role for the SEO Automation Suite. Use this skill when implementing frontend components, styling, layout, or interactive behaviour in the single-page application. Ensures visual consistency, design-token compliance, and zero-regression integration with the existing Frog Automation UI.
---

This skill defines the Senior UI Developer role responsible for building and maintaining the frontend of the SEO Automation Suite — a single-page application that combines Screaming Frog crawl management with SEO analysis, reporting, and automation tools.

## Core Competencies

### 1. Design Token Mastery

Every colour, spacing, and radius value must come from the CSS custom properties defined in `:root`. Never introduce hard-coded colour values when a token exists.

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

The side navigation uses `#0d0d1f` as its background — slightly darker than `--bg` to create visual separation. This is the only non-token colour in the layout and is intentional.

### 2. Layout Architecture

The app uses a three-layer layout:

```
body
  └── .app-layout (flex, min-height: 100vh)
       ├── .side-nav (220px, fixed, left)
       │    ├── .side-nav-brand (logo + title)
       │    └── .side-nav-items (nav buttons)
       └── .app-content (flex: 1, margin-left: 220px)
            ├── #panel-frogtomation.nav-panel (original Frog Automation UI)
            ├── #panel-reports.nav-panel
            ├── #panel-automation.nav-panel
            └── #panel-settings.nav-panel
```

**Panel switching**: Toggling the `.active` class on `.nav-panel` elements. Only one panel is visible at a time. Panel state is persisted in `localStorage` under `frog_lastNavPanel`.

**Responsive breakpoint** (≤ 760px):
- Side nav slides off-screen (`transform: translateX(-100%)`)
- Hamburger toggle button appears (`#side-nav-toggle`)
- Backdrop overlay (`#side-nav-backdrop`) closes nav on tap
- `.app-content` drops `margin-left` to 0

### 3. Component Patterns

When building new UI in any panel, follow these established patterns:

**Cards** (used in Reports, Automation panels):
```css
.placeholder-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}
```

**Settings sections**:
```css
.settings-section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  margin-bottom: 20px;
}
```

**Buttons**: Use `.btn.btn-primary` (green), `.btn.btn-secondary` (surface2), `.btn.btn-danger` (red). Disabled "Coming Soon" buttons use `.btn-soon`.

**API service cards**: Use `.api-svc-card` with toggle switches. When duplicating across panels, prefix all IDs (e.g. `settings-api-toggle-…`).

**Status badges**: Always use `.badge-{status}` classes for job status. Never create ad-hoc coloured spans.

### 4. DOM ID Namespacing

Multiple panels may render similar UI elements. To prevent ID collisions:

| Panel | ID Prefix | Example |
|---|---|---|
| Frogtomation | (none — original IDs) | `api-toggle-google_drive` |
| Settings | `settings-` | `settings-api-toggle-google_drive` |
| Reports | `reports-` | (future use) |
| Automation | `automation-` | (future use) |

### 5. JavaScript Patterns

**Panel switching**:
```javascript
function switchNavPanel(panelName) {
  document.querySelectorAll('.nav-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + panelName)?.classList.add('active');
  document.querySelectorAll('.side-nav-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-panel') === panelName);
  });
  localStorage.setItem('frog_lastNavPanel', panelName);
}
```

**Lazy loading**: Panel-specific data (e.g. Settings API integrations) is loaded on first panel visit, not on page load. Use a flag like `_settingsApiLoaded` to avoid redundant fetches.

**Shared cache**: `_apiCredentialsCache` is shared between the Frogtomation and Settings panels. Write to it from either panel's save function; read from it in both rendering functions.

**API calls**: Always use `async/await` with `try/catch`. Show errors via `.msg-err` or `.api-svc-msg`. Re-enable buttons in `finally`.

**XSS safety**: Use `escHtml()` for all user-supplied values in `innerHTML`. Use `textContent` when possible.

### 6. CSS Conventions

- **Transitions**: Target specific properties (`background .15s`, `color .15s`), never `transition: all`.
- **Hover states**: `.85` opacity for buttons; colour shift for nav items.
- **Active states**: Side nav items use green left-border + subtle green background tint (`rgba(46,204,113,.08)`).
- **Focus states**: `border-color: var(--blue)` for inputs; `outline: 2px solid var(--blue)` for non-input interactive elements.
- **Animations**: Side nav slide uses `transform .25s ease`. Backdrop appears via class toggle, not animation.

### 7. Testing Frontend Changes

- **Jest unit tests** (`npm test`): Must pass before every commit. These test backend routes but validate the contract the frontend depends on.
- **Playwright E2E tests** (`npm run test:e2e`): Test UI interactions. Add E2E tests for new interactive features.
- **Manual verification**: Start the server (`PORT=3456 node index.js`), navigate all panels, verify mobile breakpoint, test keyboard navigation.
- **Screenshots**: Before/after screenshots are required for UI PRs. Store in `docs/screenshots/PR-<NUMBER>-<description>/`.
