---
name: learn-write
description: Execute approved /learn write operations to .pi/learnings/. Use when you have reviewed and approved proposed changes from a learn session and are ready to commit them to disk. Handles creating directories, writing summaries, principles, relationships, and regenerating README.md.
---

# Learn Write

Execute the write phase of a `/learn` session. Use this when proposed changes to `.pi/learnings/` have been reviewed and approved.

Read the approved proposals from the current conversation, then execute all writes in order.

If the conversation does not contain a clear set of approved proposals, ask the user to confirm what should be written before proceeding.

## Step 1 — Prepare metadata

```
date +%Y-%m-%d
```

## Step 2 — Create directories if absent

```
mkdir -p .pi/learnings/principles .pi/learnings/summaries .pi/learnings/relationships
```

## Step 3 — Migrate from `observations/` if present

If `.pi/learnings/observations/` exists:

```
ls .pi/learnings/observations/ 2>/dev/null
```

For each observation file found, count summaries citing its ID:

```
grep -rl "\[<observation-id>\]" .pi/learnings/summaries/ 2>/dev/null | wc -l
```

Count ≥ 3: copy to `.pi/learnings/principles/<id>.md`.  
Count < 3: leave it.

## Step 4 — Write the session summary

Write to `.pi/learnings/summaries/<date>-<goal-slug>.md`:

```
---
session-id: <current-session-id>
goal: "<session goal>"
date: <date>
---
<Narrative prose. Cite [principle-id] for established codebase patterns.
Cite [relationship-id] directly for themes that do not yet have a principle.>
```

## Step 5 — Write codebase principle files

Write each approved principle to `.pi/learnings/principles/<id>.md`:

```
---
id: <id>
instance-of: <relationship-id>
links-to: []
---
<prose with exact names>
```

Rewrite any renamed or revised existing principle files. Update all summary citations that used the old ID.

## Step 6 — Write relationship files

Write each approved new or revised relationship to `.pi/learnings/relationships/<id>.md`.

Update the `used-in` field of source relationships for any new corollaries.

## Step 7 — Write AGENTS.md additions

If any standing rule candidates were approved, append them to `.pi/AGENTS.md` (or the project root `AGENTS.md`). Create the file if absent.

## Step 8 — Regenerate README.md

For every principle file in `.pi/learnings/principles/`:
1. Extract the ID from the filename.
2. Count summaries citing it: `grep -rl "\[<id>\]" .pi/learnings/summaries/ 2>/dev/null | wc -l`
3. Read its `instance-of` and first sentence of prose.

For every relationship with no corresponding principle file, count summaries citing the relationship ID directly: `grep -rl "\[<rel-id>\]" .pi/learnings/summaries/ 2>/dev/null | wc -l`

Write `.pi/learnings/README.md`:

```
## Codebase Principles

### <relationship-id>
(one entry per principle grouped under its instance-of relationship,
sorted by citation count descending)
- [<principle-id>] — <first sentence>  · <N> sessions

### User preferences
(meta-scoped principles — no parent relationship)
- [<principle-id>] — <first sentence>  · <N> sessions

## Relationships (no principle yet)
(relationships cited in summaries but with no corresponding principle, sorted by highest count desc)
- <relationship-id> — <N>/3 sessions
```

Only write what the approved proposals contain. Do not invent entries.
