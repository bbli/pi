---
name: draft-relationship
description: Draft and write a new relationship or codebase principle to .pi/learnings/ on demand, without running a full /learn session. Use when you observe a recurring pattern mid-session and want to capture it immediately, or when the user explicitly describes a method or principle they want recorded.
---

# Draft Relationship

Capture a new relationship or codebase principle to `.pi/learnings/` without running a full `/learn` session. Use when a pattern is clear enough to record now.

## Step 1 — Identify what to capture

From the current conversation, identify what the user wants to record. Classify it:

- **Relationship** — a portable debugging method or approach that would apply across codebases (once proper nouns are replaced with generics, the method still makes sense)
- **Codebase principle** — a concrete, codebase-specific fact: a specific log tag, file path, prerequisite, exception condition, or trigger signal tied to an existing or new relationship
- **Both** — a new relationship with a matching codebase principle

If unclear, ask the user before drafting.

## Step 2 — Draft the entry

### Relationship format

```
---
id: kebab-case-identifier
links-to: []
used-in: []
---
Rich prose stating the method. Use real file names and log tags to ground the abstraction,
but the method itself should be portable: another agent on another codebase should recognise
it when the same pattern appears.
```

**Quality rules for relationships:**
- Source is user demonstrations, not agent corrections. The user described or demonstrated a procedure — that's a relationship. The agent was corrected — that's not.
- The portability test: replace all codebase-specific proper nouns with generics. If the statement is still meaningful and actionable, it's a relationship. If it collapses, it belongs in a codebase principle.
- Single claim per file. One method or approach. Link related methods via `links-to`.
- Include illustrative conditions — when the method applies and, if possible, when it does not.
- Choose `id` names that describe a debugging action: `interleave-expected-vs-actual-timeline`, not `agent-should-check-timelines`.

### Codebase principle format

```
---
id: kebab-case-id
instance-of: <relationship-id>    # the relationship this instantiates; empty for meta-scoped
links-to: []                      # related principle IDs
---
Prose using exact names: log tags, file paths, function names, counter names.
```

**Quality rules for principles:**
- Ground in real names. A principle that says "check `space_tuples_trace`" is useful; "check the relevant trace file" is not.
- The portability test in reverse: if replacing proper nouns collapses the statement, it belongs here (not in a relationship).
- Append or link. If new information qualifies an existing principle (a caveat, prerequisite, exception), append it to that principle. Create a new file only when the information has a distinct subject other principles might independently reference.
- Scope: **codebase-scoped** (connects to a relationship via `instance-of`) or **meta-scoped** (user preferences, working style — leave `instance-of` empty).

## Step 3 — Check for existing entries

Before proposing, check whether an existing entry already covers this:

```
cat .pi/learnings/README.md 2>/dev/null
ls .pi/learnings/relationships/ 2>/dev/null
ls .pi/learnings/principles/ 2>/dev/null
```

If a close match exists: propose a revision to the existing file rather than a new one.

## Step 4 — Present and wait

Show the drafted content — full frontmatter + prose — and ask:

> Does this look right? Say **'write it'** to commit, or correct the content.

Do not write anything until the user confirms.

## Step 5 — Write

On approval:

1. Create directories if absent:
   ```
   mkdir -p .pi/learnings/principles .pi/learnings/relationships
   ```

2. Write the file(s).

3. If a relationship was added or revised, update the `used-in` field of any source relationships for new corollaries.

4. Regenerate `.pi/learnings/README.md`:

   For every principle file in `.pi/learnings/principles/`:
   - Extract the ID, count summaries citing it: `grep -rl "\[<id>\]" .pi/learnings/summaries/ 2>/dev/null | wc -l`
   - Read its `instance-of` and first sentence of prose.

   For every relationship with no corresponding principle, count summaries citing the relationship ID directly.

   Write `.pi/learnings/README.md`:

   ```
   ## Codebase Principles

   ### <relationship-id>
   - [<principle-id>] — <first sentence>  · <N> sessions

   ### User preferences
   - [<principle-id>] — <first sentence>  · <N> sessions

   ## Relationships (no principle yet)
   - <relationship-id> — <N>/3 sessions
   ```
