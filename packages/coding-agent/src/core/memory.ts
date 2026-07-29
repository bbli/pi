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
Compositional trajectory: how relationships were sequenced, what each produced, how they
fed each other, where pivots occurred. Cite [principle-id] for established patterns;
[relationship-id] for themes without a principle yet. Inline in narrative, not as a list.
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
 * Traversal procedure embedded from .pi/skills/search-relationships-and-observations.md.
 * The 7-step sequence for querying the learnings graph.
 */
export const SEARCH_SKILL_TEXT = `\
# Search Relationships and Codebase Principles

The learnings graph has three layers:

- **Relationships** (\`relationships/\`) - portable methods encoding how the user approaches a type of problem. The abstract *thinking frame*.
- **Codebase Principles** (\`principles/\`) — concrete recurring patterns specific to this codebase: exact files, log tags, counters, gotchas. Each has an \`instance-of\` field naming its parent relationship (optional) and a \`links-to\` list of related principles.
- **Summaries** (\`summaries/\`) - observed traversals: how relationships were sequenced and composed to solve a specific problem. The empirical record of which compositions worked, in what order, and where pivots occurred.

## Algorithm

\`\`\`
queryLearnings(goal, [
  step(1, "Orient"),                        // → identify available relationships from README
  step(2, "Form abstract plan",
    for_each(relevant_id, [
      read(relationships/<id>),
      interrogate(relationship, goal),       // inputs required? output? success looks like?
      assess(applicability),                 // trigger-for present? exception-to blocking?
    ]),
    clarifyIfAmbiguous(),                    // → if no frame, scan broadly first
    holistic(problemShape),                 // → step back: what shape do these relationships describe?
    deriveCorollaries(fromGoal, [
      sequential(A → B),                    // A's output feeds B
      conjunctive(A + B),                   // A and B address orthogonal aspects and combine
      conditional(A → B if P, else C),     // trigger-for/exception-to establishes which
      fallback(A, then B),                  // exception-to on A pairs with B
    ]),
    synthesize(hypothesisChain),             // → method + expected output + failure indicator per step
  ),
  step(3, "Concretize the plan",
    map(abstractPlan → learnings_directory, [
      concrete_artifacts,                   //   exact files, log tags, functions, counters
      gotchas,                             //   exception-to, prerequisite-for findings
      research_questions,                  //   gaps → researchConversationQuestion(...)
    ])
  ),
])
\`\`\`

---

## Step Details

### Step 1 - Orient

\`\`\`
cat .pi/learnings/README.md 2>/dev/null
\`\`\`

The README has two sections:

- **Codebase Principles** - principles grouped under their parent relationship. Meta-scoped principles (user preferences, no parent relationship) listed at the end.
- **Relationships (no principle yet)** - relationships cited in summaries below the ≥3 threshold, with citation count.

Identify relevant relationship IDs from both sections. If \`.pi/learnings/\` does not exist or the README is absent, proceed without the graph and note the absence.

### Step 2 - Form abstract plan

This is the core reasoning step. The goal is to produce an abstract plan - a method-level procedure for achieving the goal that would make sense to a domain expert who has never seen this codebase.

**Read and interrogate each relevant relationship:**
\`\`\`
cat .pi/learnings/relationships/<id>.md
\`\`\`

Reading is not enough - actively question each relationship against the current situation:

- *What does this method require as input?* Does the current situation already provide those inputs, or would obtaining them be a step in the plan?
- *What would the output of applying this method be?* Does that output move toward the goal, and what would success look like at the abstract level?
- *Is this method actively triggered or merely plausible?* A relationship with a \`trigger-for\` signal visible in the current situation is strongly indicated. One without is speculative.

**Clarify if no frame emerges:** If reading the relationships produces no clear frame, scan broadly — grep principles for relevant terms to identify the right relationship, then return to reading it.

**Assess applicability before composing.** Classify each relationship:

- **Actively indicated** - a \`trigger-for\` signal is visible in the current situation; high confidence
- **Plausibly applicable** - the method fits the shape of the problem but the trigger has not been confirmed; medium confidence
- **Possibly blocked** - an \`exception-to\` condition may be active; note the caveat, proceed with caution or treat as fallback only

Higher-confidence relationships anchor the plan. Lower-confidence ones are candidates or fallbacks.

**Take a holistic view.** Before checking composition patterns, step back: what is the shape of the problem these relationships together describe? Do they address orthogonal aspects of the same problem? Does one produce what another requires? This view surfaces compositional patterns that mechanical checking alone misses.

**Check summaries for observed compositions.** Before deriving corollaries analytically, check whether any summary already shows the relationships now in view composed for a similar problem:

\`\`\`
ls .pi/learnings/summaries/ 2>/dev/null
\`\`\`

Read summaries that appear relevant by filename (goal slug). Look for the traversal sequence: which relationship came first, what it produced, how that fed the next. An observed composition is stronger evidence than analytical derivation — if a summary already shows A → B working for this type of goal, that sequence anchors the plan. Note any pivots or dead ends recorded in the traversal.

If no relevant summaries exist or none match the current problem shape, proceed to analytical derivation.

**Derive corollaries - working from the goal backwards.** Start with the goal outcome and reason backwards: what do you need to know or establish to achieve it? Which relationships produce those prerequisites? Then check the four composition patterns:

- **Sequential (A → B)** - A's output is the input B requires. The plan follows A with B.
- **Conjunctive (A + B)** - A and B address orthogonal aspects of the same problem and combine. Run both; synthesize their outputs.
- **Conditional (A → B if P, else C)** - a \`trigger-for\`/\`exception-to\` pair establishes when each applies. The plan branches on the trigger signal.
- **Fallback (A, then B)** - an \`exception-to\` on A pairs with relationship B that handles the case A cannot. The plan tries A and switches to B if blocked.

Apply a derived procedure if the pattern is clear. Prefer goal-directed composition over coincidental matches.

**Synthesize the abstract plan as a hypothesis chain.** Express each step as:

> *Apply [method] → expect [what success looks like] → if [failure indicator], then [pivot or fallback]*

This makes the plan falsifiable: the agent knows what to look for at each step and when to change course. Do not reference codebase-specific artifacts - this is the abstract layer. **Abstraction test:** would this plan make sense to a domain expert who has never seen this codebase? If a step requires naming a specific file, log tag, or counter, it is not abstract enough yet.

### Step 3 - Concretize the plan

Translate each element of the abstract plan into a concrete action for this codebase.

\`\`\`
.pi/learnings/
  principles/    — codebase-specific patterns; frontmatter: id, instance-of, links-to
  summaries/     - observed traversals (compositions, dead ends, sub-threshold patterns)
\`\`\`

For each abstract plan element:

- **Principles** give exact artifacts — the specific file, log tag, function, or counter to use, plus gotchas encoded in prose and linked principles: prerequisites to check first, conditions where the method breaks down, signals that confirm it applies here.
- **Summaries** give empirical composition data — read them for two specific cases:
  - *Sub-threshold relationships* (1–2/3 citations in the README): no principle exists yet, so unformalised detail lives only in the summary. Read the relevant summary to surface gotchas or artifacts not yet promoted to a principle.
  - *Dead ends and pivots*: a summary records "tried A, hit condition X, switched to B" — the pivot and its cause. A principle records only that X is an exception; the summary records the observed trigger and the fallback that resolved it.
- **Gaps** - where the learnings provide nothing relevant, formulate a concrete question and call \`researchConversationQuestion\` rather than proceeding on assumption.

**When the graph is sparse:** extract the abstract role of any artifact found and map it to the current context. Adapt rather than stopping - a principle from a different service or layer often applies with proper-noun substitution. If the equivalent in the current context is unknown, \`researchConversationQuestion\` fills the gap.

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

## Phase 1: Act-as-user performance

Read every user message in the session. For each, evaluate how the agent performed relative to what the user needed:

- **Correction** — the agent took a wrong direction or made a false assumption; user had to redirect
- **Knowledge gap** — user had to supply information the agent should have found or known (a log tag, file path, mechanism, prerequisite)
- **Style friction** — agent's format, verbosity, or level of detail didn't match what the user wanted
- **Blind spot** — agent missed something visible in the codebase or conversation that mattered
- **Method divergence** — agent approached the problem differently than the user would have
- **Missed askUser trigger** — a point where the agent should have called \`askUser\` but didn't. Match against the known trigger conditions: assumption contradicted by new evidence, repeated failed attempts on the same issue, scope escalating beyond the original request, speculating without grounding claims in read evidence, circular research (revisiting the same files/questions without applying prior findings), goal drift (work diverging from the stated goal across multiple turns). Note which condition applied and what the call would have surfaced.
- **Effective** — agent handled something well without needing user intervention

Build a flat list — one bullet per observation with its classification, a brief description, and (for failures) what the correct behavior would have been.

**🛑 STOP — Gate 1.** Present your findings list.

> Does this look right? Say **'summary'** to draft the session summary, or correct any misclassifications.

DO NOT proceed to Phase 2 until the user responds.

---

## Phase 2: System knowledge

*Enter this phase when the user says 'summary' or approves the Phase 1 findings.*

Write the session summary. The goal is to capture knowledge a future agent could not derive from reading the codebase alone. Be dense and selective — leave out anything the codebase answers directly.

**What is worth capturing:**

- **Navigation priority** — which source to check first, and why the obvious alternative is misleading or noisy. Not "check file X" (greppable). "Check X before Y because Y has 10x noise from unrelated subsystems" (not derivable).
- **Interpretation keys** — what a specific pattern, counter value, or log signature actually means in practice, as opposed to what the code says it does.
- **Plausible dead ends** — approaches that look correct from the code but fail in practice, and why. These save a future agent the same detour.
- **Non-obvious prerequisites** — conditions that must be true before a method works, where the failure mode looks identical to the actual bug.
- **User judgment and reasoning** — when the user redirected, what principle drove that choice? Not "user changed to approach X" but "user changed because invariant Y must hold before Z can be applied."
- **Working style** — how the user communicates, what level of detail they want before moving, what they find useful vs. distracting.

**What is not worth capturing:**

- Chronological recaps of what was read or grepped
- The problem description (rederivable from the code and git history)
- Single-occurrence events that were not part of a demonstrated method
- Anything a competent engineer would find in under two minutes from the codebase

**Test:** Would a future agent reading only this summary and the codebase know something it could not derive from the codebase alone that would change how it approaches a similar problem? If no, leave it out.

Write the summary as a compositional trajectory — not a list of what was applied, but a narrative of how relationships and principles connected to solve the problem:
- What goal or problem was being pursued
- Which relationship was reached for first and why
- What it produced, and how that fed the next step
- Which codebase principles (exact artifacts) were needed to execute each relationship
- Where relationships composed — one's output becoming another's input
- Where composition broke down and why (dead ends, pivots)

Cite IDs inline in the narrative as anchors:
- Established principle: \`[principle-id]\`
- Relationship without a principle yet: \`[relationship-id]\`
- Meta-scoped themes (preferences, working style): prose only, no ID

Do not write the file yet. Show the draft content inline for review.

**🛑 STOP — Gate 2.** Show the full draft summary.

> Does this capture what's worth retaining? Correct it or say **'draft'** to propose relationships and principles.

DO NOT proceed to Phase 3 until the user responds.

---

## Phase 3: Draft and triangulate

*Enter this phase when the user says 'draft' or approves the Phase 2 summary.*

### Draft relationships and principles

${RELATIONSHIP_DESIGN_SKILL_TEXT}

From the Phase 2 summary and Phase 1 method-divergence observations, reason inductively:
- Does the knowledge captured describe a portable method (relationship) or a codebase-specific artifact (principle)?
- A principle with a populated \`instance-of\` — does an existing relationship already capture that method, or is this genuinely new?
- Prose describing a prerequisite, exception, trigger, or composition — what relationship does it scope?
- Phase 1 method-divergence observations — what did the user demonstrate or reach for that the agent did not? Draft or revise a relationship to encode that method.
- For each implied relationship: revise an existing one or draft a new one.

For each entry drafted, assign a confidence level:
- **Well-evidenced** — directly demonstrated in this session; multiple observations or a clear, concrete pattern
- **Inferred** — derived from a single correction or method-divergence; one data point, needs user confirmation
- **Speculative** — loose induction with thin evidence; flag explicitly and let the user decide whether to include

### Triangulate against existing learnings

Check each proposed principle and relationship against the existing learnings graph:

\`\`\`
.pi/learnings/
  README.md      — read first to orient
  principles/    — grep -rl "instance-of: <rel-id>" principles/
  summaries/     — grep -rl "\\[<id>\\]" summaries/
\`\`\`

For each proposed entry: search for existing entries that corroborate, conflict with, or subsume it. Revise accordingly.

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
mkdir -p .pi/learnings/principles .pi/learnings/summaries .pi/learnings/relationships
\`\`\`

**Migrate from \`observations/\` if present.**
If \`.pi/learnings/observations/\` exists:
\`\`\`
ls .pi/learnings/observations/ 2>/dev/null
\`\`\`
For each observation file found, count summaries citing its ID:
\`\`\`
grep -rl "\\[<observation-id>\\]" .pi/learnings/summaries/ 2>/dev/null | wc -l
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
<Compositional trajectory: how relationships were sequenced, what each produced, how
they fed each other. Cite [principle-id] for established patterns, [relationship-id]
for themes without a principle yet. Inline in narrative, not as a list.>
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

**Write AGENTS.md additions.**
If any standing rule candidates were approved, append them to \`.pi/AGENTS.md\` (or the project root \`AGENTS.md\`). Create the file if absent.

**Regenerate README.md.**

For every principle file in \`.pi/learnings/principles/\`:
1. Extract the ID from the filename.
2. Count summaries citing it: \`grep -rl "\\[<id>\\]" .pi/learnings/summaries/ 2>/dev/null | wc -l\`
3. Read its \`instance-of\` and first sentence of prose.

For every relationship with no corresponding principle file, count summaries citing the relationship ID directly: \`grep -rl "\\[<rel-id>\\]" .pi/learnings/summaries/ 2>/dev/null | wc -l\`

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
