---
name: threshold-check
description: Audit .pi/learnings/ to show which relationships are accumulating citation counts toward the ≥3 principle threshold. Shows a sorted table of counts with status indicators. No writes performed.
---

# Threshold Check

Audit `.pi/learnings/` to see which relationships are building toward principle status. No writes.

## Step 1 — Read the README

```
cat .pi/learnings/README.md 2>/dev/null
```

If `.pi/learnings/` does not exist or the README is absent, note that and stop — there is nothing to audit.

Extract all relationship IDs from:
- `## Codebase Principles` — the heading names are relationship IDs
- `## Relationships (no principle yet)` — listed directly

Also check for relationship files not yet in the README:

```
ls .pi/learnings/relationships/ 2>/dev/null
```

## Step 2 — Count citations

For each relationship ID:

```
grep -rl "\[<relationship-id>\]" .pi/learnings/summaries/ 2>/dev/null | wc -l
```

Also check for each relationship whether a corresponding principle file exists:

```
ls .pi/learnings/principles/ 2>/dev/null
```

## Step 3 — Present results

Show a table sorted by citation count descending:

```
Relationship ID                     Citations   Status
-------------------------------------------------------
<relationship-id>                   4           ✓ has principle
<relationship-id>                   3           ! threshold met — no principle yet
<relationship-id>                   2           → approaching (1 more session)
<relationship-id>                   1           · started
```

Status meanings:
- `✓ has principle` — ≥3 citations and a principle file exists; graph is up to date
- `! threshold met — no principle yet` — ≥3 citations but no principle file; candidate for `/learn` or `/skill:draft-relationship`
- `→ approaching` — 2 citations; one more session will hit the threshold
- `· started` — 1 citation

This skill performs no writes. To formalize a threshold-met relationship as a principle, use `/skill:draft-relationship` or run `/learn`.
