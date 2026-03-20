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
### Final State
![Final State](docs/screenshots/PR-<NUMBER>-<description>/final-state.png)

After the change:
- ✅ Result A
- ✅ Result B
- ✅ Result C
```

---

## Embed in PR Description

### Recommended Structure

```markdown
# PR Title

## Overview
[Description of changes]

## Visual Proof: Before/After

### Before
![Before](docs/screenshots/PR-<NUMBER>-<description>/before.png)

### After
![After](docs/screenshots/PR-<NUMBER>-<description>/after.png)

## Detailed Screenshots

<details>
<summary>Click to see additional screenshots</summary>

### State 1
![State 1](docs/screenshots/PR-<NUMBER>-<description>/state-1.png)

### State 2
![State 2](docs/screenshots/PR-<NUMBER>-<description>/state-2.png)

</details>

## Screenshot Documentation

📸 [View all screenshots](docs/screenshots/PR-<NUMBER>-<description>/README.md)
```

---

## Tips for Best Presentation

1. **Use collapsible sections** (`<details>`) for detailed flows to keep PR description concise
2. **Lead with before/after** comparison for immediate visual impact
3. **Add brief captions** under each screenshot explaining what it shows
4. **Group related screenshots** together (e.g., all error states)
5. **Use tables** for side-by-side feature comparisons

---

## Alternative: Image Gallery

For a more visual approach:

```markdown
## Screenshot Gallery

| Before | After |
|--------|-------|
| ![Before](docs/screenshots/PR-<NUMBER>-<description>/before.png) | ![After](docs/screenshots/PR-<NUMBER>-<description>/after.png) |

### Detailed States
| State 1 | State 2 | State 3 |
|---------|---------|---------|
| ![](docs/screenshots/PR-<NUMBER>-<description>/state-1.png) | ![](docs/screenshots/PR-<NUMBER>-<description>/state-2.png) | ![](docs/screenshots/PR-<NUMBER>-<description>/state-3.png) |
```

---

## Direct Image URLs (for GitHub)

If you need to reference images by URL, use this pattern:

```
https://github.com/jmhthethird/frog_automation/raw/<branch>/docs/screenshots/PR-<NUMBER>-<description>/before.png
https://github.com/jmhthethird/frog_automation/raw/<branch>/docs/screenshots/PR-<NUMBER>-<description>/after.png
```

Replace `<branch>` with your branch name, `<NUMBER>` with your PR number, and `<description>` with the directory name.

---

**Pro Tip:** Preview your PR description locally using a Markdown viewer to ensure images display correctly before publishing!
