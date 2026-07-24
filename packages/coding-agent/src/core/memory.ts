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

Session summaries are narrative records of what happened in a learn session. They cite principle IDs and relationship IDs inline in their prose. When a pattern has a codebase principle, cite its principle ID. When a theme does not yet have a principle, cite the relationship ID directly - this is what the learn session greps to detect recurring themes before a principle is created.

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
- **Summaries** (\`summaries/\`) - session narrative records. Cite \`[principle-id]\` for established patterns; \`[relationship-id]\` directly for themes without a principle yet.

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

**Clarify if no frame emerges:** If reading the relationships produces no clear frame, scan broadly - grep principles for relevant terms, or read recent summaries for similar problems - to identify the right relationship, then return to reading it.

**Assess applicability before composing.** Classify each relationship:

- **Actively indicated** - a \`trigger-for\` signal is visible in the current situation; high confidence
- **Plausibly applicable** - the method fits the shape of the problem but the trigger has not been confirmed; medium confidence
- **Possibly blocked** - an \`exception-to\` condition may be active; note the caveat, proceed with caution or treat as fallback only

Higher-confidence relationships anchor the plan. Lower-confidence ones are candidates or fallbacks.

**Take a holistic view.** Before checking composition patterns, step back: what is the shape of the problem these relationships together describe? Do they address orthogonal aspects of the same problem? Does one produce what another requires? This view surfaces compositional patterns that mechanical checking alone misses.

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
  summaries/     - session records citing [principle-id] or [relationship-id]
\`\`\`

For each abstract plan element:

- **Principles** give exact artifacts — the specific file, log tag, function, or counter to use, plus gotchas encoded in prose and linked principles: prerequisites to check first, conditions where the method breaks down, signals that confirm it applies here.
- **Summaries** give context - how the method played out in prior sessions, situational fit gaps to watch for, dead ends to avoid.
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
You are reviewing a past pi agent session to extract what the user knows, how they operate, and what they value - knowledge the agent can draw on in future sessions. Work through the two phases below in order.

The session being reviewed is the conversation history that precedes this message - the one that was loaded when this learn session started. Focus your analysis on that conversation, not on this current exchange.

## Algorithm

\`\`\`
learn([
  phase(1, "Observe",
    classify(user_messages, [
      "domain_knowledge",                   // named a file, mechanism, or log path
      "debugging_method",                   // described or demonstrated a procedure
      "preference_or_style",                // pushed back on format, expressed how they work
      "correction_or_redirect",             // fixed an agent assumption
      "task_direction",                     // new instruction or extended scope
    ])
  ),
  phase(2, "Learn", [
    step(1, "Write session summary"),                         // cite [principle-id] or [rel-id]
    step(2, "Cross-summary analysis",
      for_each(relationship_id_cited, [
        count = grep(summaries, pattern="[{relationship_id}]"),
        if(count >= 2 && !principleExists && specificPatternRecurs):
          proposePrinciple()                                  // count+1 = this session → ≥3 total
      ])
    ),
    step(3, "Draft relationships",          embeds(SCHEMA_SPEC)),
    step(4, "Derive corollaries"),
    step(5, "Triangulate",                  checkAgainstExisting(learnings_directory)),
  ]),
  phase(3, "Present → Write", [
    present([
      "new_principles",
      "new_or_revised_relationships",
      "derived_corollaries",
      "readme_changes",
      "agents_md_candidates",
    ]),
    waitForApproval(),                                        // "write it" or corrections
    write([
      createDirs(),
      migrateFromObservations(),                             // if observations/ exists
      writeSessionSummary(),
      writePrincipleFiles(),
      writeRelationshipFiles(),
      regenerateReadme(README_FORMAT),
    ]),
  ]),
])
\`\`\`

---

## Phase 1: Observe

Read every user message in the session. For each, note what the user contributed and classify it:

- **Domain knowledge** - named a file, component, mechanism, or log path
- **Debugging method** - described or demonstrated a diagnostic procedure
- **Preference or style** - pushed back on format, expressed how they like to work
- **Correction or redirect** - fixed an agent assumption, redirected the approach
- **Task direction** - issued a new instruction or extended scope

Build a list of raw findings - these are the inputs to Phase 2.

## Phase 2: Learn

### Step 1 - Write the session summary

Write the summary first, before considering whether any codebase principle should be created.

For each relationship applied or encountered in this session:
- If a codebase principle already exists for it: cite \`[principle-id]\` in the narrative.
- If no principle exists yet: cite \`[relationship-id]\` directly in the narrative.

For meta-scoped themes (user preferences, working style): describe them in prose with no ID citation.

Write with exact names throughout - log tags, file paths, function names, counter names. The summary is the primary record.

### Step 2 - Cross-summary analysis

For each relationship ID cited in this session's summary, check how many other summaries cite it:

\`\`\`
grep -rl "\\[<relationship-id>\\]" .pi/learnings/summaries/ 2>/dev/null | wc -l
\`\`\`

If the grep returns **2 or more** existing summaries (this session is one more, bringing the total to ≥3) AND no principle exists yet for this relationship:

Read the matching summaries. Confirm that a **specific codebase pattern** - not just the abstract relationship being applied - recurs across them. A relationship appearing 3 times does not automatically warrant a principle; a concrete, narrow codebase-specific pattern (a specific log tag, prerequisite, exception condition, or trigger signal) appearing 3 times does.

If a specific pattern is confirmed: draft a codebase principle:
- \`id\` (kebab-case), \`instance-of\` (parent relationship ID), \`links-to\` (related principle IDs), prose using exact names.
- Ground the prose in evidence from ≥3 sessions. Capture prerequisite, exception, trigger, or composition relationships in prose or via \`links-to\`, not as separate frontmatter fields.

For meta-scoped recurring themes: same threshold (≥3 sessions), leave \`instance-of\` empty.

### Step 3 - Draft relationships

${RELATIONSHIP_DESIGN_SKILL_TEXT}

Reason inductively from the candidate principles and findings:
- A principle with a populated \`instance-of\` — does an existing relationship already capture that method, or is this genuinely new (draft)?
- Prose that describes a prerequisite, exception, trigger, or composition — what relationship does it scope? Draft or match a relationship for the \`instance-of\` field.
- For each implied relationship: does an existing one already capture it (revise) or is this genuinely new (draft)?

### Step 4 - Derive corollaries

Refer to the relationship design reference embedded in Step 3 above, particularly the Corollaries section.

Check the four composition patterns across the relationships now in view:
- **Sequential (A → B)** - does A's output feed directly into B?
- **Conjunctive (A + B → C)** - do A and B run independently and combine for C?
- **Conditional (A → B if P, else C)** - does a \`trigger-for\` on B pair with an \`exception-to\` on B plus an alternative relationship C?
- **Fallback (A, then B)** - does an \`exception-to\` on A pair with a relationship B that handles the case A cannot?

Draft corollary relationships with \`corollary-of\` and \`composition\` in frontmatter and \`inferred: true\`.

### Step 5 - Triangulate

Use the learnings graph to check whether proposed changes are consistent with existing knowledge.

The directory structure:
\`\`\`
.pi/learnings/
  README.md      - index of established principles and relationships
  principles/    — grep: grep -rl "instance-of: <rel-id>" principles/
  summaries/     - grep: grep -rl "\\[<id>\\]" summaries/
\`\`\`

For each proposed principle or relationship: search for existing entries that corroborate, conflict with, or subsume it. Revise accordingly.

### Step 6 - Present

Present the following clearly, then stop and wait for the user to respond:

1. **New codebase principles** - frontmatter + prose for each, noting scope and connection type
2. **New / revised relationships** - complete file content; note what changed and why for revisions
3. **Derived corollaries** - relationship files with \`corollary-of\` and \`composition\`
4. **README changes** - proposed updated README content
5. **AGENTS.md candidates** - standing rules proposed for addition; user decides each one

After presenting, ask: **"Does this look right? Let me know any corrections or additions, or say 'write it' to commit these to disk."**

Do not proceed to Step 7 until the user explicitly approves.

### Step 7 - Write

Once the user approves - with or without requested changes - execute all writes in order.

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
If the count is **3 or more**: copy the file to \`.pi/learnings/principles/<id>.md\` - it already meets the threshold and is an established codebase principle. If the count is fewer than 3: leave it - it was a pre-threshold observation and should be reconsidered once the pattern recurs in future sessions.

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
instance-of: <relationship-id>
links-to: []
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
3. Read its \`instance-of\` and first sentence of prose from frontmatter.

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

Only write what the conversation gives clear evidence for. If a pattern occurred once and is ambiguous, say so in the prose. Do not speculate beyond what the history shows.`;
