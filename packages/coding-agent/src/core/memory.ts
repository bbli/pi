/**
 * Relationship design procedure embedded from .pi/skills/relationship-design.md.
 * Describes the schema and guidelines for codebase principles, relationships, and corollaries.
 */
export const RELATIONSHIP_DESIGN_SKILL_TEXT = `\
# Relationship and Codebase Principle Design

The learnings graph has two complementary layers. A **relationship** says what to do; a **codebase principle** says what to look at when doing it in a specific codebase. Always read both together when consulting the graph.

---
## principles/

Codebase principles are concrete, recurring patterns discovered in this codebase - specific facts, scoped methods, prerequisites, exceptions, or triggers that have appeared as the same specific codebase-level pattern in ≥3 sessions. Each has its own ID and a typed connection to a relationship.

Codebase principles serve as **tags on summaries**. When a session summary cites a principle ID, it marks that session as one where that principle was relevant.

### Format

\`\`\`
---
id: kebab-case-id
instance-of: relationship-id    # optional: the relationship this principle instantiates
links-to: []                    # optional: other codebase principles related to this one
---
Prose describing the concrete fact, method, or scoping knowledge.
Use exact names: log tags, file paths, function names, counter names.
\`\`\`

### Connection types

The \`instance-of\` field names the relationship this principle instantiates — the concrete artifact, log tag, or procedure that makes the abstract method executable in this codebase. Leave it empty for meta-scoped principles (user preferences) that don't connect to any relationship.

Other connection types — **prerequisite-for** (something that must be true before the method works), **exception-to** (a context where the method breaks down), **trigger-for** (a signal that the method should be applied), and **composes** (a recipe combining multiple relationships) — are captured in prose, either within the principle itself or in a linked principle referenced via \`links-to\`.

The \`links-to\` field lists IDs of other codebase principles that are related and worth reading alongside this one. Use it to chain prerequisite, exception, or trigger principles to the instance principle they qualify.

### Origin

Codebase principles are either **demonstrated** or **inferred**:

- **Demonstrated** - created from ≥3 sessions showing the same specific codebase pattern. This is the default for all non-corollary principles.
- **Inferred** - derived by composing existing relationships (see Corollaries). Not yet confirmed by sessions. Add \`inferred: true\` to frontmatter and note the derivation in prose. Becomes demonstrated once ≥3 summaries cite it.

### Scope

Most principles are **codebase-scoped** - they describe facts about this specific codebase and connect to a relationship via \`relates-to\`. But some useful principles are **meta-scoped**: they describe how the user prefers to work, communicate, or make decisions, and don't connect to any codebase relationship. Examples: "user prefers synthesis over exploration when the picture is clear", "user asks for diagrams when component boundaries are in question".

Meta-scoped principles have an empty \`instance-of\`. They are still tagged to summaries and surface through the README rather than through relationship-based search.

### File naming

\`principles/<id>.md\` - the filename is the principle ID. Codebase principles are shared across sessions and not session-scoped.

### How to Write Good Codebase Principles

**Ground in real names.** Use exact names throughout - log tags, file paths, function names, counter names. A principle that says "check \`space_tuples_trace\`" is useful; one that says "check the relevant trace file" is not.

**Append or link.** When new information qualifies or constrains the same artifact as an existing principle — a caveat, prerequisite, or exception that has no value read in isolation — append it to that principle's prose. When the information has a distinct subject that other principles could independently reference, create a new principle and reference it via \`links-to\`. The test: *could another principle plausibly cite this as a \`links-to\` entry?* If yes, new principle. If no, append.

**The portability test (what fails it is a codebase principle).** Replace all codebase-specific proper nouns in a candidate entry with generic placeholders. If it collapses - if you can't say what to do without naming the specific tag or file - it belongs here, not in a relationship file.

---
## summaries/

Session summaries are observed traversals — records of how relationships and principles were sequenced and composed to solve a specific problem. They cite principle IDs and relationship IDs inline in their prose as anchors in the compositional narrative: which relationship was reached for first, what it produced, how that fed the next, where pivots occurred. When a pattern has a codebase principle, cite its principle ID. When a theme does not yet have a principle, cite the relationship ID directly — this is what the learn session greps to detect recurring themes before a principle is created.

### Format

\`\`\`
---
session-id: <current-session-id>
goal: "the session goal"
date: YYYY-MM-DD
---
### Step 1
<what was tried, what it produced, or where it hit a wall>

### Step 2
<next move, correction, or pivot>

... Cite [principle-id] for established patterns; [relationship-id] for themes without a principle yet.
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

**Source is user demonstrations, not agent corrections.** When the user corrects the agent, it tells you the agent was wrong. When the user demonstrates how they would approach a problem, it tells you their method. Only the second produces a relationship. The practical filter: before writing a relationship, ask "what did the user do here?" not "what did the agent fail to do?" If the answer is "the user described a debugging workflow," write it. If the answer is "the user said the agent was wrong about X," don't - that's a local correction, not a transferable method.

**Relationships tell you what to do without codebase lookup.** A relationship should be immediately applicable on a new codebase knowing only the method. If understanding the relationship requires knowing a specific log tag or file name, it's not a relationship - it belongs in a codebase principle. The method and the codebase-specific artifact compose: the relationship supplies the method, the principle supplies the artifact.

**The portability test (what survives it is a relationship).** Replace all codebase-specific proper nouns in a candidate entry with generic placeholders. If the statement is still meaningful and actionable, it's a relationship. If it collapses, it belongs in a codebase principle. Boundary cases - entries that partially survive - should default to a codebase principle under the parent relationship. A separate relationship file is only justified when the entry needs its own graph structure because other relationships reference it.

**Evidence threshold.** A relationship gains credibility when corroborated by an existing codebase principle - finding a similar pattern in a past session's principle file is a strong signal that the relationship generalises. A single occurrence can still justify a new relationship when the method is clearly described and well-understood; use judgment. When evidence is thin, say so in the prose.

**Ground in real names.** Use real file names, function names, and component names in the prose where they ground the abstraction. The claim itself should remain portable - real names are examples, not constraints. A relationship that names \`space_tuples_trace\` to illustrate an interleaving method is more useful than one that says "check the relevant trace file."

**Illustrative conditions, not hard rules.** Relationship prose should include examples of when the method applies and, ideally, when it does not. Without non-examples, a future agent over-applies the relationship to situations it was not designed for. The examples calibrate - they are not a decision tree.

**Single claim per relationship.** Each relationship file should capture one method or approach. Bundling multiple methods into a single file makes it hard to cite selectively and hard to grep for. If two methods often appear together, capture them in separate files and link them via \`links-to\`.

---
## Corollaries

Corollaries are relationships derived by composing existing ones - combining verified, specific principles to produce new knowledge that wasn't directly demonstrated. They are safer than generalisation: you are not extrapolating beyond what is known, you are combining what is already established.

A corollary that survives the portability test becomes a relationship file with \`corollary-of\` and \`composition\` in its frontmatter, recording how it was derived. The source relationships' \`used-in\` fields are updated to point to the new corollary.

### Sequential (A → B)

The output of A becomes the input to B. Apply A first; its result is what B operates on. Neither is useful without the other in order.

> A: *read-test-callpath-for-expected-sequence* → produces: ordered list of expected operations
> B: *interleave-expected-vs-actual-timeline* → takes: expected list + actual list
> Corollary: "get the expected sequence from the test callpath, then feed it directly into the interleave method"

To identify: A produces something B requires as input. They have been applied in the same sessions, in order.

### Conjunctive (A + B → C)

A and B run independently; C requires both outputs simultaneously before it can proceed. Neither A nor B depends on the other, but C cannot start without both.

> A: *read-test-callpath-for-expected-sequence* → produces: expected ops
> B: *grep-actual-ops-from-trace* → produces: actual ops
> Corollary C: diff and interleave → produces: divergence point

To identify: A and B address the same problem from different angles and their outputs are combined in a third step.

### Conditional (A → B if P, else C)

A identifies which method to apply. The raw material is a \`trigger-for\` principle establishing when B applies, paired with an \`exception-to\` principle establishing when B does not - and an alternative relationship C that covers the exception case.

> trigger-for B: "\`space_hazard\` appears alongside test failure → apply interleave method"
> exception-to B: "coarse timestamps in snapshots cleanup path → interleave unreliable"
> C: *interleave-by-event-sequence-id*
> Corollary: if \`space_hazard\` present and not in snapshots cleanup path → B; else → C

To identify: a \`trigger-for\` and an \`exception-to\` on the same relationship, with a second relationship covering the exception case.

### Fallback (A, then B if A yields nothing)

Apply A; if A produces no useful result, apply B. An \`exception-to\` principle directly signals this: it defines when A breaks down, and B is the relationship that handles that case.

> A: *interleave-by-timestamp*
> exception-to A: "coarse timestamps in snapshots cleanup path make this unreliable"
> B: *interleave-by-event-sequence-id*
> Corollary: try A; if timestamp resolution is insufficient, switch to B

To identify: an \`exception-to\` principle on A paired with a relationship B that handles the exceptional case A cannot.

### When to derive corollaries

After gathering and filtering relationships during triangulation, check whether any of the four patterns apply to the relationships now in view:

- Do any two relationships form a chain where A's output is B's input? → sequential
- Do any two relationships address the same problem from different angles, with outputs that combine? → conjunctive
- Does a \`trigger-for\` or \`exception-to\` principle on one relationship pair it with an alternative? → conditional or fallback

Propose derived corollaries alongside demonstrated relationships. The \`composition\` field is the evidence for how they were derived.
`;

/**
 * The analysis prompt sent when the user invokes `/learn` in an active session.
 * The LLM analyzes the conversation history, proposes changes to the learnings
 * graph, and waits for explicit user approval before writing anything to
 * .pi/learnings/.
 *
 * Graph structure:
 *   .pi/learnings/relationships/  - portable methods derived from sessions
 *   .pi/learnings/principles/     - codebase-specific recurring patterns
 *   .pi/learnings/summaries/      - session narrative records
 *   .pi/learnings/README.md       - entry point: codebase principles + relationships without principles
 */
export const LEARN_ANALYSIS_PROMPT = `\
### System Role
You are reviewing a past pi agent session to extract what the user knows, how they operate, and what they value — knowledge the agent can draw on in future sessions.

**⚠️ This is an interactive process with mandatory stops. DO NOT proceed past any gate without explicit user input.**

Work through the phases below one at a time. Each phase ends with a gate.

The session being reviewed is the conversation history that precedes this message. Focus your analysis on that conversation, not on this current exchange.

---

## Phase 1: System knowledge

Write a step-by-step account of what happened in the conversation, formatted with numbered markdown headers (\`### Step 1\`, \`### Step 2\`, etc.). Each step is one meaningful move in the investigation: what was tried, what it revealed about the problem space, where it hit a wall, what the user corrected, what the pivot was. Include roadblocks — they are part of the story.

Stay at the method and approach level, not the tool invocation level. "Tried timestamp-based interleaving, timestamps were too coarse in the snapshot path, switched to event-sequence ordering" is a step. "Read foo.ts" is not.

Do not record conclusions, root causes, or fixes. The value of a summary is the investigative path, not the answer — recording the answer invites the agent to skip thinking when it encounters a similar situation later and pattern-match to a memorised conclusion instead of reasoning from evidence. Write what was tried and what it revealed about the problem space, not what the problem turned out to be.

Cite IDs inline in the narrative as anchors:
- Established principle: \`[principle-id]\`
- Relationship without a principle yet: \`[relationship-id]\`
- Meta-scoped themes (preferences, working style): prose only, no ID

Do not write the file yet. Show the draft content inline for review.

**🛑 STOP — Gate 1.** Show the full draft summary.

> Does this accurately capture what happened? Correct it or say **'assess'** to evaluate act-as-user performance.

DO NOT proceed to Phase 2 until the user responds.

---

## Phase 2: Act-as-user performance

*Enter this phase when the user says 'assess' or approves the Phase 1 summary.*

Read every user message in the session. For each, evaluate how the agent performed relative to what the user needed:

- **Correction** — the agent took a wrong direction or made a false assumption; user had to redirect
- **Knowledge gap** — user had to supply information the agent should have found or known (a log tag, file path, mechanism, prerequisite)
- **Style friction** — agent's format, verbosity, or level of detail didn't match what the user wanted
- **Blind spot** — agent missed something visible in the codebase or conversation that mattered
- **Method divergence** — agent approached the problem differently than the user would have
- **Missed askUser trigger** — a point where the agent should have called \`askUser\` but didn't. Match against the known trigger conditions: assumption contradicted by new evidence, repeated failed attempts on the same issue, scope escalating beyond the original request, speculating without grounding claims in read evidence, circular research (revisiting the same files/questions without applying prior findings), goal drift (work diverging from the stated goal across multiple turns). Note which condition applied and what the call would have surfaced.
- **Effective** — agent handled something well without needing user intervention

Build a flat list — one bullet per observation with its classification, a brief description, and (for failures) what the correct behavior would have been.

**🛑 STOP — Gate 2.** Present your findings list.

> Does this look right? Say **'draft'** to propose relationships and principles, or correct any misclassifications.

DO NOT proceed to Phase 3 until the user responds.

---

## Phase 3: Draft and triangulate

*Enter this phase when the user says 'draft' or approves the Phase 2 findings.*

### Draft relationships and principles

${RELATIONSHIP_DESIGN_SKILL_TEXT}

From the Phase 1 summary and Phase 2 method-divergence observations, reason inductively:
- Does the knowledge captured describe a portable method (relationship) or a codebase-specific artifact (principle)?
- A principle with a populated \`instance-of\` — does an existing relationship already capture that method, or is this genuinely new?
- Prose describing a prerequisite, exception, trigger, or composition — what relationship does it scope?
- Phase 2 method-divergence observations — what did the user demonstrate or reach for that the agent did not? Draft or revise a relationship to encode that method.
- For each implied relationship: revise an existing one or draft a new one.

For each entry drafted, assign a confidence level:
- **Well-evidenced** — directly demonstrated in this session; multiple observations or a clear, concrete pattern
- **Inferred** — derived from a single correction or method-divergence; one data point, needs user confirmation
- **Speculative** — loose induction with thin evidence; flag explicitly and let the user decide whether to include

### Triangulate against existing learnings

For each proposed principle and relationship, call \`researchConversationQuestion\` with a \
self-contained question that names the entry and asks whether the learnings graph already \
has an entry that corroborates, conflicts with, or subsumes it:

> \`researchConversationQuestion("Does $(pwd)/.pi/learnings/ already have a relationship or \
principle that corroborates, conflicts with, or subsumes [entry-id]: [one-sentence description]? \
Read README.md first to orient, then grep principles/ and summaries/ for related IDs and \
read any matches.")\`

Call one per proposed entry, all in the same turn so they run in parallel. Use the \
returned findings to revise each proposal before presenting at Gate 3.

**🛑 STOP — Gate 3.** Present the reconciled proposal:
1. **New codebase principles** — frontmatter + prose, each labeled with its confidence level
2. **New / revised relationships** — complete file content; note what changed and why for revisions; each labeled with its confidence level
3. **README changes** — proposed updated content
4. **AGENTS.md candidates** — standing rules proposed for addition; user decides each

> Say **'write it'** to commit these to disk, or make any final corrections.

DO NOT write anything until the user explicitly says 'write it'.

---

## Phase 4: Write

*Enter this phase when the user says 'write it'.*

**Prepare metadata:**
\`\`\`
date +%Y-%m-%d
\`\`\`

**Create directories if absent:**
\`\`\`
mkdir -p "$(pwd)/.pi/learnings/principles" "$(pwd)/.pi/learnings/summaries" "$(pwd)/.pi/learnings/relationships"
\`\`\`

**Migrate from \`observations/\` if present.**
If \`$(pwd)/.pi/learnings/observations/\` exists:
\`\`\`
ls "$(pwd)/.pi/learnings/observations/" 2>/dev/null
\`\`\`
For each observation file found, count summaries citing its ID:
\`\`\`
grep -rl "\\[<observation-id>\\]" "$(pwd)/.pi/learnings/summaries/" 2>/dev/null | wc -l
\`\`\`
Count ≥ 3: copy to \`.pi/learnings/principles/<id>.md\`.
Count < 3: leave it.

**Write the session summary.**
Write to \`.pi/learnings/summaries/<date>-<goal-slug>.md\`:
\`\`\`
---
session-id: <current-session-id>
goal: "<session goal>"
date: <date>
---
<### Step 1
<what was tried, what it revealed about the problem space, or where it hit a wall — not what the root cause or fix turned out to be>

### Step 2
<next move, correction, pivot, or what the step revealed>

... Cite [principle-id] for established patterns, [relationship-id] for themes without a principle yet.>
\`\`\`

**Write codebase principle files.**
Write each new principle to \`.pi/learnings/principles/<id>.md\`:
\`\`\`
---
id: <id>
instance-of: <relationship-id>
links-to: []
---
<prose>
\`\`\`
Rewrite any renamed or revised existing principle files. Update all summary citations that used the old ID.

**Write relationship files.**
Write each new or revised relationship to \`.pi/learnings/relationships/<id>.md\`.
Update the \`used-in\` field of source relationships for any new corollaries.

**Regenerate README.md.**

For every principle file in \`.pi/learnings/principles/\`:
1. Extract the ID from the filename.
2. Count summaries citing it: \`grep -rl "\\[<id>\\]" "$(pwd)/.pi/learnings/summaries/" 2>/dev/null | wc -l\`
3. Read its \`instance-of\` and first sentence of prose.

For every relationship with no corresponding principle file, count summaries citing the relationship ID directly: \`grep -rl "\\[<rel-id>\\]" "$(pwd)/.pi/learnings/summaries/" 2>/dev/null | wc -l\`

Write \`.pi/learnings/README.md\`:
\`\`\`
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
\`\`\`

Only write what the conversation gives clear evidence for. Do not speculate beyond what the history shows.`;
