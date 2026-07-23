/**
 * Relationship design procedure embedded from .pi/skills/relationship-design.md.
 * Describes the schema and guidelines for codebase principles, relationships, and corollaries.
 */
export const RELATIONSHIP_DESIGN_SKILL_TEXT = `\
# Relationship and Codebase Principle Design

The learnings graph has two complementary layers. A **relationship** says what to do; a **codebase principle** says what to look at when doing it in a specific codebase. Always read both together when consulting the graph.

---
## principles/

Codebase principles are concrete, recurring patterns discovered in this codebase — specific facts, scoped methods, prerequisites, exceptions, or triggers that have appeared as the same specific codebase-level pattern in ≥3 sessions. Each has its own ID and a typed connection to a relationship.

Codebase principles serve as **tags on summaries**. When a session summary cites a principle ID, it marks that session as one where that principle was relevant.

### Format

\`\`\`
---
id: kebab-case-id
relation: instance-of
relates-to: relationship-id    # can be empty if abstract relationship not yet evident
---
Prose describing the concrete fact, method, or scoping knowledge.
Use exact names: log tags, file paths, function names, counter names.
\`\`\`

### Connection types

The \`relation\` field describes how this principle connects to its relationship:

**instance-of** — the principle IS the relationship applied to this codebase: the concrete artifact, log tag, or procedure that makes the abstract method executable here.
> \`relates-to: interleave-expected-vs-actual-timeline\`
> "use \`rg UNIT_TEST\` under the test’s component tag for expected steps, \`rg space_tuples_trace\` for actual ops; sort both by timestamp and diff"

**prerequisite-for** — something that must be true or done before the relationship’s method works in this codebase. The method silently fails without it.
> \`relates-to: interleave-expected-vs-actual-timeline\`
> "\`space_tuples_trace\` is only emitted when gc_rewriter is initialised with \`--debug-space\`; confirm that flag is set before grepping or the actual timeline will appear empty"

**exception-to** — a context where the relationship’s method breaks down or gives misleading results.
> \`relates-to: interleave-expected-vs-actual-timeline\`
> "in the snapshots cleanup path, \`space_tuples_trace\` timestamps are coarse (1s resolution) — interleaving by timestamp is unreliable here; use event sequence IDs instead"

**trigger-for** — the codebase-specific signal that indicates the relationship’s method should be applied.
> \`relates-to: interleave-expected-vs-actual-timeline\`
> "when \`space_hazard\` appears alongside an unexpected test failure, accounting has diverged — this is the entry condition for the interleave method"

**composes** — a recipe that combines two or more relationships into a unified procedure specific to this codebase. \`relates-to\` is a list.
> \`relates-to: [read-test-callpath-for-expected-sequence, interleave-expected-vs-actual-timeline]\`
> "grep \`PS_DIAG_INFO UNIT_TEST\` under the test’s root tag for expected; grep \`space_tuples_trace\` for actual; merge on component tag and sort by step number"

### Origin

Codebase principles are either **demonstrated** or **inferred**:

- **Demonstrated** — created from ≥3 sessions showing the same specific codebase pattern. This is the default for all non-corollary principles.
- **Inferred** — derived by composing existing relationships (see Corollaries). Not yet confirmed by sessions. Add \`inferred: true\` to frontmatter and note the derivation in prose. Becomes demonstrated once ≥3 summaries cite it.

### Scope

Most principles are **codebase-scoped** — they describe facts about this specific codebase and connect to a relationship via \`relates-to\`. But some useful principles are **meta-scoped**: they describe how the user prefers to work, communicate, or make decisions, and don’t connect to any codebase relationship. Examples: “user prefers synthesis over exploration when the picture is clear”, “user asks for diagrams when component boundaries are in question”.

Meta-scoped principles have an empty \`relates-to\` and do not get a \`relation\` type. They are still tagged to summaries and surface through the README rather than through relationship-based search.

### File naming

\`principles/<id>.md\` — the filename is the principle ID. Codebase principles are shared across sessions and not session-scoped.

### How to Write Good Codebase Principles

**Ground in real names.** Use exact names throughout — log tags, file paths, function names, counter names. A principle that says “check \`space_tuples_trace\`” is useful; one that says “check the relevant trace file” is not.

**Use the right connection type.** The \`relation\` field shapes how a future agent uses the principle. An \`instance-of\` tells the agent what to do; a \`prerequisite-for\` tells it what to check first; an \`exception-to\` tells it when to stop; a \`trigger-for\` tells it when to start; a \`composes\` gives it a ready-made recipe. Choosing the wrong type misfires the principle at search time.

**The portability test (what fails it is a codebase principle).** Replace all codebase-specific proper nouns in a candidate entry with generic placeholders. If it collapses — if you can’t say what to do without naming the specific tag or file — it belongs here, not in a relationship file.

---
## summaries/

Session summaries are narrative records of what happened in a learn session. They cite principle IDs and relationship IDs inline in their prose. When a pattern has a codebase principle, cite its principle ID. When a theme does not yet have a principle, cite the relationship ID directly — this is what the learn session greps to detect recurring themes before a principle is created.

### Format

\`\`\`
---
session-id: <current-session-id>
goal: "the session goal"
date: YYYY-MM-DD
---
Narrative prose describing what happened. Cite [principle-id] for established codebase
patterns. Cite [relationship-id] directly for themes that do not yet have a principle.
\`\`\`

### File naming

\`summaries/<date>-<goal-slug>.md\`

---
## relationships/

The user's debugging methods, heuristics, and approaches, captured as transferable principles. A relationship encodes what the user reaches for when facing a type of problem: which sources of evidence they consult first, in what order, and how they combine them. It should answer the question "what would this user do next?" when a future agent faces the same type of problem.

A relationship is not a correction to agent behavior. Do not record "the agent should not commit to hypotheses without verifying X" - that is a behavioral patch, not a method. Record instead the positive method the user demonstrated or described: "when debugging Y, do Z."

**Good test:** would this relationship help a future agent debug the same problem the same way the user would? If yes, it belongs here. If it only helps the agent avoid a past mistake, it does not belong here.

### Format

\`\`\`
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
\`\`\`

### Fields

- \`id\` - kebab-case, using vocabulary from the codebase and conversation. Choose names that describe a debugging action or workflow, not an agent behavioral trait: \`interleave-expected-vs-actual-timeline\`, \`read-test-callpath-for-expected-sequence\`, \`check-counter-names-before-asserting\`.
- \`links-to\` - IDs of tangentially related relationships worth reading alongside this one. Composition is in the prose.
- \`used-in\` - IDs of corollaries derived from this relationship.
- \`corollary-of\` - source relationship IDs this was derived from by composition. Present only on corollary relationships.
- \`composition\` - the pattern used to derive this corollary: \`sequential\`, \`conjunctive\`, \`conditional\`, or \`fallback\`. Present only on corollary relationships.

### How to Write Good Relationships

**Source is user demonstrations, not agent corrections.** When the user corrects the agent, it tells you the agent was wrong. When the user demonstrates how they would approach a problem, it tells you their method. Only the second produces a relationship. The practical filter: before writing a relationship, ask "what did the user do here?" not "what did the agent fail to do?" If the answer is "the user described a debugging workflow," write it. If the answer is "the user said the agent was wrong about X," don't — that's a local correction, not a transferable method.

**Relationships tell you what to do without codebase lookup.** A relationship should be immediately applicable on a new codebase knowing only the method. If understanding the relationship requires knowing a specific log tag or file name, it’s not a relationship — it belongs in a codebase principle. The method and the codebase-specific artifact compose: the relationship supplies the method, the principle supplies the artifact.

**The portability test (what survives it is a relationship).** Replace all codebase-specific proper nouns in a candidate entry with generic placeholders. If the statement is still meaningful and actionable, it's a relationship. If it collapses, it belongs in a codebase principle. Boundary cases — entries that partially survive — should default to a codebase principle under the parent relationship. A separate relationship file is only justified when the entry needs its own graph structure because other relationships reference it.

**Evidence threshold.** A relationship gains credibility when corroborated by an existing codebase principle — finding a similar pattern in a past session’s principle file is a strong signal that the relationship generalises. A single occurrence can still justify a new relationship when the method is clearly described and well-understood; use judgment. When evidence is thin, say so in the prose.

**Ground in real names.** Use real file names, function names, and component names in the prose where they ground the abstraction. The claim itself should remain portable - real names are examples, not constraints. A relationship that names \`space_tuples_trace\` to illustrate an interleaving method is more useful than one that says "check the relevant trace file."

**Illustrative conditions, not hard rules.** Relationship prose should include examples of when the method applies and, ideally, when it does not. Without non-examples, a future agent over-applies the relationship to situations it was not designed for. The examples calibrate - they are not a decision tree.

**Single claim per relationship.** Each relationship file should capture one method or approach. Bundling multiple methods into a single file makes it hard to cite selectively and hard to grep for. If two methods often appear together, capture them in separate files and link them via \`links-to\`.

---
## Corollaries

Corollaries are relationships derived by composing existing ones — combining verified, specific principles to produce new knowledge that wasn’t directly demonstrated. They are safer than generalisation: you are not extrapolating beyond what is known, you are combining what is already established.

A corollary that survives the portability test becomes a relationship file with \`corollary-of\` and \`composition\` in its frontmatter, recording how it was derived. The source relationships’ \`used-in\` fields are updated to point to the new corollary.

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

A identifies which method to apply. The raw material is a \`trigger-for\` principle establishing when B applies, paired with an \`exception-to\` principle establishing when B does not — and an alternative relationship C that covers the exception case.

> trigger-for B: “\`space_hazard\` appears alongside test failure → apply interleave method”
> exception-to B: “coarse timestamps in snapshots cleanup path → interleave unreliable”
> C: *interleave-by-event-sequence-id*
> Corollary: if \`space_hazard\` present and not in snapshots cleanup path → B; else → C

To identify: a \`trigger-for\` and an \`exception-to\` on the same relationship, with a second relationship covering the exception case.

### Fallback (A, then B if A yields nothing)

Apply A; if A produces no useful result, apply B. An \`exception-to\` principle directly signals this: it defines when A breaks down, and B is the relationship that handles that case.

> A: *interleave-by-timestamp*
> exception-to A: “coarse timestamps in snapshots cleanup path make this unreliable”
> B: *interleave-by-event-sequence-id*
> Corollary: try A; if timestamp resolution is insufficient, switch to B

To identify: an \`exception-to\` principle on A paired with a relationship B that handles the exceptional case A cannot.

### When to derive corollaries

After gathering and filtering relationships during triangulation, check whether any of the four patterns apply to the relationships now in view:

- Do any two relationships form a chain where A’s output is B’s input? → sequential
- Do any two relationships address the same problem from different angles, with outputs that combine? → conjunctive
- Does a \`trigger-for\` or \`exception-to\` principle on one relationship pair it with an alternative? → conditional or fallback

Propose derived corollaries alongside demonstrated relationships. The \`composition\` field is the evidence for how they were derived.
`;

/**
 * Traversal procedure embedded from .pi/skills/search-relationships-and-observations.md.
 * The 7-step sequence for querying the learnings graph.
 */
export const SEARCH_SKILL_TEXT = `\
# Search Relationships and Codebase Principles

The learnings graph has three layers, each serving a different role:

- **Relationships** (\`relationships/\`) — the *thinking frame*: portable methods encoding how the user approaches a type of problem.
- **Codebase Principles** (\`principles/\`) — *typed codebase knowledge*: concrete recurring patterns connecting abstract methods to specific artifacts in this project. Each principle has a \`relation\` field (instance-of, prerequisite-for, exception-to, trigger-for, composes) and a \`relates-to\` field naming its parent relationship.
- **Summaries** (\`summaries/\`) — *session narrative records*: historical context showing when and how knowledge was applied. Summaries cite principle IDs for established patterns and relationship IDs directly for themes without a principle yet.

Codebase principles answer "what does this relationship look like in this codebase?" Summaries answer "when was this knowledge relevant and what was happening around it?"

---

## Traversal Sequence

### Step 1 — Orient via the README

\`\`\`
cat .pi/learnings/README.md 2>/dev/null
\`\`\`

The README has two sections:

- **Codebase Principles** — principles grouped under their parent relationship with connection type noted. Meta-scoped principles (user preferences, no parent relationship) listed at the end.
- **Relationships (no principle yet)** — relationships cited directly in summaries but below the ≥3 threshold, with citation count (e.g. 2/3).

Identify relevant relationship IDs from both sections. If \`.pi/learnings/\` does not exist or the README is absent, proceed without the graph and note the absence.

### Step 2 — Read relationships

\`\`\`
cat .pi/learnings/relationships/<id>.md
\`\`\`

For each relevant relationship, read the full file. This gives the abstract frame: what the pattern means, what move it calls for, when it applies and when it does not.

### Step 3 — Clarify frame (when abstract reasoning is ambiguous)

If no clear frame emerges after reading the relationships:

1. Scan principles for terms relevant to the current situation:
   \`\`\`
   grep -r "<term>" .pi/learnings/principles/ 2>/dev/null
   \`\`\`
2. Scan recent summaries for similar problems:
   \`\`\`
   ls -t .pi/learnings/summaries/*.md 2>/dev/null | head -5
   \`\`\`
   Read the most relevant ones.

Use the concrete evidence to select the right relationship or narrow to a candidate, then return to Step 2.

### Step 4 — Search principles or summaries

For each relevant relationship, check whether a codebase principle exists:

\`\`\`
grep -rl "relates-to: <relationship-id>" .pi/learnings/principles/ 2>/dev/null
\`\`\`

**If matches are found** — read the principle file(s).

The \`relation\` field tells you how to use it:

- \`instance-of\` — what to do in this codebase: the concrete artifact, log tag, or procedure
- \`prerequisite-for\` — what to check or enable first; the method silently fails without it
- \`exception-to\` — when this method breaks down or misleads; signals a fallback may be needed
- \`trigger-for\` — the codebase-specific signal that indicates this method should be applied
- \`composes\` — a ready-made recipe combining multiple relationships (check \`relates-to\` list for components)

**If no principle exists** — grep summaries by relationship ID directly:

\`\`\`
grep -rl "\\[<relationship-id>\\]" .pi/learnings/summaries/ 2>/dev/null
\`\`\`

Read matching summaries for narrative context: when this knowledge was relevant, what the surrounding situation looked like, how it played out in practice.

When reading these summaries, apply the following:

**Check for situational fit gaps.** The method described may be exactly right, but some detail of execution may not apply to the current situation. A summary may describe grepping a log file, but in the current situation that log has already been provided — so the grep step is unnecessary. Identify what fits and what needs adapting before applying the finding.

**Read the full narrative arc, not just the outcome.** Summaries describe what happened, including detours and dead ends. "We tried X first, which was inconclusive, then Y revealed the issue" should not be read as simply "do Y" — the ordering and the failure of X are part of the knowledge.

**Weight by citation count.** A relationship cited in 2 summaries is stronger evidence than one cited in 1. One citation is a hint; two is a pattern worth taking seriously.

**Close the loop.** After extracting the relevant pattern, explicitly map it to the current task: what is the concrete next step in this specific situation?

**Distinguish meta-scoped from codebase-scoped.** User preference findings (no \`relates-to\`) transfer directly — they describe how the user works regardless of codebase. Codebase-scoped findings describe a specific project and may need adaptation.

**Ground artifact names in live context.** Before relying on a specific file path, counter name, or log tag found in a summary, verify it exists in the current codebase. Summaries may describe a different version of the code.

### Step 5 — Derive corollaries (goal-directed)

Given the current goal, check whether any of the gathered relationships compose into a more direct procedure for achieving it. Only derive a corollary if the composition produces something actionable toward the goal — not as a general reasoning exercise.

Check the four patterns:

- **Sequential (A → B)** — does A's output feed directly into B?
- **Conjunctive (A + B → C)** — do A and B run independently and combine for C?
- **Conditional (A → B if P, else C)** — does a \`trigger-for\` principle establish when B applies, and an \`exception-to\` principle plus alternative relationship C cover the remaining case?
- **Fallback (A, then B if A yields nothing)** — does an \`exception-to\` on A pair with a relationship B that handles the case A cannot?

Apply the derived procedure if the pattern is clear. Note as a candidate for the next learn session if the corollary appears genuinely new.

### Step 6 — Expand

Follow \`links-to\`, \`used-in\`, and \`corollary-of\` fields on relationships selectively. Stop when the picture is clear — this is a judgment call, not a full traversal.
`;

/**
 * The analysis prompt sent when the user invokes `/learn` in an active session.
 * The LLM analyzes the conversation history, proposes changes to the learnings
 * graph, and waits for explicit user approval before writing anything to
 * .pi/learnings/.
 *
 * Graph structure:
 *   .pi/learnings/relationships/  — portable methods derived from sessions
 *   .pi/learnings/principles/     — codebase-specific recurring patterns
 *   .pi/learnings/summaries/      — session narrative records
 *   .pi/learnings/README.md       — entry point: codebase principles + relationships without principles
 */
export const LEARN_ANALYSIS_PROMPT = `\
### System Role
You are reviewing a past pi agent session to extract what the user knows, how they operate, and what they value — knowledge the agent can draw on in future sessions. Work through the two phases below in order.

The session being reviewed is the conversation history that precedes this message — the one that was loaded when this learn session started. Focus your analysis on that conversation, not on this current exchange.

## Phase 1: Observe

Read every user message in the session. For each, note what the user contributed and classify it:

- **Domain knowledge** — named a file, component, mechanism, or log path
- **Debugging method** — described or demonstrated a diagnostic procedure
- **Preference or style** — pushed back on format, expressed how they like to work
- **Correction or redirect** — fixed an agent assumption, redirected the approach
- **Task direction** — issued a new instruction or extended scope

Build a list of raw findings — these are the inputs to Phase 2.

## Phase 2: Learn

### Step 1 — Write the session summary

Write the summary first, before considering whether any codebase principle should be created.

For each relationship applied or encountered in this session:
- If a codebase principle already exists for it: cite \`[principle-id]\` in the narrative.
- If no principle exists yet: cite \`[relationship-id]\` directly in the narrative.

For meta-scoped themes (user preferences, working style): describe them in prose with no ID citation.

Write with exact names throughout — log tags, file paths, function names, counter names. The summary is the primary record.

### Step 2 — Cross-summary analysis

For each relationship ID cited in this session's summary, check how many other summaries cite it:

\`\`\`
grep -rl "\\[<relationship-id>\\]" .pi/learnings/summaries/ 2>/dev/null | wc -l
\`\`\`

If the grep returns **2 or more** existing summaries (this session is one more, bringing the total to ≥3) AND no principle exists yet for this relationship:

Read the matching summaries. Confirm that a **specific codebase pattern** — not just the abstract relationship being applied — recurs across them. A relationship appearing 3 times does not automatically warrant a principle; a concrete, narrow codebase-specific pattern (a specific log tag, prerequisite, exception condition, or trigger signal) appearing 3 times does.

If a specific pattern is confirmed: draft a codebase principle:
- \`id\` (kebab-case), \`relation\`, \`relates-to\` (parent relationship ID), prose using exact names.
- Choose the relation type with evidence from ≥3 sessions, not from this session alone.

For meta-scoped recurring themes: same threshold (≥3 sessions), no \`relation\` or \`relates-to\`.

### Step 3 — Draft relationships

${RELATIONSHIP_DESIGN_SKILL_TEXT}

Reason inductively from the candidate principles and findings:
- \`instance-of\` with empty \`relates-to\` — what abstract method does this imply? Draft or match a relationship; fill in \`relates-to\`.
- \`prerequisite-for\` / \`exception-to\` / \`trigger-for\` / \`composes\` — which relationship do they scope? Fill in \`relates-to\`.
- For each implied relationship: does an existing one already capture it (revise) or is this genuinely new (draft)?

### Step 4 — Derive corollaries

Refer to the relationship design reference embedded in Step 3 above, particularly the Corollaries section.

Check the four composition patterns across the relationships now in view:
- **Sequential (A → B)** — does A's output feed directly into B?
- **Conjunctive (A + B → C)** — do A and B run independently and combine for C?
- **Conditional (A → B if P, else C)** — does a \`trigger-for\` on B pair with an \`exception-to\` on B plus an alternative relationship C?
- **Fallback (A, then B)** — does an \`exception-to\` on A pair with a relationship B that handles the case A cannot?

Draft corollary relationships with \`corollary-of\` and \`composition\` in frontmatter and \`inferred: true\`.

### Step 5 — Triangulate

${SEARCH_SKILL_TEXT}

Do existing entries corroborate, conflict with, or subsume any of the drafts? Revise accordingly.

### Step 6 — Present

Present the following clearly, then stop and wait for the user to respond:

1. **New codebase principles** — frontmatter + prose for each, noting scope and connection type
2. **New / revised relationships** — complete file content; note what changed and why for revisions
3. **Derived corollaries** — relationship files with \`corollary-of\` and \`composition\`
4. **README changes** — proposed updated README content
5. **AGENTS.md candidates** — standing rules proposed for addition; user decides each one

After presenting, ask: **"Does this look right? Let me know any corrections or additions, or say 'write it' to commit these to disk."**

Do not proceed to Step 7 until the user explicitly approves.

### Step 7 — Write

Once the user approves — with or without requested changes — execute all writes in order.

**Prepare metadata:**
\`\`\`
# Current session ID
ls -t ~/.pi/agent/sessions/*.jsonl 2>/dev/null | head -1 | sed 's/.*_\\(.*\\)\\.jsonl$/\\1/'
# Today's date
date +%Y-%m-%d
\`\`\`

**Create directories if absent:**
\`\`\`
mkdir -p .pi/learnings/principles .pi/learnings/summaries .pi/learnings/relationships
\`\`\`

**Migrate from \`observations/\` if present.**
If \`.pi/learnings/observations/\` exists and this is the first write pass under the new schema:
\`\`\`
ls .pi/learnings/observations/ 2>/dev/null
\`\`\`
For each observation file found, count how many summaries cite its ID:
\`\`\`
grep -rl "\\[<observation-id>\\]" .pi/learnings/summaries/ 2>/dev/null | wc -l
\`\`\`
If the count is **3 or more**: copy the file to \`.pi/learnings/principles/<id>.md\` — it already meets the threshold and is an established codebase principle. If the count is fewer than 3: leave it — it was a pre-threshold observation and should be reconsidered once the pattern recurs in future sessions.

**Write the session summary.**
Write to \`.pi/learnings/summaries/<date>-<goal-slug>.md\`:
\`\`\`
---
session-id: <current-session-id>
goal: "<session goal>"
date: <date>
---
<Narrative prose. Cite [principle-id] for established codebase patterns.
Cite [relationship-id] directly for themes that do not yet have a principle.>
\`\`\`

**Write codebase principle files.**
Write each new principle to \`.pi/learnings/principles/<id>.md\`:
\`\`\`
---
id: <id>
relation: <type>
relates-to: <relationship-id>
---
<prose>
\`\`\`
Rewrite any renamed or revised existing principle files and update all summary citations that used the old ID.

**Write relationship files.**
Write each new or revised relationship to \`.pi/learnings/relationships/<id>.md\`.
Update the \`used-in\` field of source relationships for any new corollaries.

**Write AGENTS.md additions.**
If any standing rule candidates were approved, append them to \`.pi/AGENTS.md\` (or the project root \`AGENTS.md\` if that is where project rules live). Create the file if absent.

**Regenerate README.md.**

For every principle file in \`.pi/learnings/principles/\`:
1. Extract the ID from the filename.
2. Count summaries citing it: \`grep -rl "\\[<id>\\]" .pi/learnings/summaries/ 2>/dev/null | wc -l\`
3. Read its \`relation\`, \`relates-to\`, and first sentence of prose from frontmatter.

For every relationship with no corresponding principle file, count summaries citing the relationship ID directly: \`grep -rl "\\[<rel-id>\\]" .pi/learnings/summaries/ 2>/dev/null | wc -l\`

Write \`.pi/learnings/README.md\`:
\`\`\`
## Codebase Principles

### <relationship-id>
(one entry per principle grouped under its relates-to relationship,
sorted by citation count descending)
- (<relation-type>) [<principle-id>] — <first sentence>  · <N> sessions

### User preferences
(meta-scoped principles — no parent relationship)
- [<principle-id>] — <first sentence>  · <N> sessions

## Relationships (no principle yet)
(relationships cited in summaries but with no corresponding principle, sorted by highest count desc)
- <relationship-id> — <N>/3 sessions
\`\`\`

Only write what the conversation gives clear evidence for. If a pattern occurred once and is ambiguous, say so in the prose. Do not speculate beyond what the history shows.`;
