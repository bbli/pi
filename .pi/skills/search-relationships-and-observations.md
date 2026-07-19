---
name: search-relationships-and-observations
description: Querying the learnings graph at .pi/learnings/. Use when finding relevant relationships and observations for a current task, situation, or set of patterns.
---

# Search Relationships and Observations

The learnings graph at `.pi/learnings/` has two layers that serve different roles:

- **Relationships** (`relationships/`) are the *thinking frame* — abstract patterns encoding how this user approaches a type of problem: which evidence to consult first, in what order, and how to combine it.
- **Observations** (`observations/`) are the *domain content* — concrete, codebase-specific records of how each pattern has manifested in this project: which files, components, and interactions are the real terrain.

Use relationships to frame and classify a situation. Use observations to make it specific and actionable for this codebase. The two layers combine: the abstract frame from relationships filled in with the concrete detail from observations.

---

## Traversal Sequence

Apply the following four steps in order. Each step builds on the last.

### 1. Orient via the README

```
cat .pi/learnings/README.md 2>/dev/null
```

The README lists relationships ordered by how frequently they appear in observations, with a one-sentence summary for each. Identify which relationship IDs are most relevant to the current situation or patterns.

If `.pi/learnings/` does not exist or the README is absent, proceed without the graph and note the absence.

### 2. Read the relevant relationship files in full

```
cat .pi/learnings/relationships/<id>.md
```

For each relationship identified in Step 1, read the full file. This gives you the thinking frame: what the pattern means, how the user reasons about it, and what kind of move it calls for.

### 3. Selectively expand via links-to and used-in

Each relationship's frontmatter has two fields:

- `links-to` — tangentially related relationships worth reading alongside this one
- `used-in` — corollaries derived from this relationship that may apply more directly

Read the ones that sharpen the frame. Stop when the picture is clear — this is a judgment call, not a full traversal.

### 4. Grep observations by relationship ID

```
grep "<id>" .pi/learnings/observations/*.md 2>/dev/null
```

Each match is a single line — the complete record of how that pattern played out in a past session. Read it for codebase-specific detail: which files or components, what the user's intervention looked like, what the outcome was.

If no lines match for a given relationship ID, proceed with the relationship definition alone — the abstract frame is still useful without concrete examples.
