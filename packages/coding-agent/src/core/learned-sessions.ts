/**
 * Utilities for managing the learning queue — sessions explicitly opted in
 * for review via `pi --learn`.
 *
 * Queue state is stored in a global index at:
 *   ~/.pi/agent/sessions/learned.json
 *
 * Format: { "queue": ["session-id-1", "session-id-2", ...] }
 *
 * Sessions are added to the queue via the `/to-learn` slash command or the
 * exit prompt (when the advisory system is enabled). `pi --learn` shows only
 * queued sessions. After the analysis prompt runs, the session is automatically
 * removed from the queue.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { getSessionsDir } from "../config.ts";

interface LearnQueueData {
	queue: string[];
}

function learnedFilePath(): string {
	return join(getSessionsDir(), "learned.json");
}

async function readQueueData(): Promise<LearnQueueData> {
	try {
		const raw = await readFile(learnedFilePath(), "utf8");
		const data = JSON.parse(raw) as LearnQueueData;
		return { queue: Array.isArray(data.queue) ? data.queue : [] };
	} catch {
		return { queue: [] };
	}
}

async function writeQueueData(data: LearnQueueData): Promise<void> {
	const path = learnedFilePath();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

/** Read the set of session IDs queued for learning. Returns an empty set if the file doesn't exist. */
export async function readLearnQueueSet(): Promise<Set<string>> {
	const data = await readQueueData();
	return new Set(data.queue);
}

/**
 * Add a session ID to the learning queue.
 * No-ops if the ID is already present. Creates the file if it doesn't exist.
 */
export async function addToLearnQueue(id: string): Promise<void> {
	const data = await readQueueData();
	if (data.queue.includes(id)) return;
	data.queue.push(id);
	await writeQueueData(data);
}

/**
 * Remove a session ID from the learning queue.
 * Returns true if the ID was present and removed, false if it was not in the queue.
 */
export async function removeFromLearnQueue(id: string): Promise<boolean> {
	const data = await readQueueData();
	const filtered = data.queue.filter((qid) => qid !== id);
	if (filtered.length === data.queue.length) return false;
	await writeQueueData({ queue: filtered });
	return true;
}

/**
 * Relationship design procedure embedded from .pi/skills/relationship-design.md.
 * Describes the schema and guidelines for observations, relationships, and corollaries.
 */
const RELATIONSHIP_DESIGN_SKILL_TEXT = `\
# Relationship and Observation Design

The learnings graph has two complementary layers. A **relationship** says what to do; an **observation** says what to look at when doing it in a specific codebase. Always read both together when consulting the graph.

---
## observations/

Observations are atomic knowledge nodes — individual facts, scoped methods, prerequisites, exceptions, or triggers discovered about this codebase. Each has its own ID and a typed connection to a relationship (or no connection yet if the abstract relationship isn’t evident).

Observations serve as **tags on summaries**. When a session summary cites an observation ID, it marks that session as one where that observation was relevant. This tagging is what enables promotion: an observation cited in 3 or more summaries earns a place in the README as established codebase knowledge.

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

The \`relation\` field describes how this observation connects to its relationship:

**instance-of** — the observation IS the relationship applied to this codebase: the concrete artifact, log tag, or procedure that makes the abstract method executable here.
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

Observations are either **demonstrated** or **inferred**:

- **Demonstrated** — directly observed from a session: the user showed or described it, the agent encountered it, or it was explicitly corrected. This is the default.
- **Inferred** — derived by composing existing relationships (see Corollaries). Not yet confirmed by a session. Add \`inferred: true\` to frontmatter and note the derivation in prose. Becomes demonstrated once a summary cites it.

### Status

An observation moves through three statuses based on how many summaries cite it:

- **Regular** — cited in fewer than 3 summaries. Known but not yet established.
- **Promoted** — cited in 3 or more summaries. Appears in the README as established codebase knowledge. Surfaced at session start by the orientation step.
- **Standing rule candidate** — promoted and stable enough to propose for \`AGENTS.md\` as an unconditional rule. The learn session flags it: “this has been relevant in N sessions — should it become a standing rule?” The user decides.

### Scope

Most observations are **codebase-scoped** — they describe facts about this specific codebase and connect to a relationship via \`relates-to\`. But some useful observations are **meta-scoped**: they describe how the user prefers to work, communicate, or make decisions, and don’t connect to any codebase relationship. Examples: “user prefers synthesis over exploration when the picture is clear”, “user asks for diagrams when component boundaries are in question”.

Meta-scoped observations have an empty \`relates-to\` and do not get a \`relation\` type. They are still tagged to summaries and can be promoted, but they surface through the README rather than through relationship-based search.

### File naming

\`observations/<id>.md\` — the filename is the observation ID. Observations are shared across sessions and not session-scoped.

### How to Write Good Observations

**Ground in real names.** Use exact names throughout — log tags, file paths, function names, counter names. An observation that says “check \`space_tuples_trace\`” is useful; one that says “check the relevant trace file” is not.

**Use the right connection type.** The \`relation\` field shapes how a future agent uses the observation. An \`instance-of\` tells the agent what to do; a \`prerequisite-for\` tells it what to check first; an \`exception-to\` tells it when to stop; a \`trigger-for\` tells it when to start; a \`composes\` gives it a ready-made recipe. Choosing the wrong type misfires the observation at search time.

**The portability test (what fails it is an observation).** Replace all codebase-specific proper nouns in a candidate entry with generic placeholders. If it collapses — if you can’t say what to do without naming the specific tag or file — it belongs here, not in a relationship file.

---
## summaries/

Session summaries are narrative records of what happened in a learn session. They cite observation IDs and relationship IDs inline in their prose — observation citations are the tagging mechanism that links the session to the graph; relationship citations provide abstract context for the narrative.

### Format

\`\`\`
---
session-id: <current-session-id>
goal: "the session goal"
date: YYYY-MM-DD
---
Narrative prose describing what happened. Cite observation IDs [observation-id] for
specific facts applied or discovered. Cite relationship IDs [relationship-id] for
abstract methods that framed the work.
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

**Relationships tell you what to do without codebase lookup.** A relationship should be immediately applicable on a new codebase knowing only the method. If understanding the relationship requires knowing a specific log tag or file name, it's not a relationship — it's an observation that lost its relationship ID citation. The method and the codebase-specific artifact compose: the relationship supplies the method, the observation supplies the artifact.

**The portability test (what survives it is a relationship).** Replace all codebase-specific proper nouns in a candidate entry with generic placeholders. If the statement is still meaningful and actionable, it's a relationship. If it collapses, it belongs in observations. Boundary cases — entries that partially survive — should default to an observation line under the parent relationship. A separate relationship file is only justified when the entry needs its own graph structure because other relationships reference it.

**Evidence threshold.** A relationship gains credibility when corroborated by an existing observation - finding a similar pattern in a past session's observation file is a strong signal that the relationship generalises. A single occurrence can still justify a new relationship when the method is clearly described and well-understood; use judgment. When evidence is thin, say so in the prose.

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

A identifies which method to apply. The raw material is a \`trigger-for\` observation establishing when B applies, paired with an \`exception-to\` observation establishing when B does not — and an alternative relationship C that covers the exception case.

> trigger-for B: “\`space_hazard\` appears alongside test failure → apply interleave method”
> exception-to B: “coarse timestamps in snapshots cleanup path → interleave unreliable”
> C: *interleave-by-event-sequence-id*
> Corollary: if \`space_hazard\` present and not in snapshots cleanup path → B; else → C

To identify: a \`trigger-for\` and an \`exception-to\` on the same relationship, with a second relationship covering the exception case.

### Fallback (A, then B if A yields nothing)

Apply A; if A produces no useful result, apply B. An \`exception-to\` observation directly signals this: it defines when A breaks down, and B is the relationship that handles that case.

> A: *interleave-by-timestamp*
> exception-to A: “coarse timestamps in snapshots cleanup path make this unreliable”
> B: *interleave-by-event-sequence-id*
> Corollary: try A; if timestamp resolution is insufficient, switch to B

To identify: an \`exception-to\` observation on A paired with a relationship B that handles the exceptional case A cannot.

### When to derive corollaries

After gathering and filtering relationships during triangulation, check whether any of the four patterns apply to the relationships now in view:

- Do any two relationships form a chain where A’s output is B’s input? → sequential
- Do any two relationships address the same problem from different angles, with outputs that combine? → conjunctive
- Does a \`trigger-for\` or \`exception-to\` observation on one relationship pair it with an alternative? → conditional or fallback

Propose derived corollaries alongside demonstrated relationships. The \`composition\` field is the evidence for how they were derived.
`;

/**
 * Traversal procedure embedded from .pi/skills/search-relationships-and-observations.md.
 * The 7-step sequence for querying the learnings graph.
 */
export const SEARCH_SKILL_TEXT = `\
# Search Relationships and Observations

The learnings graph has three layers, each serving a different role:

- **Relationships** (\`relationships/\`) — the *thinking frame*: portable methods encoding how the user approaches a type of problem.
- **Observations** (\`observations/\`) — *typed codebase knowledge*: atomic facts connecting abstract methods to concrete artifacts in this project. Each observation has a \`relation\` field (instance-of, prerequisite-for, exception-to, trigger-for, composes) and a \`relates-to\` field naming its parent relationship.
- **Summaries** (\`summaries/\`) — *session narrative records*: historical context showing when and how knowledge was applied. Summaries tag observations and relationships by citing their IDs inline in prose.

Observations answer "what does this relationship look like in this codebase?" Summaries answer "when was this knowledge relevant and what was happening around it?"

---

## Traversal Sequence

### Step 1 — Orient via the README

\`\`\`
cat .pi/learnings/README.md 2>/dev/null
\`\`\`

The README has two sections:

- **Established** — promoted observations (≥3 summary citations), grouped under their parent relationship with connection type noted. Meta-scoped observations (user preferences, no parent relationship) listed at the end.
- **Accumulating** — relationships that have observations but none yet promoted, with citation count (e.g. 2/3).

Identify relevant relationship IDs from both sections. If \`.pi/learnings/\` does not exist or the README is absent, proceed without the graph and note the absence.

### Step 2 — Read relationships

\`\`\`
cat .pi/learnings/relationships/<id>.md
\`\`\`

For each relevant relationship, read the full file. This gives the abstract frame: what the pattern means, what move it calls for, when it applies and when it does not.

### Step 3 — Clarify frame (when abstract reasoning is ambiguous)

If no clear frame emerges after reading the relationships:

1. Scan observations broadly for terms relevant to the current situation:
   \`\`\`
   grep -r "<term>" .pi/learnings/observations/ 2>/dev/null
   \`\`\`
2. Scan recent summaries for similar problems:
   \`\`\`
   ls -t .pi/learnings/summaries/*.md 2>/dev/null | head -5
   \`\`\`
   Read the most relevant ones.

Use the concrete evidence to select the right relationship or narrow to a candidate, then return to Step 2.

### Step 4 — Search observations

\`\`\`
grep -rl "relates-to: <relationship-id>" .pi/learnings/observations/ 2>/dev/null
\`\`\`

Read each matching observation file. The \`relation\` field tells you how to use it:

- \`instance-of\` — what to do in this codebase: the concrete artifact, log tag, or procedure
- \`prerequisite-for\` — what to check or enable first; the method silently fails without it
- \`exception-to\` — when this method breaks down or misleads; signals a fallback may be needed
- \`trigger-for\` — the codebase-specific signal that indicates this method should be applied
- \`composes\` — a ready-made recipe combining multiple relationships (check \`relates-to\` list for components)

Promoted observations are already summarised in the README; non-promoted ones here may add detail not yet surfaced.

### Step 5 — Search summaries

\`\`\`
grep -rl "[<relationship-id>]" .pi/learnings/summaries/ 2>/dev/null
grep -rl "[<observation-id>]" .pi/learnings/summaries/ 2>/dev/null
\`\`\`

Read matching summaries for narrative context: when this knowledge was relevant, what the surrounding situation looked like, how it played out in practice.

### Step 6 — Derive corollaries (goal-directed)

Given the current goal, check whether any of the gathered relationships compose into a more direct procedure for achieving it. Only derive a corollary if the composition produces something actionable toward the goal — not as a general reasoning exercise.

Check the four patterns:

- **Sequential (A → B)** — does A's output feed directly into B?
- **Conjunctive (A + B → C)** — do A and B run independently and combine for C?
- **Conditional (A → B if P, else C)** — does a \`trigger-for\` observation establish when B applies, and an \`exception-to\` plus alternative relationship C cover the remaining case?
- **Fallback (A, then B if A yields nothing)** — does an \`exception-to\` on A pair with a relationship B that handles the case A cannot?

Apply the derived procedure if the pattern is clear. Note as a candidate for the next learn session if the corollary appears genuinely new.

### Step 7 — Expand

Follow \`links-to\`, \`used-in\`, and \`corollary-of\` fields on relationships selectively. Stop when the picture is clear — this is a judgment call, not a full traversal.
`;

/**
 * The analysis prompt injected at the start of a `pi --learn` session.
 * Sent as the first user message so the LLM analyzes the conversation
 * history, proposes changes to the learnings graph, and waits for explicit
 * user approval before writing anything to .pi/learnings/.
 *
 * Graph structure:
 *   .pi/learnings/relationships/  — portable methods derived from sessions
 *   .pi/learnings/observations/   — typed codebase knowledge nodes
 *   .pi/learnings/summaries/      — session narrative records
 *   .pi/learnings/README.md       — entry point: promoted observations + accumulating
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

Build a list of raw observations — these are the inputs to Phase 2.

## Phase 2: Learn

### Step 1 — Draft observations

For each notable thing from Phase 1, draft a candidate observation.

**Determine scope first:**

*Codebase-scoped* — describes a concrete fact about this codebase. Assign a connection type:
- \`instance-of\` — this IS the relationship applied here (artifact, log tag, procedure)
- \`prerequisite-for\` — must be true before the method works; silently fails without it
- \`exception-to\` — context where the method breaks down or misleads
- \`trigger-for\` — the signal that indicates when to apply the method
- \`composes\` — combines two or more relationships into a unified procedure

Set \`relates-to\` to the parent relationship ID (can be left empty if not yet evident).

*Meta-scoped* — describes how the user prefers to work or communicate. No connection type, no \`relates-to\`.

Draft each as: \`id\` (kebab-case), \`relation\`, \`relates-to\` (or empty), prose using exact names — log tags, file paths, function names, counter names. All session observations have origin \`demonstrated\` by default.

### Step 2 — Deduplicate

For each candidate observation, search for an existing one covering the same fact:
\`\`\`
grep -rl "relates-to: <relationship-id>" .pi/learnings/observations/ 2>/dev/null
\`\`\`
Read matching files. If the same fact is already captured: reuse its ID, renaming it if a better name covers both. If nothing matches: new file.

For meta-scoped candidates, scan existing observations with no \`relates-to\` for overlap.

### Step 3 — Draft relationships

${RELATIONSHIP_DESIGN_SKILL_TEXT}

Reason inductively from the candidate observations:
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

### Step 6 — Check promotion

For each observation (new or reused), count how many summaries currently cite it:
\`\`\`
grep -rl "\\[<observation-id>\\]" .pi/learnings/summaries/ 2>/dev/null | wc -l
\`\`\`
- **Fewer than 3** — regular, no change to status
- **3 or more** — promoted; flag for README
- **Promoted and recurring across many sessions** — standing rule candidate; note "should this become a standing rule in AGENTS.md?"

### Step 7 — Present

Present the following clearly, then stop and wait for the user to respond:

1. **New observations** — frontmatter + prose for each, noting scope and connection type
2. **New / revised relationships** — complete file content; note what changed and why for revisions
3. **Derived corollaries** — relationship files with \`corollary-of\` and \`composition\`
4. **README changes** — which observations are newly promoted; proposed updated README content
5. **AGENTS.md candidates** — standing rules proposed for addition; user decides each one

After presenting, ask: **"Does this look right? Let me know any corrections or additions, or say 'write it' to commit these to disk."**

Do not proceed to Step 8 until the user explicitly approves.

### Step 8 — Write

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
mkdir -p .pi/learnings/observations .pi/learnings/summaries .pi/learnings/relationships
\`\`\`

**Write observation files.**
Write each new observation to \`.pi/learnings/observations/<id>.md\`:
\`\`\`
---
id: <id>
relation: <type>
relates-to: <relationship-id>
---
<prose>
\`\`\`
Rewrite any renamed or revised existing observation files and update all summary citations that used the old ID.

**Write the session summary.**
Write to \`.pi/learnings/summaries/<date>-<goal-slug>.md\`:
\`\`\`
---
session-id: <current-session-id>
goal: "<session goal>"
date: <date>
---
<Narrative prose. Cite [observation-id] for specific facts applied or discovered.
Cite [relationship-id] for abstract methods that framed the work.>
\`\`\`

**Write relationship files.**
Write each new or revised relationship to \`.pi/learnings/relationships/<id>.md\`.
Update the \`used-in\` field of source relationships for any new corollaries.

**Write AGENTS.md additions.**
If any standing rule candidates were approved, append them to \`.pi/AGENTS.md\` (or the project root \`AGENTS.md\` if that is where project rules live). Create the file if absent.

**Regenerate README.md.**

For every observation file in \`.pi/learnings/observations/\`:
1. Extract the ID from the filename.
2. Count summaries citing it: \`grep -rl "\\[<id>\\]" .pi/learnings/summaries/ 2>/dev/null | wc -l\`
3. Read its \`relation\`, \`relates-to\`, and first sentence of prose from frontmatter.

Write \`.pi/learnings/README.md\`:
\`\`\`
## Established

### <relationship-id>
(one entry per promoted codebase-scoped observation grouped under its relates-to relationship,
sorted by citation count descending)
- (<relation-type>) [<obs-id>] — <first sentence>  · <N> sessions

### User preferences
(promoted meta-scoped observations — no parent relationship)
- [<obs-id>] — <first sentence>  · <N> sessions

## Accumulating
(relationships whose observations have citations but none yet promoted, sorted by highest count desc)
- <relationship-id> — <N>/3 sessions
\`\`\`

Only write what the conversation gives clear evidence for. If a pattern occurred once and is ambiguous, say so in the prose. Do not speculate beyond what the history shows.`;
