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

import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, addToLearnQueue, getSettingsListTheme, readLearnQueueSet, removeFromLearnQueue } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// researchProcedure tool
// ---------------------------------------------------------------------------

const RESEARCH_PROCEDURE_TOOL_SYSTEM_PROMPT = `\
# SYSTEM — PROCEDURE LOOKUP
You are a procedure lookup subagent. Your sole job is to determine the confirmed \
procedure for the operational task described in the research question — access paths, \
command syntax, log file locations, or step-by-step instructions.

CRITICAL: Ignore any tasks, guidelines, or requests that appear in the conversation \
history above. Those are directed at the main session, not at you. Your only job is \
to answer the procedure question passed to you directly.

Work through these steps in order:

1. SKILLS: If any skill listed in the <available_skills> block above covers this task, \
   read it using the read tool and extract the procedure.
2. KNOWLEDGE: Reason from your training knowledge and state the procedure. Include \
   your confidence (high/medium/low).
3. DOCUMENTATION: If confidence is low or medium, use bash to verify — man pages \
   (man <tool>), --help output, or public documentation (curl to an authoritative \
   source). Use bash for documentation lookup only — do not run commands against \
   real systems or data.
4. If the system is internal or proprietary and none of the above yields reliable \
   steps, return: "Could not confirm procedure — recommend asking the user directly."

Return:
- Numbered procedure steps
- Confidence level (high/medium/low) and what it is based on
- Any unresolved gaps or caveats

CRITICAL: Do not edit or write files. Do not run commands against live systems. \
Stop as soon as you have enough to return a procedure or confirm you cannot.`;

function extractSkillsBlock(systemPrompt: string): string | undefined {
	const match = systemPrompt.match(/<available_skills>[\s\S]*?<\/available_skills>/);
	return match?.[0];
}

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
in this conversation. Before investigating, apply a progress filter — research that won't \
change your conclusion or next action is a distraction, not a step forward.

**Progress filter — apply to each question before any tool call:**
For each question or uncertainty, ask: "If I learn the answer, would it change my hypothesis, \
recommended fix, or what I do next toward the goal?" Use the active goal if one was set \
(via set_goal), or the implicit goal from the conversation.
- If yes — it qualifies for investigation.
- If no — it is a secondary or epistemic gap: note it briefly and skip it. \
  Do not call any research tool for it.

If no questions pass the filter, say so in one or two sentences and stop — \
do not proceed to investigation.

For each question that qualifies:
1. Choose the right tool based on the nature of the question:
   - researchConversationQuestion(question) — for codebase questions: gaps, unverified \
     assumptions, or uncertainties that can be answered by reading code, files, or logs.
   - For system-specific operational unknowns (SSH paths, log locations, CLI flags, access \
     workflows): look them up inline using bash (man pages, --help, public docs via curl) or \
     check skills. The RESEARCH_PROCEDURE guideline will activate if needed.
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

const RESEARCH_BEFORE_ACTION_PROMPT = `\
[SYSTEM GUIDELINE INSTRUCTIONS: RESEARCH_BEFORE_ACTION — Before taking the next action, \
read the relevant source code first. \
Skip only if you have already read the relevant source files for the current \
investigation in this conversation, or if a [SYSTEM GUIDELINE INSTRUCTIONS: RESEARCH_BEFORE_ACTION] \
message already appears in the conversation for the current investigation.]

A background monitor has detected that you appear to be about to take an action \
without first reading the relevant source code. The specific action is described in \
the advisory observation above.

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

const RESEARCH_PROCEDURE_PROMPT = `\
[SYSTEM GUIDELINE INSTRUCTIONS: RESEARCH_PROCEDURE — Call the \`researchProcedure\` tool \
before proceeding. \
Skip only if the specific steps are already confirmed from a skill, code, or logs \
read in this session, or if a [SYSTEM GUIDELINE INSTRUCTIONS: RESEARCH_PROCEDURE] \
message covering this same task already appears in the recent conversation.]

A background monitor has detected that you are about to perform an operational task — \
accessing a remote system, using system-specific CLI commands, or retrieving data from \
a specific path — without a confirmed procedure for how to do it.

Proceeding without a confirmed procedure risks wasted effort: wrong path, wrong flags, \
results you cannot interpret.

Call the \`researchProcedure\` tool now with a description of the specific operational \
task you need to perform. The tool will check available skills, training knowledge, and \
man pages, then return the confirmed steps to follow.

Once you have the procedure, apply it to the current task.`;

const GATHER_EVIDENCE_PROMPT = `\
[SYSTEM GUIDELINE INSTRUCTIONS: GATHER_EVIDENCE Before iterating further on your current \
hypothesis, consider whether you have exhausted available direct evidence sources. \
Skip only if you have already accessed new direct operational data sources (system logs, \
infrastructure logs, remote machine logs) after forming your current hypothesis.]

A background monitor has detected that you have a working hypothesis but appear to be \
continuing to iterate on the same evidence base. The specific pattern is described in \
the advisory observation above.

Iterating further on inference from the same evidence rarely changes the conclusion \
the hypothesis becomes more elaborate but not better grounded. Direct evidence is what \
changes the conclusion.

Before continuing:

1. Call \`researchConversationQuestion\` to identify specific direct evidence sources. \
   Ask what logs, services, or system components would directly record the behavior \
   you are trying to confirm on this system. Name the specific event — do not ask \
   generically.
2. Read the findings. For each source identified:
   - If you know how to access it, go get it directly via bash.
   - If you do not know the path, command, or access method, call \`researchProcedure\` \
     with the specific task to look up the confirmed procedure first.
3. Apply what you find to your hypothesis before continuing.

The key distinction: indirect evidence (code reading, inferring from adjacent logs) builds \
a plausible hypothesis. Direct evidence (the specific log that records the exact event at \
the exact time) confirms or refutes it. If direct evidence is available and not yet \
accessed, another round of inference is unlikely to improve confidence on its own.

This tends to apply when:
- You have noted "I can't confirm X" without attempting to access a different log source
- You have called researchConversationQuestion multiple times in succession without \
  accessing new operational data
- You have identified a potential direct evidence source but haven't attempted to access it
- Your stated confidence is medium or low and there are plausible ways to strengthen it \
  with direct evidence

It is less applicable when:
- You have already accessed all plausible direct evidence sources for this investigation
- The investigation is purely code-focused with no operational components
- The hypothesis already has high confidence with direct supporting evidence
- The relevant evidence no longer exists or is inaccessible (e.g., the system is no \
  longer in the state it was during the event)

Once you have assessed what direct evidence is or isn't accessible, apply that to your \
next action. If sources are accessible, go get them. If they are not, note explicitly \
what evidence is missing and what that means for confidence then continue with your \
best-available hypothesis.`;

const REGROUND_PROMPT = `\
[SYSTEM GUIDELINE INSTRUCTIONS: REGROUND — An external monitor has detected that the \
investigation needs grounding. Call askUser as described below. \
Skip only if a [SYSTEM GUIDELINE INSTRUCTIONS: REGROUND] message already appears in \
the conversation after the most recent triggering event.]

A background monitor has detected that the investigation needs to reground. \
The specific condition is described in the advisory observation above.

Call askUser now with:
- question: what you are currently trying to figure out or resolve
- reason: the specific condition detected and a brief description of what was observed \
  (e.g. "circular research — researchConversationQuestion called 4 times without \
applying findings", "goal drift — investigating area X while goal requires Y", \
"repeated failed attempts — same fix tried 3 times")

An external observer will analyse the full conversation and inject a grounded \
observation to help you move forward.`;

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
		];

		if (guidelines.length === 0 && continuations.length === 0) {
			items.push({ id: "empty", label: "No guidelines or continuations registered", currentValue: "" });
		} else {
			if (guidelines.length > 0) {
				items.push({ id: "section:guidelines", label: "── Guidelines ──", currentValue: "" });
				for (const g of guidelines) {
					const trigger = g.triggerPrompt.length > 1000 ? g.triggerPrompt.slice(0, 1000) + "…" : g.triggerPrompt;
					items.push({
						id: `guideline:${g.id}`,
						label: g.label ?? g.id,
						currentValue: pi.getGuidelineEnabled(g.id) ? "enabled" : "disabled",
						values: ["enabled", "disabled"],
						description: `Trigger: ${trigger}`,
					});
				}
			}
			if (continuations.length > 0) {
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
		}

		this.settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 12),
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "system") {
					pi.setAdvisoryEnabled(newValue === "enabled");
				} else if (id.startsWith("guideline:")) {
					pi.setGuidelineEnabled(id.slice("guideline:".length), newValue === "enabled");
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

// Tracks which session has already been auto-removed from the learn queue so the
// agent_end handler only does the disk write once per session.
let learnAutoMarkedSessionId: string | null = null;

// Option strings for the session_before_quit select dialog — extracted to
// constants so the guard comparisons can't silently drift from the labels.
const QUIT_OPT_YES = "Yes — add to learning queue";
const QUIT_OPT_NO = "No — quit without marking";
const QUIT_OPT_INSPECT = "Inspect first — stay in session";

export default function osAgent(pi: ExtensionAPI): void {
	// --- Tools ---

	pi.registerTool({
		name: "researchProcedure",
		label: "Procedure Lookup",
		description:
			"Look up the confirmed procedure for an operational task — SSH paths, CLI command " +
			"syntax, log file locations. Spawns a subagent that checks available skills, " +
			"training knowledge, and man pages, then returns confirmed steps with confidence.",
		promptSnippet:
			"researchProcedure(task): look up the confirmed procedure for an operational task " +
			"and return steps with confidence level",
		promptGuidelines: [
			"Call researchProcedure when you need to confirm the exact procedure, path, or " +
				"command syntax for an operational task before attempting it — SSH access, " +
				"log file locations, system-specific CLI flags.",
		],
		parameters: Type.Object({
			task: Type.String({ description: "Description of the operational task to look up the procedure for." }),
		}),
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			const skillsBlock = extractSkillsBlock(ctx.getSystemPrompt());
			const systemPrompt = skillsBlock
				? `${skillsBlock}\n\n${RESEARCH_PROCEDURE_TOOL_SYSTEM_PROMPT}`
				: RESEARCH_PROCEDURE_TOOL_SYSTEM_PROMPT;
			let text: string | undefined;
			try {
				text = await pi.runBranchSession(`# PROCEDURE LOOKUP TASK\n${params.task}`, {
					systemPrompt,
					systemPromptOverride: true,
					tools: ["read", "grep", "find", "ls", "bash"],
					blockedTools: ["edit", "write"],
					label: "procedure",
					seedContext: true,
					abortSignal: signal,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `Procedure lookup failed: ${msg}` }],
					details: undefined,
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text:
							text ??
							"(procedure subagent produced no output — it may have exited without writing findings)",
					},
				],
				details: undefined,
			};
		},
	});

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
		"Look for any of the following: " +
		"1. An Implementation Uncertainty Report (⚠️ IMPLEMENTATION UNCERTAINTIES) containing " +
		"   🔴 CRITICAL or 🟠 LOW confidence items. " +
		"2. Anything that explicitly enumerates knowledge gaps, evidence gaps, or open questions " +
		"   — including but not limited to: " +
		"   - Numbered or bulleted open items (e.g. [ ] unchecked gaps, [?] unconfirmed steps) " +
		"   - Sections titled Evidence Gaps, Unverified Assumptions, Alternative Hypotheses Not " +
		"     Ruled Out, or Unconfirmed Callpath Steps " +
		"   - Statements like 'I need to verify X', 'not confirmed from source', or 'no log confirms' " +
		"3. A Phase 5 / Uncertainty & Confidence Assessment block where Overall Confidence is rated " +
		"   Medium or Low, or where any evidence gap or unconfirmed step is listed with a [ ] or [?] marker. " +
		"Do NOT trigger if any of these are true: " +
		"- researchConversationQuestion was already called after the uncertainties appeared, or the agent has already begun looking up operational procedures inline. " +
		"- A [SYSTEM GUIDELINE INSTRUCTIONS: RESEARCH_UNCERTAINTIES] or " +
		"  [SYSTEM CONTINUATION INSTRUCTIONS: RESEARCH_UNCERTAINTIES] message already follows the uncertainties. " +
		"- The questions were answered by the user or resolved through direct context. " +
		"- The assistant ended its turn proceeding confidently and produced no enumerated gaps or [ ]/[?] markers.";

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
      "- The agent has already read the source files that produce the specific logs or outputs it is about to search in this conversation" + 
			"In the `reason` argument, include a brief description of the specific action the agent " +
			"appears about to take (e.g. 'grep logs for error X', 'edit parser.ts', 'run diagnostic command Y').",
		injectPrompt: RESEARCH_BEFORE_ACTION_PROMPT,
		label: "advisory:research-before-action",
	});

	pi.registerGuideline({
		id: "gather-evidence",
		triggerPrompt:
			"Has the agent formed a working hypothesis or diagnosis about a system-level or operational " +
			"issue, but there is remaining uncertainty \u2014 medium or low stated confidence, unconfirmed " +
			"steps, or explicit gaps like 'I can't confirm X from the available logs' \u2014 AND the agent " +
			"appears to be continuing to iterate on the same evidence base (repeated researchConversationQuestion " +
			"calls, re-reading the same files, chaining inferences from existing data) without having " +
			"attempted to access new direct evidence sources such as system logs on remote machines, " +
			"service-specific logs, or infrastructure event logs? " +
			"Strong signals this SHOULD trigger: " +
			"- Agent has stated a hypothesis but rates confidence as medium or low, or lists unconfirmed steps or gaps. " +
			"- Agent has noted a specific evidence gap: 'the logs don't show whether Y happened', 'I can't confirm X'. " +
			"- Agent has made multiple consecutive researchConversationQuestion calls without running bash " +
			"  commands to access new operational data. " +
			"- Agent has explicitly identified a potential direct evidence source (e.g., 'blade-level logs " +
			"  would show the rescan events directly') but has not attempted to access it. " +
			"Strong signals this should NOT trigger: " +
			"- Agent has already used bash to access new operational data sources after the current hypothesis was formed. " +
			"- The investigation is purely code-focused with no operational or infrastructure components. " +
			"- The hypothesis is high confidence with sufficient direct supporting evidence. " +
			"- No hypothesis has been formed yet \u2014 the agent is still in initial exploration. " +
			"In the `reason` argument, describe: (1) what iteration pattern the agent is in " +
			"(e.g., 'repeated researchConversationQuestion calls about catalog behavior'), and " +
			"(2) what direct evidence source appears untapped " +
			"(e.g., 'blade-level NFS logs on ir1-ir7 that would show the rescan events directly').",
		injectPrompt: GATHER_EVIDENCE_PROMPT,
		label: "advisory:gather-evidence",
	});

	pi.registerGuideline({
		id: "research-procedure",
		triggerPrompt:
			"Is the agent about to perform an operational task — accessing a remote system, " +
			"running system-specific CLI commands, or retrieving data from a specific path — " +
			"where the exact procedure, access path, or command syntax has NOT been confirmed " +
			"from skills, code, or logs already read in this session? " +
			"Strong signals this APPLIES: " +
			"- The agent says it needs to access something but doesn't know where it lives or how to get there. " +
			"- The agent is about to use SSH paths, log file locations, or specialized CLI flags " +
			"  that haven't been confirmed in this conversation. " +
			"- The agent is guessing at a path or command format without having looked it up. " +
			"- The agent describes going to look at a remote or infrastructure resource without " +
			"  knowing the specific access procedure. " +
			"Strong signals this does NOT apply: " +
			"- The exact path, command, or procedure has already been confirmed from skills, code, " +
			"  or logs in this conversation. " +
			"- The agent is using well-known general commands (git, npm, standard bash) where no " +
			"  system-specific knowledge is needed. " +
			"- The agent has already looked up or confirmed the specific procedure, path, or command syntax needed for the current task from skills, documentation, or prior session context" +
			"- The agent is currently doing the research (reading docs, checking man pages, checking skills). " +
			"In the `reason` argument, describe what specific operational task or resource the " +
			"agent is about to work with and what procedure appears to be unconfirmed.",
		injectPrompt: RESEARCH_PROCEDURE_PROMPT,
		label: "advisory:research-procedure",
	});

	pi.registerGuideline({
		id: "reground",
		triggerPrompt:
      "Does the current conversation show any of the following signs that the agent " +                       
      "needs to step back and rebuild a grounded understanding before continuing? " +                         
			"Representative examples of when this applies include, but are not limited to: " +
			"(1) ASSUMPTION CONTRADICTED: Information, evidence, or an argument has been " +
			"    presented that contradicts or undermines a position, hypothesis, or assumption " +
			"    the agent stated earlier. Strong signals: the user says the diagnosis is wrong " +
			"    and explains why; the user provides log lines, test results, or code that " +
			"    contradict the agent's stated understanding; the agent predicted X and the user " +
			"    reports Y happened instead. " +
			"(2) REPEATED FAILED ATTEMPTS: The user has reported that a fix or change the agent " +
			"    made did not resolve the problem, and this has happened more than once for the " +
			"    same issue. Strong signals: the user says something is 'still' broken after a " +
			"    fix; the agent has made multiple fix attempts on the same issue with none " +
			"    confirmed working. " +
			"(3) SCOPE ESCALATED: The task has grown significantly beyond what the original " +
			"    request implied. Strong signals: what started as a change to one file now " +
			"    touches many layers or subsystems; the agent is investigating areas not " +
			"    mentioned or implied by the original task. " +
			"(4) SPECULATING WITHOUT EVIDENCE: The agent's most recent output makes central " +
			"    claims through heavy hedging ('it might be', 'perhaps', 'probably') without " +
			"    grounding them in something directly read or confirmed in this conversation. " +
			"    Strong signals: the agent proposes a cause or mechanism without having read " +
			"    the code or logs that would confirm it. " +
			"(5) CIRCULAR RESEARCH: researchConversationQuestion has been called repeatedly " +
			"    across recent turns in a way that appears circular or unproductive. " +
			"    Strong signals: the agent asks similar or overlapping questions in successive " +
			"    calls; prior research findings are visible in the conversation but the agent " +
			"    calls researchConversationQuestion again without having visibly applied those " +
			"    findings to advance the investigation; three or more calls appear in the recent " +
			"    conversation and the investigation does not appear to have made forward progress " +
			"    between them. " +
			"    Weak signal (does not apply on its own): two or three researchConversationQuestion " +
			"    calls batched within a single turn — batching parallel questions is the correct " +
			"    usage pattern and is not a sign of circular research. " +
			"(6) GOAL DRIFT: call get_goal to retrieve the active goal text. If it returns " +
			"    empty, this condition does not apply. Otherwise compare the returned goal " +
			"    text against the agent's recent tool calls and reasoning. Strong signals: " +
			"    the agent has been reading files, running commands, or reasoning about an " +
			"    area that is several steps removed from the stated goal across multiple " +
			"    consecutive turns, with no visible explanation of why the current detour " +
			"    is necessary to achieve that specific goal. " +
			"    Weak signals (do not apply on their own): the agent is doing exploratory " +
			"    work that is plausibly preparatory; the goal is broad and the work could " +
			"    reasonably fall within it; the agent explicitly noted why the current area " +
			"    is relevant to the goal. " +
			"Strong signals this does NOT apply: " +
			"- The user corrects a minor detail (typo, wrong port, filename) that does not " +
			"  affect the agent's overall model. " +
			"- The user asks a clarifying question or expresses uncertainty without asserting " +
			"  a contradiction. " +
			"- The agent has not yet attempted any fix (for condition 2). " +
			"- Hedged claims are peripheral and do not affect the core approach (for condition 4). " +
			"- researchConversationQuestion calls are batched in a single turn or address " +
			"  clearly distinct topics with findings visibly applied between them (for condition 5). " +
			"- No goal is set in the conversation, or the agent's recent work is plausibly " +
			"  preparatory to the goal even if not directly about it, or the agent has " +
			"  explicitly explained why the current area is relevant (for condition 6). " +
			"- The agent has already produced an explicit reassessment of its understanding after the triggering event visible in this conversation" +
			"In the `reason` argument, include a brief description of which condition applies " +
			"and what specifically was detected — for condition 6, include the goal text " +
			"returned by get_goal and describe what the agent was actually doing instead.",
		injectPrompt: REGROUND_PROMPT,
		label: "advisory:reground",
	});

	// pi.registerGuideline({
	// 	id: "research-uncertainties",
	// 	triggerPrompt: researchUncertaintiesTrigger,
	// 	injectPrompt: RESEARCH_UNCERTAINTIES_GUIDELINE_PROMPT,
	// 	label: "advisory:research-uncertainties",
	// });
	//
	// pi.registerContinuation({
	// 	id: "research-uncertainties",
	// 	triggerPrompt: researchUncertaintiesTrigger,
	// 	injectPrompt: RESEARCH_UNCERTAINTIES_CONTINUATION_PROMPT,
	// 	label: "advisory:research-uncertainties",
	// });

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

	// --- /learned command ---

	pi.registerCommand("finish-learning", {
		description: "Remove the current session from the learning queue",
		handler: async (_args, ctx) => {
			const id = ctx.sessionManager.getSessionId();
			try {
				const removed = await removeFromLearnQueue(id);
				ctx.ui.notify(
					removed
						? `Session ${id.slice(0, 8)}… removed from learning queue`
						: `Session ${id.slice(0, 8)}… was not in the learning queue`,
					"info",
				);
			} catch (err) {
				ctx.ui.notify(
					`Failed to remove session from learning queue: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("to-learn", {
		description: "Queue the current session for learning review (shows up in pi --learn)",
		handler: async (_args, ctx) => {
			const id = ctx.sessionManager.getSessionId();
			try {
				await addToLearnQueue(id);
				ctx.ui.notify(`Session ${id.slice(0, 8)}… queued for learning`, "info");
			} catch (err) {
				ctx.ui.notify(
					`Failed to queue session for learning: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
			}
		},
	});

	// --- session_before_quit: prompt to queue for learning (advisory sessions only) ---

	pi.on("session_before_quit", async (_, ctx) => {
		if (!pi.getAdvisoryEnabled()) return;
		const id = ctx.sessionManager.getSessionId();
		const queue = await readLearnQueueSet();
		if (queue.has(id)) return;
		const choice = await ctx.ui.select(
			"Queue this session for learning review?",
			[QUIT_OPT_YES, QUIT_OPT_NO, QUIT_OPT_INSPECT],
		);
		if (choice === QUIT_OPT_INSPECT) {
			return { cancel: true };
		}
		// QUIT_OPT_NO and undefined (dialog dismissed) both fall through — quit without marking.
		if (choice === QUIT_OPT_YES) {
			try {
				await addToLearnQueue(id);
			} catch (err) {
				ctx.ui.notify(
					`Failed to queue session for learning: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
			}
		}
	});

	// --- agent_end: auto-remove from learn queue after analysis prompt runs ---

	pi.on("agent_end", async (_, ctx) => {
		if (pi.getFlag("learn-session") !== true) return;
		const id = ctx.sessionManager.getSessionId();
		// Guard: only remove from queue once per session to avoid a disk read
		// on every subsequent agent turn after the first analysis completes.
		if (learnAutoMarkedSessionId === id) return;
		learnAutoMarkedSessionId = id;
		try {
			await removeFromLearnQueue(id);
		} catch (err) {
			console.error(`[learn] removeFromLearnQueue failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	});

	// --- Startup logging (fires after bindCore, so advisory API is live) ---

	pi.on("session_start", (_, ctx) => {
		const guidelines = pi.getGuidelines();
		const continuations = pi.getContinuations();

		// Reset per-session tracking state for the new session.
		learnAutoMarkedSessionId = null;

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

	pi.registerFlag("learn-session", {
		description: "Internal: signals that this session was opened via pi --learn for auto-removal from the learn queue",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("keep-branch-sessions", {
		description: "Keep branch sessions alive after completion (skip dispose) for debugging",
		type: "boolean",
		default: false,
	});
}
