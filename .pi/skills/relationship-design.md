---
name: relationship-design
description: Designing relationships and observations for .pi/learnings/. Use when proposing, reviewing, or writing entries in the learnings graph.
---

# Relationship and Observation Design

The learnings graph has two complementary layers. A **relationship** says what to do; an **observation** says what to look at when doing it in a specific codebase. Always read both together when consulting the graph.

---
## observations/

Observations are atomic knowledge nodes — individual facts, scoped methods, prerequisites, exceptions, or triggers discovered about this codebase. Each has its own ID and a typed connection to a relationship (or no connection yet if the abstract relationship isn’t evident).

Observations serve as **tags on summaries**. When a session summary cites an observation ID, it marks that session as one where that observation was relevant. This tagging is what enables promotion: an observation cited in 3 or more summaries earns a place in the README as established codebase knowledge.

### Format

```
---
id: kebab-case-id
relation: instance-of
relates-to: relationship-id    # can be empty if abstract relationship not yet evident
---
Prose describing the concrete fact, method, or scoping knowledge.
Use exact names: log tags, file paths, function names, counter names.
```

### Connection types

The `relation` field describes how this observation connects to its relationship:

**instance-of** — the observation IS the relationship applied to this codebase: the concrete artifact, log tag, or procedure that makes the abstract method executable here.
> `relates-to: interleave-expected-vs-actual-timeline`
> "use `rg UNIT_TEST` under the test’s component tag for expected steps, `rg space_tuples_trace` for actual ops; sort both by timestamp and diff"

**prerequisite-for** — something that must be true or done before the relationship’s method works in this codebase. The method silently fails without it.
> `relates-to: interleave-expected-vs-actual-timeline`
> "`space_tuples_trace` is only emitted when gc_rewriter is initialised with `--debug-space`; confirm that flag is set before grepping or the actual timeline will appear empty"

**exception-to** — a context where the relationship’s method breaks down or gives misleading results.
> `relates-to: interleave-expected-vs-actual-timeline`
> "in the snapshots cleanup path, `space_tuples_trace` timestamps are coarse (1s resolution) — interleaving by timestamp is unreliable here; use event sequence IDs instead"

**trigger-for** — the codebase-specific signal that indicates the relationship’s method should be applied.
> `relates-to: interleave-expected-vs-actual-timeline`
> "when `space_hazard` appears alongside an unexpected test failure, accounting has diverged — this is the entry condition for the interleave method"

**composes** — a recipe that combines two or more relationships into a unified procedure specific to this codebase. `relates-to` is a list.
> `relates-to: [read-test-callpath-for-expected-sequence, interleave-expected-vs-actual-timeline]`
> "grep `PS_DIAG_INFO UNIT_TEST` under the test’s root tag for expected; grep `space_tuples_trace` for actual; merge on component tag and sort by step number"

### File naming

`observations/<id>.md` — the filename is the observation ID. Observations are shared across sessions and not session-scoped.

### How to Write Good Observations

**Ground in real names.** Use exact names throughout — log tags, file paths, function names, counter names. An observation that says “check `space_tuples_trace`” is useful; one that says “check the relevant trace file” is not.

**Use the right connection type.** The `relation` field shapes how a future agent uses the observation. An `instance-of` tells the agent what to do; a `prerequisite-for` tells it what to check first; an `exception-to` tells it when to stop; a `trigger-for` tells it when to start; a `composes` gives it a ready-made recipe. Choosing the wrong type misfires the observation at search time.

**The portability test (what fails it is an observation).** Replace all codebase-specific proper nouns in a candidate entry with generic placeholders. If it collapses — if you can’t say what to do without naming the specific tag or file — it belongs here, not in a relationship file.

---
## summaries/

Session summaries are narrative records of what happened in a learn session. They cite observation IDs and relationship IDs inline in their prose — observation citations are the tagging mechanism that links the session to the graph; relationship citations provide abstract context for the narrative.

### Format

```
---
session-id: <current-session-id>
goal: "the session goal"
date: YYYY-MM-DD
---
Narrative prose describing what happened. Cite observation IDs [observation-id] for
specific facts applied or discovered. Cite relationship IDs [relationship-id] for
abstract methods that framed the work.
```

### File naming

`summaries/<date>-<goal-slug>.md`

---
## relationships/

The user's debugging methods, heuristics, and approaches, captured as transferable principles. A relationship encodes what the user reaches for when facing a type of problem: which sources of evidence they consult first, in what order, and how they combine them. It should answer the question "what would this user do next?" when a future agent faces the same type of problem.

A relationship is not a correction to agent behavior. Do not record "the agent should not commit to hypotheses without verifying X" - that is a behavioral patch, not a method. Record instead the positive method the user demonstrated or described: "when debugging Y, do Z."

**Good test:** would this relationship help a future agent debug the same problem the same way the user would? If yes, it belongs here. If it only helps the agent avoid a past mistake, it does not belong here.

### Format

```
---
id: kebab-case-identifier
links-to: []
used-in: []
corollary-of: []        # optional: source relationship IDs this was derived from
composition: sequential  # optional: sequential | conjunctive | conditional | fallback
---
Rich prose stating the relationship. Use real codebase names where they ground the
abstraction - but the claim itself should be portable: another agent on another session
should recognise it as applying when the same pattern appears.
```

### Fields

- `id` - kebab-case, using vocabulary from the codebase and conversation. Choose names that describe a debugging action or workflow, not an agent behavioral trait: `interleave-expected-vs-actual-timeline`, `read-test-callpath-for-expected-sequence`, `check-counter-names-before-asserting`.
- `links-to` - IDs of tangentially related relationships worth reading alongside this one. Composition is in the prose.
- `used-in` - IDs of corollaries derived from this relationship.
- `corollary-of` - source relationship IDs this was derived from by composition. Present only on corollary relationships.
- `composition` - the pattern used to derive this corollary: `sequential`, `conjunctive`, `conditional`, or `fallback`. Present only on corollary relationships.

### How to Write Good Relationships

**Source is user demonstrations, not agent corrections.** When the user corrects the agent, it tells you the agent was wrong. When the user demonstrates how they would approach a problem, it tells you their method. Only the second produces a relationship. The practical filter: before writing a relationship, ask "what did the user do here?" not "what did the agent fail to do?" If the answer is "the user described a debugging workflow," write it. If the answer is "the user said the agent was wrong about X," don't — that's a local correction, not a transferable method.

**Relationships tell you what to do without codebase lookup.** A relationship should be immediately applicable on a new codebase knowing only the method. If understanding the relationship requires knowing a specific log tag or file name, it's not a relationship — it's an observation that lost its relationship ID citation. The method and the codebase-specific artifact compose: the relationship supplies the method, the observation supplies the artifact.

**The portability test (what survives it is a relationship).** Replace all codebase-specific proper nouns in a candidate entry with generic placeholders. If the statement is still meaningful and actionable, it's a relationship. If it collapses, it belongs in observations. Boundary cases — entries that partially survive — should default to an observation line under the parent relationship. A separate relationship file is only justified when the entry needs its own graph structure because other relationships reference it.

**Evidence threshold.** A relationship gains credibility when corroborated by an existing observation - finding a similar pattern in a past session's observation file is a strong signal that the relationship generalises. A single occurrence can still justify a new relationship when the method is clearly described and well-understood; use judgment. When evidence is thin, say so in the prose.

**Ground in real names.** Use real file names, function names, and component names in the prose where they ground the abstraction. The claim itself should remain portable - real names are examples, not constraints. A relationship that names `space_tuples_trace` to illustrate an interleaving method is more useful than one that says "check the relevant trace file."

**Illustrative conditions, not hard rules.** Relationship prose should include examples of when the method applies and, ideally, when it does not. Without non-examples, a future agent over-applies the relationship to situations it was not designed for. The examples calibrate - they are not a decision tree.

**Single claim per relationship.** Each relationship file should capture one method or approach. Bundling multiple methods into a single file makes it hard to cite selectively and hard to grep for. If two methods often appear together, capture them in separate files and link them via `links-to`.

---
## Corollaries

Corollaries are relationships derived by composing existing ones — combining verified, specific principles to produce new knowledge that wasn’t directly demonstrated. They are safer than generalisation: you are not extrapolating beyond what is known, you are combining what is already established.

A corollary that survives the portability test becomes a relationship file with `corollary-of` and `composition` in its frontmatter, recording how it was derived. The source relationships’ `used-in` fields are updated to point to the new corollary.

### Sequential (A → B)

The output of A becomes the input to B. Apply A first; its result is what B operates on. Neither is useful without the other in order.

> A: *read-test-callpath-for-expected-sequence* → produces: ordered list of expected operations
> B: *interleave-expected-vs-actual-timeline* → takes: expected list + actual list
> Corollary: “get the expected sequence from the test callpath, then feed it directly into the interleave method”

To identify: A produces something B requires as input. They have been applied in the same sessions, in order.

### Conjunctive (A + B → C)

A and B run independently; C requires both outputs simultaneously before it can proceed. Neither A nor B depends on the other, but C cannot start without both.

> A: *read-test-callpath-for-expected-sequence* → produces: expected ops
> B: *grep-actual-ops-from-trace* → produces: actual ops
> Corollary C: diff and interleave → produces: divergence point

To identify: A and B address the same problem from different angles and their outputs are combined in a third step.

### Conditional (A → B if P, else C)

A identifies which method to apply. The raw material is a `trigger-for` observation establishing when B applies, paired with an `exception-to` observation establishing when B does not — and an alternative relationship C that covers the exception case.

> trigger-for B: “`space_hazard` appears alongside test failure → apply interleave method”
> exception-to B: “coarse timestamps in snapshots cleanup path → interleave unreliable”
> C: *interleave-by-event-sequence-id*
> Corollary: if `space_hazard` present and not in snapshots cleanup path → B; else → C

To identify: a `trigger-for` and an `exception-to` on the same relationship, with a second relationship covering the exception case.

### Fallback (A, then B if A yields nothing)

Apply A; if A produces no useful result, apply B. An `exception-to` observation directly signals this: it defines when A breaks down, and B is the relationship that handles that case.

> A: *interleave-by-timestamp*
> exception-to A: “coarse timestamps in snapshots cleanup path make this unreliable”
> B: *interleave-by-event-sequence-id*
> Corollary: try A; if timestamp resolution is insufficient, switch to B

To identify: an `exception-to` observation on A paired with a relationship B that handles the exceptional case A cannot.

### When to derive corollaries

After gathering and filtering relationships during triangulation, check whether any of the four patterns apply to the relationships now in view:

- Do any two relationships form a chain where A’s output is B’s input? → sequential
- Do any two relationships address the same problem from different angles, with outputs that combine? → conjunctive
- Does a `trigger-for` or `exception-to` observation on one relationship pair it with an alternative? → conditional or fallback

Propose derived corollaries alongside demonstrated relationships. The `composition` field is the evidence for how they were derived.
