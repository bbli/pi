---
name: query-learnings
description: Query the local project's .pi/learnings/ graph to surface relevant relationships and codebase principles for the current goal. Use when starting an investigation, before diving into implementation, or when the learnings graph should inform the next step.
---

# Search Relationships and Codebase Principles

The learnings graph has two layers:

- **Relationships** (`relationships/`) - portable methods encoding how the user approaches a type of problem. The abstract *thinking frame*.
- **Codebase Principles** (`principles/`) — concrete recurring patterns specific to this codebase: exact files, log tags, counters, gotchas. Each has an `instance-of` field naming its parent relationship (optional) and a `links-to` list of related principles.

## Algorithm

```
queryLearnings(goal, [
  step(1, "ls relationships/"),              // → relationship IDs only; no principles, no anchoring bias
  step(2, "Choose relevant relationships",   // → read each relevant relationship file
    read(relationships/<id>),
    bfs(links-to, relevant-only),              // CRITICAL: follow relevant links-to entries; stop when expansion yields no new understanding
  ),
  step(3, "Grep codebase principles",        // → concrete artifacts for the chosen relationships
    grep(instance-of: <rel-id>),             //   pass A: principles linked to chosen relationships
    grep(keywords-from-goal),                //   pass B: broader sweep for cross-cutting principles
  ),
  step(4, "Synthesize",
    check(exactMatch || modifications),      // exact: apply directly; modifications: adapt
    inject(suggestion),
  ),
])
```

---

## Step Details

### Step 1 - ls relationships/

> **Note:** `.pi/learnings/` is the **local project's** learnings directory — relative to the project working directory, not the pi installation. All bash commands below use `$(pwd)/.pi/learnings/` to make this explicit.

```
ls "$(pwd)/.pi/learnings/relationships/" 2>/dev/null
```

This lists relationship IDs only — no codebase principles, no concrete artifact names. Identify which relationships are relevant to the current goal based on their names alone. If `$(pwd)/.pi/learnings/` does not exist or the relationships directory is absent, proceed without the graph and note the absence.

### Step 2 - Choose relevant relationships

For each relevant relationship ID identified in Step 1, read the relationship file:

```
cat "$(pwd)/.pi/learnings/relationships/<id>.md"
```

Read to understand what the method does and whether it fits the current situation. Select the relationships that apply.

> **CRITICAL — goal-directed BFS expansion over `links-to`.** After reading the initial set of relevant relationships, inspect the `links-to` field in each one's frontmatter. For each linked ID, judge whether it appears relevant to the current goal given what you have read so far — if so, read it:
>
> ```
> cat "$(pwd)/.pi/learnings/relationships/<linked-id>.md"
> ```
>
> Add relevant newly-read relationships to the frontier and repeat for their `links-to` entries in turn. Stop expanding when the frontier yields no linked IDs that add to your understanding of the goal — when linked names either name methods already covered or are clearly outside the goal's scope. This is a judgment call, not a full traversal; stop when the picture is clear.

### Step 3 - Grep codebase principles

Two passes — run both:

**Pass A — by relationship ID.** Find principles that are instances of the chosen relationships:

```
grep -rl "instance-of: <rel-id>" "$(pwd)/.pi/learnings/principles/" 2>/dev/null
```

Run once per chosen relationship ID. Read each matching principle file.

**Pass B — by keyword.** Find principles relevant to the goal regardless of relationship linkage:

```
grep -ril "<keyword>" "$(pwd)/.pi/learnings/principles/" 2>/dev/null
```

Use 2–3 keywords drawn from the goal (component names, action verbs, artifact names). Read any principle files not already found in Pass A.

### Step 4 - Synthesize

With the relationships and principles in hand, determine how to apply the findings:

- **Direct match** — the relationships and principles apply directly. Apply the methods with the concrete artifacts as-is.
- **Modifications needed** — the relationships and principles apply but need adaptation. Use the relationship methods with the concrete artifacts from the principles, adjusting for differences the current situation introduces.

**Scope-alignment check for Pass B hits.** Principles surfaced by keyword match (Pass B) may share vocabulary with the goal without being scoped to the component under investigation. Before recommending a Pass B principle, verify that the component or service being investigated appears in the principle's emitter list, file paths, or named scope. If the principle names specific emitters and the component under investigation is not among them, do not surface it — a keyword match on "space" or "shared" is not sufficient grounds to recommend a tag emitted only by gc_rewriter or medium_cleanup_worker when the failing component is shared_space_worker.

State what applies directly, what would need adaptation for the current context, and any gaps where `researchConversationQuestion` would be needed. The calling prompt determines what to do with these findings.
