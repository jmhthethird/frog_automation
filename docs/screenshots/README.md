# PR Screenshots Directory

This directory contains before/after screenshots for Pull Requests that include UI changes. **Each PR gets its own directory** to keep screenshots organized and easy to find.

---

## Directory Structure

```
docs/screenshots/
├── README.md                    # This file
├── PR-GUIDE.md                  # Quick reference for embedding screenshots in PRs
├── _TEMPLATE/                   # Template for new PR directories
│   └── README.md                # Copy this when creating a new PR directory
└── PR-<NUMBER>-<short-description>/
    ├── README.md                # Links to PR, describes screenshots
    ├── before.png               # Screenshot(s) before the change
    ├── after.png                # Screenshot(s) after the change
    └── ...                      # Additional screenshots as needed
```

### Naming Convention

Each PR directory follows this pattern:
- **Format:** `PR-<NUMBER>-<short-description>`
- **Examples:**
  - `PR-42-google-drive-oauth`
  - `PR-57-job-scheduling-ui`
  - `PR-103-dark-theme-refinements`

---

## How to Add Screenshots for Your PR

### 1. Create the Directory

```bash
# Replace <NUMBER> with your PR number and <description> with a short identifier
mkdir docs/screenshots/PR-<NUMBER>-<description>
```

### 2. Copy the Template README

```bash
cp docs/screenshots/_TEMPLATE/README.md docs/screenshots/PR-<NUMBER>-<description>/
```

### 3. Edit the README

Update the template with:
- Your PR number and title
- Link to the actual PR
- Description of what the screenshots show

### 4. Add Your Screenshots

Place your before/after screenshots in the directory:
- `before.png` — UI state before your changes
- `after.png` — UI state after your changes
- Additional screenshots as needed (e.g., `error-state.png`, `mobile-view.png`)

### 5. Reference in Your PR

In your PR description, reference the screenshots using relative paths:

```markdown
### Before
![Before](docs/screenshots/PR-123-my-feature/before.png)

### After
![After](docs/screenshots/PR-123-my-feature/after.png)
```

---

## Screenshot Guidelines

### Recommended Specifications

- **Resolution:** 1400x900 pixels (main UI), 600x700 pixels (popups/modals)
- **Device Scale Factor:** 2x (high DPI for clarity)
- **Browser:** Chromium (for consistency)
- **Format:** PNG with full color depth

### What to Capture

1. **Before state** — How the UI looked before your changes (or "N/A" for new features)
2. **After state** — The final UI after your changes
3. **Key interactions** — Different states (hover, active, error, success)
4. **Responsive views** — Mobile/tablet views if relevant

### Using Playwright for Screenshots

```bash
# Start the server
PORT=3456 npm start

# In another terminal, run Playwright to capture screenshots
npx playwright screenshot --viewport-size=1400,900 http://localhost:3456 screenshot.png
```

---

## Existing PR Directories

| Directory | PR | Description |
|-----------|-----|-------------|
| [`PR-42-google-drive-oauth`](PR-42-google-drive-oauth/) | [#42](https://github.com/jmhthethird/frog_automation/pull/42) | Google Drive OAuth2 integration refactor |

---

## Why Per-PR Directories?

1. **Organization** — Easy to find screenshots for any PR
2. **History** — Screenshots are preserved even after PR is merged
3. **Context** — Each directory's README links back to the PR
4. **Review** — Reviewers can browse all screenshots for a PR in one place
5. **Documentation** — Screenshots serve as visual documentation of UI evolution

---

## Related Documentation

- **[PR-GUIDE.md](PR-GUIDE.md)** — Quick reference for embedding screenshots in PR descriptions
- **[PR Template](../../.github/pull_request_template.md)** — Every UI PR requires screenshots

---

**Last Updated:** 2026-03-19
