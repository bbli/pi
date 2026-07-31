# Advisory System Design

## Core Distinction: Fast Brain vs. Slow Brain

The advisory system maps onto the dual-process model from cognitive psychology
(Kahneman's System 1 / System 2):

| | Fast Brain | Slow Brain |
|---|---|---|
| **Implementation** | Guidelines / Continuations | act-as-user |
| **Signal** | Local — 1–2 turns, no goal needed | Global — full arc, goal-aware |
| **Response** | Fixed inject prompt | Reasoned observation |
| **Timing** | Fires immediately on pattern match | Fires at agent_end after deliberation |
| **Analogy** | Reflex, heuristic | Reflection, judgment |

A pattern belongs in the **fast brain** if:
- It is detectable from a local signal (a phrase, a repeated call, a transition point)
- The right response is the same every time the pattern fires
- Waiting for the slow brain would miss the moment

A pattern belongs in the **slow brain** if:
- It requires comparing the current state against the goal
- It requires reasoning across the full conversation arc
- It requires building a system model from accumulated evidence
- No reliable local trigger exists

---

## Fast Brain Patterns (Guidelines / Continuations)

### Signals from agent output

**Unverified success claim**
- Trigger: agent says "this should work", "this is fixed", "this addresses the issue"
  without a subsequent verification command
- Inject: you've stated success but haven't confirmed it — run the relevant command
  before moving on

**Stated hypothesis without evidence**
- Trigger: agent asserts a root cause without citing a specific file, log line,
  or command output as the source
- Inject: that conclusion isn't grounded in direct evidence — what specifically
  led you there?

### Signals from tool call patterns

**Repeated tool call**
- Trigger: same file read or same bash command run twice within the last N turns
  with no new findings between
- Inject: you've already done this — what new information would change what you
  do next?

**Large output, no synthesis**
- Trigger: a tool returned a large result and the agent's next action doesn't
  state what was learned from it
- Inject: what did that output tell you? State your updated understanding before
  proceeding

### Signals from transition points

**Fix before reproduction**
- Trigger: agent has confirmed a bug exists and is writing a fix without first
  confirming it can reproduce the failure
- Inject: before fixing, confirm you can reproduce the exact failure and capture
  its output — otherwise you won't know if the fix worked

**Step dependency not verified**
- Trigger: agent proceeds to a next step that depends on the previous one having
  succeeded, without verifying the previous step's output
- Inject: you're moving to the next step — did the previous one actually succeed?

---

## Slow Brain Patterns (act-as-user)

### Trajectory patterns (require seeing the full arc)

**Approach exhaustion**
The agent has tried multiple categorically different implementations of the same
approach, all failing. Each looked locally reasonable. Only the slow brain can
classify them as the same approach and conclude the approach itself is wrong.
Distinct from the fast-brain "repeated tool call" — this is about approach
categories across many turns, not repeated identical actions.

**Stale mental model**
Evidence has arrived mid-session that should have updated the working hypothesis,
but the agent is still acting on the old model. Requires comparing the hypothesis
formed early against the evidence that accumulated since.

**Contradiction across distance**
The agent stated X in turn 4, then began acting on not-X in turn 14. Each turn
looked internally consistent. Only the full read reveals the contradiction.

### Goal-relative patterns (require knowing the goal)

**Success criteria mismatch**
The agent is about to declare success, but what it produced doesn't satisfy the
original goal — it satisfies a proxy the agent constructed for itself. Requires
comparing the goal against the current output.

**Scope inflation**
The solution has grown significantly more complex than the problem warrants.
Requires holding the original problem scope (from the goal) alongside the current
solution shape and judging the gap.

**Boiling the ocean**
The agent is trying to understand the entire system before acting on a specific
thing. Requires knowing what the goal actually is to judge that the current
breadth is excessive.

### Epistemic patterns (require reasoning across the full evidence base)

**Evidence sufficiency**
Not "which areas haven't been explored" but: do we have enough evidence to make
a confident conclusion, or are we about to act on thin ground? A judgment about
the total picture.

**Occam's razor**
The agent has constructed an elaborate causal chain. Is there a simpler
explanation consistent with the same evidence? Requires holding all evidence
together and reasoning about alternatives.

**Confidence drift**
The agent stated a hypothesis with medium confidence early in the session. By
now it is treating that hypothesis as established fact and building further work
on top of it, without the intervening evidence having actually confirmed it.
The confidence escalated silently across turns.

---

## What act-as-user currently implements

act-as-user runs a branch session at `agent_end` (when no continuation fired)
seeded with the full conversation history and the active goal. It works in three
steps:

1. **Understand the current situation** — map confirmed facts vs. assumptions,
   draw an architectural diagram marking explored vs. unexplored areas
2. **Assess possible expansions** — direction check (on track / off track) +
   identify unexplored system areas and the specific logs to look at there
3. **Decide whether to inject** — only call `injectMessage` if there is a
   specific, concrete expansion to suggest; suppress vague or speculative
   suggestions
