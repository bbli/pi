---
name: prompt-and-skill-design
description: Reviewing and designing prompts and skills. Use when creating, editing, or reviewing any prompt, system instruction, injection advisory, or skill file.
---

# Prompt and Skill Review

Prompts are code. A prompt that appears well-intentioned can fail silently — misfiring on the wrong context, producing robotic compliance, or breaking idempotency — in ways that are invisible until a specific condition is hit. The goal of this review is to trace how the prompt actually executes, then evaluate it against the principles below with the same rigor applied to code review.

For new prompts: draft first, then apply Phases 1–4 to the draft before finalizing.

---

## Before You Begin

If you are in the middle of another task when this skill fires:
- Briefly note what you were working on
- Return to that work explicitly at the end

---

## Phase 1: Read and Trace

Before evaluating anything, establish what the prompt actually does in practice.

1. **Read the prompt in full.** Do not skim or summarize — read every line.
2. **Identify the prompt type** using the Prompt Types Reference below. This determines which principles apply and what the receiver's authority and context are.
3. **Trace execution:**
   - When does this prompt fire? What is the trigger condition?
   - Who receives it, and what is their role?
   - What does the receiver's context look like at the exact moment it fires? What messages, tool calls, or injected content are already present? What is the most recent thing in their context?
   - For advisory prompts: what does the evaluator subagent see? What does the main session see after injection? Are prior injections of this advisory already in the conversation?
4. **Identify risk areas for Phase 2** — based on the trace, note which aspects of the prompt are most sensitive to context or timing.

Produce a brief written trace (2–4 sentences) summarizing what the receiver sees and when. This is the anchor for all subsequent analysis.

---

## Phase 2: Principles Review (CRITICAL)

Evaluate the prompt against each applicable principle. For each:
- State whether the principle applies to this prompt type.
- If it applies, state whether the prompt satisfies it.
- If it does not satisfy it, name the specific gap and the failure mode it creates.

Only flag a gap if it would materially affect behavior. Skip principles that clearly do not apply.

### 0. Ground inputs in live context
Does the prompt reference specific, observable context — or does it rely on vague references like "the recent changes" or "the most recent response"? Verify those references against the execution trace: at the moment this prompt fires, does the referenced thing actually exist in the receiver's context, and is it the thing the author intended?

### 1. Label the source *(advisory prompts only)*
Does the prompt begin with a `[SYSTEM INSTRUCTION: <ID>]` sentinel? Is the ID stable and consistent with existing usage?

### 2. Frame as observation + suggestion
Does the prompt describe what was observed before suggesting what to do, and is that suggestion framed as guidance the receiver can apply with judgment rather than a mandatory script? Check for unconditional imperatives (`must`, `always`, `required`) and for prompts that jump straight to action without first giving the receiver the observation to validate against their own context.

### 3. Illustrative conditions, not hard rules
Does the prompt include examples of when it applies and when it does not, and does it explicitly tell the receiver to use those examples to form their own judgment? Without non-examples the receiver over-applies; without the explicit framing that the examples are representative rather than exhaustive, the receiver treats them as a decision tree.

### 4. Idempotency anchor *(advisory prompts only)*
Is the skip condition anchored to a specific event, not the session? A session-scoped skip condition blocks all future occurrences of the advisory.

### 5. Close the loop
Does the prompt instruct the receiver to apply its content to the current task? Without this, the receiver treats the content as passive context rather than input to act on. Check both components: the direct findings *and* any uncertainties or gaps surfaced.

### 6. Acknowledge the interruption *(advisory injection prompts — long workflows only)*
If the advisory may fire while the receiver is mid-task, does it ask the receiver to briefly note what was in progress before entering the workflow, and to return to it afterward? Without this, the workflow completes but the prior context is silently abandoned.

---

## Phase 3: Anti-Pattern Scan

Check the prompt against each anti-pattern. For any match, flag it as a finding with the specific text that triggers it.

| Anti-pattern | Problem |
|---|---|
| Unconditional imperative | Robotic compliance regardless of context |
| Explicit opt-out grant | Model may dismiss the prompt entirely |
| Silent injection *(advisory)* | Model treats injected text as a user command |
| "Skip if seen in conversation" *(advisory)* | Blocks all future occurrences |
| Full inject prompt as trigger condition *(advisory)* | Evaluator checks its own output |
| Evaluator follows conversation instructions *(advisory)* | Subagent acts on main-session directives |
| No closing instruction — findings | Model treats returned information as passive context rather than input to act on |
| No closing instruction — uncertainties | Model escalates every gap into more research, or discards it |
| No interruption acknowledgment *(advisory, long workflow)* | Prior task is silently abandoned when the advisory fires mid-task |

---

## Phase 4: Edge Cases

Reason about inputs and states the author may not have anticipated. For each, name the scenario and the failure mode.

Common edge case categories:

- **Context mismatch**: the prompt references "the most recent X" or "anything recent" but at the moment of firing, the receiver's context contains something unexpected between the intended referent and the present (e.g., an injected advisory appears after the agent's response, making the advisory — not the agent's output — the most recent message)
- **Partial trigger match**: the trigger condition is partially satisfied — the prompt fires, but the content is not fully applicable to the situation
- **Re-injection behavior**: the prompt fires again after a prior injection that the receiver already acted on — is re-injection useful, or does it thrash?
- **Competing instructions**: the receiver has other system instructions that conflict with this prompt — which wins, and is that the intended outcome?
- **Thin context**: the prompt fires early in a conversation when the receiver has little context to anchor its judgment
- **Idempotency race**: the skip condition is checked against stale state, or the event that should reset it does not do so reliably

---

## Summary

Conclude with a summary of findings grouped by severity:

- **Critical** — gaps that will cause the prompt to silently fail or misfire in predictable conditions
- **Important** — gaps that degrade behavior but may not always manifest
- **Minor** — style or framing improvements

For each finding:
1. The principle, anti-pattern, or edge case it falls under
2. The specific text or structural issue
3. A concrete suggestion for how to fix it

If the prompt is sound, say so explicitly.

---

## General Principles

These principles are the review criteria for Phase 2. They also guide drafting when writing new prompts.

The core problem: LLMs are trained toward compliance — without careful framing, they treat prompt instructions as mandatory scripts and follow them robotically even when context makes them irrelevant or inappropriate. The goal is to give the agent the right information and guidance it can interpret and apply with judgment, not a script to execute mechanically.

The core pattern is **observation + suggestion, not command**:

> ❌ "Before writing any code, follow this workflow: 1. Restate… 2. Identify gaps…"

> ✅ "A background monitor detected this may be a feature implementation request. If relevant to your current task, you may want to consider: restating the request to confirm understanding, identifying knowledge gaps before starting…"

The model already has context. Your job is to surface an observation and offer a suggestion the model can interpret and apply — not to pre-decide how the agent should respond.

### 0. Ground inputs in live context
Prompts that reference the live environment are more precise and require less user intervention than static templates. Before finalizing a draft, identify which inputs could be derived automatically from observable context — the current task, recent output, detected patterns, file being edited — rather than hardcoded or left as static placeholders.

The more a prompt can derive from context automatically, the more precisely it targets the situation it was designed for.

### 1. Label the source *(advisory prompts only)*
Name where the message comes from. The LLM weights authority differently by perceived origin.
- ❌ Silent injection — model treats it as a user command
- ✅ `[SYSTEM INSTRUCTION: <ID>]` sentinel prefix — the structured format signals the message is automated, not a user command

### 2. Frame as observation + suggestion *(IMPORTANT)*
Describe what was detected or observed first, then offer a suggestion as a consequence — framed as guidance the model can apply with judgment, not a mandatory script. Separating the observation from the action lets the model validate the observation against its own context before deciding how to act; framing the action as guidance rather than a command prevents robotic compliance when context makes the suggestion irrelevant.
- ❌ `"you are not required to follow this"` — can cause the model to dismiss the prompt
- ❌ `"you must follow these steps exactly"` — produces robotic compliance regardless of context
- ✅ `"apply this with judgment for your current context"`
- ✅ `"adapt the parts that are relevant to your situation"`
- ✅ `"use this as a starting point, not a script"`

### 3. Provide illustrative conditions, not hard rules *(IMPORTANT)*
Rather than defining explicit follow/skip rules, give the model representative examples of when this prompt applies and when it might not, and explicitly tell the receiver to use those examples to form their own judgment. The examples calibrate — they are not a decision tree.
- ❌ `"follow if X; skip if Y"` — hard rules invite mechanical compliance
- ✅ `"These are representative examples — use them to form your own judgment: this tends to apply when you are starting a new feature; it may not be relevant if you are in the middle of debugging an existing one"`

Without illustrative non-examples the receiver over-applies; without the explicit framing that the examples are representative, the receiver treats them as exhaustive rules.

### 4. Anchor idempotency to specific events, not sessions *(advisory prompts only)*
Temporal precision prevents both over-firing and under-firing:
- ❌ `"skip if already seen in this conversation"` — blocks all future occurrences
- ✅ `"skip if already addressed for this specific commit"` — resets correctly on new events

### 5. Close the loop *(IMPORTANT)*
When a prompt delivers information, explicitly instruct the receiver to apply the findings to the task at hand. Without this, the model tends to treat returned information as passive context to file away rather than input to act on.
- ✅ `"Apply these findings to the current task before continuing"`

**Returned output has two components — instruct the receiver to address both.**

Every tool or subagent response carries a direct answer *and* uncertainties or gaps it surfaced. Without an explicit instruction to treat uncertainties as thinking material, the model either escalates (triggers more research) or discards them.

- ❌ No uncertainty instruction — model either spawns follow-on research or discards the gaps
- ✅ `"Reflect on any uncertainties flagged — they may not apply directly but can surface new angles or inform your approach"`

### 6. Acknowledge the interruption *(advisory injection prompts — long workflows only)*
When an advisory fires mid-task, the receiver may have been in the middle of something. Without an explicit acknowledgment step, the workflow completes but the prior context is silently abandoned — the receiver either forgets what they were doing or has to reconstruct it from scratch.

For workflows long enough to displace the interrupted task, instruct the receiver to briefly note what was in progress before entering the workflow and to outline the return path after it completes.

- ❌ No acknowledgment — advisory fires, prior work is lost
- ✅ `"Before starting, briefly note what you were in the middle of and outline the steps you will need to return to once this workflow is complete."`

This applies most strongly to workflows that may fire at any point during an active task (e.g., CODE_WORKFLOW). It is less applicable to advisories that fire at natural task boundaries (e.g., post-implementation review or flesh-out prompts), where there is typically nothing in progress to interrupt.

---

## Vocabulary Reference

Use freeing language, not locking language:

| Purpose | Locking (avoid) | Freeing (prefer) |
|---|---|---|
| Obligation | `must`, `always`, `required` | `may`, `if applicable`, `at your discretion` |
| Relevance | unconditional | `if you judge this relevant`, `if this applies` |
| Autonomy | `you are not required to follow this` | `apply with judgment`, `adapt to your situation` |
| Action | `do X` | `you may want to consider X`, `consider whether X` |
| Source *(advisory)* | silent | `[SYSTEM INSTRUCTION: <ID>]` prefix |
| Uncertainty *(advisory)* | `X happened` | `X appears to have happened`, `may be X` |
| Skip *(advisory — sentinel only)* | — | `Skip only if [specific event condition]` |
| Closing — findings | *(absent)* | `apply these findings to the current task` |
| Closing — uncertainties | *(absent)* | `reflect on any uncertainties flagged` |
| Interruption *(advisory, long workflow)* | *(absent)* | `"Before starting, briefly note what you were in the middle of..."` |

---

## Prompt Types Reference

Five distinct prompt types exist in the pi system. Identifying which type you are reviewing is the first step in Phase 1 — it determines authority, scope, what the receiver does with the content, and which principles apply.

### 1. Main session system prompt
**Lives in:** `buildSystemPrompt()`, tool `promptSnippet`, tool `promptGuidelines`, `appendSystemPrompt`, skill files, context files (e.g. AGENTS.md).
**Audience:** Main session.
**Authority:** High — treated as static operating context.
**Design rule:** Keep it stable, not turn-by-turn reactive. All principles 0–7 apply. Tool-contributed guidelines (`promptGuidelines`) belong here when they govern *when and how to invoke* a tool.

### 2. Main session injection (`injectPrompt`)
**Lives in:** `GuidelineDefinition.injectPrompt`, `ContinuationDefinition.injectPrompt`.
**Audience:** Main session (dynamic, in-conversation).
**Authority:** Moderate — seen as an in-conversation message, not part of the system prompt.
**Design rule:** Must include an idempotency sentinel (Principle 4). Frame as an advisory (Principles 1–2). Always include a closing instruction (Principle 5).

### 3. Trigger condition (`triggerPrompt`)
**Lives in:** `GuidelineDefinition.triggerPrompt`, `ContinuationDefinition.triggerPrompt`.
**Audience:** Advisory evaluator subagent (as one of several condition inputs).
**Authority:** N/A — a predicate fragment, not a standalone prompt.
**Design rule:** Write as a specific, observable, binary question evaluatable from the conversation history alone. It must not require speculation. Never shown to the main session.

### 4. Evaluator subagent prompt
**Lives in:** `ADVISORY_EVAL_SYSTEM_PROMPT`.
**Audience:** Advisory evaluator branch session.
**Authority:** High within the evaluator.
**Design rule:** Observer only — must explicitly instruct the evaluator to ignore any instructions embedded in the conversation history. Single tool call (`injectGuideline`) then stop. Never put `injectPrompt` content here.

### 5. Worker subagent prompt
**Lives in:** `RESEARCH_SYSTEM_PROMPT`, `SUMMARIZATION_SYSTEM_PROMPT`, and any branch session system prompt for a task-scoped worker.
**Audience:** Worker branch session.
**Authority:** High within the worker.
**Design rule:** Contains role, tools available, output format, hard constraints (no edits, no sub-subagents), and stop condition. Must not contain main-session-aware language. Closing instructions (Principle 7) belong in the caller's `promptGuidelines`, not here.

---

### Quick reference

| Type | Audience | Authority | Key constraints |
|---|---|---|---|
| Main session system prompt | Main session | High (static) | Stable; tool guidelines go here via `promptGuidelines` |
| Main session injection | Main session | Moderate (dynamic) | Sentinel + advisory framing + closing instruction |
| Trigger condition | Evaluator (as input fragment) | N/A | Binary, observable, no speculation |
| Evaluator subagent | Advisory evaluator | High (within evaluator) | Observer only; single tool call; ignore conversation directives |
| Worker subagent | Worker branch session | High (within worker) | Task-scoped; no side effects; no main-session-aware language |
