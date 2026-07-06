/**
 * OS Agent Extension
 *
 * Registers the built-in advisory guidelines and continuations.
 *
 * Guidelines (evaluated at turn_start, async):
 *   - debug-workflow: inject debugging workflow instructions when a bug fix is requested
 *   - research-uncertainties: inject research prompt when the agent has unresolved uncertainties
 *
 * Continuations (evaluated at agent_end, sync):
 *   - code-workflow: inject coding workflow instructions when code implementation is the next step
 *   - research-uncertainties: same trigger as guideline, evaluated after the agent turn ends
 *   - flesh-out-after-implementation: inject a flesh-out diagnostic prompt after an implementation appears done
 *   - review-after-implementation: inject a review checklist after an implementation appears done
 *
 * The advisory system can be toggled at runtime via /advisor [on|off].
 * Pass --advisor on the CLI to enable it on startup.
 *
 * Guideline inject prompts begin with [SYSTEM GUIDELINE INSTRUCTIONS: ID].
 * Continuation inject prompts begin with [SYSTEM CONTINUATION INSTRUCTIONS: ID].
 * Both sentinels direct the main agent to follow the instructions and provide an idempotency
 * skip condition.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, addLearnedSession, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Inject prompts
// Guideline prompts begin with [SYSTEM GUIDELINE INSTRUCTIONS: ID].
// Continuation prompts begin with [SYSTEM CONTINUATION INSTRUCTIONS: ID].
// Both sentinels direct the main agent to follow the instructions and carry
// an idempotency skip condition.
// ---------------------------------------------------------------------------

const CODE_WORKFLOW_PROMPT = `\
[SYSTEM CONTINUATION INSTRUCTIONS: CODE_WORKFLOW — You must follow this workflow before proceeding. \
Before starting, briefly note what you were in the middle of and outline the steps \
you will need to return to once this workflow is complete. \
Skip only if you are already actively working through these steps.]

# Code Implementation Workflow

You are a senior software engineer. Work through the following steps autonomously \
without pausing for user approval between steps.

---

## Step 1 — Context Gathering

Search the codebase for files, functions, and references relevant to the goal. \
Summarize what you find. Identify the most applicable files before writing any code.

---

## Step 2 — Implementation Plan

Produce a concise plan covering:

**Problem overview**: one sentence restating the goal.

**Proposed solution**: technical approach.
- If modifying existing functions, list all callers that will be affected.
- If there are meaningful implementation options, state them briefly and pick the best one.

**📞 Callpath diagram (required)**: ASCII diagram tracing the full execution path \
end-to-end — from the entry point through every major function, module boundary, \
async handoff, and output:

\`\`\`
├─ entryPoint()
│      └─ primaryCall()                         ← sync point (await)
│              ├─ sideEffect()  ──fire-and-forget──
│              └─ sharedWriter()                ← shared writer
\`\`\`

Mark async/fire-and-forget paths, sync/await points (← sync point), and shared \
state writers (← shared writer).

**Vertical slices (required)**: decompose into thin end-to-end slices — each adds \
exactly one observable behavior. Name the first slice "Core Plumbing" — minimum \
wiring to confirm end-to-end connectivity. For each slice state:
- Files to modify or create
- Observable behavior after this slice: what to run and exactly what to see

**⚠️ Implementation uncertainties**: list unknowns with confidence levels.

\`\`\`
⚠️ IMPLEMENTATION UNCERTAINTIES
Summary: X 🔴 CRITICAL | X 🟠 LOW | X 🟡 MEDIUM | X 🟢 HIGH

1. [Component/Step]: [what you are unsure about]
   Confidence: 🔴 CRITICAL
   Assumption: [what you are assuming]
   Impact if wrong: [what breaks]
\`\`\`

If there are any 🔴 CRITICAL or 🟠 LOW items: call \`researchConversationQuestion(question)\` \
for each one before moving to Step 3 — one call per item, with a precise self-contained \
question. Read the findings, then update or confirm the plan. \
🟡 MEDIUM and 🟢 HIGH items may proceed without research.

---

## Step 3 — Implement Each Slice in Order

For each slice:

1. **Implement** the code changes for this slice.
2. **Check**: run \`npm run check\` (full output). Fix all errors, warnings, and \
   infos before proceeding.
3. **Commit**:
   \`\`\`bash
   git add <only the files you changed>
   git commit -m "NEED_REVIEW: <description>"
   \`\`\`
4. Confirm the observable behavior for this slice, then continue to the next.

**Commit rules:**
- Never commit until \`npm run check\` passes clean.
- Stage only your files — never \`git add .\` or \`git add -A\`.
- One commit per slice, not one commit for everything.
- Message format: \`NEED_REVIEW: description\` or \`{feat,fix,docs}[(scope)]: description\`.

After all slices are committed, briefly note what was done and return to the original task.`;


const RESEARCH_UNCERTAINTIES_PROMPT_BODY = `You have unresolved questions or uncertainties \
in this conversation. Use the researchConversationQuestion tool to investigate each distinct \
question in its own focused subagent before proceeding — this surfaces answers without \
polluting the main context window with exploratory reads.

For each unresolved question or uncertainty:
1. Call researchConversationQuestion(question) with a precise, self-contained question.
2. Read the returned findings.
3. Repeat for each remaining question.
4. Once you have the findings, apply them to the current task before continuing. \
Consider whether the answers resolve your uncertainties sufficiently to proceed. \
Also reflect on any gaps or uncertainties the research itself surfaced — they may not \
require further investigation, but they can surface new angles or reveal assumptions \
worth revisiting before acting.

If your questions are already answered or you have sufficient context to proceed, \
skip this instruction.`;

const RESEARCH_UNCERTAINTIES_GUIDELINE_PROMPT = `\
[SYSTEM GUIDELINE INSTRUCTIONS: RESEARCH_UNCERTAINTIES — ${RESEARCH_UNCERTAINTIES_PROMPT_BODY}`;

const RESEARCH_UNCERTAINTIES_CONTINUATION_PROMPT = `\
[SYSTEM CONTINUATION INSTRUCTIONS: RESEARCH_UNCERTAINTIES — ${RESEARCH_UNCERTAINTIES_PROMPT_BODY}`;

const DEBUG_WORKFLOW_PROMPT = `\
[SYSTEM GUIDELINE INSTRUCTIONS: DEBUG_WORKFLOW — You must follow this workflow before proceeding. \
Skip only if you are already actively working through these steps.]

You are about to debug an issue. Before making any changes:

1. Reproduce the problem — confirm you can see the failure.
2. Form a hypothesis about the root cause.
3. Verify the hypothesis by reading the relevant code (do not guess).
4. Apply the minimal fix.
5. Confirm the failure no longer occurs, then run npm run check.`;

const REVIEW_PROMPT = `\
[SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW — You must work through this checklist for the commit \
just made before proceeding. Skip only if a review for this specific commit has already \
been completed.]

### System Role
You are a senior software engineer performing a comprehensive code review for a colleague. Your approach combines thorough analysis with clear explanation of your reasoning. Follow the following three-phase procedure:

## Phase 1: Architectural Walkthrough and Diagramming

Before diving into detailed critique, establish a clear understanding of how the changes fit into the system's architecture:

1. **Identify Key Architectural Changes**:
   - Map out any changes to system architecture, component relationships, or data flow patterns
   - Identify which modules, classes, or functions are most significantly affected
   - Note any new components introduced, existing components removed, or responsibilities that have shifted between components

2. **Trace Key Algorithmic Modifications**:
   - For each major algorithmic change, trace through the execution path
   - Focus on functions that have been added, significantly modified, or deleted
   - Identify the core data transformations happening in the code and where they cross component boundaries

3. **Create an Architectural Diagram**:
   - Use a free-form ASCII text diagram to illustrate the system architecture and how the changes affect it
   - Show the relevant components/modules/services and the relationships between them (calls, dependencies, data flow, ownership)
   - Clearly distinguish what is **new**, **modified**, and **removed** by the change (e.g., annotate with [NEW], [MODIFIED], [REMOVED])
   - Show the direction of dependencies and the direction of data flow between components
   - Highlight integration points with external services, databases, queues, or other boundaries
   - Where useful, show both a "before" and "after" view so the architectural delta is obvious

**Example Format:**
~~~
Architecture: Order Processing Flow (after change)

        ┌──────────────┐         ┌─────────────────────┐
        │  API Gateway │────────▶│  OrderController     │
        └──────────────┘  HTTP   │  [MODIFIED]          │
                                 └─────────┬───────────┘
                                           │ calls
                          ┌────────────────┼────────────────┐
                          ▼                                  ▼
              ┌────────────────────┐            ┌────────────────────────┐
              │ PricingService     │            │ InventoryService [NEW] │
              │ [MODIFIED]         │            │  - reserveStock()      │
              │  - calcTotal()     │            └───────────┬────────────┘
              └─────────┬──────────┘                        │ async
                        │ reads                              ▼
                        ▼                          ┌───────────────────┐
              ┌────────────────────┐               │  StockReservedQ   │
              │  PricingRepo (DB)  │               │  (message queue)  │
              └────────────────────┘               └───────────────────┘

Removed: LegacyPriceCache [REMOVED]  ──X── (previously sat between
         PricingService and PricingRepo)

Architectural Notes / Risk Points:
• InventoryService is a new synchronous dependency of OrderController → adds a
  failure mode on the critical request path; consider timeout/fallback behavior.
• Removal of LegacyPriceCache shifts read load directly onto PricingRepo →
  validate DB capacity and latency assumptions.
• New async hop via StockReservedQ introduces eventual consistency → confirm
  downstream consumers tolerate ordering/delivery semantics.
~~~

4. **Identify Risk Areas for Phase 2**:
   - Based on the architectural and algorithmic analysis, highlight which areas need the most scrutiny in Phase 2
   - Note any new coupling, dependency cycles, or boundary crossings that could introduce risk
   - Flag any complex data transformations that could introduce edge cases
   - Flag any areas where component interactions could lead to inconsistent states

## Phase 2: Step-by-Step Code Review Analysis

Using the context established in Phase 1, structure your review using Markdown headers for each major concern area:

1. **Correctness Issues (CRITICAL)**:
  - Identify any logical errors or incorrect implementations
  - Justify findings with direct code snippets, including line numbers and filenames
  - **Caller Impact Analysis (CRITICAL)**:
    - **Search the codebase for all callers of modified functions**
    - For each modified function signature (parameters added/removed/reordered, return type changed, exceptions modified):
      - Identify all call sites in the codebase
      - Verify each caller is compatible with the changes
      - Check if callers handle new error conditions or return values
      - Validate that removed parameters aren't being passed by existing callers
      - Confirm new required parameters are provided by all callers
    - For functions with changed behavior (even without signature changes):
      - Identify callers that may depend on the old behavior
      - Assess if the new behavior could break existing assumptions
      - Check for callers in unexpected locations (tests, scripts, configuration)
    - **List all affected callers and their compatibility status**
  - **State Synchronization and Dual Representations (CRITICAL)**:
    - For each mutation (write, initialization, seeding, or cache update) in the diff, identify all other data structures that represent the same logical state — caches, indexes, secondary stores, parallel in-memory views, or derived representations
    - Verify that every representation is kept in sync by the change. A write that updates one view but leaves another stale is a correctness bug even if both views are individually valid
    - Specifically flag:
      - **Parallel representations**: two or more objects that hold the same data in different forms (e.g. a flat message array for inference + an entry graph for UI/persistence; a write-through cache + a DB row; an in-memory index + a persisted store). Ask: when one is written, is the other written too?
      - **Seeding / initialization paths**: operations that pre-populate a session, context, or component. Ask: does the seeding reach every downstream consumer that reads from this component, or does it only cover the consumers the author had in mind?
      - **Lazy vs. eager population**: if a structure is populated on-demand in one path and eagerly in another, verify both paths agree on contents after the same logical operation
    - For each gap found, name the trigger condition (the call path or state combination that exposes the inconsistency) and the observable symptom (what a caller of the stale representation will see)

  - **Concurrency and Race Conditions (CRITICAL)**:
    - Identify shared mutable state (caches, counters, collections, static/instance fields, files) accessed from more than one thread, request, coroutine, or async task
    - Flag check-then-act / read-modify-write sequences (TOCTOU) that aren't atomic — e.g. "if not exists → create", get-then-increment, balance checks before debits
    - Verify locking is correct and complete: consistent lock ordering (deadlock risk), appropriate lock scope (not held across I/O or external calls), and no lost/double unlocks
    - Check thread-safety of data structures and that concurrent collections / atomics are used where needed
    - For async code, flag unawaited operations, concurrent mutation of shared objects, and races between callbacks/promises
    - Assess idempotency and correctness under retries and duplicate/concurrent requests (especially around the integration points and queues noted in Phase 1)
    - Note visibility/memory-model concerns where one thread may observe stale state written by another

2. **Architectural Review (CRITICAL)**:
  This section is mandatory and evaluates whether the change is structurally sound, not just locally correct. Use the architectural diagram from Phase 1 as the basis for this analysis.
  
  **Boundaries and Responsibilities:**
  - Assess whether new or modified components have a single, clear responsibility (separation of concerns)
  - Identify logic placed in the wrong layer or component (e.g., business logic in a controller, persistence concerns leaking into domain code)
  - Check whether the change respects existing module/service boundaries or erodes them
  
  **Coupling and Cohesion:**
  - Identify any new coupling introduced between components and whether it is necessary
  - Flag tight coupling to concrete implementations where an abstraction/interface would be more appropriate
  - Check the **direction of dependencies**: do they point the intended way (e.g., toward stable abstractions), or do they introduce cycles or upward dependencies?
  - Evaluate whether cohesion within affected components is maintained or weakened
  
  **Dependencies and Integration Points:**
  - Evaluate new synchronous dependencies on the critical path (added latency, new failure modes, blast radius)
  - For new external/async integrations (services, queues, caches), assess consistency model, retries, timeouts, idempotency, and backpressure
  - Check whether removed components (e.g., caches, fallbacks, adapters) shift load or responsibility elsewhere in ways that were not accounted for
  
  **Design Patterns and Consistency:**
  - Check whether the change follows established patterns and conventions in the codebase, or introduces a divergent approach without justification
  - Identify reinvented functionality that duplicates existing components/utilities
  - Assess extensibility: will this design accommodate likely near-term changes, or does it bake in assumptions that will be costly to undo?
  
  **Scalability and Failure Behavior:**
  - Consider how the new architecture behaves under load, partial failure, and dependency outages
  - Identify single points of failure or unbounded resource usage introduced by the change
  - Note any state or consistency concerns arising from new component interactions

3. **Edge Cases and Control Flow Analysis**:
  - Think critically about edge cases for newly implemented code
  - Analyze if changes can cause unwanted control flow
  - **Point out any gaps in test coverage**
  - When applicable, demonstrate how test code interacts with the main codebase changes

4. **Logging, Observability, and Debugging Analysis (CRITICAL)**:
  This section is mandatory and must be thoroughly addressed for every code review, as it is frequently overlooked by developers.
  
  **Logging:**
  - Point out any changes to existing log lines and critique their effectiveness
  - **Analyze whether new log lines are needed, especially for:**
    - Failure cases and error conditions
    - Entry and exit points of critical functions
    - State transitions or important decision points
    - Integration points with external services or databases
  - Evaluate log levels (DEBUG, INFO, WARN, ERROR) for appropriateness
  - Check if logs contain sufficient context (request IDs, user IDs, relevant parameters) for debugging
  - Verify that sensitive data (passwords, tokens, PII) is not being logged
  
  **Metrics and Monitoring:**
  - **Identify where metrics should be added or updated:**
    - Performance metrics: latency, duration, processing time for new or modified operations
    - Business metrics: counts of important events (requests, transactions, conversions)
    - Error rates and failure counts for new error paths
    - Resource utilization: database connections, memory usage, queue depths
  - Consider which metrics need aggregation (counters, gauges, histograms)
  - Evaluate if existing metrics need to be updated or removed due to code changes
  - **Think about alerting implications:** What metric thresholds would indicate problems?
  
  **Tracing and Distributed Context:**
  - For operations that span multiple services or components:
    - Verify trace context propagation (span creation, context passing)
    - Check if new external calls or async operations need trace instrumentation
    - Identify operations that should be captured as distinct spans
  - For complex operations, consider if trace attributes/tags should be added for filtering
  - Evaluate if parent-child span relationships are correctly maintained
  
  **Debugging Considerations:**
  - Assess if the changes provide sufficient information to diagnose production issues
  - Identify code paths where additional observability would significantly reduce MTTR (Mean Time To Resolution)
  - Consider: "If this fails in production at 3 AM, what information would I need to debug it?"

5. **Deleted Code Regression Analysis**:
  - **Analyze if deleted or modified code had important side effects or edge case handling**:
    - Check if removed functions handled specific error conditions or edge cases
    - Identify if deleted code provided critical fallback mechanisms
    - Review if modified code removes important validation or safety checks
    - Look for deleted code that managed state transitions or cleanup operations
    - **Check if deleted code had logging, metrics, or tracing that needs to be preserved**
  - Verify that replacement code maintains the same level of robustness

6. **Code Quality and Maintenance**:
  - Look for typos or accidentally deleted code
  - Check for naming conventions, code clarity, and maintainability
  - Identify any architectural concerns

**For all these areas, only add a comment if something needs to be addressed**

If a code change is required, show the original code and propose a specific fix

Example Format:
### --------CODE REVIEW 1: src/components/UserManager.js:45-------
The variable name is unclear and doesn't follow naming conventions.

Original:
~~~js
const x = getAllUsers();
~~~

Suggestion:
~~~js
const allUsers = getAllUsers();
~~~

Reasoning: Clear variable names improve code readability and make the intent obvious to other developers.

## Phase 3: Gather Context for Unit Test Recommendations

After completing the code review analysis, perform a focused investigation to identify specific **EXISTING** unit tests:

1. **Re-examine Code Changes with Test Focus**:
  - Review each modified function, class, and module specifically for testability
  - Identify the exact methods, edge cases, and failure scenarios that need validation
  - Map each issue found in Phase 2 to specific test requirements

2. **Locate and Analyze Existing Test Files**:
  - Search for existing test files that cover the modified code (look for naming patterns like *.test.js, *_test.py, test_*.py, etc.)
  - Examine the structure and coverage of existing tests
  - Identify gaps between existing tests and the changes made

3. **Create Specific Test Recommendations with Reasoning**:
  - For each recommended test, provide:
    - **Exact test file path and test name/description**
    - **Step-by-step reasoning**: Why this specific test is needed based on the code changes and issues identified
    - **What the test should validate**: Specific behaviors, edge cases, or regressions
    - **Priority level**: Critical/Important/Nice-to-have based on risk assessment

4. **Address Gaps and Conflicts**:
  - If any definitions, context, or dependencies are missing, explicitly state this
  - If there is conflicting evidence or unclear intent, point that out and suggest follow-up questions
  - Do not infer or invent missing information

## SUMMARY

Conclude with a SUMMARY section using:
- Bullet points for main findings and recommendations from Phase 2
- **ARCHITECTURAL ASSESSMENT (CRITICAL)**: Summarize the key architectural findings — boundary/responsibility issues, new coupling or dependency concerns, integration and failure-mode risks, and overall structural soundness of the change
- **CALLER COMPATIBILITY ISSUES (CRITICAL)**: List all affected callers of modified functions and their compatibility status
- **LOGGING AND OBSERVABILITY RECOMMENDATIONS (CRITICAL)**: Summarize key logging, metrics, and tracing additions needed
- **UNIT TESTS TO RUN (CRITICAL)**: Present the specific unit test recommendations from Phase 3, including:
  - Exact test file paths and test names
  - Step-by-step reasoning for each recommended test
  - Priority levels for each test based on risk assessment
- One to two sentence overall assessment of the changes
- If helpful, include a free form ASCII text diagram to clarify key architectural or flow concepts affected by the changes

## Guidelines:
- **All items marked with (CRITICAL) are mandatory requirements that must be addressed in every review**
- **ALWAYS produce an architectural diagram in Phase 1 and an architectural review in Phase 2 - structural problems are as important as local correctness issues**
- **ALWAYS search the codebase for callers of modified functions - this is critical to prevent breaking changes**
- Only provide feedback where changes are actually needed
- Skip files that don't require any modifications
- Justify all reasoning with specific code examples
- Think through feedback step by step before responding
- Focus on actionable, specific suggestions rather than general advice
- **Phase 3 unit test recommendations must be based on the specific issues and risks identified in Phase 2**
- **ALWAYS include specific unit tests to run in the summary with detailed reasoning - this is a critical requirement**
- **ALWAYS include logging and observability analysis and recommendations - this is frequently overlooked and is critical for production support**
- **ALWAYS include caller compatibility analysis in the summary - breaking changes to callers are a critical risk**
- **ALWAYS include the architectural assessment in the summary - structural regressions are a critical risk**`;

const RESEARCH_BEFORE_ACTION_PROMPT = `\
[SYSTEM GUIDELINE INSTRUCTIONS: RESEARCH_BEFORE_ACTION — Before taking the next action, \
read the relevant source code first. \
Skip only if you have already read the relevant source files for the current \
investigation in this conversation, or if a [SYSTEM GUIDELINE INSTRUCTIONS: RESEARCH_BEFORE_ACTION] \
message already appears in the conversation for the current investigation.]

A background monitor has detected that you appear to be about to take an action — \
editing code, grepping logs, or running diagnostic commands — without first reading \
the relevant source code.

Acting without grounding yourself in the code produces wasted effort: log searches \
find nothing useful because you did not know what to look for; code edits miss callers \
or side effects; diagnostic commands return results you cannot interpret.

Before taking the next action, consider:
- Read the relevant source files to understand the structure and behavior of the code involved.
- Form a specific hypothesis about what you expect to find before searching logs or running commands.
- For unfamiliar areas, call \`researchConversationQuestion\` to explore efficiently without \
  polluting the main context with exploratory reads.
- After each round of log searching or diagnostic output, re-read the relevant code to \
  revise your hypothesis before searching again — do not iterate on evidence alone.

This tends to apply when:
- You are about to grep logs or search output without having read the code that produces them
- You are debugging a failure and moving directly to evidence collection without a code-grounded hypothesis
- You are about to edit code in an area you have not yet explored in this conversation
- You have received log output or command results and are about to run more commands \
  without revisiting the source to revise your hypothesis

It is less applicable when:
- You have already read the relevant source files in this conversation before taking this action
- The action itself is the research (reading files, calling researchConversationQuestion)
- The change is a simple, already-understood, bounded edit
- A single bash command fully resolves the request without needing code context

Once you have read the relevant code and formed a grounded hypothesis, apply that \
understanding to decide your next action. Reflect on any gaps the code reveals — \
they may reframe the problem or suggest a different approach.`;

const ASSUMPTION_CHALLENGED_PROMPT = `\
[SYSTEM GUIDELINE INSTRUCTIONS: ASSUMPTION_CHALLENGED — Something in this conversation \
contradicts your current understanding. Return to first principles \
and rebuild your hypothesis before continuing. \
Skip only if this specific contradiction has already been acknowledged and your \
working hypothesis explicitly revised in response.]

A background monitor has detected that something in this conversation \
contradicts or undermines a position or assumption you previously stated. Your current \
hypothesis should be treated as invalidated.

Before collecting any further evidence or continuing the investigation:

1. State explicitly what you now know for certain, what you were assuming, \
and which assumptions the new evidence has invalidated.
2. From that foundation, form a revised hypothesis about what is happening — \
grounded in what is known, not inferred backward from evidence already \
collected.
3. Present a callpath diagram of your revised understanding, marking \
confirmed steps, assumed steps, and the point where your previous model \
broke down.

Only then proceed — investigating the revised hypothesis, not searching for \
evidence and fitting a hypothesis to it afterward.

A good debugging session always moves from hypothesis to evidence, not from \
evidence to hypothesis.`;

const RESUME_TASK_PROMPT = `\
[SYSTEM CONTINUATION INSTRUCTIONS: RESUME_TASK — An advisory workflow has completed \
and there appears to be a prior task that was interrupted. Return to it now. \
Skip if: (1) you have already resumed the original task after this advisory completed, \
or (2) the advisory was the full scope of the user's request and no prior task existed.]

A background monitor detected that an advisory workflow — CODE_WORKFLOW, FLESH_OUT, \
or CODE_REVIEW — has completed, and there may be earlier work from before the \
interruption that has not yet been resumed.

Look back in the conversation to identify what you were working on before the advisory \
fired. If a CODE_WORKFLOW was triggered, you may have noted the original task at the \
start of that workflow. Resume from where you left off, applying any relevant findings \
from the advisory if they inform the original task.

If nothing was interrupted — the advisory was the full scope of the request — \
skip this and wait for the user.`;

const FLESH_OUT_PROMPT = `\
[SYSTEM CONTINUATION INSTRUCTIONS: FLESH_OUT — Run the Implementation Fleshing-Out Prompt \
for the recently committed new feature or significant change. \
Skip if any of these apply: \
(1) A FLESH_OUT analysis has already been completed for this implementation. \
(2) A [SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW] message appeared in the conversation \
before the most recent implementation — those findings produce targeted fixes, not new scope. \
(3) The user asked for a specific, bounded change: a bug fix, refactor, rename, or targeted edit.]

# Implementation Fleshing-Out Prompt

This is a DIAGNOSTIC / RECOMMENDATION prompt. Analyze the implementation, surface candidate \
NEW BEHAVIORS and EXISTING-SCOPE EDGE CASES, make recommendations on what to address, then \
stop. Do NOT implement anything in this prompt — no code changes, no commits. The Code \
Implementation Workflow will re-trigger automatically once you have presented your findings.

BEHAVIORS vs EDGE CASES — keep these strictly separate:
- BEHAVIORS = candidate new/extra functionality the current implementation does not attempt \
at all. Optional extensions to scope. Ask: "Does this require the system to do something it \
currently doesn't attempt at all?" → BEHAVIOR.
- EDGE CASES = gaps in correctness within the scope the implementation already claims to \
handle. Ask: "Does this only concern how the current logic reacts to an input/state it \
wasn't built for?" → EDGE CASE.

---

## STEP 1: Locate and Understand the Implementation

- Check the conversation first. If implementation history from a Code Implementation Workflow \
run is already present, reuse that context — do not re-derive it.
- If no such context exists, locate the implementation: identify the diff/changeset \
(e.g. git diff, git log -p on recent commits). If no diff is available, read the \
relevant files directly.
- Also search ~/Documents/WorkVault/AI_Knowledge for related design notes if relevant.
- Static analysis only — read the code by inspection. Do not generate or run tests, and \
do not fan out into broad exploratory search beyond understanding this implementation \
and its immediate callers/dependents.

---

## STEP 2: Summarize the Implementation

- Prose Summary: a concise description of what the implementation does today — entry points, \
main logic, inputs, outputs/side-effects, and what it explicitly does not attempt.
- Convey enough of the as-built execution flow in prose so per-candidate diagrams in \
Steps 3 and 4 have a shared frame of reference.
- Do NOT produce a callpath diagram here. Diagrams are produced per-candidate in Steps 3 \
and 4 only.

---

## Per-Candidate Diagram Convention (Steps 3 and 4)

Every candidate gets its own focused ASCII diagram — a scoped excerpt of the as-built \
execution flow highlighting only the function(s) and node(s) directly relevant to that \
one candidate:
- For a BEHAVIOR: show where in the existing flow the new capability would attach.
- For an EDGE CASE: pinpoint the specific node where the gap lives and the flow reaching it.

Use standard ASCII callpath conventions (├─, └─, ← sync point, ← shared writer, \
──fire-and-forget──). Keep each diagram small and scoped to the relevant slice only.

---

## STEP 3: Generate Candidate BEHAVIORS (New Functionality)

Using static analysis, identify functionality the implementation could reasonably support \
but currently does not attempt at all. Ground candidates in what you actually observe: an \
unhandled but adjacent use case, a parameter accepted but unused, a natural next capability \
suggested by the code's shape, functionality present in sibling code but absent here.

For each candidate:
- New capability: what it would add (one sentence)
- Why plausible: what in the code suggests this is a reasonable extension
- Scope signal: small addition vs. significant new surface area
- Focused diagram (REQUIRED): scoped ASCII diagram showing where the capability attaches

Keep this to highest-signal candidates only — not a brainstorming dump.

---

## STEP 4: Generate Candidate EDGE CASES (Existing-Scope Gaps)

Using static analysis, identify places where the current implementation's own logic has \
undefined, unhandled, or likely-unintentional behavior on non-happy-path input or state.

Look for: missing guards on empty/null/undefined/zero/negative input; unbounded loops or \
retries with no max/backoff; unhandled failure branches; concurrency hazards; assumptions \
about ordering, uniqueness, or size not enforced anywhere; silent failure paths.

For each candidate:
- Location: function/file and relevant flow node
- Gap: what input/state isn't handled
- Why plausible: why this scenario could realistically occur
- Current behavior if triggered (e.g. "throws uncaught exception", "silently no-ops")
- Focused diagram (REQUIRED): scoped ASCII diagram pinpointing where the gap lives

Do not propose fixes — surface the gap and ask what behavior is wanted.

---

## STEP 5: Present Findings and Recommendations

Present Steps 2–4 in a single message, then close with a RECOMMENDATIONS section:

~~~
## 🆕 CANDIDATE BEHAVIORS (New Functionality)
Summary: N candidates identified

1. [Behavior name]
   - New capability: ...
   - Why plausible: ...
   - Scope signal: ...
   - Diagram: <focused ASCII diagram>

## ⚠️ CANDIDATE EDGE CASES (Existing-Scope Gaps)
Summary: N candidates identified

1. [Edge case name]
   - Location: [file/function, flow node]
   - Gap: ...
   - Why plausible: ...
   - Current behavior if triggered: ...
   - Diagram: <focused ASCII diagram>

## 📝 RECOMMENDATIONS
- BEHAVIORS to implement: [list by name, or "none"]
- EDGE CASES to address: [list by name with brief intended resolution, or "none"]
~~~

Keep BEHAVIORS and EDGE CASES in two clearly separate sections in that order.

Once you have presented your findings and recommendations, your job in this prompt is done. \
Do not implement anything. The Code Implementation Workflow will re-trigger automatically.

---

CRITICAL REMINDERS:
- Reuse in-conversation implementation context; only re-derive from disk/repo when \
genuinely missing.
- Static analysis only — no test generation or execution, no broad exploratory search.
- Never blend BEHAVIORS with EDGE CASES. Keep them in separate, clearly labeled sections.
- Step 2 is prose only — one focused diagram per candidate in Steps 3 and 4 only.
- Every candidate must be traceable to something specific observed in the code.`;



// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// /advisor TUI component
// ---------------------------------------------------------------------------

class AdvisoryStatusComponent extends Container {
	private settingsList: SettingsList;

	constructor(pi: ExtensionAPI, onClose: () => void) {
		super();

		const guidelines = pi.getGuidelines();
		const continuations = pi.getContinuations();

		const items: SettingItem[] = [
			{
				id: "system",
				label: "Advisory System",
				currentValue: pi.getAdvisoryEnabled() ? "enabled" : "disabled",
				values: ["enabled", "disabled"],
				description:
					"Toggle the advisory system on or off. When disabled, no guidelines " +
					"or continuations are evaluated.",
			},
			...guidelines.map((g) => ({
				id: `guideline:${g.id}`,
				label: g.id,
				currentValue: "guideline",
				description: `Trigger: ${g.triggerPrompt}`,
			})),
			...continuations.map((c) => ({
				id: `continuation:${c.id}`,
				label: c.id,
				currentValue: "continuation",
				description: `Trigger: ${c.triggerPrompt}`,
			})),
		];

		this.settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 12),
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "system") {
					pi.setAdvisoryEnabled(newValue === "enabled");
				}
			},
			onClose,
		);

		this.addChild(new DynamicBorder());
		this.addChild(this.settingsList);
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		this.settingsList.handleInput(data);
	}
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function osAgent(pi: ExtensionAPI): void {
	// --- Guidelines (turn_start, async) ---

	// pi.registerGuideline({
	// 	id: "debug-workflow",
	// 	triggerPrompt:
	// 		"Is the user starting a new debugging or bug-fix task that hasn't already received " +
	// 		"debugging workflow guidance in the recent conversation? " +
	// 		"Use your judgment: if this looks like a fresh debugging request that hasn't " +
	// 		"been covered by a recent [SYSTEM GUIDELINE INSTRUCTIONS: DEBUG_WORKFLOW] message, trigger. " +
	// 		"If the conversation already has debug guidance covering this task, do not trigger.",
	// 	injectPrompt: DEBUG_WORKFLOW_PROMPT,
	// 	label: "advisory:debug-workflow",
	// });

	// --- Guidelines + Continuations: research-uncertainties ---

	const researchUncertaintiesTrigger =
		"Does anything recent in the conversation contain explicit, unresolved questions or " +
		"uncertainties that have NOT yet been investigated? " +
		"Look for either: " +
		"(1) An Implementation Uncertainty Report (⚠️ IMPLEMENTATION UNCERTAINTIES) in the " +
		"recent conversation, containing 🔴 CRITICAL or 🟠 LOW confidence items. " +
		"(2) Anything recent in the conversation explicitly enumerates questions or knowledge " +
		"gaps that need to be resolved before proceeding (e.g. numbered open items, " +
		"'I need to verify X before implementing', or an ⚠️ IMPLEMENTATION UNCERTAINTIES block). " +
		"Do NOT trigger if any of these are true: " +
		"- The researchConversationQuestion tool was already called after the uncertainties appeared. " +
		"- A [SYSTEM GUIDELINE INSTRUCTIONS: RESEARCH_UNCERTAINTIES] or " +
		"  [SYSTEM CONTINUATION INSTRUCTIONS: RESEARCH_UNCERTAINTIES] message already follows the uncertainties. " +
		"- The questions were answered by the user or resolved through direct context. " +
		"- The assistant ended its turn proceeding confidently without flagged open items.";

	pi.registerGuideline({
		id: "research-before-action",
		triggerPrompt:
			"Is the agent about to take a concrete action — such as editing code, grepping logs, " +
			"or running diagnostic bash commands — without having first read the relevant source " +
			"code to form a grounded hypothesis? " +
			"Strong signals this APPLIES: " +
			"- The agent's apparent next step is to grep logs, search output, or run diagnostic " +
			"  commands without having read the source files that produce those logs. " +
			"- The agent is debugging a failure and moving directly to evidence collection " +
			"  (log searches, command runs) without first reading the relevant code. " +
			"- The agent has received log output or command results and is about to take another " +
			"  action round without revisiting the source code to revise its hypothesis. " +
			"- The agent is about to edit code in an area not yet explored in this conversation. " +
			"Strong signals this does NOT apply: " +
			"- The agent has already read the relevant source files in this conversation before " +
			"  taking the current action. " +
			"- The agent is currently doing research (reading files, calling researchConversationQuestion). " +
			"- The action is a simple, bounded lookup where no code context is needed. " +
			"- A [SYSTEM GUIDELINE INSTRUCTIONS: RESEARCH_BEFORE_ACTION] message already appears " +
			"  in the conversation for the current investigation.",
		injectPrompt: RESEARCH_BEFORE_ACTION_PROMPT,
		label: "advisory:research-before-action",
	});

	pi.registerGuideline({
		id: "assumption-challenged",
		triggerPrompt:
			"Has anything in the conversation presented information, evidence, or an argument " +
			"that contradicts or undermines a position, hypothesis, or assumption the agent " +
			"stated earlier in the conversation? " +
			"Strong signals this APPLIES: " +
			"- The user says the agent's diagnosis or hypothesis is wrong and explains why. " +
			"- The user provides log lines, test results, or code that contradict the agent's " +
			"  stated understanding. " +
			"- The user corrects a factual claim about system behavior, architecture, or " +
			"  component interactions. " +
			"- The agent predicted X would happen and the user reports Y happened instead. " +
			"Strong signals this does NOT apply: " +
			"- The user corrects a minor detail (typo, wrong port, filename) that does not " +
			"  affect the agent's overall model. " +
			"- The user asks a clarifying question without asserting a contradiction. " +
			"- The user expresses uncertainty without providing contradicting evidence. " +
			"- A [SYSTEM GUIDELINE INSTRUCTIONS: ASSUMPTION_CHALLENGED] message already appears " +
			"  in the conversation after the most recent contradicting message.",
		injectPrompt: ASSUMPTION_CHALLENGED_PROMPT,
		label: "advisory:assumption-challenged",
	});

	pi.registerGuideline({
		id: "research-uncertainties",
		triggerPrompt: researchUncertaintiesTrigger,
		injectPrompt: RESEARCH_UNCERTAINTIES_GUIDELINE_PROMPT,
		label: "advisory:research-uncertainties",
	});

	pi.registerContinuation({
		id: "research-uncertainties",
		triggerPrompt: researchUncertaintiesTrigger,
		injectPrompt: RESEARCH_UNCERTAINTIES_CONTINUATION_PROMPT,
		label: "advisory:research-uncertainties",
	});

	// --- Continuations (agent_end, sync) ---

	pi.registerContinuation({
		id: "code-workflow",
		triggerPrompt:
			"Does the current conversation call for code implementation as the next step — either " +
			"from a user directive to write or modify code, a completed code review with findings " +
			"to act on, or a Fleshing Out response with implementation candidates? " +
			"Strong signals that this APPLIES: " +
			"- A new feature, refactor, or architectural change where the approach is not yet determined. " +
			"- The change touches multiple files or components without a clear pre-existing plan. " +
			"- The agent would need to discover callers, data flows, or cross-file impacts before acting. " +
			"- A [SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW] has recently appeared with findings " +
			"  or suggestions to implement. " +
			"- The most recent assistant message is a Flesh Out response containing " +
			"  ## 🆕 CANDIDATE BEHAVIORS / ## ⚠️ CANDIDATE EDGE CASES and a ## 📝 RECOMMENDATIONS " +
			"  section — implement the recommended items. " +
			"Strong signals that this does NOT apply: " +
			"- A [SYSTEM CONTINUATION INSTRUCTIONS: CODE_WORKFLOW] has already been injected for " +
			"  this task — do not re-trigger for work already in progress or committed. " +
			"- The most recent assistant output contains only questions, an uncertainty report " +
			"  (⚠️ IMPLEMENTATION UNCERTAINTIES), or research points — without an accompanying code " +
			"  directive or Flesh Out recommendations. Questions and uncertainties are handled by " +
			"  RESEARCH_POINTS, not CODE_WORKFLOW. " +
			"- The agent's immediate task is to search, read, or explain code — not implement it. " +
			"- The user expresses future intent without directing the agent to act now " +
			"  (e.g., 'we should probably...', 'this might need to change', 'I think X should do Y'). " +
			"- Purely mechanical git operations with no new file edits. " +
			"Judgment heuristic: is code implementation the concrete next step, not just a future " +
			"possibility? Features, review fixes, and Flesh Out recommendations all qualify. " +
			"Questions, uncertainty reports, and research points alone do not.",
		injectPrompt: CODE_WORKFLOW_PROMPT,
		label: "advisory:code-workflow",
	});

	pi.registerContinuation({
		id: "review-after-implementation",
		triggerPrompt:
			"Does this conversation show a recently completed implementation pass that has not yet " +
			"been followed by a code review? " +
			"Strong signals that implementation is done: the agent wrote or modified code across " +
			"one or more files, the work appears substantively complete (not mid-slice), git commits " +
			"were made, or the agent's last action was finalizing or wrapping up code changes. " +
			"Strong signals that review is NOT needed yet: the agent is still actively implementing " +
			"(mid-slice, uncommitted changes), no code was written (search/read/explain only), " +
			"or only mechanical non-code changes were made (changelog, docs, config). " +
			"Idempotency: do not trigger if [SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW] has " +
			"already appeared in the conversation after the most recent implementation.",
		injectPrompt: REVIEW_PROMPT,
		label: "advisory:review",
	});

	pi.registerContinuation({
		id: "flesh-out-after-implementation",
		triggerPrompt:
			"Does this conversation show a recently completed NEW FEATURE implementation that has not " +
			"yet been through a flesh-out analysis? " +
			"These are representative signals — use them to calibrate your judgment. " +
			"Signals that flesh-out APPLIES: " +
			"- The agent implemented a new feature, new capability, significant architectural change, " +
			"  or meaningful new scope (not just fixing something existing). " +
			"- The user asked for something to be built or added that didn't exist before. " +
			"- The implementation is substantively complete (not mid-slice), with commits made. " +
			"Signals that flesh-out does NOT apply: " +
			"- The implementation was done in response to [SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW] " +
			"  findings — those are targeted fixes to existing scope, not new features. " +
			"- The user asked for a specific, bounded change: a bug fix, refactor, rename, or targeted edit. " +
			"- The agent is still actively implementing (mid-slice, uncommitted changes). " +
			"- No code was written (search/read/explain only). " +
			"- Only mechanical non-code changes were made (changelog, docs, config). " +
			"Idempotency: do not trigger if [SYSTEM CONTINUATION INSTRUCTIONS: FLESH_OUT] has " +
			"already appeared in the conversation after the most recent implementation.",
		injectPrompt: FLESH_OUT_PROMPT,
		label: "advisory:flesh-out",
	});

	pi.registerContinuation({
		id: "resume-task",
		triggerPrompt:
			"Does the conversation show an advisory workflow (CODE_WORKFLOW, FLESH_OUT, or CODE_REVIEW) " +
			"that has recently completed, where there was prior work from before the interruption " +
			"that has not yet been resumed? " +
			"These are representative signals — use them to calibrate your judgment. " +
			"Signals this APPLIES: " +
			"- A [SYSTEM CONTINUATION INSTRUCTIONS: CODE_WORKFLOW], [FLESH_OUT], or [CODE_REVIEW] " +
			"  appears in the conversation, the advisory appears to have completed (code committed, " +
			"  review done, or findings presented), AND the agent's response to that advisory " +
			"  explicitly noted something it was working on before (e.g. 'I was in the middle of X, " +
			"  I will return to it after this workflow'). " +
			"- The advisory completed AND the user's request that preceded the advisory injection " +
			"  was not fully addressed by the advisory itself. " +
			"Signals this does NOT apply: " +
			"- The agent is still mid-workflow (uncommitted changes, mid-review, mid-flesh-out). " +
			"- The advisory was triggered directly by the user's own request — it IS the full task. " +
			"- The agent has already resumed the original task after the advisory. " +
			"- No advisory injection appears in the conversation. " +
			"Idempotency: do not trigger if [SYSTEM CONTINUATION INSTRUCTIONS: RESUME_TASK] has " +
			"already appeared in the conversation after the most recent advisory completion.",
		injectPrompt: RESUME_TASK_PROMPT,
		label: "advisory:resume-task",
	});

	// --- /advisor command ---

	pi.registerCommand("advisor", {
		description:
			"Show advisory system status and registered guidelines/continuations. " +
			"Toggle: /advisor on | /advisor off",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") {
				pi.setAdvisoryEnabled(true);
				ctx.ui.notify("[advisory] enabled", "info");
				return;
			}
			if (arg === "off") {
				pi.setAdvisoryEnabled(false);
				ctx.ui.notify("[advisory] disabled", "warning");
				return;
			}
			await ctx.ui.custom<void>((_tui, _theme, _kb, done) => new AdvisoryStatusComponent(pi, done));
		},
	});

	// --- /learned command ---

	pi.registerCommand("learned", {
		description: "Mark the current session as learned (excludes it from pi --learn)",
		handler: async (_args, ctx) => {
			const id = ctx.sessionManager.getSessionId();
			try {
				await addLearnedSession(id);
				ctx.ui.notify(`Session ${id.slice(0, 8)}… marked as learned`, "info");
			} catch (err) {
				ctx.ui.notify(
					`Failed to mark session as learned: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
			}
		},
	});

	// --- Startup logging (fires after bindCore, so advisory API is live) ---

	pi.on("session_start", (_, ctx) => {
		const guidelines = pi.getGuidelines();
		const continuations = pi.getContinuations();

		// Apply --advisor flag if set.
		if (pi.getFlag("advisor") === true) {
			pi.setAdvisoryEnabled(true);
			if (ctx.hasUI) ctx.ui.notify("[advisory] enabled via --advisor", "info");
		}
	});

	// --- CLI flags ---

	pi.registerFlag("advisor", {
		description: "Enable the advisory system on startup",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("keep-branch-sessions", {
		description: "Keep branch sessions alive after completion (skip dispose) for debugging",
		type: "boolean",
		default: false,
	});
}
