# PR Screenshots - Quick Reference Guide

Use this guide to embed screenshots in your PR description for maximum impact.

> **Important:** Screenshots should be placed in a PR-specific directory: `docs/screenshots/PR-<NUMBER>-<description>/`
> See the [main README](README.md) for full instructions.

---

## Setting Up Your PR Screenshots Directory

```bash
# 1. Create your PR directory
mkdir docs/screenshots/PR-<NUMBER>-<description>

# 2. Copy the template README
cp docs/screenshots/_TEMPLATE/README.md docs/screenshots/PR-<NUMBER>-<description>/

# 3. Add your screenshots
# Place before.png, after.png, and any other screenshots in the directory

# 4. Update the README with your PR details
```

---

## Main Before/After Comparison

```markdown
## Visual Comparison: Before vs After

### Before - Original Implementation
![Before](docs/screenshots/PR-<NUMBER>-<description>/before.png)

The original implementation had:
- ❌ Issue 1
- ❌ Issue 2
- ❌ Issue 3

### After - Refactored Implementation
![After](docs/screenshots/PR-<NUMBER>-<description>/after.png)

The refactored version provides:
- ✅ Improvement 1
- ✅ Improvement 2
- ✅ Improvement 3
```

---

## Detailed UI Flow Screenshots

### 1. Initial State
```markdown
### Initial State
![Initial State](docs/screenshots/PR-<NUMBER>-<description>/initial-state.png)

Initial state showing:
- Feature A
- Feature B
```

### 2. Intermediate State
```markdown
### Intermediate State
![Intermediate](docs/screenshots/PR-<NUMBER>-<description>/intermediate.png)

User interaction:
- Step 1
- Step 2
```

### 3. Final State
```markdown
### Successfully Connected
![Connected State](docs/screenshots/google-drive-card-connected.png)

After successful OAuth connection:
- ✅ Green "Connected" indicator
- ✅ Disconnect button visible
- ✅ Folder picker enabled
- ✅ Selected folder displayed
```

---

## OAuth Callback Pages

### Success Page
```markdown
### OAuth Success Callback
![Success Callback](docs/screenshots/oauth-callback-success.png)

Professional success page featuring:
- ✓ Large green checkmark
- Clear success message
- Auto-redirect countdown
- Dark theme matching app
```

### Error Page
```markdown
### OAuth Error Callback
![Error Callback](docs/screenshots/oauth-callback-error.png)

Helpful error page with:
- ✕ Clear error indication
- Detailed error message
- "Return to Application" button
- Actionable guidance
```

---

## Full Context View

```markdown
### Complete API Settings View
![Full API Settings](docs/screenshots/api-settings-full.png)

Google Drive integration in context of all API services:
- Consistent card layout across all integrations
- Toggle switches for enable/disable
- Badge showing enabled services count
```

---

## Key Features Gallery

### Feature Grid Layout
```markdown
## Key UX Improvements

<table>
<tr>
<td width="33%">

### Real-Time Status
![Status Updates](docs/screenshots/google-drive-card-saved.png)
Color-coded feedback at every step

</td>
<td width="33%">

### Professional Design
![OAuth Success](docs/screenshots/oauth-callback-success.png)
Beautiful callback pages

</td>
<td width="33%">

### Progressive UI
![Connected State](docs/screenshots/google-drive-card-connected.png)
Smart button enable/disable

</td>
</tr>
</table>
```

---

## Embed in PR Description

### Recommended Structure

```markdown
# Google Drive OAuth2 Integration - Complete Refactor

## Overview
[Description of changes]

## Visual Proof: Before/After

### Before
![Before](docs/screenshots/before.png)

### After
![After](docs/screenshots/after.png)

## Detailed UI Flow

<details>
<summary>Click to see complete UI flow screenshots</summary>

### 1. Initial State
![Disconnected](docs/screenshots/google-drive-card-disconnected.png)

### 2. Entering Credentials
![Credentials](docs/screenshots/google-drive-card-credentials-filled.png)

### 3. Credentials Saved
![Saved](docs/screenshots/google-drive-card-saved.png)

### 4. Connected
![Connected](docs/screenshots/google-drive-card-connected.png)

</details>

## OAuth Callback Pages

<details>
<summary>View new callback page designs</summary>

### Success Page
![Success](docs/screenshots/oauth-callback-success.png)

### Error Page
![Error](docs/screenshots/oauth-callback-error.png)

</details>

## Full Documentation

For complete screenshot documentation including specifications and usage:
📸 [View Screenshot Documentation](docs/screenshots/README.md)

For implementation details:
📚 [View Implementation Guide](docs/google-drive-oauth-implementation.md)
```

---

## Tips for Best Presentation

1. **Use collapsible sections** (`<details>`) for detailed flows to keep PR description concise
2. **Lead with before/after** comparison for immediate visual impact
3. **Add brief captions** under each screenshot explaining what it shows
4. **Group related screenshots** together (e.g., all error states)
5. **Link to full documentation** for reviewers who want more detail
6. **Use tables** for side-by-side feature comparisons

---

## Alternative: Image Gallery

For a more visual approach:

```markdown
## Screenshot Gallery

### OAuth Flow
| Initial State | Credentials | Saved | Connected |
|---------------|-------------|-------|-----------|
| ![](docs/screenshots/google-drive-card-disconnected.png) | ![](docs/screenshots/google-drive-card-credentials-filled.png) | ![](docs/screenshots/google-drive-card-saved.png) | ![](docs/screenshots/google-drive-card-connected.png) |

### Callback Pages
| Success | Error |
|---------|-------|
| ![](docs/screenshots/oauth-callback-success.png) | ![](docs/screenshots/oauth-callback-error.png) |
```

---

## Direct Image URLs (for GitHub)

If you need to reference images by URL:

```
https://github.com/jmhthethird/frog_automation/raw/<branch>/docs/screenshots/before.png
https://github.com/jmhthethird/frog_automation/raw/<branch>/docs/screenshots/after.png
```

Replace `<branch>` with your actual branch name.

---

**Pro Tip:** Preview your PR description locally using a Markdown viewer to ensure images display correctly before publishing!
