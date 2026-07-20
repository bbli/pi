---
name: search-relationships-and-observations
description: Querying the learnings graph at .pi/learnings/. Use when finding relevant relationships, observations, and summaries for a current task, situation, or set of patterns.
---

# Search Relationships and Observations

The learnings graph has three layers, each serving a different role:

- **Relationships** (`relationships/`) — the *thinking frame*: portable methods encoding how the user approaches a type of problem.
- **Observations** (`observations/`) — *typed codebase knowledge*: atomic facts connecting abstract methods to concrete artifacts in this project. Each observation has a `relation` field (instance-of, prerequisite-for, exception-to, trigger-for, composes) and a `relates-to` field naming its parent relationship.
- **Summaries** (`summaries/`) — *session narrative records*: historical context showing when and how knowledge was applied. Summaries tag observations and relationships by citing their IDs inline in prose.

Observations answer "what does this relationship look like in this codebase?" Summaries answer "when was this knowledge relevant and what was happening around it?"

---

## Traversal Sequence

### Step 1 — Orient via the README

```
cat .pi/learnings/README.md 2>/dev/null
```

The README has two sections:

- **Established** — promoted observations (≥3 summary citations), grouped under their parent relationship with connection type noted. Meta-scoped observations (user preferences, no parent relationship) listed at the end.
- **Accumulating** — relationships that have observations but none yet promoted, with citation count (e.g. 2/3).

Identify relevant relationship IDs from both sections. If `.pi/learnings/` does not exist or the README is absent, proceed without the graph and note the absence.

### Step 2 — Read relationships

```
cat .pi/learnings/relationships/<id>.md
```

For each relevant relationship, read the full file. This gives the abstract frame: what the pattern means, what move it calls for, when it applies and when it does not.

### Step 3 — Clarify frame (when abstract reasoning is ambiguous)

If no clear frame emerges after reading the relationships:

1. Scan observations broadly for terms relevant to the current situation:
   ```
   grep -r "<term>" .pi/learnings/observations/ 2>/dev/null
   ```
2. Scan recent summaries for similar problems:
   ```
   ls -t .pi/learnings/summaries/*.md 2>/dev/null | head -5
   ```
   Read the most relevant ones.

Use the concrete evidence to select the right relationship or narrow to a candidate, then return to Step 2.

### Step 4 — Search observations

```
grep -rl "relates-to: <relationship-id>" .pi/learnings/observations/ 2>/dev/null
```

Read each matching observation file. The `relation` field tells you how to use it:

- `instance-of` — what to do in this codebase: the concrete artifact, log tag, or procedure
- `prerequisite-for` — what to check or enable first; the method silently fails without it
- `exception-to` — when this method breaks down or misleads; signals a fallback may be needed
- `trigger-for` — the codebase-specific signal that indicates this method should be applied
- `composes` — a ready-made recipe combining multiple relationships (check `relates-to` list for components)

Promoted observations are already summarised in the README; non-promoted ones here may add detail not yet surfaced.

### Step 5 — Search summaries

```
grep -rl "\[<relationship-id>\]" .pi/learnings/summaries/ 2>/dev/null
grep -rl "\[<observation-id>\]" .pi/learnings/summaries/ 2>/dev/null
```

Read matching summaries for narrative context: when this knowledge was relevant, what the surrounding situation looked like, how it played out in practice.

### Step 6 — Derive corollaries (goal-directed)

Given the current goal, check whether any of the gathered relationships compose into a more direct procedure for achieving it. Only derive a corollary if the composition produces something actionable toward the goal — not as a general reasoning exercise.

Check the four patterns:

- **Sequential (A → B)** — does A's output feed directly into B?
- **Conjunctive (A + B → C)** — do A and B run independently and combine for C?
- **Conditional (A → B if P, else C)** — does a `trigger-for` observation establish when B applies, and an `exception-to` plus alternative relationship C cover the remaining case?
- **Fallback (A, then B if A yields nothing)** — does an `exception-to` on A pair with a relationship B that handles the case A cannot?

Apply the derived procedure if the pattern is clear. Note as a candidate for the next learn session if the corollary appears genuinely new.

### Step 7 — Expand

Follow `links-to`, `used-in`, and `corollary-of` fields on relationships selectively. Stop when the picture is clear — this is a judgment call, not a full traversal.
