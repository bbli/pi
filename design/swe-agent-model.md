# SWE Agent: Decision Model

Design notes for the model layer — structural understanding of the codebase
and a decision-making system for advisory agents. This is the companion to
`swe-agent-search-tree.md`, which covers the hypothesis search tree.

---

## What the model is not

The model is not a task list, a knowledge base, or a collection of raw facts.
It is a representation of two distinct things:

1. **Structural understanding**: how this codebase is organised, what depends
   on what, what each component is supposed to do.
2. **Decision model**: how to reason under ambiguity in this specific context
   — which decision heuristics apply, where they break down, and how to
   calibrate them against past experience.

The search tree handles epistemic state (what do I currently believe?). The
model handles structural and decision-making state (how does this system work,
and how should I reason about it?).

---

## What the LLM already has

The LLM already knows what software engineering is, what TypeScript is, what
common bugs look like, and how to reason. It does not need to be taught to
think. What it needs is **private knowledge** — things that do not exist
anywhere it was trained on.

Categories of private knowledge:

| Category | Examples |
|---|---|
| Structural relations | module dependencies, data flow, ownership in this codebase |
| Architectural decisions | why X was built this way, what was rejected and why |
| Failed experiments | tried library X, caused issue Y, rolled back |
| Tribal conventions | implicit rules not written anywhere |
| Developer preferences | how this person likes things named, structured, reviewed |
| Past conversations | what was decided in prior sessions, what was already tried |
| Production observations | actual data shapes, edge cases only visible in prod |

The model covers all of these except real-time state (ephemeral, tool-fetched)
and production observations (requires explicit human input or cross-session
accumulation).

---

## The two layers

### Relations layer

Structural facts about how things in this codebase connect. Not raw facts
about what exists, but **causal and dependency relations** that constrain
reasoning:

```
packages/agent/src/agent-loop.ts → packages/agent/src/types.ts
  (imports AgentLoopConfig, AgentContext — central dependency)

beforeToolCall hook → fault space check
  (all tool blocking routes through beforeToolCall, not inline in tools)

compaction → .pi/memory/model.md
  (model updated at compaction time, not at session end)
```

Relations are expressed as `X → Y [reason]`. The reason is what makes a
relation useful — it encodes the mechanism, not just the connection.

History is implicit in the relation. Instead of "on date X we tried Y and it
failed", the relation captures the lesson: "approach Y for problem class Z
tends to fail because W". The date and raw events are noise; the causal
structure is the signal.

### Decision model layer

Cognitive heuristics for reasoning under ambiguity, specific to this codebase
and workflow. Not general software engineering advice — the LLM already has
that. Private decision patterns derived from observed outcomes:

```
SITUATION: asked to modify code in a module not yet fully read
BETTER ACTION: read full file before editing
REASON: partial reads miss cross-file dependencies not visible from
        function signatures; editing from partial context breaks callers
        in ways not visible until tests run
```

This layer is only available to advisory agents, not injected into the main
agent's context. The main agent focuses on the task. The advisory agent
monitors decision points and injects guidance when a known pattern is
recognised.

---

## Why general principles, not just examples

Reasoning from examples is inductive — it generalises by surface similarity
to past cases. For genuinely novel situations, examples fail precisely when
you need them most. A principle applied to a situation never seen before
requires understanding the mechanism, not matching to a case.

The right architecture is both:

```
causal principles (rule + its why)
  primary substrate — handles novel situations deductively
  the LLM understands why the rule holds and can apply it to new cases

notable exception examples
  calibration — resolves boundary ambiguity for edge cases
  shows where the principle was subtly wrong in specific configurations
  not a replacement for the principle
```

A bare instruction ("read the full file first") is brittle because the agent
does not know why it holds. A causally-grounded principle ("read the full file
first, because partial reads miss cross-file dependencies not visible from
function signatures") is robust — the agent can apply it to novel situations
because it understands the mechanism.

---

## Guideline file format

Each guideline is a self-contained file. The advisory subagent receives it as
its system prompt.

```markdown
# Guideline: read before editing

## Principle
Read the full file before making edits. Partial reads miss cross-file
dependencies not visible from function signatures. Editing from partial
context breaks callers in ways not visible until tests run.

## Applies when
- About to call edit or write on a file
- File has not been fully read in this session
- Change affects more than a single isolated function

## Does not apply when
- File was fully read earlier in this session
- Change is a trivial single-line fix (typo, log line, comment)
- File was just created by the agent in this session

## Where the principle was subtly wrong
- Agent read the file fully but missed a side-effect in an imported
  utility. Principle should extend to: also read immediate imports
  when the change touches exported interfaces.
- Agent read the file but a prior tool call in the same turn had
  already modified it. Read was stale. Principle should require:
  re-read if any prior tool call in this turn modified the file.

## Trigger (pre-filter, evaluated without LLM)
tool: edit | write
condition: file path not in session_read_list
```

The "where the principle was subtly wrong" section contains human-reviewed
exception cases — the moments where the principle held in general but failed
in a specific configuration. These calibrate the subagent's judgment at
boundaries without replacing the principle.

---

## Other decision-making models worth encoding

Beyond individual guidelines, the following cognitive patterns are worth
encoding as standing principles in the advisory system:

**Dual process (System 1 / System 2)**
Fast pattern-matching for routine situations; slow deliberate reasoning when
irreversibility or high uncertainty is present. The advisory agent is the
System 2 layer. It fires when the main agent is about to take an irreversible
action or proceed on an unverified assumption.

**Progressive commitment**
Make reversible decisions first; defer irreversible ones. Action reversibility
should be a first-class property in the advisory system:

```
read, grep, find  → fully reversible
edit, write       → reversible (can undo within session)
bash              → depends (rm is irreversible, grep is not)
external API call → irreversible
```

Advisory fires before irreversible actions to force a commitment check.

**Pre-mortem**
Before committing to an approach, briefly consider: if this fails, why would
it have failed? This surfaces blind spots before acting rather than
discovering them through failure. Runs at `prepareNextTurn` when the main
agent has settled on an approach but has not started executing.

**Assumption surfacing**
Track which beliefs are assumptions vs. verified facts. An unverified
high-risk assumption about to drive an irreversible action is the highest-
priority advisory trigger. The advisory agent injects: "you are assuming X,
which is unverified. Verify before proceeding."

**Satisficing**
Stop searching when an approach is good enough. Do not optimise when
sufficiency is available. Each task type can have explicit stopping criteria
encoded in the decision model.

**Scope-risk calibration**
Match effort to risk. Do not restructure a module to fix a typo. Do not fix
a typo in a file being restructured and leave without noting it. The advisory
agent detects scope drift — the main agent wandering outside the stated task
boundary — and steers it back.

**Active gap detection**
The most valuable advisory capability is proactive, not reactive. Rather than
matching against known failure patterns, the advisory agent asks: "given what
the main agent has stated as assumptions, what has it *not* checked that could
invalidate the current approach?" This fires regardless of whether the current
situation matches a known case.

---

## The advisory subagent architecture

### Overview

```
prepareNextTurn fires
  │
  ├─ stage 1: evaluate trigger conditions (no LLM)
  │     pattern match against tool calls + session state
  │     produces: candidate guideline set (typically 1–3)
  │
  ├─ stage 2: spawn branch subagent per candidate (parallel)
  │     seeded with: main session history
  │     system prompt: guideline file (principle + examples + trigger)
  │     returns: APPLIES / CONFIDENCE / REASON / ACTION
  │
  ├─ collect verdicts
  │
  ├─ filter: keep high-confidence APPLIES=yes only
  │
  ├─ resolve conflicts (multiple guidelines firing simultaneously)
  │     prefer higher-risk guideline when guidelines conflict
  │
  └─ inject surviving ACTION texts as steering messages
        main agent sees guidance before next LLM call
```

### Verdict format

Each advisory subagent returns a structured verdict:

```
APPLIES: yes | no | uncertain
CONFIDENCE: high | medium | low
REASON: one sentence explaining the judgment
ACTION: [steering message to inject, if APPLIES=yes]
```

Only `APPLIES: yes, CONFIDENCE: high` results steer the main agent.
Medium confidence is logged but does not interrupt. Low confidence is
discarded.

### Graduated response

```
high confidence + irreversible action  → block, require acknowledgment
medium confidence                      → inject as suggestion
low confidence                         → log only, do not interrupt
novel situation (no matching examples) → flag to human for new guideline
```

### Conflict resolution

When multiple guidelines fire simultaneously:
- Pick the higher-risk guideline if they conflict
- If they are compatible, merge ACTION texts into a single steering message
- If they directly contradict, surface both to the human rather than guessing

### Guideline grouping

Individual guidelines are grouped by concern to reduce the number of subagents:

```
safety group      → irreversibility, assumption verification, scope limits
code quality      → read-before-edit, type discipline, test coverage
process           → commit hygiene, PR hygiene, changelog
decision process  → pre-mortem, satisficing, scope-risk calibration
```

A group fires one subagent that reasons over all guidelines in the group
in a single pass, rather than one subagent per guideline.

---

## How the model is built and maintained

### Extraction source

Conversations (JSONL session files) are the primary source. The compaction
system already summarises sessions when context fills up. The extraction
pass piggybacks on compaction — at the same moment the to-be-discarded
messages are summarised, a second focused pass extracts decision-model
content.

Extraction prompt (not factual extraction, decision-pattern extraction):

> Given this conversation, identify decision points where the agent chose
> an approach under uncertainty. For each: (1) describe the situation type,
> (2) what the agent did, (3) whether it worked, (4) what a better decision
> would have been. Express each as a situation-action-outcome pattern with
> its underlying causal reason.

### Human-in-the-loop training

Automatic extraction produces raw candidates. A human reviews them and:
- Promotes a candidate to a guideline (writes the principle + applicability)
- Rejects a candidate (noise, not a generalizable pattern)
- Adds an exception case to an existing guideline when the principle was
  subtly wrong

This is the training signal. The system accumulates candidates automatically;
the human provides the causal grounding that makes them principles rather than
cases.

### Storage

```
.pi/guidelines/
  read-before-edit.md
  irreversibility-check.md
  assumption-surfacing.md
  ...

.pi/memory/
  relations.md       ← structural relations layer (auto-updated at compaction)
```

Guidelines are human-authored and human-reviewed. Relations are
automatically extracted and do not require human review for individual
entries, but can be manually corrected.

### Injection point

Relations are loaded as a context file at session start via `buildSystemPrompt`
`contextFiles`, alongside `AGENTS.md`. The LLM sees the relations as
background context, not as rules.

Guidelines are never injected into the main agent's context. They are the
system prompts of advisory subagents only.

---

## Keeping the model from growing unbounded

Three rules applied during the merge step at compaction:

1. **Deduplication**: if an identical or near-identical relation already
   exists, do not add it again.
2. **Aging**: relations not referenced in recent sessions move to an archive.
   Guidelines with no trigger matches over N sessions are flagged for review.
3. **Contradiction resolution**: if a new relation contradicts an existing one,
   keep the newer one and note the conflict for human review.

The merge step is itself an LLM call with the current relations file and newly
extracted facts as input, producing the updated file.

---

## Open questions

1. **Per-cwd vs global**: the model should be per-cwd. Relations and guidelines
   for this repo should not bleed into a different project.

2. **Bootstrap**: the first few sessions have no model. The system degrades
   gracefully — empty model means no prior context, same as today.

3. **Guideline staleness**: guidelines written for an old version of the
   codebase may no longer apply. Trigger conditions that never fire are a
   signal that the guideline may be stale.

4. **Advisory subagent cost**: even with pre-filtering, firing branch sessions
   on every turn adds latency and cost. The trigger pre-filter is the primary
   cost control. A secondary control is a per-session advisory budget — after
   N advisory interventions in one session, raise the confidence threshold to
   reduce noise.

5. **What the LLM does with injected guidance**: the advisory system injects
   steering messages, but the main agent can ignore them. Tracking whether
   injected guidance was followed and whether outcomes improved is the long-
   term calibration signal, and it requires human judgment to score.
