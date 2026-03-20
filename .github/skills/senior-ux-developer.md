---
name: senior-ux-developer
description: Senior UX Developer role for the SEO Automation Suite. Use this skill when designing user flows, information architecture, interaction patterns, or accessibility improvements. Ensures a cohesive, intuitive experience across the combined Frog Automation and SEO analysis workflows.
---

This skill defines the Senior UX Developer role responsible for user experience design across the SEO Automation Suite — a platform that combines crawl automation, SEO analysis, report generation, and process automation into a single application.

## Core Competencies

### 1. Information Architecture

The application is organised into four top-level sections via side navigation:

| Section | Purpose | Current State |
|---|---|---|
| **Frogtomation** | Screaming Frog crawl management — submit jobs, manage profiles/configs, view results, schedule recurring crawls | Fully functional |
| **Reports** | Generate structured SEO audit reports from crawl data | Placeholder (6 report types defined, all "Coming Soon") |
| **Automation** | End-to-end SEO process automation (keyword mapping, redirects, content gaps, schema) | Placeholder (4 automation types defined, all "Coming Soon") |
| **Settings** | Centralised configuration — SEO Automation credentials + Frog Automation API integrations | Functional (dual-source settings) |

**Design principle**: Each section should feel self-contained. A user focused on crawling should never need to visit Settings to complete their workflow. A user focused on reports should see crawl data surfaced in context, not be forced to switch to Frogtomation.

### 2. Navigation & Wayfinding

**Side navigation design decisions:**
- 220px sidebar is collapsible at all viewport sizes via the hamburger toggle (`#side-nav-toggle`), which is always visible.
- **Desktop** (> 760px): Toggling adds `body.nav-collapsed`, sliding the sidebar off-screen and expanding content to fill the full width. Collapsed state is persisted in `localStorage` (`frog_sideNavCollapsed`).
- **Mobile** (≤ 760px): Sidebar starts hidden; toggle opens it as an overlay with a backdrop.
- Active state uses the brand green (`--green`) with a left-border accent — consistent with the seo-automation Sidebar pattern.
- "Soon" badges on Reports and Automation communicate feature maturity without hiding the sections. Users can explore and understand the roadmap.
- Panel state persists in `localStorage` (`frog_lastNavPanel`) so returning users land where they left off.

**Future navigation considerations:**
- As Report and Automation features mature, consider sub-navigation within those panels (e.g. tabs for different report types).
- Consider breadcrumb-style context when drilling into specific reports or automation workflows.
- The side nav currently supports full collapse/expand. A future enhancement could add an icon-only rail mode (56px) as an intermediate state for power users.

### 3. User Workflow Mapping

**Primary workflow: Crawl → Analyse → Report**

```
1. Frogtomation: Submit crawl job (URL, profile, config, schedule)
2. Frogtomation: Monitor job status (running → completed)
3. Frogtomation: Review crawl output (logs, diff, compare)
4. Reports:      Generate audit reports from crawl data (future)
5. Reports:      Export reports to Google Drive (future)
6. Automation:   Run automated analysis pipelines (future)
```

**Secondary workflow: Configure → Integrate**

```
1. Settings:     Configure Google service account credentials
2. Settings:     Configure API integrations (Frog Automation services)
3. Frogtomation: Verify integrations work (run a crawl with --use-* flags)
```

**Key UX insight**: Settings are duplicated intentionally — API integrations appear both in the Frogtomation panel (where they're contextually relevant) and in the Settings panel (centralised management). This reduces friction for users who are "in the zone" running crawls.

### 4. Interaction Design Guidelines

**Feedback patterns:**
- Success messages (`.msg-ok`): Green background, auto-dismiss after 3–5 seconds.
- Error messages (`.msg-err`): Red background, persist until user action or next interaction.
- Loading states: Disable the triggering button and update its label (e.g. "Saving…"). Re-enable in `finally`.
- "Coming Soon" buttons: Visually muted (`.btn-soon`, `opacity: .6`, `cursor: default`). Communicate future capability without frustrating users.

**Progressive disclosure:**
- Collapsible sections (`<details>`) for secondary content (profiles, configs, API integrations).
- Lazy loading for panel-specific data (Settings API integrations load on first visit).
- Export tabs use a multi-level disclosure (`:All` flags → individual category details).

**Keyboard navigation:**
- All side nav items are `<button>` elements — fully keyboard-accessible.
- Modals trap focus within the dialog (cron modal, drive folder browser).
- Hamburger toggle is always visible and keyboard-reachable at all viewport sizes.
- Tab order flows naturally: side nav → panel content → modals (when open).

### 5. Visual Hierarchy

**Dark theme is the identity.** The dark colour scheme (`--bg: #1a1a2e`) is not optional — it defines the application's professional, tool-oriented character.

**Hierarchy through contrast:**
1. **Side nav** (`#0d0d1f`) — darkest, always visible, anchors the layout
2. **Content background** (`--bg: #1a1a2e`) — base layer
3. **Cards/panels** (`--surface: #16213e`) — elevated content areas
4. **Headers** (`--surface2: #0f3460`) — top-level context, highest elevation
5. **Input fields** (`#0a0a1e`) — recessed, inviting interaction

**Colour as meaning:**
- Green (`--green`): Success, active, primary action, completed
- Red (`--red`): Error, danger, failed
- Orange (`--orange`): Warning, stopped
- Blue (`--blue`): Info, links, focus, running
- Dim text (`--text-dim`): Secondary, labels, hints

### 6. Accessibility Requirements

**WCAG 2.1 AA compliance is the target.** Every new feature must meet:

| Requirement | Implementation |
|---|---|
| **Keyboard access** | All interactive elements reachable via Tab. No `<div onclick>` — use `<button>` or `<a>`. |
| **Focus indicators** | `border-color: var(--blue)` for inputs; `outline: 2px solid var(--blue)` for other elements. |
| **Colour independence** | Status badges include text labels (not just coloured dots). Disabled buttons have both reduced opacity and `cursor: default`. |
| **Screen reader support** | Use semantic HTML (`<header>`, `<main>`, `<nav>`, `<section>`). Add `aria-label` for icon-only buttons. |
| **Motion reduction** | CSS transitions are short (≤ 250ms). No infinite animations. Respect `prefers-reduced-motion`. |
| **Touch targets** | Minimum 44×44px for mobile touch targets. Nav items have adequate padding. |

### 7. Future UX Opportunities

When implementing Report and Automation features, consider:

1. **Contextual actions**: Allow generating a report directly from a completed job's detail panel in Frogtomation.
2. **Progress indicators**: Show report generation progress with a progress bar or step indicator.
3. **Notifications**: When a scheduled crawl completes, surface a notification in the relevant panel.
4. **Onboarding**: First-time users should see guided setup prompts in Settings before they can use Reports/Automation.
5. **Cross-panel linking**: A "View Report" link in a completed job's detail panel that navigates to the Reports panel with context.
6. **Unified settings**: Eventually merge all settings into a single, well-organised Settings panel with sections and search.
7. **Dashboard**: Consider a landing page / dashboard that summarises recent activity across all sections.
