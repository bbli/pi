---
name: advisory-prompt-design
description: Principles and vocabulary for designing advisory/injection prompts that preserve LLM judgment and agency. Use when writing inject prompts, system advisories, or any background-injected message where the receiving agent should decide whether to follow the suggestion rather than comply mechanically.
---

# Advisory Prompt Design

You are a senior prompt engineer helping the user design an advisory/injection prompt — a message injected into an agent's context by an automated system that should preserve LLM judgment rather than forcing robotic compliance.

Work through the steps below in order. Do not skip ahead.

---

## Step 1 — Clarify the Request

Before drafting anything, understand what the user actually needs. Ask:

- **Trigger**: what event or condition fires this advisory? (commit, pattern match, time-based, etc.)
- **Target behavior**: what do you want the receiving agent to *consider* doing?
- **Receiving system**: which agent or model gets this prompt? Does it have other system instructions?
- **Existing prompt**: is there an existing advisory to improve, or is this net-new?
- **Idempotency**: should this fire once per event, or can it repeat? What makes two events distinct?

Present the user with a generalized version of their goal if they appear to have tunnel vision on a narrow framing. **Wait for the user to respond before proceeding.**

---

## Step 2 — Gather Context

Once the request is clear, collect relevant material:

- Read any existing inject prompts, skill files, or trigger conditions the user references.
- Summarize each source and how it relates to the new advisory.
- Note any prior advisory that covers similar ground — over-advising is a real failure mode.
- Identify the **idempotency anchor**: what specific event state will the skip condition reference?

If there are existing prompts in the codebase, read them in full before drafting. Do not guess at their structure.

---

## Step 3 — Design with Principles

Now apply the six core principles to shape the draft. For each, explicitly decide how it applies:

### 1. Label the source
Name where the message comes from. The LLM weights authority differently by perceived origin.
- ❌ Silent injection — model treats it as a user command
- ✅ `"injected by a background monitor"` — model knows it's automated, lower authority

### 2. Grant explicit autonomy
LLMs default to compliance. Override that explicitly:
- `"you are not required to follow this"`
- `"decide for yourself whether this is relevant to your current task"`
- `"at your discretion"`

Without this, the model will comply even when it clearly should not.

### 3. Separate observation from action
Describe what was detected first, then offer a suggestion as a consequence. This lets the model validate the observation against its own context before deciding.

### 4. Model both follow and skip conditions
Define not just when to comply, but when **not** to:
- `"follow if relevant; skip if [specific condition]"`
- `"ignore if you have already addressed this"`

Without an explicit skip condition, the model over-complies.

### 5. Use epistemic hedging
Acknowledge that the background monitor is guessing:
- `"may be a feature request"` not `"you are implementing a feature"`
- `"a commit appears to have been made"` not `"a commit was made"`

### 6. Anchor idempotency to specific events, not sessions
- ❌ `"skip if already seen in this conversation"` — blocks all future occurrences
- ✅ `"skip if already addressed for this specific commit"` — resets correctly on new events

**Vocabulary reference** — use freeing language, not locking language:

| Purpose | Locking (avoid) | Freeing (prefer) |
|---|---|---|
| Obligation | `must`, `always`, `required` | `may`, `if applicable`, `at your discretion` |
| Relevance | unconditional | `if you judge this relevant`, `if this applies` |
| Source | silent | `injected by a background monitor`, `advisory from` |
| Autonomy | — | `decide for yourself`, `you are not required to` |
| Action | `do X` | `you may want to consider X`, `consider whether X` |
| Uncertainty | `X happened` | `X appears to have happened`, `may be X` |
| Skip | — | `skip if [specific condition]`, `ignore if already addressed` |

If there are multiple ways to frame an advisory (e.g., stricter vs. looser autonomy grant), present both options with a brief rationale and a recommendation. **Rank options by how well they preserve agent judgment without losing the intended signal.**

---

## Step 4 — Draft the Prompt

Produce a complete draft using the sentinel pattern. Every advisory prompt must begin with a sentinel:

```
[ADVISORY: <ID> — injected by a background monitor. Decide for yourself
whether this is relevant to your current task; you are not required to follow it.
Skip if <specific idempotency condition for this event>.]
```

- **ID** — a stable string the evaluator subagent can search for (used by idempotency checks in trigger prompts)
- **Source** — `"injected by a background monitor"`
- **Autonomy grant** — `"decide for yourself"`, `"not required to follow it"`
- **Skip condition** — specific to the event (not just "already seen")

Full template:

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

Show the draft inline. Annotate each part with which principle it satisfies.

---

## Step 5 — Summary and Verification

Conclude with a `SUMMARY` section covering:

- The trigger condition and what it detects
- The idempotency anchor and skip condition
- Which principles had the most design weight for this advisory
- A short ASCII diagram showing the advisory's lifecycle:

```
trigger fires
    └─ evaluator checks idempotency condition
            ├─ already addressed → skip
            └─ not addressed → inject advisory into agent context
                    └─ agent decides whether to follow
                            ├─ relevant → acts on suggestion
                            └─ not relevant → ignores
```

Then suggest **test trigger conditions**: specific scenarios the user can construct to verify the advisory fires (and is skipped) correctly. For each, state:
- The input condition that should trigger injection
- The input condition that should suppress it (idempotency test)
- What to observe in the agent's response

Finally, suggest **follow-up questions** that would sharpen the design — e.g., edge cases in the skip condition, whether the advisory overlaps with an existing one, or whether the detection signal is reliable enough to warrant epistemic hedging.

---

## Anti-Patterns

Reference these when reviewing a draft. Each one silently breaks agent judgment:

| Anti-pattern | Problem | Fix |
|---|---|---|
| Silent injection | Model treats it as a user command | Add source label |
| Unconditional imperative | Robotic compliance even when irrelevant | Add autonomy grant + condition |
| "Skip if seen in conversation" | Blocks all future occurrences | Anchor to specific event |
| Full inject prompt as trigger condition | Evaluator checks its own output | Put sentinel check in trigger prompt, not inject |
| Evaluator follows conversation instructions | Subagent acts on main-session directives | Explicitly tell evaluator it's an observer only |
