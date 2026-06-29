/**
 * OS Agent Extension
 *
 * Registers the built-in advisory guidelines and continuations.
 *
 * Guidelines (evaluated at turn_start, async):
 *   - code-workflow: inject coding workflow instructions when a feature is requested
 *   - debug-workflow: inject debugging workflow instructions when a bug fix is requested
 *
 * Continuations (evaluated at agent_end, sync):
 *   - review-after-commit: inject a review checklist after a git commit
 *
 * The advisory system can be toggled at runtime via /advisor [on|off].
 * Pass --no-advisor on the CLI to start with it disabled.
 *
 * Each inject prompt begins with a [SYSTEM INSTRUCTION: ID] sentinel that:
 * - Directs the main agent to follow the instructions before proceeding
 * - Provides an idempotency skip condition for the main agent
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Inject prompts
// Each begins with a [SYSTEM INSTRUCTION: ID] sentinel that directs the main agent
// to follow the instructions and carries an idempotency skip condition.
// ---------------------------------------------------------------------------

const CODE_WORKFLOW_PROMPT = `\
[SYSTEM INSTRUCTION: CODE_WORKFLOW — You must follow this workflow before proceeding. \
Before starting, briefly note what you were in the middle of and outline the steps \
you will need to return to once this workflow is complete. \
Skip only if you are already actively working through these steps.]


# Integrated System Code Implementation Plan

**⚠️ IMPORTANT: This is an INTERACTIVE, TWO-PHASE process. You MUST wait for user responses at designated checkpoints. DO NOT proceed past any STOP checkpoint without explicit user approval.**

**🎯 KEY PRINCIPLE: Openly communicate uncertainty. It is EXPECTED and VALUABLE for you to identify areas where you lack confidence or are making assumptions. The user can then provide clarification before implementation begins.**

**🍰 KEY PRINCIPLE — VERTICAL SLICES, NOT LAYERS: Every implementation step must add a thin, end-to-end "vertical slice" of functionality, NOT a horizontal "layer." Each step must produce a NEW OBSERVABLE BEHAVIOR — something the user can run, see, or test that was not possible before that step. Avoid plans that build an entire layer at a time (all data models, then all services, then all UI) before anything is observable. Prefer plans where each step makes the system *do* something new, even if narrow. If a step produces no observable behavior, it is almost certainly a horizontal layer and should be merged into a vertical slice or re-sequenced.**

You are a senior software engineer tasked with analyzing, planning, and implementing solutions based on the User's Goal.

**This process has TWO distinct phases with MANDATORY stops:**
- **PHASE 1:** Analysis and Implementation Planning with Uncertainty Identification (STOP - await approval)
- **PHASE 2:** Implementation (only after explicit approval of the plan)

**Process Flow:**
PHASE 1: Analysis → Implementation Plan (each step = 1 vertical slice w/ observable behavior)
                                  → Plan-Based Uncertainties → 🛑 STOP (await approval)
                                                               ↓
PHASE 2: Implementation → Code per Step → Verify observable behavior → 🛑 STOP after each commit

---

## PHASE 1: Analysis and Implementation Planning

1. **Context Gathering and Codebase Search**
   - Search the codebase for files, functions, references, or tests directly relevant to the User's Goal. Try searching in ~/Documents/WorkVault/AI_Knowledge as well
   - For each source found:
     - Summarize its relevance.
     - If not relevant, briefly note and disregard.
   - Return a list of the most applicable files or code snippets for further analysis.

2. **Create a DETAILED IMPLEMENTATION PLAN**
   - Before writing any code, provide a comprehensive plan. This plan should include:
     - **Problem Overview:** Briefly restate the problem or goal based on the user's request and the gathered context.
     - **Proposed Solution Outline:** Describe the overall technical approach you will take to address the problem.
       - **If there is a change to an existing function, check that its callers expect this behavior and list these callers out for the user to confirm**
       - **If there are multiple implementation options or approaches, present them for the user to decide.**
       - Use visualizations (such as sequence, state, component diagrams, flowchart, free form ASCII text diagrams with simplified data structures) to clarify key concepts, system interactions, or data flow related to the changes.

     - **📞 CALLPATH WORKFLOW DIAGRAM (REQUIRED):** Before listing implementation steps, produce an ASCII callpath diagram that traces the end-to-end execution flow of the proposed change — from the entry point through every major function, module boundary, async handoff, and output. Model it after the style below, showing the nesting of calls, fire-and-forget paths, sync points, and shared writers explicitly.

       **Format template (adapt names and structure to the actual system):**
~~~
        ├─ entryPoint()  ─── outer loop ────────────────────────────────────────────┐
        │        │                                                                   │
        │   [phase_start]                                                     [phase_end]
        │        │                                                                   │
        │     primary call     ┌─── async: backgroundWork(params, ctx) ──────────┐  │
        │        │             │   worker reads state / calls downstream          │  │
        │        │             │   returns: ResultType | undefined                │  │
        │        │             └──────────────────────── resolves whenever ───────┘  │
        │   [phase_end] ──fire-and-forget────────────────────────────────────────── │
        │        │   stores Promise<ResultType|undefined>                            │
        │        │   in _pendingWorkPromise                                          │
        │        │                                                                   │
        │   [phase_start]  ← caller continues immediately ────────────────────────►─┘
        │
        ├─ _handlePostRun() loop
        │
        ├─ if (_pendingWorkPromise)
        │       result = await _pendingWorkPromise          ← sync point
        │       if result → _applyResult(result)            ← shared writer
        │                   caller.continue()
        │                   _handlePostRun() loop
        │
        └─ _maybeRunFollowUp()  ← per-run, also calls _applyResult
                │
                result = await followUpWork(params, ctx)
                if result → _applyResult(result)            ← same shared writer
~~~

       **Requirements for this diagram:**
       - Trace the **full callpath** from user-facing entry point to final side effect or output
       - Show **every major function or method** that will be added or modified by this plan
       - Mark **async/fire-and-forget** paths with "──fire-and-forget──"
       - Mark **sync/await points** explicitly with "← sync point"
       - Identify **shared writers** (functions, sinks, or state that multiple paths write to) with "← shared writer"
       - Label **loop boundaries** and **phase transitions** ("[phase_start]", "[phase_end]", etc.)
       - If there are **multiple implementation options**, draw a diagram for each option

     - **🍰 SLICE THE PLAN VERTICALLY:** Before listing steps, briefly explain how you have decomposed the work into vertical slices. Each step must move a thin path of functionality end-to-end so that a new observable behavior emerges. State explicitly: "Each step below adds one observable behavior." If you find yourself naming a step after a layer ("build the data layer", "add all the API routes", "wire up the UI"), STOP and re-slice it into behavior-driven steps.
     - **🔧 STEP 1 (MANDATORY FIRST COMMIT): Core Plumbing Setup**
       - Implement the fundamental infrastructure, interfaces, or "API skeleton" first
       - Create minimal working version with basic connectivity/structure
       - Establish data flow pathways without complex logic
       - Set up error handling framework
       - **⚡ BASE CASE SIGNAL (REQUIRED):** Include a concrete, observable signal that the plumbing is wired up correctly — e.g., a startup log message, a health-check endpoint returning 200, a console printout, or a test assertion that passes. **The plumbing step is not complete until this signal can be triggered and verified by the user.**
         - Examples by context:
           - VS Code extension → "console.log('✅ [ExtensionName] loaded successfully')"
           - REST API → "GET /health" returns '{ status: "ok" }'
           - CLI tool → 'tool --version' prints name and version
           - Background service → log line on startup: '"[ServiceName] initialized"'
           - Library/module → a smoke-test that imports the module and calls a no-op entry point without error
       - **👁️ OBSERVABLE BEHAVIOR AFTER THIS STEP (REQUIRED):** State exactly what the user can now run and what they will see. For the plumbing step, this is precisely the BASE CASE SIGNAL above — describe it concretely (what command/action to take, and the exact output/result to expect).
       - **This step should result in a compilable, runnable foundation where the base case signal confirms connectivity — even if no real features are implemented yet**
       - **Files to modify/create**: [List specific files for the plumbing step]
       - **Commit message**: "NEED_REVIEW: Add core plumbing for [feature/goal]"
     - **Step-by-Step Feature Implementation:** After core plumbing, break down remaining features into manageable vertical slices:
       - For each subsequent step:
         - Describe the specific task to be performed.
         - Identify the file(s) that will be modified or created.
         - Explain the specific code changes or logic you intend to implement within those files → and **how they contribute to the overall goal**
         - **👁️ Observable behavior after this step (REQUIRED):** State the NEW observable behavior the user will be able to run/see/test once this step is complete — the concrete signal that this vertical slice works. Be specific about the trigger and the expected result (e.g., "calling 'GET /users/:id' now returns the user's name from the DB", "typing in the search box now filters the visible list", "running 'npm test -- auth' now passes the login round-trip test"). **If you cannot name an observable behavior for a step, that step is a horizontal layer — re-slice it so the behavior is observable, or fold it into the slice that consumes it.**
         - **Build incrementally as vertical slices**: Each step should add ONE clear, observable piece of functionality on top of the working foundation — not an internal layer that can only be seen once a later step is also done.
         - **If there are multiple options for implementation, present them all to the user. Rank the options in terms of relevance.**
     - **Commit Strategy:** Reiterate that you will commit changes ('git add [files_you_added_or_changed] && git commit -m "NEED_REVIEW: [descriptive message]"') after completing logical units of work. **The FIRST commit will always be the core plumbing setup.**

3. **🔍 Implementation Uncertainties: Difficulties and Assumption Identification** (CRITICAL STEP):
   **Based on the implementation plan created in Step 2**, explicitly identify:
   - **Low Confidence Areas**: Components or interactions from the plan that you don't fully understand
   - **Assumptions Made**: Any guesses about how planned components will work or should interact
   - **Missing Knowledge**: Information about the planned approach that would help create better implementation
   - **Complex Interactions**: Areas in the plan where the behavior might be non-obvious and challenging
   - **External Dependencies**: Services or systems mentioned in the plan that you're unsure how to integrate

   **⚠️ CRITICAL: Uncertainties must be directly derived from and reference specific aspects of the implementation plan from Step 2**

   **Format this as a clear "Implementation Uncertainty Report" with confidence levels:**
   ~~~
   ⚠️ IMPLEMENTATION UNCERTAINTIES (Based on the Implementation Plan):

   Summary: X 🔴 CRITICAL | X 🟠 LOW | X 🟡 MEDIUM | X 🟢 HIGH uncertainties identified

   1. [Specific Plan Component/Step]: [What you're unsure about in this planned approach]
      - Confidence Level: [🔴 CRITICAL/🟠 LOW/🟡 MEDIUM/🟢 HIGH]
      - Plan Reference: [Reference to specific step/component in the implementation plan]
      - Assumption: [What you're assuming about this planned component]
      - Would benefit from: [What information would help implement this part of the plan]
      - Impact if wrong: [What could break if assumption about this plan component is incorrect]
   ~~~

   **Add confidence levels to each step in the implementation plan:**
   - Go back to the implementation plan from Step 2
   - Add **Confidence level**: [🔴 CRITICAL/🟠 LOW/🟡 MEDIUM/🟢 HIGH] to each implementation step
   - This creates a direct mapping between plan components and uncertainty levels

   **Confidence Level Guide:**
   - **🔴 CRITICAL**: No understanding of this planned approach, pure guessing. Implementation will likely be wrong without clarification.
   - **🟠 LOW**: Major assumptions made about this plan component. High risk of incorrect implementation.
   - **🟡 MEDIUM**: Some assumptions about planned approach but based on common patterns. Moderate risk.
   - **🟢 HIGH**: Minor uncertainty about this plan component only. Low risk but clarification would still help.

   - **Order uncertainties by confidence level** (🔴 CRITICAL first, then 🟠 LOW, 🟡 MEDIUM, 🟢 HIGH)
   - Present this uncertainty analysis clearly to the user, formatted using Markdown.

**🛑 STOP HERE - PHASE 1 CHECKPOINT**
- You have now presented:
  1. **The complete implementation plan with confidence levels AND an observable behavior for each step**
  2. **The Callpath Workflow Diagram tracing the full execution flow**
  3. **The Implementation Uncertainty Report based on the specific plan components (🔴 CRITICAL → 🟠 LOW → 🟡 MEDIUM → 🟢 HIGH)**
- DO NOT PROCEED to implementation without explicit approval
- The user may want to:
  - **Address 🔴 CRITICAL and 🟠 LOW confidence uncertainties first**
  - **Clarify assumptions you've made about specific plan components**
  - **Confirm that the callpath diagram accurately reflects the intended execution flow**
  - **Confirm that each step's observable behavior represents a real vertical slice (not a hidden layer)**
  - Choose between implementation options
  - Adjust the implementation approach
  - Modify the step ordering
- WAIT for the user to address plan-based uncertainties AND provide explicit approval like "looks good", "proceed to implementation", or "go ahead to Phase 2"

---

## PHASE 2: Implementation (Only proceed after explicit Phase 1 approval)

**⚠️ VERIFY: Have you received explicit approval for the implementation plan? If not, STOP and wait for approval.**

4. **Implementation**:
   - For each planned implementation step:
     - **Implement the step according to the approved plan**
     - **Commit the implementation**:
       ~~~bash
       git add [implementation_files]
       git commit -m "NEED_REVIEW: [step description]"
       ~~~

     **🛑 MANDATORY STOP - STEP CHECKPOINT**

     Present to the user:
     - What was implemented (step description)
     - **👁️ For EVERY step: Instruct the user to verify the observable behavior for this step** — tell them exactly what to run and what they should see (e.g., "Please run X and confirm you see Y"). For Step 1 this observable behavior is the base case signal (e.g., "Please run the extension and confirm you see ✅ [ExtensionName] loaded successfully in the console."). The step is not "done" until the user can confirm the observable behavior.
     - Any issues encountered and resolutions
     - New uncertainties discovered (if any)
     - **Updated callpath diagram** showing which paths are now live vs. still pending (mark completed paths with ✅ and pending paths with ⏳)
     - What comes next (if not the final step)

     **WAIT for explicit user signal** (e.g., "continue", "next", "proceed")

     The user may want to:
     - Review the implementation code
     - Verify the observable behavior themselves
     - Request modifications
     - Address new uncertainties

     **DO NOT proceed without explicit approval**

---

**🚨 CRITICAL PROCESS REMINDERS**

**This is a TWO-PHASE process with mandatory stops:**

1. **Phase 1**: Analyze → Implementation Plan + **Callpath Diagram** → **Plan-Based Uncertainties** → **🛑 STOP** (await approval)
2. **Phase 2**: Implement → Code per Step → **Updated Callpath Diagram** → **🛑 STOP after EACH commit** (await "continue")

**You MUST:**
- Create the implementation plan FIRST, then produce the callpath diagram, then identify uncertainties based on that specific plan
- **The callpath diagram is MANDATORY — it must appear in the plan before the step list, covering the full execution path end-to-end**
- **Define an OBSERVABLE BEHAVIOR for EVERY step — each step is a vertical slice that makes the system do something new, not a horizontal layer**
- **Re-slice any step that has no observable behavior; layered, behavior-less steps are not acceptable**
- Wait for explicit approval before starting each phase
- Stop after EVERY commit in Phase 2
- **After EACH step's commit, explicitly ask the user to verify that step's observable behavior before proceeding (for Step 1 this is the base case signal)**
- Never skip checkpoints or assume approval
- Always present implementation uncertainties prominently

**Remember**: Identifying what you don't understand about your specific implementation plan is just as valuable as planning what you do understand. The user EXPECTS and VALUES uncertainty identification based on the concrete plan you've created. **Equally, every step should leave the system in a runnable state with a new, verifiable behavior — thin vertical slices beat broad horizontal layers. And the callpath diagram is the shared map everyone navigates by — keep it accurate and up to date throughout Phase 2.**`;

const DEBUG_WORKFLOW_PROMPT = `\
[SYSTEM INSTRUCTION: DEBUG_WORKFLOW — You must follow this workflow before proceeding. \
Skip only if you are already actively working through these steps.]

You are about to debug an issue. Before making any changes:

1. Reproduce the problem — confirm you can see the failure.
2. Form a hypothesis about the root cause.
3. Verify the hypothesis by reading the relevant code (do not guess).
4. Apply the minimal fix.
5. Confirm the failure no longer occurs, then run npm run check.`;

const REVIEW_PROMPT = `\
[SYSTEM INSTRUCTION: CODE_REVIEW — You must work through this checklist for the commit \
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

	pi.registerGuideline({
		id: "code-workflow",
		triggerPrompt:
			"Are we doing coding work that hasn't already received workflow guidance? " +
			"Examples that would indicate yes: the user asked to implement, add, change, " +
			"refactor, fix, update, or remove code; the agent is writing or editing files; " +
			"a non-trivial code change is underway. " +
			"Do not trigger for purely mechanical git operations (staging, committing, pushing, " +
			"branching, or reviewing already-written changes) — no new code is being written. " +
			"If a recent [SYSTEM INSTRUCTION: CODE_WORKFLOW] message already covers this task, do not trigger.",
		injectPrompt: CODE_WORKFLOW_PROMPT,
		label: "advisory:code-workflow",
	});

	pi.registerGuideline({
		id: "debug-workflow",
		triggerPrompt:
			"Is the user starting a new debugging or bug-fix task that hasn't already received " +
			"debugging workflow guidance in the recent conversation? " +
			"Use your judgment: if this looks like a fresh debugging request that hasn't " +
			"been covered by a recent [SYSTEM INSTRUCTION: DEBUG_WORKFLOW] message, trigger. " +
			"If the conversation already has debug guidance covering this task, do not trigger.",
		injectPrompt: DEBUG_WORKFLOW_PROMPT,
		label: "advisory:debug-workflow",
	});

	// --- Continuations (agent_end, sync) ---

	pi.registerContinuation({
		id: "review-after-commit",
		triggerPrompt:
			"Was a git commit made during this agent run that has not yet been followed by a code review? " +
			"Find the most recent successful git commit in the tool call results. " +
			"Then check whether a [SYSTEM INSTRUCTION: CODE_REVIEW] review checklist has appeared in the " +
			"conversation AFTER that specific commit. " +
			"Use your judgment: if the commit is recent and no review has followed it yet, trigger. " +
			"If a review has already been conducted for this specific commit, do not trigger.",
		injectPrompt: REVIEW_PROMPT,
		label: "advisory:review",
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

	// --- Startup logging (fires after bindCore, so advisory API is live) ---

	pi.on("session_start", (_, ctx) => {
		const guidelines = pi.getGuidelines();
		const continuations = pi.getContinuations();

		// Apply --no-advisor flag if set.
		if (pi.getFlag("no-advisor") === true) {
			pi.setAdvisoryEnabled(false);
			if (ctx.hasUI) ctx.ui.notify("[advisory] disabled via --no-advisor", "warning");
		}
	});

	// --- CLI flags ---

	pi.registerFlag("no-advisor", {
		description: "Disable the advisory system on startup",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("keep-branch-sessions", {
		description: "Keep branch sessions alive after completion (skip dispose) for debugging",
		type: "boolean",
		default: false,
	});
}
