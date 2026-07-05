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
 *   - review-after-commit: inject a review checklist after a git commit
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
import { DynamicBorder, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
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

**⚠️ Implementation uncertainties**: list unknowns with confidence levels. \
Use the research tool to resolve 🔴 CRITICAL and 🟠 LOW items before implementing.

\`\`\`
⚠️ IMPLEMENTATION UNCERTAINTIES
Summary: X 🔴 CRITICAL | X 🟠 LOW | X 🟡 MEDIUM | X 🟢 HIGH

1. [Component/Step]: [what you are unsure about]
   Confidence: 🔴 CRITICAL
   Assumption: [what you are assuming]
   Impact if wrong: [what breaks]
\`\`\`

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
		id: "debug-workflow",
		triggerPrompt:
			"Is the user starting a new debugging or bug-fix task that hasn't already received " +
			"debugging workflow guidance in the recent conversation? " +
			"Use your judgment: if this looks like a fresh debugging request that hasn't " +
			"been covered by a recent [SYSTEM GUIDELINE INSTRUCTIONS: DEBUG_WORKFLOW] message, trigger. " +
			"If the conversation already has debug guidance covering this task, do not trigger.",
		injectPrompt: DEBUG_WORKFLOW_PROMPT,
		label: "advisory:debug-workflow",
	});

	// --- Guidelines + Continuations: research-uncertainties ---

	const researchUncertaintiesTrigger =
		"Does the most recent assistant response contain explicit, unresolved questions or " +
		"uncertainties that have NOT yet been investigated? " +
		"Look for either: " +
		"(1) An Implementation Uncertainty Report (⚠️ IMPLEMENTATION UNCERTAINTIES) in the " +
		"most recent assistant message, containing 🔴 CRITICAL or 🟠 LOW confidence items. " +
		"(2) The most recent assistant message explicitly enumerates questions or knowledge " +
		"gaps it needs to resolve before proceeding (e.g. numbered open items, " +
		"'I need to verify X before implementing', or an ⚠️ IMPLEMENTATION UNCERTAINTIES block). " +
		"Do NOT trigger if any of these are true: " +
		"- The researchConversationQuestion tool was already called after the uncertainties appeared. " +
		"- A [SYSTEM GUIDELINE INSTRUCTIONS: RESEARCH_UNCERTAINTIES] or " +
		"  [SYSTEM CONTINUATION INSTRUCTIONS: RESEARCH_UNCERTAINTIES] message already follows the uncertainties. " +
		"- The questions were answered by the user or resolved through direct context. " +
		"- The assistant ended its turn proceeding confidently without flagged open items.";

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
			"- The most recent assistant message is a Fleshing Out response containing " +
			"  ## 🆕 CANDIDATE BEHAVIORS or ## ⚠️ CANDIDATE EDGE CASES sections. " +
			"Strong signals that this does NOT apply: " +
			"- A [SYSTEM CONTINUATION INSTRUCTIONS: CODE_WORKFLOW] has already been injected for " +
			"  this task — do not re-trigger for work already in progress or committed. " +
			"- The most recent assistant output contains only questions, an uncertainty report " +
			"  (⚠️ IMPLEMENTATION UNCERTAINTIES), or research points — without an accompanying code " +
			"  directive or Fleshing Out candidates. Questions and uncertainties are handled by " +
			"  RESEARCH_POINTS, not CODE_WORKFLOW. " +
			"- The agent's immediate task is to search, read, or explain code — not implement it. " +
			"- The user expresses future intent without directing the agent to act now " +
			"  (e.g., 'we should probably...', 'this might need to change', 'I think X should do Y'). " +
			"- Purely mechanical git operations with no new file edits. " +
			"Judgment heuristic: is code implementation the concrete next step, not just a future " +
			"possibility? Features, review fixes, and Fleshing Out candidates all qualify. " +
			"Questions, uncertainty reports, and research points alone do not.",
		injectPrompt: CODE_WORKFLOW_PROMPT,
		label: "advisory:code-workflow",
	});

	pi.registerContinuation({
		id: "review-after-commit",
		triggerPrompt:
			"Was a git commit made during this agent run that has not yet been followed by a code review? " +
			"Find the most recent successful git commit in the tool call results. " +
			"Then check whether a [SYSTEM CONTINUATION INSTRUCTIONS: CODE_REVIEW] review checklist has appeared in the " +
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
