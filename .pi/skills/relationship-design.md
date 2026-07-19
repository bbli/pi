---
name: relationship-design
description: Designing relationships and observations for .pi/learnings/. Use when proposing, reviewing, or writing entries in the learnings graph.
---

# Relationship and Observation Design

The learnings graph has two complementary layers. A **relationship** says what to do; an **observation** says what to look at when doing it in a specific codebase. Always read both together when consulting the graph.

---

## relationships/

The user's debugging methods, heuristics, and approaches, captured as transferable principles. A relationship encodes what the user reaches for when facing a type of problem: which sources of evidence they consult first, in what order, and how they combine them. It should answer the question "what would this user do next?" when a future agent faces the same type of problem.

A relationship is not a correction to agent behavior. Do not record "the agent should not commit to hypotheses without verifying X" — that is a behavioral patch, not a method. Record instead the positive method the user demonstrated or described: "when debugging Y, do Z."

**Good test:** would this relationship help a future agent debug the same problem the same way the user would? If yes, it belongs here. If it only helps the agent avoid a past mistake, it does not belong here.

### Format

```
---
id: kebab-case-identifier
links-to: []
used-in: []
---
Rich prose stating the relationship. Use real codebase names where they ground the
abstraction — but the claim itself should be portable: another agent on another session
should recognise it as applying when the same pattern appears.
```

### Fields

- `id` — kebab-case, using vocabulary from the codebase and conversation. Choose names that describe a debugging action or workflow, not an agent behavioral trait: `interleave-expected-vs-actual-timeline`, `read-test-callpath-for-expected-sequence`, `check-counter-names-before-asserting`.
- `links-to` — IDs of tangentially related relationships worth reading alongside this one. Composition is in the prose.
- `used-in` — IDs of corollaries derived from this relationship.

---

## observations/

The codebase-specific knowledge that makes each relationship actionable in this codebase. Where a relationship says what to do (read the test callpath for expected state), an observation says what to look at (which log tags, which files, which counter names). Observations are not session records — they are the concrete facts: which components emit which log tags, which files contain which mechanisms, which counter names to check.

Each observation is a **single line** (no line breaks) so that grep returns the full statement in one match. Relationship IDs are cited inline in the prose in brackets — they are not line headers. This is what makes observations searchable: a future agent grepping for a relationship ID will find the concrete codebase knowledge associated with it.

### Format

```
---
goal: "the session goal"
---

In this codebase, when checking space accounting, read the callpath under the relevant test to get the expected operation sequence [read-test-callpath-for-expected-sequence], then grep space_tuples_trace for the actual sequence and interleave them line by line to find where they diverge [interleave-expected-vs-actual-timeline].
```

Note: each line is a concrete statement about how this codebase works, with the relationship ID cited in brackets within the prose. The ID is what makes the line greppable; the prose is what makes it useful.

### File naming

`observations/<date>-<goal-slug>.md` — date in `YYYY-MM-DD` format, goal slug in kebab-case derived from the session goal.

---

## Evaluation and Proposal

For each observation or pattern under consideration, decide:

- Does an existing relationship capture the abstract idea? Does it need revision?
- Is this a gap requiring a new relationship?
- What concrete codebase knowledge should become an observation line?
- Does any newly proposed relationship apply retroactively to existing observation lines?

Present the following clearly and wait for explicit approval before writing anything:

1. **New relationships** — complete file content (frontmatter + prose) for each new relationship.
2. **Revised relationships** — updated prose for any existing relationship being revised, with a note on what changed and why.
3. **New observation lines** — the single-line codebase knowledge statements, with relationship IDs cited inline.
4. **Retroactive citations** — any relationship ID citations to be added inline to lines in past observation files, with the target filename and the updated line.

---

## Principles

**Evidence threshold.** A relationship gains credibility when corroborated by an existing observation — finding a similar pattern in a past session's observation file is a strong signal that the relationship generalises. A single occurrence can still justify a new relationship when the method is clearly described and well-understood; use judgment. When evidence is thin, say so in the prose.

**Ground in real names.** Use real file names, function names, and component names in the relationship prose where they ground the abstraction. The claim itself should remain portable — real names are examples, not constraints. A relationship that names `space_tuples_trace` to illustrate an interleaving method is more useful than one that says "check the relevant trace file."

**Illustrative conditions, not hard rules.** Relationship prose should include examples of when the method applies and, ideally, when it does not. Without non-examples, a future agent over-applies the relationship to situations it was not designed for. The examples calibrate — they are not a decision tree.

**Single claim per relationship.** Each relationship file should capture one method or approach. Bundling multiple methods into a single file makes it hard to cite selectively and hard to grep for. If two methods often appear together, capture them in separate files and link them via `links-to`.
