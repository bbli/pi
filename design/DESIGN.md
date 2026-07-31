# Agent Orchestration Design Notes

## Core Thesis: Against Agent Teams

The dominant "agent teams" model — a coordinator delegating tasks to specialist agents — has two fundamental problems:

**1. When to communicate?**
Prescriptive routing rules ("call the Reviewer after step 3") are wrong. An external observer should always run and inject only when it finds something actionable. The question is not *when* to call the reviewer — it is *what threshold* the reviewer uses to decide whether to speak.

**2. Shared context is lossy**
Agents in a team communicate via text files, summaries, or structured messages. Every handoff requires reconstructing context from scratch. An implementation plan is a lossy projection of the conversation history that produced it. The conversation history is always richer than the plan derived from it.

---

## The Search Tree Model

Instead of a manager delegating to workers, treat the agent as a **search algorithm over a conversation state space**.

- **Node** = conversation state (the full history up to that point)
- **Edge** = a branch-opening prompt (a new instruction that redirects the agent)
- **Goal test** = all active considerations satisfied
- **Backtrack** = pop the branch (discard its turns, keep only the distilled result)

A "branch" is not a separate agent. It is the same model, same context, with a new instruction appended as the most recent message. When the branch is done, only its distillation returns to the parent thread — not its full internal transcript.

### Key properties

**Context is inherited, not reconstructed.**
Every agent-team hop requires re-explaining the situation. Every branch already knows it.

**Backtracking is nearly free.**
The "state" is the conversation. Popping a branch means discarding those turns. The parent state was never mutated.

**The last instruction wins.**
The LLM follows the most recent instruction regardless of conversation length. A branch is a temporary re-brief. When it pops, the original goal reasserts.

**The main thread stays on the happy path.**
Error handling, repair work, and review work all happen in branches. The main thread's history contains only forward progress — never failed attempts, dead ends, or repair transcripts. Only distillations.

### Branch types by return contract

| Type | Access | Returns |
|---|---|---|
| Review branch | Read-only | Verdict + N bullet points |
| Repair branch | Write-enabled | Distillation of what changed (≤3 sentences) |
| Exploration branch | Read-only | Succeeded/failed + why |
| Planning branch | Read-only | Revised task list replacing the old one |

### Supporting principles

**Lazy task lists.** The task list should not be pre-planned in full. Each task completion reveals information the plan did not have. Pre-planning all tasks upfront is the planning fallacy.

**Dead-end memoization.** When an exploration branch definitively fails, inject a consideration into the parent: *"approach X was tried; failed because Y."* This prevents re-exploring the same dead end.

**Depth limits.** A review branch should not spawn a review branch. Each branch has a logical depth; certain branch types are restricted by depth. Enforced as a consideration rather than a hard mode.

**No heuristics framework.** The LLM's training is the heuristic function. Adding an external scoring framework replaces LLM judgment with hand-crafted rules. Considerations are the evaluation function — they specify what "good" looks like, and the reviewer's LLM judgment evaluates it. No separate layer needed.

---

## Instruction Taxonomy

Instructions to an agent are not homogeneous. There are seven distinct types with different lifetimes, override rules, and placement requirements. Mixing them into a single system prompt or config file is the root cause of most agent harness brittleness.

### 1. Goal — *why we are doing this*

The high-level objective. Defines what success looks like at the top level. The domain agent plans in service of the goal; all other instruction types are subordinate to it.

- Stable across an entire session
- Cannot be overridden by domain or procedural instructions
- Should be minimal (one or two sentences)
- Consulted when making high-level decisions, not low-level ones

Without an explicit goal, the agent optimizes locally: it fixes the immediate bug by deleting the test. It satisfies the task without satisfying the intent.

### 2. Constraint — *what we must never do*

Hard negative bounds on the action space. Different from procedural instructions, which describe correct process. Constraints restrict options regardless of what else is true.

- Pre-conditions evaluated before any action, not after
- Immune to domain override — an unusual project cannot authorize a constraint violation
- Should be minimal in number (they reduce the solution space irreversibly)
- Examples: "never commit without running the check", "never force push", "never modify `.env` files"

In search tree terms: constraints are illegal moves. They prune edges before expansion.

### 3. Domain — *what we are working on*

Facts about the current situation: project context, architectural decisions, current task, module boundaries.

- Task-scoped — changes as work progresses
- Should live close to the user prompt, not in the system prompt
- Should be updateable mid-session without restarting
- Goes stale silently when placed in the system prompt and left there

A common mistake: domain context in the system prompt. It cannot be updated, competes with procedural instructions for LLM attention, and leaks across branches.

### 4. Procedural — *how we do it*

Methodology, workflow, tool-use patterns, branching rules, skill selection.

- Stable across sessions and domains
- Lives in the system prompt and skills layer
- Domain-agnostic and reusable
- Can be overridden by domain context in unusual situations (unlike constraints)

The agent should never have to think about procedure. Procedure is the harness's job. When the agent reasons about whether to load a skill, it is doing the harness's job, poorly, in the wrong place.

### 5. Style — *how we communicate*

Tone, verbosity, format, conventions. Orthogonal to all other types.

- Applies uniformly across tasks and domains
- Should never affect what the agent does, only how it reports it
- Examples: "be concise", "technical prose only", "no emojis in commits"

### 6. Meta — *how to interpret other instructions*

Precedence and conflict-resolution rules for all other instruction types. Without them, the agent falls back to recency (last instruction wins) or prominence, producing unpredictable behavior when instructions conflict.

- Defines the hierarchy: constraints > goal > domain > procedural > style
- Examples: "domain context cannot override constraints", "user messages at runtime override project config", "when in doubt, do less — prefer reversible actions"
- Should be stated explicitly, not assumed

### 7. Temporal — *when this applies*

Instructions scoped to a phase, task, or turn. Any of the above types can have a temporal qualifier.

| Scope | Example |
|---|---|
| Session | "Always run npm run check" |
| Task | "This consideration expires when the feature is merged" |
| Phase | "During planning, only plan — do not implement" |
| Turn | "For this response only, be maximally concise" |

Temporal instructions reduce the active instruction set as work progresses, reducing cognitive load on the model. An instruction that expires cleanly is better than one that lingers and conflicts with later instructions.

---

## Sync vs Async Subagents

The right criterion for whether a subagent should block the main session is not severity alone. It is three properties evaluated together:

**1. Decision dependency** — does the main session need the result to know what to do next?

**2. State conflict** — would running both in parallel create write-write conflicts on shared state?

**3. Cost of one wrong action** — if the subagent finds a problem, how bad is one more main-session turn before the finding lands?

Any one being true is sufficient to force sync.

| Subagent | Decision dep. | Write conflict | Cost of wrong turn | Verdict |
|---|---|---|---|---|
| Advisory reviewer | No | No | Low | Async |
| Critical reviewer | No | No | High | Sync |
| Repair branch | Yes | Yes | High | Sync |
| Exploration branch | Yes | No | Medium | Sync |
| Planning branch | Yes | No | Medium | Sync |
| Dead-end memoization | No | No | None | Async |
| Parallel explorations | Yes | No | Medium | Sync, parallel execution |

### Observer vs gatekeeper

**Async → Observer.** The subagent watches and reports. The main session is the source of truth for what to do next and proceeds regardless of whether the observer finds anything.

**Sync → Gatekeeper.** The subagent's output determines or validates the main session's next move. The main session cannot safely proceed until the subagent resolves.

The write conflict test is mechanical: if the subagent has write access to any state the main session is also writing, it must be sync.

### Reversibility override

Even when the three axes say async, irreversibility flips the answer. If the main session's next action cannot be undone — a push, a deploy, a destructive operation — sync review is required regardless of whether the cost of one wrong turn would normally be low.

### Parallel sync

Multiple sync subagents do not have to be sequential. Read-only explorations with no mutual conflicts can all fire simultaneously, with the main session awaiting the full set. This is beam search: sync from the main session's perspective, parallel in wall-clock time.

### Connection to procedural/domain split

Procedural subagents (review, check) tend toward async — they monitor methodology compliance and the main session proceeds regardless. Domain subagents (repair, exploration, planning) tend toward sync — they resolve uncertainty about the problem itself, and the main session does not know what to do next until they complete.

The cleanest heuristic: **if the subagent is checking HOW you're working, async. If it's resolving WHAT to do next, sync.**

---

## Domain Agent / OS Agent Architecture

The search tree model handles branching and distillation. But within the main thread, a fused agent still does everything: it plans, knows about skills, registers considerations, invokes checks. Domain knowledge and procedural machinery are mixed.

The next level of separation is **dependency inversion applied to conversation structure**:

- **Domain agent** — knows the problem, states abstract intents, produces a plan in terms of capabilities. Does not know which skill to use, which check to register, or how any capability is implemented.
- **OS agent** — knows the procedural layer. Receives abstract intents, classifies them, selects the appropriate skill or branch type, executes, and returns distillations.

The domain agent never says "use the explore skill." It says "I need this researched." The OS agent decides that means the explore skill, or bash, or three parallel sub-agents. The domain agent does not care.

### Communication pattern: nested conversations

The temptation is to implement this as two separate agents passing messages — that is agent teams with extra steps. Context reconstruction costs at every handoff.

The right structure is the call stack, made explicit:

```
Domain conversation (outer)
│
│  domain agent: research("how does the session manager work?")
│        ↓
│   [OS agent takes over — inner conversation]
│        inherits full domain context
│        classifies: RESEARCH task
│        loads: explore skill
│        registers: relevant considerations for this capability
│        executes: tool calls, reads, searches
│        distills: ≤3 sentence summary
│   [inner conversation pops]
│        ↑ only the distillation returns
│
│  domain agent receives: ResearchResult
│  continues planning with full context + distillation
```

The inner conversation inherits the full domain context. Its internal work — tool calls, retries, skill mechanics — never appears in the outer conversation. The domain agent's history contains only abstract intents and distilled results.

### The capability manifest

For dependency inversion to work, the domain agent needs to know what abstract capabilities exist — not how they are implemented. This is the API definition between the two layers, injected at session start:

```
capabilities:
  research(topic, scope?)     → findings summary
  implement(spec)             → what was built
  verify(criterion)           → passed | failed + reason
  review(criteria[])          → findings, severity
  explore(question)           → answer + relevant references
  plan(objective)             → revised task list
```

The domain agent plans exclusively in terms of these names. Adding a new skill means adding a new capability implementation — the domain agent is untouched. This is DIP: the domain agent depends on the capability abstraction, not on `manage_check`, `manage_considerations`, or `/skill:explore`.

Capability names should be vocabulary the domain agent naturally uses to describe its intentions — "I need this verified" — not names the OS agent uses to describe its tools — "run the check extension." The interface lives at the domain level of abstraction.

### The OS agent's internal loop

```
receive: research("how does the session manager work?")
    ↓
classify: RESEARCH task
    ↓
dispatch:
  load explore skill
  register consideration: "don't make changes while researching"
  set depth based on scope
    ↓
execute: tool calls, reads, searches
    ↓
distill: ≤3 sentence summary
    ↓
return: ResearchResult
```

Critically: the OS agent registers its own considerations and checks. The domain agent never calls `manage_check` or `manage_considerations`. Those are OS-layer concerns — procedural invariants that apply to how a capability is executed. When the domain agent invokes `implement(spec)`, the OS agent automatically registers the build check for the duration of that execution. The domain agent never touched `manage_check`.

### Instruction types mapped to layers

| Instruction type | Lives in |
|---|---|
| Goal | Domain agent system prompt |
| Domain | Domain agent context |
| Constraints | Both — OS enforces, domain is aware |
| Procedural | OS agent only |
| Style | Domain agent only |
| Meta | OS agent (how to interpret domain's requests) |
| Temporal | OS agent (scoped to capability execution) |

### The capability API design problem

Two failure modes for the interface:

**Too abstract**: "do the thing I need" — the OS agent cannot classify which capability applies.

**Too specific**: "run the explore skill with depth=3 on these files" — the domain agent now knows about the explore skill. The inversion is broken.

The right level is: **what, not how**. `verify("build passes")` is correct. `runBashCheck("npm run check")` is not — that is procedural leaking into domain.

### Capability discovery at plan time

The domain agent needs to know what capabilities exist when forming the plan, not just when executing. If the OS agent lacks a `deploy` capability, the domain agent should not plan a deployment step.

This means the capability manifest must be injected before planning begins. This is a mild form of upfront planning — but it is planning around stable abstractions (capability names), not unstable procedures (skill implementations). Much less brittle.

### Existing system as partial implementation

pi's current architecture is partway here. Extensions (`check.ts`, `consider.ts`) are OS-layer work: they run procedural infrastructure without the domain agent asking. The gap is that the domain agent still explicitly invokes OS machinery via `manage_check` and `manage_considerations` tool calls.

The full architecture would have the OS agent register appropriate checks and considerations automatically based on task classification. The domain agent's intent triggers OS setup implicitly. The domain agent only expresses what it wants; the OS agent is fully responsible for its own infrastructure.

---

## Known Cons

### Reviewer latency on every turn (critical path)

If any consideration has `severity: "critical"`, every `turn_end` blocks waiting for the reviewer to run a full LLM session with tool calls — even when the reviewer returns nothing actionable, which is the common case. An active agent doing many turns incurs this latency on every turn.

Mitigation under consideration: run the reviewer async as usual; if it returns a critical finding while the next turn is already in progress, abort that turn before it completes. More complex but avoids the per-turn tax.

### Repair branch has no timeout or retry cap

The repair branch is a full write-enabled agent loop with no defined stopping condition beyond the `REPAIR_COMPLETE` sentinel. If the issue is unfixable, or the branch loops, nothing stops it. `check.ts` already has `MAX_RETRIES = 3` for exactly this reason.

### Repair branch can silently worsen state

The repair branch has full write access and the main session only sees the distillation. The branch might fix a type error with `as any`, fix a failing test by deleting it, or fix a build by reverting the last commit. The distillation hides this.

### Distillation is also lossy

One of the arguments against agent teams is that sharing information via text is inherently lossy. The repair branch distillation is exactly that. If the repair touched six files and restructured an API, three sentences cannot capture it. The main session then makes decisions on an incomplete model.

The difference from agent teams: this lossiness is bounded and one-directional. But the principle is the same.

### No escalation beyond repair

The design has two responses: steer (advisory) or repair (critical). There is no abort-and-ask-the-user path. Some critical findings are not repairable by any write-enabled agent: the agent has gone off-plan, the approach is architecturally wrong, the next action is irreversible. A third severity tier — `"fatal"` — that aborts the session and surfaces to the user is missing.

### Sync pause freezes the UI

While a critical-path `turn_end` handler is awaited, the agent event loop is blocked. The TUI stalls with no progress indicator and no cancellation path from the user, for however long the repair branch takes.

### Binary severity is too coarse

Advisory vs. critical maps poorly to the real space of urgency. A "did you update the CHANGELOG?" consideration marked critical spawns the same heavy repair branch machinery as "the build is broken." More granularity is needed.

### 1-turn lag fix races with idle session

Removing the state machine deferral and injecting directly from `.then()` means that if the agent goes idle before the reviewer returns, calling `sendUserMessage` starts a new prompt immediately — before the user has typed anything. The state machine avoids this by only injecting at `turn_end`.

### Upfront consideration registration

The quality of branching depends entirely on the quality of considerations registered at session start. Over-registration causes excessive pauses; under-registration misses issues. In the full Domain/OS architecture this is mitigated — the OS agent registers considerations automatically per capability type — but in the current system it is a single point of failure.

---

## Existing Implementation (`consider.ts` + `turn-end-injection.ts`)

### Current architecture

**`check.ts`** (`agent_end`): runs a deterministic bash command; on failure, dumps raw error output as a `followUp` and asks the main session to fix it inline. The main session owns repair — violates the happy path principle.

**`consider.ts`** (`turn_end`): fires the reviewer asynchronously (fire-and-forget). Stores result in a state machine `{ idle → running → done }` and steers it into the main session on the *next* `turn_end`. Has a 1-turn lag: if the agent stops naturally after the violating turn, the finding is never injected.

**`turn-end-injection.ts`**: the reviewer side-session — read-only, seeded with full main context, returns distilled text after the `HAS_TURN_END_QUESTION` sentinel, or `undefined` if nothing actionable.

### Problems with the current design

1. **Single severity level** — all considerations treated identically regardless of urgency.
2. **Main session owns repair** — `check.ts` injects raw errors; the main thread accumulates repair attempts instead of forward progress.
3. **No pause mechanism** — a critical finding can arrive one or more turns too late.
4. **1-turn lag** — if the agent goes idle before the reviewer returns, the finding is dropped.

---

## Planned Changes: Severity + Repair Branch

### `Consideration` type

```ts
interface Consideration {
  text: string;
  removalCondition?: string;
  severity?: "advisory" | "critical";  // default: advisory
}
```

### `ReviewerResult` type (new)

```ts
interface ReviewerResult {
  severity: "advisory" | "critical";
  message: string;
}
```

### `runReviewer` signature (updated everywhere)

```ts
// before
runReviewer(questions: string[]): Promise<string | undefined>

// after
runReviewer(considerations: Consideration[]): Promise<ReviewerResult | undefined>
```

Affected call sites: `types.ts` ×2, `loader.ts`, `agent-session.ts`, `consider.ts`.

### `turn-end-injection.ts`: two sentinels + repair branch

- `ADVISORY_FINDING` (renamed from `HAS_TURN_END_QUESTION`) — inject as steer
- `CRITICAL_FINDING` — spawn write-enabled repair branch before returning

Repair branch: seeded with main context + reviewer finding, instructed to fix the issue and emit `REPAIR_COMPLETE` followed by ≤3 sentence distillation.

### `consider.ts`: sync pause for critical path

```
turn_end handler:
  if any consideration.severity === "critical":
    await pi.runReviewer(considerations)       ← blocks handler → pauses main session
    inject result immediately via steer
  else:
    pi.runReviewer(considerations)             ← fire-and-forget
    .then(result => sendUserMessage(steer))    ← direct inject, no state machine lag
```

The pause works because `runner.ts` `emit()` awaits each handler, and `_emitExtensionEvent()` awaits `emit()`. Blocking the handler blocks the full emit chain.

### Pop semantics

The repair branch's internal transcript is discarded. The main session sees only the ≤3 sentence distillation injected as a steer.

### `check.ts`: deferred

Same problem — main session owns repair. Should eventually use the repair branch mechanism. Separate follow-up due to larger surface area (`agent_end` integration, existing retry loop).

---

## Open Questions

1. **Repair branch fallback** — if `REPAIR_COMPLETE` is absent, what is the return? Options: truncate last assistant text; return generic "repair completed"; surface as error steer.

2. **Repair branch tool set** — main session's active tools, or always the full default set? If the main session has restricted tools, the repair branch inherits that restriction and may be unable to fix anything.

3. **Idle-agent advisory inject** — if the reviewer returns after `agent_end`, calling `sendUserMessage` starts a new prompt immediately. Is that the right behavior, or should the inject wait for the next user-initiated run?

4. **`check.ts` migration** — whether the repair branch should have `git` access and whether it should commit independently.

5. **Fatal severity tier** — a third severity that aborts the session and surfaces to the user rather than attempting repair. Needed for cases where no write-enabled branch can fix the issue.

6. **OS agent implementation path** — the Domain/OS split is currently a conceptual architecture. The concrete path is: (a) stop exposing `manage_check` and `manage_considerations` as tools the domain agent calls directly; (b) have the OS layer register them automatically based on the active capability type. The capability manifest and classification layer do not exist yet.

---

## LLM Signals as Messages — Lessons from Event-Driven Programming

### The core observation

Sentinel text and tool calls are both **messages from the LLM to the system**. The LLM is a producer. The calling code is a consumer. The branch session is a message channel. Without a principled approach, this devolves into a primitive string-pipe architecture — the same problems that motivated event-driven systems in the first place.

### Commands vs Events

Event-driven systems draw a hard distinction:

- **Command**: "Do X" — directed, imperative. The caller expects it to execute. `injectMessage`, `askQuestions` are commands.
- **Event**: "X happened" — broadcast, past tense. The producer doesn't know who reacts. `TASK_COMPLETE` is an event.

This distinction should be reflected in prompt language. Commands use imperative framing: *"call `injectPrompt` when..."*. Events use declarative framing: *"emit `taskCompleted` when the task is done."* Consistent naming — past tense for events (`taskCompleted`, `featureImplemented`), imperative for commands (`injectPrompt`, `researchQuestion`) — reduces ambiguity and aligns with how the model was trained on human writing.

### Typed Events vs Untyped Messages

The progression from sentinels to tool calls mirrors the evolution from raw string pipes to typed events:

```
Stage 1 (raw):    "TASK_COMPLETE: feature done"       ← sentinel
Stage 2 (typed):  { type: "taskCompleted", summary }   ← tool call
Stage 3 (schema): TaskCompletedEvent { summary: string, commitHash?: string }
```

Tool calls are already Stage 2. Stage 3 is a **formal event catalog** where every LLM-emittable signal has a typed schema, a handler registration point, and a documented contract. Extensions subscribe to specific event types. The LLM is given the catalog as its API — more reliable than ad-hoc natural language descriptions because the model generalizes better from structured contracts.

### Sentinel vs tool call — the decision rule

| Situation | Use |
|---|---|
| Needs parameters or structured data | Tool |
| Binary flag, calling code acts after session | Tool (more reliable) |
| Must detect signal mid-stream | Sentinel |
| Side effect must happen during session execute | Tool with local-only execute, act after |
| Model doesn't support tool calls | Sentinel |

The re-entrancy concern (tool `execute` calling `sendUserMessage` during `agent_end`) is resolved by making `execute` set only a local closure variable, then acting after `runBranchSession` returns. This removes the only genuine technical advantage sentinels had over tools in non-streaming contexts.

### Choreography vs Orchestration

`os-agent.ts` is currently an orchestrator — one function controls the whole flow. As capabilities grow, this becomes a bottleneck.

Choreography is the alternative: each capability registers a handler for a specific event type independently. The LLM emits `taskCompleted`; multiple handlers react — review handler, metrics handler, state handler — without any knowing about each other. This maps to the framework/skill separation: the OS agent provides the event bus; skills subscribe to events they care about.

### Idempotency via the session, not in-memory flags

In-memory flags (`reviewTriggered`) are lost on compaction, reload, or restart. The session history already IS an append-only event log — the correct idempotency source. Instead of a flag, ask: "Has a review checklist already appeared in the last N messages?" This survives compaction and is naturally consistent with the conversation state.

### Back-pressure

Every user message currently spawns a branch session, unbounded. If the user types quickly, multiple sessions queue. Event-driven equivalents: debounce (only process the last in a burst), throttle (max one per N seconds), or bounded queue depth. The simplest implementation: if a consideration session is already running, skip the next trigger or hold at most one pending.

### Dead letters — silent failure is the enemy

When a branch session errors or times out, we log and return `undefined`. The consideration is silently dropped — indistinguishable from "all clear." Event-driven systems route failed messages to a **dead letter queue** for inspection and retry.

The equivalent:
1. Notify the user via UI when a branch session fails rather than silently dropping
2. Add an explicit failure signal to prompts (`UNABLE_TO_EVALUATE` + reason) so the LLM can distinguish "checked and all clear" from "could not evaluate"
3. Optionally retry once with a simpler prompt before surfacing the failure

### Event sourcing — the session is already the log

Event sourcing means state is derived from replaying an append-only log. The session history is this log. Every tool call, every commit action, every message is already recorded.

For sharp signals — "did the agent just commit?" — **pattern-matching directly against the log** is more reliable than asking an LLM. The LLM completion classifier is appropriate when the signal is ambiguous. Deterministic history scanning should be preferred when a specific tool call or output pattern definitively indicates state.

### Practical roadmap

**Prompt changes:**
- Define an event catalog with consistent naming conventions (past tense events, imperative commands)
- Add explicit failure signals so silence is never ambiguous
- Include causal framing in event emissions: the LLM states *why* it is emitting, not just *that* it is

**Infrastructure changes:**
- `ctx.emitEvent(type, payload)` on `ExtensionContext` — extensions register typed handlers; the framework routes LLM-emitted events to them
- Replace in-memory idempotency flags with session history checks in branch session prompts
- Back-pressure: track running branch sessions, skip or queue rather than launch unbounded
- Dead letter surface: failed branch sessions notify the user rather than silently returning `undefined`
