# Frontend Design — Skills & Vision

This document defines the **design philosophy, visual identity, and UX ambitions** for Frog Automation's frontend. It is a living skills reference: use it as a creative brief, not a constraint checklist. Copilot and contributors are encouraged to suggest modern patterns and bring fresh ideas that serve the goals below.

---

## Design Philosophy

**Frog Automation is a power tool for SEO professionals.** The UI should feel like professional software — dense with information where useful, clean and calm where clarity matters. Every design decision should reduce cognitive load and help the user get their crawl job done with confidence.

> **Think terminal-grade precision meets modern web polish.**

- **Clarity over decoration.** Every element earns its place. If it doesn't inform or enable an action, remove it.
- **Speed perception matters.** Transitions, feedback states, and loading indicators should make the app feel instant and responsive — even when waiting on a crawl.
- **Dark-first.** The dark theme is non-negotiable. It is the visual identity of this application. All design work must look great on a dark background.
- **Data density done right.** Users run many jobs and manage multiple configs. Tables, lists, and grids should surface the most relevant data at a glance — with progressive disclosure for details.
- **Confidence through feedback.** Every action should have immediate, unambiguous visual confirmation. Errors must be visible. Success must be satisfying.

---

## Visual Identity

The application's design is built on a fixed palette of CSS custom properties. **These tokens are the brand — extend them, never replace them.**

| Token | Purpose |
|---|---|
| `--bg` | Page background — the darkest layer |
| `--surface` | Card and panel backgrounds |
| `--surface2` | Header, elevated controls, secondary interactive elements |
| `--text` | Primary readable content |
| `--text-dim` | Metadata, labels, hints |
| `--border` | All structural separators |
| `--radius` | Consistent rounding |
| `--green` | Success, confirmation, primary CTA |
| `--red` | Errors, destructive actions |
| `--orange` | Warnings, stopped/partial states |
| `--blue` | Info, links, focus, active/running state |
| `--gray` | Neutral, muted |

When a new concept genuinely requires a new colour, define it as a new `:root` token alongside the existing ones — never as an inline value.

---

## UX Goals

### Interaction

- **Responsiveness:** The layout must work at any viewport width. The primary breakpoint is `760px`. Design for mobile as a first-class constraint, not an afterthought.
- **Keyboard accessibility:** Every interactive element must be reachable and operable via keyboard. Focus states must be visible.
- **Loading & async states:** Every operation that hits the backend must give the user clear in-progress feedback and a clear outcome (success or error). Never leave the user guessing.
- **Optimistic UI where safe:** For lightweight read operations, prefer showing data immediately and refreshing in the background over blocking spinners.

### Information Architecture

- **Progressive disclosure:** Lead with the most important information. Put advanced options behind expandable sections (using the `<details>`/`<summary>` or equivalent pattern). Don't make the user scroll past options they don't need.
- **Status at a glance:** Job status, health, and active integrations must be visible without interaction.
- **Consistent vocabulary:** Use the established status badge system (`queued`, `running`, `completed`, `failed`, `scheduled`, `stopped`). Status words are part of the brand.

### Forms & Input

- **Smart defaults.** Remember the user's last choices (last-used profile, last-used spider config, etc.).
- **Inline validation.** Don't wait until form submission to tell the user something is wrong.
- **Helpful affordances.** Cron scheduling, profile management, and spider config selection are complex — the UI should guide the user, not just expose raw inputs.

---

## Opportunities for Innovation

The application is at an inflection point. Consider these areas as prime candidates for design and implementation improvement:

### Component Architecture
The frontend is currently a monolithic single-file SPA. As the feature surface grows, **introducing a structured component model** — whether through a lightweight framework, web components, or a disciplined module pattern — will improve maintainability and enable richer interactions. **Propose and justify modern approaches** where they offer a clear benefit.

### Animation & Micro-interactions
The current UI is functional but relatively static. Thoughtful micro-interactions (smooth list updates, progress animations for running crawls, transition effects for panel open/close) would significantly elevate the perceived quality. Use `@keyframes` or the Web Animations API where CSS transitions fall short.

### Data Visualisation
Crawl results contain rich data. Consider opportunities for inline sparklines, progress rings, or status timelines that communicate more than raw numbers in a table.

### Notifications & Real-time Feedback
The jobs list polls for updates. Explore whether WebSockets or Server-Sent Events could deliver a better real-time experience for long-running crawls.

### Theming
The dark theme is the identity, but the token system makes alternative themes technically feasible. If a light mode or a high-contrast accessibility theme is proposed, the architecture should support it via token swapping.

---

## Quality Bar

Every frontend change, regardless of scope, must meet:

- [ ] **Visual consistency** — uses design tokens, matches the dark aesthetic, no hard-coded colour values
- [ ] **Responsive** — looks correct at `320px`, `760px`, and `1200px` viewport widths
- [ ] **Accessible** — keyboard-operable, colour is never the sole informant, ARIA labels on icon-only controls
- [ ] **Error-safe** — API errors surfaced to the user clearly; loading states never leave the UI frozen
- [ ] **XSS-safe** — user-supplied content is never injected as raw HTML without sanitisation
- [ ] **Reviewed with screenshots** — before/after screenshots attached to every UI-touching PR
