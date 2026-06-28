---
name: advisory-prompt-design
description: Principles and vocabulary for designing advisory/injection prompts that preserve LLM judgment and agency. Use when writing inject prompts, system advisories, or any background-injected message where the receiving agent should decide whether to follow the suggestion rather than comply mechanically.
---

# Advisory Prompt Design

Advisory prompts are messages injected into an agent's context by an automated system (not the user). The core problem: LLMs are trained toward compliance — without careful framing, they treat injected text as mandatory instructions and follow it robotically even when the current context makes it irrelevant.

The goal is to give the agent the right information and the explicit permission to use its judgment.

## Core Principle: Observation + Suggestion, Not Command

**Command pattern (locks behavior):**
> "Before writing any code, follow this workflow: 1. Restate… 2. Identify gaps…"

**Observer + suggestion pattern (preserves judgment):**
> "A background monitor detected this may be a feature implementation request. If relevant to your current task, you may want to consider: restating the request to confirm understanding, identifying knowledge gaps before starting…"

The model already has context. Your job is to surface an observation and offer a suggestion, not pre-decide that the suggestion applies.

---

## Six Design Principles

### 1. Label the source
Name where the message came from. The LLM weights authority differently based on perceived origin.
- ❌ Silent injection — model assumes it came from the user
- ✅ `"injected by a background monitor"` — model knows it's automated, lower authority

### 2. Grant explicit autonomy
LLMs default to compliance. Override that explicitly:
- `"you are not required to follow this"`
- `"decide for yourself whether this is relevant to your current task"`
- `"at your discretion"`

Without this, the model will comply even when it clearly shouldn't.

### 3. Separate observation from action
Describe what was detected first, then offer a suggestion as a consequence. This lets the model validate the observation against its own context before deciding.

### 4. Model both follow and skip conditions
Define not just when to comply, but when NOT to:
- `"follow if relevant; skip if [specific condition]"`
- `"ignore if you have already addressed this"`

Without an explicit skip condition, the model over-complies.

### 5. Use epistemic hedging
Acknowledge that the background monitor is guessing. This lets the model factor in detection uncertainty:
- `"may be a feature request"` not `"you are implementing a feature"`
- `"a commit appears to have been made"` not `"a commit was made"`

### 6. Anchor idempotency to specific events, not sessions
Temporal precision prevents both over-firing and under-firing:
- ❌ `"skip if already seen in this conversation"` — blocks all future occurrences
- ✅ `"skip if already addressed for this specific commit"` — resets correctly on new events

---

## Vocabulary Reference

| Purpose | Locking (avoid) | Freeing (prefer) |
|---|---|---|
| Obligation | `must`, `always`, `required` | `may`, `if applicable`, `at your discretion` |
| Relevance | unconditional | `if you judge this relevant`, `if this applies` |
| Source | silent | `injected by a background monitor`, `advisory from` |
| Autonomy | — | `decide for yourself`, `you are not required to` |
| Action | `do X` | `you may want to consider X`, `consider whether X` |
| Uncertainty | `X happened` | `X appears to have happened`, `may be X` |
| Skip | — | `skip if [specific condition]`, `ignore if already addressed` |

---

## Sentinel Pattern

Each inject prompt should begin with a sentinel that does three things:

```
[ADVISORY: <ID> — injected by a background monitor. Decide for yourself
whether this is relevant to your current task; you are not required to follow it.
Skip if <specific idempotency condition for this event>.]
```

- **ID** — a stable string the evaluator subagent can search for (used by idempotency checks in trigger prompts)
- **Source** — `"injected by a background monitor"`
- **Autonomy grant** — `"decide for yourself"`, `"not required to follow it"`
- **Skip condition** — specific to the event (not just "already seen")

---

## Template

```
[ADVISORY: <ID> — injected by a background monitor. Decide for yourself
whether this is relevant to your current task; you are not required to follow it.
Skip if <idempotency condition>.]

A background monitor detected <observation>. If this is relevant to your
current work, you may want to consider:

1. <suggestion 1>
2. <suggestion 2>
3. <suggestion 3>
```

---

## Anti-Patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Silent injection | Model treats it as a user command | Add source label |
| Unconditional imperative | Robotic compliance even when irrelevant | Add autonomy grant + condition |
| "Skip if seen in conversation" | Blocks all future occurrences | Anchor to specific event |
| Full inject prompt as the trigger condition | Evaluator checks its own output | Put sentinel check in trigger prompt, not inject |
| Evaluator follows conversation instructions | Subagent acts on main-session directives | Explicitly tell evaluator it's an observer only |
