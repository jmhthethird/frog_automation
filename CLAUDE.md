# Claude Code Instructions — Frog Automation

## Project Overview

Frog Automation is a self-hosted Node.js / Express web application that schedules and runs Screaming Frog SEO Spider crawl jobs, with Google Drive integration for automation workflows. It ships as a web app and an Electron desktop app for macOS.

See [`.github/copilot-instructions.md`](.github/copilot-instructions.md) for full backend conventions, tech stack details, and frontend design constraints. All rules there apply to Claude sessions as well.

---

## Pull Request Requirements

### Always use the PR template

Every PR must use the template at `.github/pull_request_template.md`. The template sections are:

- **Summary** — what this PR does and why
- **Changes** — bulleted list of key changes by file
- **UI Screenshots** — required for any PR that touches `public/index.html`, CSS, or client-side JS
- **Testing** — how the changes were tested (checkboxes)
- **Checklist** — final review checklist

### UI Screenshots (mandatory for any UI change)

If the PR modifies `public/index.html`, any CSS, or any client-side JavaScript:

1. **Create the screenshots directory:**
   ```
   docs/screenshots/PR-<NUMBER>-<short-description>/
   ```

2. **Copy the template README:**
   ```
   cp docs/screenshots/_TEMPLATE/README.md docs/screenshots/PR-<NUMBER>-<description>/README.md
   ```
   Then fill in the PR number, title, date, and description.

3. **Take actual before/after screenshots** using the headless browser setup in this repo:
   - Global Playwright 1.56.1 is at `/opt/node22/bin/playwright`
   - Chromium is at `~/.cache/ms-playwright/chromium-1194/chrome-linux/chrome`
   - Use `xvfb-run --auto-servernum` to provide a virtual display
   - Start the server with `node index.js` on a spare port (e.g. 3099) with a temp `DATA_DIR`
   - Navigate to the relevant panel, take screenshots at 1400×900

4. **Commit the screenshots** to the PR-specific directory before pushing.

5. **Reference them in the PR description** using relative paths:
   ```markdown
   ![Before](docs/screenshots/PR-<NUMBER>-<description>/before.png)
   ![After](docs/screenshots/PR-<NUMBER>-<description>/after.png)
   ```

If there are genuinely no UI changes, write `_No UI changes._` in the Screenshots section — do not leave it blank or omit it.

### PR title

Use a conventional commit prefix: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.

---

## Development Branch

Always develop on and push to the branch specified at the start of the session. The default branch for Claude sessions is `claude/complete-automation-pr-k6dwt` unless otherwise specified.

Never push directly to `main`.

---

## Testing

Run the full test suite before committing:
```
npx jest
```

Dependencies need to be installed first (`npm install`) if `node_modules/` is absent.
