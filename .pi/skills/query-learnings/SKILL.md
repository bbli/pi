---
name: query-learnings
description: Query the local project's .pi/learnings/ graph to surface relevant relationships, codebase principles, and session summaries for the current goal. Use when starting an investigation, before diving into implementation, or when the learnings graph should inform the next step.
---

# Search Relationships and Codebase Principles

The learnings graph has three layers:

- **Relationships** (`relationships/`) - portable methods encoding how the user approaches a type of problem. The abstract *thinking frame*.
- **Codebase Principles** (`principles/`) — concrete recurring patterns specific to this codebase: exact files, log tags, counters, gotchas. Each has an `instance-of` field naming its parent relationship (optional) and a `links-to` list of related principles.
- **Summaries** (`summaries/`) - observed traversals: how relationships were sequenced and composed to solve a specific problem. The empirical record of which compositions worked, in what order, and where pivots occurred.

## Algorithm

```
queryLearnings(goal, [
  step(1, "Read README"),                    // → all relationships and principles visible at once
  step(2, "Choose relevant relationships",   // → read each relevant relationship file
    read(relationships/<id>),
  ),
  step(3, "Grep codebase principles",        // → concrete artifacts for the chosen relationships
    grep(instance-of: <rel-id>),             //   pass A: principles linked to chosen relationships
    grep(keywords-from-goal),                //   pass B: broader sweep for cross-cutting principles
  ),
  step(4, "Grep summaries"),                 // → ls summaries/ then read by filename relevance
  step(5, "Synthesize",
    check(exactMatch || modifications),      // exact: apply directly; modifications: adapt
    inject(suggestion),
  ),
])
```

---

## Step Details

### Step 1 - Read README

> **Note:** `.pi/learnings/` is the **local project's** learnings directory — relative to the project working directory, not the pi installation. All bash commands below use `$(pwd)/.pi/learnings/` to make this explicit.

```
cat "$(pwd)/.pi/learnings/README.md" 2>/dev/null
```

The README has two sections:

- **Codebase Principles** - principles grouped under their parent relationship. Meta-scoped principles (user preferences, no parent relationship) listed at the end.
- **Relationships (no principle yet)** - relationships cited in summaries below the ≥3 threshold, with citation count.

From both sections, identify relationship IDs relevant to the current goal. If `$(pwd)/.pi/learnings/` does not exist or the README is absent, proceed without the graph and note the absence.

### Step 2 - Choose relevant relationships

For each relevant relationship ID identified in Step 1, read the relationship file:

```
cat "$(pwd)/.pi/learnings/relationships/<id>.md"
```

Read to understand what the method does and whether it fits the current situation. Select the relationships that apply.

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

### Step 4 - Grep summaries

List available summaries and identify ones relevant by filename:

```
ls "$(pwd)/.pi/learnings/summaries/" 2>/dev/null
```

Read summaries whose filenames match the goal, the component under investigation, or the relationships chosen in Step 2. Summaries show which compositions worked, in what order, and where pivots occurred — an observed traversal for the same type of problem is the strongest signal available.

### Step 5 - Synthesize

With the relationships, principles, and summaries in hand, determine how to apply the findings:

- **Exact match** — a summary already records the same type of problem with the same relationships. Apply the traversal directly: the composition sequence, the concrete artifacts, and any pivots already carry the answer.
- **Modifications needed** — the relationships and principles apply but no summary is an exact match. Adapt: use the relationship methods with the concrete artifacts from the principles, adjusting for any differences the current situation introduces.

Produce the injection: a concrete, actionable suggestion grounded in what was found.
