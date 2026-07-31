# Subagent vs Continuation System

When a workflow concern needs enforcing or a task needs delegating, the choice between the continuation system (triggerPrompt + injectPrompt) and a subagent turns on whether the trigger condition is self-detectable and whether the output should be data or guidance.

## Continuation system

Use when the main session cannot reliably self-detect the condition — circular research, goal drift, cross-cutting concerns that apply regardless of the current task. The evaluator runs externally and fires automatically; the main session does not have to opt in. This is the right tool when external monitoring is the only reliable way to catch the condition. The advisory delivers guidance (observation + suggestion), not data.

**Pros:**
- Automatic enforcement — fires when the trigger condition is met regardless of what the main session is doing
- External monitoring — the evaluator runs outside the main session's context, providing a genuinely independent perspective
- Cross-cutting applicability — works across many task types without the main session explicitly opting in
- Can interrupt and redirect mid-flow

**Cons:**
- Trigger conditions are hard to write correctly — must be binary, observable, and non-speculative from conversation history alone
- Delivers instructions, not findings — guidance the main session must interpret, not concrete data
- Context accumulation — injected advisories add to the main session's context over time
- Framing complexity — sentinel, idempotency, observation+suggestion framing is easy to get subtly wrong

## Subagents

Use when the main session already has enough context to know delegation is appropriate and can form a precise, self-contained question. The subagent delivers data — findings the main session integrates and acts on with judgment. The main session is the integrator; the subagent is the specialist.

**Pros:**
- Findings, not instructions — the main session gets concrete data and applies its own judgment
- Parallel execution — multiple subagents can run in the same turn
- Isolated context — intermediate work stays out of the main session's context window
- Main session controls invocation — the question is formed from live state, not a static trigger
- Right fit for research tasks — "find X in system Y and return what you found"

**Cons:**
- No enforcement — the main session has to remember to call it
- Question quality matters — a poorly formed question produces poor findings
- Findings can be ignored — the main session can proceed without acting on them
- Latency — each subagent call is an additional LLM round-trip

## The key distinction

These are not alternatives for the same problem. The continuation system is for things the main session cannot reliably self-detect. Subagents are for tasks the main session knows it needs to delegate at a specific point, where the question is already well-formed and the output is data rather than guidance.

**Misapplying the continuation system:** trigger conditions become hard to write, advisories accumulate in the main session context, and the framing overhead yields no benefit over a direct subagent call.

**Misapplying a subagent:** no guarantee the main session will call it for a condition it might self-detect as absent.
