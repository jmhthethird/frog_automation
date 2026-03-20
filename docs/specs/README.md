# Specification Documents

This directory contains specification documents for multi-session features that span multiple agent contributions on a shared feature branch.

## Purpose

When a feature requires multiple agent sessions to complete (e.g. combining seo-automation functionality into frog_automation), each session should:

1. **Read** any existing specs before making changes to understand the full plan.
2. **Write** a spec when starting a new multi-session feature, describing:
   - **Goal**: What the feature accomplishes
   - **Affected files**: Which files will be modified
   - **Acceptance criteria**: How to verify the feature is complete
   - **Current status**: What has been done, what remains
3. **Update** the spec after completing work to reflect current status.

## Naming Convention

```
docs/specs/<feature-name>.md
```

Examples:
- `docs/specs/combine-seo-automation.md`
- `docs/specs/reports-backend.md`
- `docs/specs/unified-settings.md`

## Template

```markdown
# Feature: <name>

## Goal
<one-paragraph description>

## Affected Files
- `public/index.html` — <what changes>
- `src/routes/foo.js` — <what changes>

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Status
- [x] Completed step
- [ ] Remaining step
```
