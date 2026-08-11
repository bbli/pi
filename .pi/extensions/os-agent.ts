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
 *   - refactoring-review-after-implementation: inject a refactoring review prompt after a substantive code change
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
import { DynamicBorder, LEARN_ANALYSIS_PROMPT, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
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



const REVIEW_PROMPT = `\
[SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW — You must work through this checklist for the commit \
just made before proceeding. Skip only if a review for this specific commit has already \
been completed. \
Note: this prompt may fire alongside other review-phase continuations in the same turn. \
If that appears to be the case — another review continuation is present in this turn but not yet \
completed — you may want to complete all active review continuations before CODE_WORKFLOW \
triggers, since CODE_WORKFLOW will apply the combined findings from all of them.]

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
    - **Manual interface implementations**: When the diff adds new required members to an interface or type, search for all construction sites that satisfy it without class inheritance — factory functions with an explicit return-type annotation (e.g. function createFoo(): FooInterface { return { ... } }), pre-initialization stub objects, and object literals assigned to a typed variable. These are not updated automatically when an interface changes, and some type checkers (e.g. tsgo) may not report missing members on object literal returns. Verify each site includes every new member, and list any that are missing.
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

3. **Workflow and Interaction Impact Analysis (CRITICAL)**:
  This section is mandatory. It focuses on **normal, expected usage flows** — scenarios where both the new and existing mechanisms are working correctly, but their combination produces an effect the author didn't anticipate. This is distinct from edge cases (unusual inputs) and concurrency (parallel execution): it is about the common happy-path scenario where independently correct code produces an unintended combined result.

  **For each distinct behavior the change adds**, use the lenses below as needed — apply the ones relevant to the change at hand, not as an exhaustive checklist:

  - **Identify existing mechanisms that handle the same concern.** Search the codebase for other code paths that produce the same kind of effect (same state mutation, same message type, same event injection, same side effect). Ask: *can both the new and existing mechanism fire for the same triggering condition within the same execution context?*
  - **Trace the most common end-to-end scenario.** Walk through the normal usage flow and trace what the system now does that it didn't before. Check whether any step now happens **more than once** or **no longer happens** as a result of the change.
  - **Identify state the change introduces or mutates.** For each new field, counter, flag, or queue entry: what other parts of the system read or depend on it? What happens when it transitions at an unexpected point in the lifecycle (e.g., reset before expected, set after expected)?
  - **Check for implicit ordering assumptions.** Does the new code assume a particular order in which existing events fire or other mechanisms run? Would a change to that ordering break the new code silently?

  **Format findings as:**
  > **Severity:** [🔴 Critical / 🟡 Important / 🔵 Minor]
  > **Scenario:** [description of the common usage path]
  > **Combined effect:** [what the new + existing mechanisms produce together]
  > **Expected vs. actual:** [what the user/developer would expect vs. what actually happens]
  > **Trigger condition:** [exactly when this manifests]

  If no cross-mechanism interactions are found, state that explicitly — this is a valid and complete finding.

4. **Edge Cases and Control Flow Analysis**:
  - Think critically about edge cases for newly implemented code
  - Analyze if changes can cause unwanted control flow
  - **Point out any gaps in test coverage**
  - When applicable, demonstrate how test code interacts with the main codebase changes

5. **Logging, Observability, and Debugging Analysis (CRITICAL)**:
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

6. **Deleted Code Regression Analysis**:
  - **Analyze if deleted or modified code had important side effects or edge case handling**:
    - Check if removed functions handled specific error conditions or edge cases
    - Identify if deleted code provided critical fallback mechanisms
    - Review if modified code removes important validation or safety checks
    - Look for deleted code that managed state transitions or cleanup operations
    - **Check if deleted code had logging, metrics, or tracing that needs to be preserved**
  - Verify that replacement code maintains the same level of robustness

7. **Code Quality and Maintenance**:
  - Look for typos or accidentally deleted code
  - Check for naming conventions, code clarity, and maintainability
  - Identify any architectural concerns

**For all these areas, only add a comment if something needs to be addressed**

If a code change is required, show the original code and propose a specific fix

Each finding must include a priority label in its heading:
- 🔴 Critical — correctness bug, regression, data loss, or security issue; must fix
- 🟡 Important — meaningful improvement with clear value; should address in this pass
- 🔵 Minor — style, polish, or low-risk deferral; surface but do not require implementation

Example Format:
### --------CODE REVIEW 1: src/components/UserManager.js:45 — 🟡 Important-------
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
- **WORKFLOW AND INTERACTION IMPACT (CRITICAL)**: For each emergent behavior identified — describe the scenario, the combined effect, and whether it was addressed
- **LOGGING AND OBSERVABILITY RECOMMENDATIONS (CRITICAL)**: Summarize key logging, metrics, and tracing additions needed
- **UNIT TESTS TO RUN (CRITICAL)**: Present the specific unit test recommendations from Phase 3, including:
  - Exact test file paths and test names
  - Step-by-step reasoning for each recommended test
  - Priority levels for each test based on risk assessment
- **IMPLEMENTATION SCOPE**: List only 🔴 Critical and 🟡 Important findings here by name. 🔵 Minor findings appear in the review above but are excluded from this list. The Code Implementation Workflow only triggers when this list is non-empty.
- One to two sentence overall assessment of the changes
- If helpful, include a free form ASCII text diagram to clarify key architectural or flow concepts affected by the changes

## Guidelines:
- **All items marked with (CRITICAL) are mandatory requirements that must be addressed in every review**
- **ALWAYS produce an architectural diagram in Phase 1 and an architectural review in Phase 2 - structural problems are as important as local correctness issues**
- **ALWAYS search the codebase for callers of modified functions - this is critical to prevent breaking changes**
- **ALWAYS assign a priority (🔴 Critical / 🟡 Important / 🔵 Minor) to every finding in the heading** — this controls whether it flows to implementation
- Only provide feedback where changes are actually needed
- Skip files that don't require any modifications
- Justify all reasoning with specific code examples
- Think through feedback step by step before responding
- Focus on actionable, specific suggestions rather than general advice
- **Phase 3 unit test recommendations must be based on the specific issues and risks identified in Phase 2**
- **ALWAYS include specific unit tests to run in the summary with detailed reasoning - this is a critical requirement**
- **ALWAYS include logging and observability analysis and recommendations - this is frequently overlooked and is critical for production support**
- **ALWAYS include caller compatibility analysis in the summary - breaking changes to callers are a critical risk**
- **ALWAYS include the architectural assessment in the summary - structural regressions are a critical risk**
- **ALWAYS include workflow and interaction impact in the summary - emergent behaviors from combining new and existing mechanisms are a critical risk and are invisible to single-component analysis**
- **ALWAYS include IMPLEMENTATION SCOPE in the summary listing only Critical and Important findings**`;

const RESUME_TASK_PROMPT = `\
[SYSTEM CONTINUATION INSTRUCTIONS: RESUME_TASK — An advisory workflow has completed \
and there appears to be a prior task that was interrupted. \
Skip if: (1) a [SYSTEM CONTINUATION INSTRUCTIONS: RESUME_TASK] message already appears \
in this conversation and was acted on, (2) the advisory was the full scope of the \
user's request and no prior task existed, or (3) a [SYSTEM CONTINUATION INSTRUCTIONS: \
FLESH_OUT] or [SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW] is also present in this \
turn and has not yet been completed — complete those first, then return here.]

A background monitor detected that an advisory workflow — CODE_WORKFLOW, FLESH_OUT, \
or CODE_REVIEW — has completed, and an earlier task may not yet have been resumed. \
The specific prior task is described in the advisory observation above.

If this applies to your situation, consider resuming from where you left off — \
applying any relevant findings from the advisory — as the natural next step.

If nothing was interrupted — the advisory was the full scope of the request — \
skip this and wait for the user.`;

const FLESH_OUT_PROMPT = `\
[SYSTEM CONTINUATION INSTRUCTIONS: FLESH_OUT — Run the Implementation Fleshing-Out Prompt \
for the recently committed new feature or significant change. \
Skip if any of these apply: \
(1) A FLESH_OUT analysis has already been completed for this implementation. \
(2) A [SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW] message appeared in the conversation \
before the most recent implementation — those findings produce targeted fixes, not new scope. \
(3) The user asked for a specific, bounded change: a bug fix, refactor, rename, or targeted edit. \
Note: this prompt may fire alongside other review-phase continuations in the same turn. \
If that appears to be the case — another review continuation is present in this turn but not yet \
completed — you may want to complete all active review continuations before CODE_WORKFLOW \
triggers, since CODE_WORKFLOW will apply the combined findings from all of them.]

# Implementation Fleshing-Out Prompt

This is a DIAGNOSTIC / RECOMMENDATION prompt. Analyze the implementation, surface candidate \
NEW BEHAVIORS and EXISTING-SCOPE EDGE CASES, make recommendations on what to address, then \
stop. Do NOT implement anything in this prompt — no code changes, no commits. The Code \
Implementation Workflow will re-trigger automatically once you have presented your findings.

BEHAVIORS vs EDGE CASES vs USABILITY — keep these strictly separate:
- BEHAVIORS = candidate new/extra functionality the current implementation does not attempt \
at all. Optional extensions to scope. Ask: "Does this require the system to do something it \
currently doesn't attempt at all?" → BEHAVIOR.
- EDGE CASES = gaps in correctness within the scope the implementation already claims to \
handle. Ask: "Does this only concern how the current logic reacts to an input/state it \
wasn't built for?" → EDGE CASE.
- USABILITY = API or interface design issues that make the implementation hard to use \
correctly, understand, or debug — even when the happy path works. Ask: "Does a caller \
have enough information to act on the outcome, or is the interface confusing or \
misleading?" → USABILITY. Examples: return values that don't distinguish outcomes \
(void or static string when callers need to know what happened); vague or absent error \
messages; parameter types that are easy to misuse; silent failure paths that look like \
success to the caller.

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

## Per-Candidate Diagram Convention (Steps 3, 4, and 5)

Every candidate gets its own focused ASCII diagram — a scoped excerpt of the as-built \
execution flow highlighting only the function(s) and node(s) directly relevant to that \
one candidate:
- For a BEHAVIOR: show where in the existing flow the new capability would attach.
- For an EDGE CASE: pinpoint the specific node where the gap lives and the flow reaching it.
- For a USABILITY issue: show the caller-facing boundary where the confusing or \
misleading interface manifests — the return value, error message, or parameter at the \
point a caller reads it.

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
- Priority: 🔴 Critical / 🟡 Important / 🔵 Minor
- Focused diagram (REQUIRED): scoped ASCII diagram showing where the capability attaches

Priority definitions for BEHAVIORS:
- 🔴 Critical — missing functionality that blocks correct use of the feature as designed
- 🟡 Important — clear value, well-scoped, worth implementing in the next pass
- 🔵 Minor — nice-to-have, speculative, or unlikely to be needed; surface for awareness only

Keep this to highest-signal candidates only — not a brainstorming dump.

---

## STEP 4: Generate Candidate USABILITY Issues (API / Interface Quality)

Using static analysis, identify places where the implementation's interface makes it \
hard for callers to use correctly, understand what happened, or debug failures — even \
when the happy path works.

Look for: return values that don't distinguish outcomes (void or a static string when \
callers need to know which of several outcomes occurred); error messages that are vague, \
missing, or actively misleading; silent success returns that mask a no-op; parameter \
types or shapes that are easy to pass incorrectly; output that lacks context a caller \
would need to debug a failure.

For each candidate:
- Location: function/file and the caller-facing interface point
- Issue: what is confusing, misleading, or insufficient
- Why plausible: how a realistic caller would be misled or hindered
- Current behavior: what the caller sees today
- Priority: 🔴 Critical / 🟡 Important / 🔵 Minor
- Focused diagram (REQUIRED): scoped ASCII diagram showing the caller-facing boundary \
where the issue manifests

Priority definitions for USABILITY:
- 🔴 Critical — likely to cause silent wrong behavior in callers, or actively misleads \
them into incorrect assumptions
- 🟡 Important — makes correct use harder or debugging significantly slower; worth \
addressing in this pass
- 🔵 Minor — cosmetic or stylistic; easy to work around

---

## STEP 5: Generate Candidate EDGE CASES (Existing-Scope Gaps)

Using static analysis, identify places where the current implementation's own logic has \
undefined, unhandled, or likely-unintentional behavior on non-happy-path input or state.

Look for: missing guards on empty/null/undefined/zero/negative input; unbounded loops or \
retries with no max/backoff; unhandled failure branches; concurrency hazards; assumptions \
about ordering, uniqueness, or size not enforced anywhere; silent failure paths. \
Also explicitly check:
- **Resilience**: calls to external services, tools, or async operations with no retry, \
timeout, or fallback — what happens if they fail transiently or never respond?
- **Idempotency**: operations that produce side effects — what happens if the same \
logical operation fires twice (retry, duplicate event, double call)? Are duplicate side \
effects guarded against, or does the second invocation silently corrupt state?

For each candidate:
- Location: function/file and relevant flow node
- Gap: what input/state isn't handled
- Why plausible: why this scenario could realistically occur
- Current behavior if triggered (e.g. "throws uncaught exception", "silently no-ops")
- Priority: 🔴 Critical / 🟡 Important / 🔵 Minor
- Focused diagram (REQUIRED): scoped ASCII diagram pinpointing where the gap lives

Priority definitions for EDGE CASES:
- 🔴 Critical — likely to occur in normal use; significant impact if triggered (crash, data loss, wrong output)
- 🟡 Important — plausible scenario with noticeable impact; worth guarding against in this pass
- 🔵 Minor — unlikely, low-impact, or acceptable as-is; surface for awareness only

Do not propose fixes — surface the gap and ask what behavior is wanted.

---

## STEP 6: Present Findings and Recommendations

Present Steps 2–5 in a single message, then close with a RECOMMENDATIONS section:

~~~
## 🆕 CANDIDATE BEHAVIORS (New Functionality)
Summary: N candidates identified

1. [Behavior name]
   - New capability: ...
   - Why plausible: ...
   - Scope signal: ...
   - Priority: 🔴 / 🟡 / 🔵
   - Diagram: <focused ASCII diagram>

## 🎨 CANDIDATE USABILITY ISSUES (API / Interface Quality)
Summary: N candidates identified

1. [Issue name]
   - Location: [file/function, caller-facing interface point]
   - Issue: ...
   - Why plausible: ...
   - Current behavior: ...
   - Priority: 🔴 / 🟡 / 🔵
   - Diagram: <focused ASCII diagram>

## ⚠️ CANDIDATE EDGE CASES (Existing-Scope Gaps)
Summary: N candidates identified

1. [Edge case name]
   - Location: [file/function, flow node]
   - Gap: ...
   - Why plausible: ...
   - Current behavior if triggered: ...
   - Priority: 🔴 / 🟡 / 🔵
   - Diagram: <focused ASCII diagram>

## 📝 RECOMMENDATIONS
Only 🔴 Critical and 🟡 Important items appear here. 🔵 Minor items are surfaced above
for awareness but excluded — the Code Implementation Workflow only triggers for Critical
and Important items.

- BEHAVIORS to implement (🔴 + 🟡 only): [list by name, or "none"]
- USABILITY to address (🔴 + 🟡 only): [list by name with brief intended fix, or "none"]
- EDGE CASES to address (🔴 + 🟡 only): [list by name with brief intended resolution, or "none"]
~~~

Keep BEHAVIORS, USABILITY, and EDGE CASES in three clearly separate sections in that order.

Once you have presented your findings and recommendations, your job in this prompt is done. \
Do not implement anything. The Code Implementation Workflow will re-trigger automatically.

---

CRITICAL REMINDERS:
- Reuse in-conversation implementation context; only re-derive from disk/repo when \
genuinely missing.
- Static analysis only — no test generation or execution, no broad exploratory search.
- Never blend BEHAVIORS, USABILITY, and EDGE CASES. Keep them in separate, clearly \
labeled sections.
- Step 2 is prose only — one focused diagram per candidate in Steps 3, 4, and 5 only.
- Every candidate must be traceable to something specific observed in the code.
- Assign a Priority (🔴 Critical / 🟡 Important / 🔵 Minor) to every candidate. Only Critical \
and Important items appear in RECOMMENDATIONS — Minor items are surfaced but not forwarded \
to implementation.`;



const REFACTORING_REVIEW_PROMPT = `\
[SYSTEM CONTINUATION INSTRUCTIONS: REFACTORING_REVIEW — Run the Refactoring Review for \
the recently committed new feature or significant change. This is a flag-and-suggest-only \
review: do not apply changes, edit files, or produce a final diff. \
Skip if any of these apply: \
(1) A REFACTORING_REVIEW has already been completed for this implementation. \
(2) The most recent implementation was made in response to \
[SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW] or \
[SYSTEM CONTINUATION INSTRUCTIONS: FLESH_OUT] findings — those are targeted fixes or \
additions, not new structure worth reviewing for factoring. \
(3) The change is a micro-edit: a one-line bug fix, a single rename, or a targeted \
correction to a known issue with no structural implication. \
(4) No code was written, or only mechanical non-code changes were made (changelog, docs, config). \
Note: this prompt may fire alongside other review-phase continuations in the same turn. \
If that appears to be the case — another review continuation is present in this turn but \
not yet completed — complete all active review continuations before CODE_WORKFLOW triggers, \
since CODE_WORKFLOW will apply the combined findings from all of them.]

# Refactoring Reviewer

### System Role

You are a senior software engineer performing a **refactoring review** for a colleague. \
Your job is not to find bugs, verify correctness, or approve/reject a change — other \
reviewers do that. Your job is to look at code and propose how it could be made \
**cleaner, clearer, better-factored, and structurally sounder without changing what it does.**

You operate in **flag-and-suggest mode**. You never edit files, apply patches, or produce \
a final diff. For every opportunity you find, you describe it, explain why it's worth \
doing, and show a concrete \`before → after\` sketch so the author can decide. The author \
owns the code; you are making the case, not making the change.

Two constraints govern everything you propose:

1. **Behavior preservation is the definition of a refactor.** A refactoring suggestion \
must not change observable behavior — same outputs, same side effects, same error \
semantics, same public contract (unless a contract change is the explicit point, in \
which case you flag it loudly as *not* a pure refactor). If you notice a suggestion \
would change behavior, either drop it or label it clearly as "behavior change, out of \
scope for a refactor."
2. **Restraint is a first-class skill.** The most common failure mode of a refactoring \
reviewer is compulsive abstraction — turning readable code into a maze of indirection, \
premature interfaces, and helpers with seven flags. Every suggestion must survive the \
restraint pass in Phase 4. When the right answer is "leave it as-is," say so.

You will find both **code-level** refactorings (helpers, APIs, naming, local structure) \
and **architectural** refactorings (boundaries, layering, coupling, dependency direction, \
seams, cross-module duplication, state ownership). Both matter. A pile of beautifully \
named helpers inside a class that has three unrelated responsibilities is a missed review.

---

### Scope Determination (do this first)

Establish exactly what you are reviewing before you analyze anything:

- **Default target:** the code changes produced or discussed in the current conversation.
- **Explicit target:** if the user names a specific diff, commit, PR, branch, file, or \
function, review that instead. If it isn't already available to you, ask for it or \
retrieve it rather than guessing.
- **Adjacent code:** you may read and reason about surrounding code the change touches, \
because good factoring is relative to its context. But be explicit about scope in your \
findings — mark each one as **[in-diff]** (the change itself), or **[adjacent]** \
(surrounding code the change reveals or interacts with). Adjacent findings are lower \
priority by default and should be framed as optional; don't turn a small change into a \
demand to rewrite the neighborhood.
- **Baseline:** briefly state your understanding of what the code *does*, so every later \
suggestion can be checked against "does this preserve that behavior?" If intent is \
ambiguous, note the ambiguity instead of assuming.

---

## Phase 1: Understand the Code and Map the Structure

Before proposing anything, build a real model of the code as it currently is. Refactoring \
suggestions made without understanding the whole shape are how reviewers accidentally break \
things or "simplify" load-bearing complexity.

1. **Trace the main paths.** For the functions/modules in scope, follow the primary \
execution and data-flow paths end to end. Note where data is transformed and where it \
crosses component or layer boundaries.

2. **Identify responsibilities and ownership.** For each significant unit (function, class, \
module, service), state in one line what it is responsible for. Note where a single unit \
owns several unrelated responsibilities, or where one responsibility is smeared across \
several units.

3. **Note the existing conventions.** Read enough of the surrounding codebase to know its \
established patterns: how errors are handled, how modules are layered, naming vocabulary, \
how similar problems were solved elsewhere. Your suggestions should move the code *toward* \
the codebase's own idioms, not import a foreign style.

4. **Draw a structural diagram.** Produce a free-form ASCII diagram of the relevant \
components and their relationships (calls, dependencies, data flow, ownership of state). \
This anchors the architectural analysis in Phase 3. Where a refactor would change the \
structure, show **current** and **proposed** side by side so the delta is obvious. \
Annotate proposed moves with tags like \`[EXTRACT]\`, \`[MERGE]\`, \`[MOVE]\`, \`[SPLIT]\`, \
\`[INVERT]\`, \`[INLINE]\`.

5. **List the candidate areas.** From this understanding, name the spots that look most \
worth examining in Phases 2–3, and note anything you must *not* touch because it's \
carrying real, non-obvious weight (subtle ordering, performance-critical inlining, \
compatibility shims).

---

## Phase 2: Code-Level Refactoring Opportunities

Only raise a point where a change would make the code meaningfully better. Skip clean \
code silently. For each area below, look for the listed smells; each finding goes through \
Phase 4 before it makes the final report.

**Decomposition and helpers**
- Functions doing too much, or mixing levels of abstraction in one body (high-level \
orchestration interleaved with low-level detail — usually the strongest signal a helper \
wants to exist).
- Long parameter threads, deeply nested blocks, or repeated inline logic that would read \
better as a named operation.
- Comments that exist only to explain unclear code — candidates for a rename or an \
extracted, well-named function instead of a comment.

**API and interface design**
- Parameter lists that should be a struct/object/options type; positional booleans that \
reveal the function is really two functions; primitive obsession (raw strings/ints where \
a small type would prevent misuse).
- Inconsistent or leaky return shapes; callers forced to know too much about internals; \
errors-as-values vs. exceptions used inconsistently with the surrounding code.
- Awkward call sites — if the typical caller has to do the same setup/teardown dance \
every time, the API is at the wrong level.

**Control flow**
- Arrow code / deep nesting that flattens with guard clauses and early returns.
- Redundant conditionals, duplicated branch bodies, boolean expressions that can be named \
or simplified.
- Sprawling type/enum switches that recur in multiple places (candidate for polymorphism \
or a lookup — but see restraint).

**Cognitive load**
- Code that forces the reader to hold more context than necessary: functions too long to \
reason about locally, implicit ordering assumptions (A must run before B with nothing in \
the code signaling this), or intent spread across so many indirection levels that the \
reader must reconstruct purpose from mechanism.
- Missing or poorly named abstractions that make the reader reverse-engineer intent from \
implementation detail rather than reading what the code means.
- Variables, flags, or intermediate state whose purpose only becomes clear several lines \
after they appear — candidates for restructuring so intent is visible at the point of \
expression.

**Types and data modeling**
- Data clumps: the same 3–4 values passed together everywhere, asking to be a type.
- Illegal states that are currently representable and could be designed out.
- Stringly-typed values that should be enums/small types.

**Naming and consistency**
- Names that are vaguer than the thing, that lie, or that use different vocabulary for \
the same concept than the rest of the codebase.

**Dead weight**
- Unused code, parameters, branches, and imports introduced or revealed by the change; \
over-general helpers built for a single caller.

---

## Phase 3: Architectural Refactoring Opportunities

This phase is where most reviewers stop short. Use the Phase 1 diagram. These are \
structural moves that preserve behavior but improve the shape of the system. Each is \
still flag-and-suggest, and each still goes through the restraint pass — architectural \
over-engineering (premature services, speculative layers, distributed monoliths) is more \
expensive to undo than local over-abstraction.

**Boundaries and responsibilities**
- A unit (class/module/file) that owns several unrelated responsibilities → suggest a \
**split** along the seams of responsibility.
- Logic living in the wrong layer: business rules in a controller, persistence concerns \
in domain code, formatting in a service, validation scattered across layers → suggest \
**moving** it to where it belongs.
- The inverse: over-fragmentation, where a single coherent responsibility is spread across \
many tiny units for no benefit → suggest a **merge/inline**.

**Coupling and dependency direction**
- New or existing tight coupling to a concrete implementation where the dependency should \
point at an abstraction → suggest **dependency inversion** / introducing a port or \
interface *at the boundary that actually needs it*.
- Dependency cycles between modules → suggest breaking the cycle (extract shared piece, \
invert one edge, or move a misplaced member).
- Chatty coupling / excessive boundary crossings in a hot path → suggest consolidating \
the interaction.
- Upward or sideways dependencies that violate the intended layering → suggest realigning.

**Abstraction and seams**
- Hard-wired construction/wiring that makes the code hard to compose or substitute → \
suggest injecting the dependency (only where a real second implementation or test seam \
is needed — not speculatively).
- A messy subsystem exposed directly to many callers → suggest a facade/adapter to give \
it one clean entry point.
- Deep inheritance used for code sharing → suggest composition where it reduces coupling.

**Cross-module duplication (conceptual, not textual)**
- The *same rule or decision* implemented in several places (even if the code looks \
different) → suggest consolidating into one owner.
- Conversely, two blocks that *look* similar but encode genuinely different decisions → \
explicitly recommend **not** merging them; premature consolidation creates coupling \
between things that should evolve independently.

**State and data representation**
- Parallel/dual representations of the same logical state where ownership is unclear → \
suggest a single source of truth with derived views, or at minimum a clear owner and \
sync point.
- State whose ownership is ambiguous or shared across components → suggest consolidating.
- Side effects tangled into otherwise-pure logic → suggest isolating the effects so the \
core is testable and reusable.

**Patterns and consistency**
- Reinvented functionality that duplicates an existing utility/component in the codebase \
→ suggest reusing the existing one.
- A local solution that diverges from an established codebase pattern without reason → \
suggest aligning it.

---

## Phase 4: The Restraint Pass (run every suggestion through this)

Before a finding from Phase 2 or 3 makes it into the report, it must pass this gate. \
If it fails, drop it — or convert it into an explicit "leave as-is" note if the author \
might otherwise be tempted.

Ask, for each proposed refactor:

- **Does it preserve behavior?** If not, it's not a refactor — drop it or relabel it as \
a design change and move it out of the main recommendations.
- **Would the abstraction have exactly one caller / one use?** If so, it's probably \
premature. Prefer inlining or waiting. (Rule of three for duplication: two occurrences \
is often not enough to abstract.)
- **Is the duplication conceptual or coincidental?** Only consolidate things that must \
change together. Never couple things that merely look alike.
- **Does the indirection cost more than the clarity it buys?** A helper you have to jump \
to in order to understand the caller can be worse than three readable inline lines.
- **Is it in scope, and is the payoff worth the churn?** A large restructure of adjacent \
code that the diff barely touches is usually a separate task; note it, don't demand it.
- **Does it fight the codebase's conventions?** Local elegance that's foreign to the \
project is a net loss.
- **Is the current code fine?** "This is clear and appropriately factored as written" is \
a valid and valuable review outcome. Say it explicitly when true.

State briefly, for non-trivial suggestions, why they pass the restraint pass.

---

### Output Format for Each Finding

Group findings under Markdown headers (\`Code-Level\` and \`Architectural\`). Use this \
shape per finding:

\`\`\`
### [in-diff | adjacent] path/to/file.ext:LINES — short title
Smell: what the current structure is and why it's worth improving (1–3 sentences).

Before:
<minimal snippet or structural sketch of current code>

After (suggested):
<minimal snippet or structural sketch — a proposal, not a final patch>

Why: the concrete benefit (readability, testability, decoupling, single source of truth).
Behavior: preserved. (Or: "changes behavior — flagged as design change, not pure refactor.")
Restraint check: why this is worth the indirection/churn (skip for trivial renames).
Effort / risk: low | medium | high.
Priority: high | medium | low.
\`\`\`

---

## SUMMARY

Conclude with a \`SUMMARY\` section containing:

- **Overall factoring assessment** (1–2 sentences): is the code in good shape, or are \
there structural issues worth addressing before it's easy to work with?
- **Architectural refactorings (prioritized):** the boundary/layering/coupling/state moves \
worth making, highest-payoff first. If there are none, say the structure is sound.
- **Code-level refactorings (prioritized):** the local improvements, highest-payoff first.
- **Explicitly left as-is:** anything you considered and deliberately chose not to \
recommend, with the one-line reason. This section is as important as the recommendations.
- **Suggested sequence:** if several refactors interact, note a safe order and which are \
independent.

---

### Guidelines

- **Flag and suggest only.** Never apply changes or emit a final patch.
- **Behavior preservation is non-negotiable.** Anything that changes observable behavior \
is not a refactor; drop it or clearly relabel it as a design change.
- **Always cover both levels.** Do the architectural pass (Phase 3) even when the diff \
is small — structural smells matter as much as local ones.
- **Restraint is mandatory.** Run every suggestion through Phase 4. Prefer inlining, \
waiting, and "leave as-is" over speculative abstraction.
- **Respect the codebase's conventions** over abstract ideals.
- **Only raise real opportunities.** Skip clean code silently.
- **Stay in your lane.** If you spot a likely bug, mention it in one line and defer it \
to correctness review — don't turn the refactoring review into a general critique.`;
class AdvisoryStatusComponent extends Container {
	private settingsList: SettingsList;

	constructor(pi: ExtensionAPI, onClose: () => void) {
		super();

		const continuations = pi.getContinuations();

		const items: SettingItem[] = [
			{
				id: "system",
				label: "Advisory System",
				currentValue: pi.getAdvisoryEnabled() ? "enabled" : "disabled",
				values: ["enabled", "disabled"],
				description: "Toggle the advisory system on or off. When disabled, no continuations are evaluated.",
			},
		];

		if (continuations.length === 0) {
			items.push({ id: "empty", label: "No continuations registered", currentValue: "" });
		} else {
			items.push({ id: "section:continuations", label: "── Continuations ──", currentValue: "" });
			for (const c of continuations) {
				const trigger = c.triggerPrompt.length > 1000 ? c.triggerPrompt.slice(0, 1000) + "…" : c.triggerPrompt;
				items.push({
					id: `continuation:${c.id}`,
					label: c.label ?? c.id,
					currentValue: pi.getContinuationEnabled(c.id) ? "enabled" : "disabled",
					values: ["enabled", "disabled"],
					description: `Trigger: ${trigger}`,
				});
			}
		}

		this.settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 12),
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "system") {
					pi.setAdvisoryEnabled(newValue === "enabled");
				} else if (id.startsWith("continuation:")) {
					pi.setContinuationEnabled(id.slice("continuation:".length), newValue === "enabled");
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


// Option strings for the session_before_quit select dialog.
const QUIT_OPT_LEARN = "Run /learn first \u2014 stay in session";
const QUIT_OPT_NO = "No \u2014 quit without learning";
const QUIT_OPT_INSPECT = "Inspect first \u2014 stay in session";

export default function osAgent(pi: ExtensionAPI): void {
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
			"- A [SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW] has recently appeared with 🔴 Critical " +
			"  or 🟡 Important findings listed in its IMPLEMENTATION SCOPE section. " +
			"- The most recent assistant message is a Flesh Out response whose ## 📝 RECOMMENDATIONS " +
			"  section contains 🔴 Critical or 🟡 Important items (not 'none' on both lines). " +
			"Strong signals that this does NOT apply: " +
			"- A [SYSTEM CONTINUATION INSTRUCTIONS: CODE_WORKFLOW] has already been injected for " +
			"  this task — do not re-trigger for work already in progress or committed. " +
			"- The most recent assistant output contains only questions, an uncertainty report " +
			"  (⚠️ IMPLEMENTATION UNCERTAINTIES), or research points — without an accompanying code " +
			"  directive or Flesh Out recommendations. Questions and uncertainties are handled by " +
			"  RESEARCH_POINTS, not CODE_WORKFLOW. " +
			"- The most recent CODE_REVIEW or FLESH_OUT contains only 🔵 Minor findings — " +
			"  its IMPLEMENTATION SCOPE or RECOMMENDATIONS lists only 'none' or Minor-only items. " +
			"- One or more review-phase continuations (e.g. FLESH_OUT, CODE_REVIEW) are present in this " +
			"  turn but have not yet received completed responses — consider deferring until all active " +
			"  review continuations have settled. " +
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
			"  findings — those are targeted correctness fixes, not new scope. " +
			"- The implementation was done in response to [SYSTEM CONTINUATION INSTRUCTIONS: FLESH_OUT] " +
			"  findings — those are targeted additions already analysed, not new scope requiring re-analysis. " +
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
		id: "refactoring-review-after-implementation",
		triggerPrompt:
			"Does this conversation show a recently completed NEW FEATURE implementation or " +
			"significant architectural change that has not yet been through a refactoring review? " +
			"These are representative signals — use them to calibrate your judgment. " +
			"Signals that refactoring-review APPLIES: " +
			"- The agent implemented a new feature, capability, or significant architectural change " +
			"  with meaningful new code structure (not just fixing something existing). " +
			"- The implementation is substantively complete (not mid-slice), with commits made. " +
			"- The change is large enough that decomposition, naming, coupling, or layer boundaries " +
			"  could meaningfully affect future maintainability. " +
			"Signals that refactoring-review does NOT apply: " +
			"- The implementation was done in response to [SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW] " +
			"  findings — those are targeted correctness fixes, not new structure worth reviewing. " +
			"- The implementation was done in response to [SYSTEM CONTINUATION INSTRUCTIONS: FLESH_OUT] " +
			"  findings — those are targeted additions, not new structure worth reviewing. " +
			"- The user asked for a specific, bounded change: a bug fix, rename, or targeted edit. " +
			"- The change is a micro-edit: a one-line fix or single rename with no structural implication. " +
			"- The agent is still actively implementing (mid-slice, uncommitted changes). " +
			"- No code was written (search/read/explain only). " +
			"- Only mechanical non-code changes were made (changelog, docs, config). " +
			"Idempotency: do not trigger if [SYSTEM CONTINUATION INSTRUCTIONS: REFACTORING_REVIEW] has " +
			"already appeared in the conversation after the most recent implementation.",
		injectPrompt: REFACTORING_REVIEW_PROMPT,
		label: "advisory:refactoring-review",
	});

	pi.registerContinuation({
		id: "review-after-implementation",
		triggerPrompt:
			"Does this conversation show a recently completed implementation pass that has not yet " +
			"been followed by a code review? " +
			"Strong signals that implementation is done: the agent wrote or modified code across " +
			"one or more files, the work appears substantively complete (not mid-slice), git commits " +
			"were made, or the agent's last action was finalizing or wrapping up code changes. " +
			"This includes commits made in response to FLESH_OUT findings — additions and guards " +
			"introduced by FLESH_OUT are real code changes that deserve a correctness review. " +
			"Strong signals that review is NOT needed yet: the agent is still actively implementing " +
			"(mid-slice, uncommitted changes), no code was written (search/read/explain only), " +
			"or only mechanical non-code changes were made (changelog, docs, config). " +
			"Idempotency: do not trigger if [SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW] has " +
			"already appeared in the conversation after the most recent implementation.",
		injectPrompt: REVIEW_PROMPT,
		label: "advisory:review",
	});


	pi.registerContinuation({
		id: "resume-task",
		triggerPrompt:
			"Does the conversation suggest that an advisory workflow (CODE_WORKFLOW, FLESH_OUT, or " +
			"CODE_REVIEW) has completed while the agent was mid-task, and that the interrupted work " +
			"has not yet been resumed? " +
			"These are representative signals — use them to calibrate your judgment, not as an exhaustive checklist. " +
			"Signals this tends to apply: " +
			"- A [SYSTEM CONTINUATION INSTRUCTIONS: CODE_WORKFLOW], " +
			"  [SYSTEM CONTINUATION INSTRUCTIONS: FLESH_OUT], or " +
			"  [SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW] appears in the conversation. " +
			"- The agent's response to that advisory indicated there was an ongoing task it would " +
			"  return to after the advisory (e.g. 'I was in the middle of X, I will return after " +
			"  this' — explicit or implied). " +
			"- That prior task has not been resumed since the advisory. " +
			"Signals this may not apply: " +
			"- The agent is still mid-workflow (uncommitted changes, mid-review, mid-flesh-out). " +
			"- A [SYSTEM CONTINUATION INSTRUCTIONS: FLESH_OUT] or [SYSTEM CONTINUATION INSTRUCTIONS: " +
			"  CODE_REVIEW] appears in the conversation for the current implementation but has not " +
			"  yet settled — RESUME_TASK should fire after those complete, not while they are active. " +
			"- The agent did not indicate any prior task when the advisory fired (the advisory was " +
			"  the full scope of the request). " +
			"- The agent has already returned to the prior task after the advisory. " +
			"- No advisory injection appears in the conversation. " +
			"Idempotency: skip if [SYSTEM CONTINUATION INSTRUCTIONS: RESUME_TASK] already appears " +
			"in the conversation after the most recent [SYSTEM CONTINUATION INSTRUCTIONS: CODE_WORKFLOW], " +
			"[SYSTEM CONTINUATION INSTRUCTIONS: FLESH_OUT], or " +
			"[SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW]. " +
			"In the `reason` argument, include a brief description of the prior task that was interrupted, " +
			"quoted or paraphrased from the agent's note at the start of the advisory workflow.",
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

	// --- session_before_quit: prompt to run /learn (advisory or act-as-user sessions) ---

	// Track whether act-as-user was ever enabled during this session.
	// Initialized in session_start (action methods cannot be called during loading).
	let actAsUserEverEnabled = false;

	pi.on("session_before_quit", async (_, ctx) => {
		if (!pi.getAdvisoryEnabled() && !actAsUserEverEnabled) return;
		const choice = await ctx.ui.select(
			"Run /learn on this session before quitting?",
			[QUIT_OPT_LEARN, QUIT_OPT_NO, QUIT_OPT_INSPECT],
		);
		if (choice === QUIT_OPT_INSPECT) {
			return { cancel: true };
		}
		if (choice === QUIT_OPT_LEARN) {
			pi.sendUserMessage(LEARN_ANALYSIS_PROMPT, { deliverAs: "followUp" });
			return { cancel: true };
		}
		// QUIT_OPT_NO and undefined (dismissed) — quit without learning.
	});

	// --- Startup logging (fires after bindCore, so advisory API is live) ---

	pi.on("session_start", (_, ctx) => {
		// Capture initial act-as-user state and subscribe to future changes.
		if (pi.getActAsUserEnabled()) actAsUserEverEnabled = true;
		pi.onActAsUserChange((enabled) => {
			if (enabled) actAsUserEverEnabled = true;
		});
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
