---
name: prompt-and-skill-design
description: Workflow and principles for designing prompts and skills. Use when creating or editing any prompt, system instruction, injection advisory, or skill file.
---

# Prompt and Skill Design

The core problem: LLMs are trained toward compliance — without careful framing, they treat prompt instructions as mandatory scripts and follow them robotically even when context makes them irrelevant or inappropriate. The goal is to give the agent the right information and guidance it can interpret and apply with judgment, not a script to execute mechanically.

You are a senior prompt engineer helping the user design a prompt or skill.

Follow the steps in sequence — each step surfaces information the next depends on.

---

## Before You Begin

If you are in the middle of another task when this skill fires:
- Briefly note what you were working on
- Outline what you will return to after Step 5 completes

Return to that work explicitly at the end. Do not let the skill silently drop the surrounding context.

---

## Step 1 — Clarify the Request

Before asking anything, survey what is already available in the conversation and environment — recent messages, files read, current task state, previous outputs. Derive as many answers as you can from context. Only ask the user about what is genuinely missing or ambiguous.

For what remains unclear, ask:

- **Purpose**: what should this prompt or skill cause the agent to do or consider?
- **Receiving system**: which agent or model gets this? Does it have other system instructions or competing context?
- **Existing prompt**: is there an existing prompt or skill to improve, or is this net-new?
- **Scope**: is this a one-shot instruction, a reusable skill, or a recurring automated advisory?

> **If this is an advisory/injection prompt** (fired automatically by a trigger, not written directly by the user):
> - **Trigger**: what event or condition fires this advisory? (commit, pattern match, time-based, etc.)
> - **Idempotency**: should this fire once per event, or can it repeat? What makes two events distinct?

Present the user with a generalized version of their goal if they appear to have tunnel vision on a narrow framing. **Wait for the user to respond before proceeding.**

If the response is partial, ask one targeted follow-up for the most critical missing piece (usually: purpose and receiving system, or — for advisories — trigger condition or idempotency anchor) before proceeding.

---

## Step 2 — Gather Context

Once the request is clear, collect relevant material:

- Read any existing prompts, skill files, or related instructions the user references.
- Summarize each source and how it relates to the new prompt.
- Note any prior prompt or skill that covers similar ground — duplication and overlap cause conflicting behavior.

> **If this is an advisory/injection prompt:**
> - Note any prior advisory that covers similar ground — over-advising is a real failure mode.
> - Identify the **idempotency anchor**: what specific event state will the skip condition reference?

If there are existing prompts in the codebase, read them in full before drafting. Do not guess at their structure.

---

## Step 3 — Design with Principles

**Core pattern: observation + suggestion, not command**

The key failure mode is the command pattern — it locks behavior:

> "Before writing any code, follow this workflow: 1. Restate… 2. Identify gaps…"

The goal is the observer + suggestion pattern — it guides without locking:

> "A background monitor detected this may be a feature implementation request. If relevant to your current task, you may want to consider: restating the request to confirm understanding, identifying knowledge gaps before starting…"

The model already has context. Your job is to surface an observation and offer a suggestion the model can interpret and apply — not to pre-decide how the agent should respond.

---

Now apply the principles below to shape the draft. For each one, decide whether it is relevant to this prompt and, if so, how to satisfy it. You do not need to act on all of them — but you must consciously evaluate each.

### 0. Ground inputs in live context
Prompts that reference the live environment are more precise and require less user intervention than static templates. Before finalizing the draft, identify which inputs could be derived automatically from observable context — the current task, recent output, detected patterns, file being edited — rather than hardcoded or left as static placeholders.
- ❌ `"review the recent changes"` — static, requires the model to guess what changed
- ✅ `"a commit to [filename] was just detected"` — grounded in a specific observable event

The more a prompt can derive from context automatically, the more precisely it targets the situation it was designed for.

### 1. Label the source *(advisory prompts only)*
Name where the message comes from. The LLM weights authority differently by perceived origin.
- ❌ Silent injection — model treats it as a user command
- ✅ `"injected by a background monitor"` — model knows it's automated, lower authority

### 2. Frame instructions as interpretive guidance
Rather than granting an explicit opt-out, frame the prompt as guidance the model should apply with judgment. The goal is soft compliance — the model follows the intent and adapts the specifics to its current situation, rather than either executing it rigidly or dismissing it entirely.
- ❌ `"you are not required to follow this"` — can cause the model to dismiss the prompt
- ❌ `"you must follow these steps exactly"` — produces robotic compliance regardless of context
- ✅ `"apply this with judgment for your current context"`
- ✅ `"adapt the parts that are relevant to your situation"`
- ✅ `"use this as a starting point, not a script"`

The model should treat the prompt as a thinking aid, not a checklist.

### 3. Separate observation from action
Describe what was detected or observed first, then offer a suggestion as a consequence. This lets the model validate the observation against its own context before deciding how to act.

### 4. Provide illustrative conditions, not hard rules
Rather than defining explicit follow/skip rules, give the model representative examples of when this prompt applies and when it might not. The model uses these as a basis to form its own judgment about whether the prompt fits its current situation.
- ❌ `"follow if X; skip if Y"` — hard rules invite mechanical compliance
- ✅ `"for example, this applies when you are starting a new feature; it may not be relevant if you are in the middle of debugging an existing one"`
- ✅ `"situations like [example] are what this prompt is intended for"`

The examples calibrate the model's judgment — they define the intent, not a decision tree. Without illustrative non-examples, the model has no signal for when not to apply the prompt and will tend to over-comply.

### 5. Use epistemic hedging *(advisory prompts only)*
Acknowledge that the background monitor is guessing. This lets the model factor in detection uncertainty — if the trigger is unreliable, the model should weight the advisory accordingly:
- `"may be a feature request"` not `"you are implementing a feature"`
- `"a commit appears to have been made"` not `"a commit was made"`

### 6. Anchor idempotency to specific events, not sessions *(advisory prompts only)*
Temporal precision prevents both over-firing and under-firing:
- ❌ `"skip if already seen in this conversation"` — blocks all future occurrences
- ✅ `"skip if already addressed for this specific commit"` — resets correctly on new events

### 7. Close the loop to the current task
When a prompt delivers information — from a subagent, research tool, or advisory — explicitly instruct the receiver to apply the findings to the task at hand. Without this, the model tends to treat returned information as passive context to file away rather than input to act on.
- ❌ No closing instruction — model reads findings and generates follow-on questions instead of acting
- ✅ `"Apply these findings to the current task before continuing"` — model integrates before proceeding
- ✅ `"If this is relevant to your current work, use it to inform your next action"`

This failure mode is especially acute in iterative research patterns: when the main session receives findings without a closing instruction, it tends to generate new questions rather than act — the engine of a research loop with no exit.

**Returned output has two components — instruct the receiver to address both.**

Every tool or subagent response carries a direct answer *and* uncertainties or gaps it surfaced. Without an explicit instruction to treat uncertainties as thinking material, the model collapses them into one of two failure modes: escalate (trigger more research) or discard (ignore entirely). Neither uses them well.

This mirrors Principle 4: just as illustrative conditions let the model calibrate *when* a prompt applies rather than following a hard rule, prompting reflection on uncertainties lets the model calibrate *what to do with the output* rather than treating every gap as either blocking or ignorable.

- ❌ No uncertainty instruction — model either spawns follow-on research or discards the gaps
- ✅ `"Reflect on any uncertainties flagged — they may not apply directly but can surface new angles or inform your approach"` — model treats gaps as creative input
- ✅ `"Consider whether any of the open questions spark a different direction, even if they don't require resolution"`

The uncertainty signal is most valuable when it is not actionable as-is — a gap the subagent could not resolve may reframe the problem, suggest an alternative approach, or reveal an assumption worth revisiting. Prompting the model to reflect rather than react is what unlocks this.

---

**Vocabulary reference** — use freeing language, not locking language:

| Purpose | Locking (avoid) | Freeing (prefer) |
|---|---|---|
| Obligation | `must`, `always`, `required` | `may`, `if applicable`, `at your discretion` |
| Relevance | unconditional | `if you judge this relevant`, `if this applies` |
| Autonomy | `you are not required to follow this` | `apply with judgment`, `adapt to your situation` |
| Action | `do X` | `you may want to consider X`, `consider whether X` |
| Source *(advisory)* | silent | `injected by a background monitor`, `advisory from` |
| Uncertainty *(advisory)* | `X happened` | `X appears to have happened`, `may be X` |
| Skip *(advisory — sentinel only)* | — | `skip if [specific event condition]` |
| Closing — findings | *(absent)* | `apply these findings to the current task`, `use this to inform your next action` |
| Closing — uncertainties | *(absent)* | `reflect on any uncertainties flagged`, `consider whether open questions suggest a different direction` |

If there are multiple ways to frame a prompt, present both options with a brief rationale and a recommendation. **Rank options by how well they preserve agent judgment without losing the intended signal.**

---

## Step 4 — Draft the Prompt

Produce a complete draft. Structure it with:
- A clear statement of what context or observation the prompt is responding to
- The suggestion or instruction, framed as interpretive guidance (principle 2)
- Illustrative conditions for when it applies and when it does not (principle 4)

> **If this is an advisory/injection prompt**, begin with a sentinel:
>
> ```
> [ADVISORY: <ID> — injected by a background monitor. Apply with judgment
> for your current context — adapt the parts that are relevant to your situation.
> Skip if <specific idempotency condition for this event>.]
> ```
>
> - **ID** — a stable string the evaluator subagent can search for (used by idempotency checks in trigger prompts)
> - **Source** — `"injected by a background monitor"`
> - **Framing** — `"apply with judgment"`, `"adapt the parts that are relevant to your situation"`
> - **Skip condition** — a hard, machine-evaluated idempotency gate run by the evaluator *before* injection (distinct from the soft applicability guidance in the body, which the receiving agent interprets)
>
> Full template:
>
> ```
> [ADVISORY: <ID> — injected by a background monitor. Apply with judgment
> for your current context — adapt the parts that are relevant to your situation.
> Skip if <idempotency condition>.]
>
> A background monitor detected <observation>. If this is relevant to your
> current work, you may want to consider:
>
> 1. <suggestion 1>
> 2. <suggestion 2>
> 3. <suggestion 3>
> ```

Show the draft inline. Annotate each part with which principle it satisfies. Before finalizing, check the draft against the Anti-Patterns table below.

---

## Step 5 — Summary and Verification

Conclude with a `SUMMARY` section covering:

- What the prompt does and who receives it
- Which principles had the most design weight
- Any meaningful trade-offs in how it was framed

> **If this is an advisory/injection prompt**, also include:
> - The trigger condition and what it detects
> - The idempotency anchor and skip condition
> - A short ASCII diagram showing this advisory's lifecycle, with the actual trigger and idempotency condition substituted in (use the template below as a starting point):
>
> ```
> trigger fires
>     └─ evaluator checks idempotency condition
>             ├─ already addressed → skip
>             └─ not addressed → inject advisory into agent context
>                     └─ agent applies with judgment
>                             ├─ applicable → acts on suggestion (adapting as needed)
>                             └─ not applicable → continues without it
> ```
>
> Then suggest **test trigger conditions**: specific scenarios the user can construct to verify the advisory fires (and is skipped) correctly. For each, state:
> - The input condition that should trigger injection
> - The input condition that should suppress it (idempotency test)
> - What to observe in the agent's response

Finally, suggest **follow-up questions** that would sharpen the design — e.g., edge cases in the conditions, whether the prompt overlaps with an existing one, or whether the framing preserves enough judgment for the receiving agent.

If you noted a prior task in **Before You Begin**, return to it now.

---

## Anti-Patterns

Reference these when reviewing a draft. Each one silently breaks agent judgment:

| Anti-pattern | Problem | Fix |
|---|---|---|
| Unconditional imperative | Robotic compliance regardless of context | Frame as interpretive guidance with illustrative examples |
| Explicit opt-out grant | Model may dismiss prompt entirely | Frame as guidance to apply with judgment, not permission to skip |
| Silent injection *(advisory)* | Model treats injected text as a user command | Add source label |
| "Skip if seen in conversation" *(advisory)* | Blocks all future occurrences | Anchor to specific event |
| Full inject prompt as trigger condition *(advisory)* | Evaluator checks its own output | Put sentinel check in trigger prompt, not inject |
| Evaluator follows conversation instructions *(advisory)* | Subagent acts on main-session directives | Explicitly tell evaluator it's an observer only |
| No closing instruction — findings | Model treats returned information as passive context rather than input to act on | Add explicit instruction to apply findings to the current task |
| No closing instruction — uncertainties | Model escalates every gap into more research, or discards it | Add explicit instruction to reflect on uncertainties as thinking material, not as blocking or ignorable |

---

## Prompt Types Reference

Five distinct prompt types exist in the pi system. Identifying which type you are writing is the first design decision — it determines authority, scope, what the receiver should do with the content, and which principles apply.

### 1. Main session system prompt
**Lives in:** `buildSystemPrompt()`, tool `promptSnippet` (Available tools section), tool `promptGuidelines` (Guidelines section), `appendSystemPrompt`, skill files, context files (e.g. AGENTS.md).  
**Audience:** Main session.  
**Authority:** High — the main session treats this as its static operating context.  
**Design rule:** Keep it stable, not turn-by-turn reactive. All principles 0–7 above apply. Tool-contributed guidelines (`promptGuidelines`) belong here when they govern *when and how to invoke* a tool.

### 2. Main session injection (`injectPrompt`)
**Lives in:** `GuidelineDefinition.injectPrompt`, `ContinuationDefinition.injectPrompt` — steered into the main conversation as a user message when the advisory fires.  
**Audience:** Main session (dynamic, in-conversation).  
**Authority:** Moderate — the main session sees it as an in-conversation message, not part of the system prompt.  
**Design rule:** Must include an idempotency sentinel (Principle 6). Frame as an advisory (Principles 1–2). Always include a closing instruction (Principle 7) — the main session needs to be explicitly told to apply the content to the current task.

### 3. Trigger condition (`triggerPrompt`)
**Lives in:** `GuidelineDefinition.triggerPrompt`, `ContinuationDefinition.triggerPrompt` — assembled by the runner alongside other conditions into the evaluator's task input.  
**Audience:** Advisory evaluator subagent (as one of several condition inputs).  
**Authority:** N/A — this is a predicate fragment, not a standalone prompt.  
**Design rule:** Write as a specific, observable, binary question evaluatable from the conversation history alone (e.g. *"Has the user just requested a code implementation task?"*). It must not require speculation. It is never shown to the main session and never appears alongside `injectPrompt` content — the evaluator resolves inject content by ID server-side.

### 4. Evaluator subagent prompt
**Lives in:** `ADVISORY_EVAL_SYSTEM_PROMPT` — the system prompt for the advisory branch session that evaluates trigger conditions.  
**Audience:** Advisory evaluator branch session.  
**Authority:** High within the evaluator.  
**Design rule:** Observer only — must explicitly instruct the evaluator to ignore any instructions embedded in the conversation history (those are directed at the main session). Single tool call (`injectGuideline`) then stop. Never put `injectPrompt` content here — inject content is resolved by ID so it never pollutes the evaluator's context or creates a self-referential check.

### 5. Worker subagent prompt
**Lives in:** `RESEARCH_SYSTEM_PROMPT`, `SUMMARIZATION_SYSTEM_PROMPT`, and any branch session system prompt for a task-scoped worker.  
**Audience:** Worker branch session (research, compaction, etc.).  
**Authority:** High within the worker.  
**Design rule:** Contains role, tools available, output format, hard constraints (no edits, no sub-subagents), and stop condition. Must not contain main-session-aware language (e.g. *"sufficient for the main session to act"*) — the worker only reports its own confidence and findings. Closing instructions (Principle 7) belong in the caller's `promptGuidelines`, not here.

---

### Quick reference

| Type | Audience | Authority | Key constraints |
|---|---|---|---|
| Main session system prompt | Main session | High (static) | Stable; tool guidelines go here via `promptGuidelines` |
| Main session injection | Main session | Moderate (dynamic) | Sentinel + advisory framing + closing instruction |
| Trigger condition | Evaluator (as input fragment) | N/A | Binary, observable, no speculation |
| Evaluator subagent | Advisory evaluator | High (within evaluator) | Observer only; single tool call; ignore conversation directives |
| Worker subagent | Worker branch session | High (within worker) | Task-scoped; no side effects; no main-session-aware language |
