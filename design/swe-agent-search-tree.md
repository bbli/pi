# SWE Agent: Hypothesis Search Tree

Design notes for a model-driven coding agent that reasons rather than searches blindly.

---

## Motivation

Reinforcement learning and pure search are not the same as learning. RL
reverse-engineers a policy from reward signals. A pure search tree is
structured trial-and-error — Bayesian search, not understanding. A human
software engineer does something different:

- Forms causal hypotheses before acting
- Designs actions to *discriminate* between hypotheses (maximise information gain)
- Updates a structural model of the system when observations surprise them
- Backtracks with understanding, not just by retrying

This document covers the **hypothesis search tree** and its integration into
the agent loop. The companion concept — the **codebase model** (structural
understanding of the system) — is documented separately.

---

## Why not a task list?

| | Task list | Hypothesis search tree |
|---|---|---|
| Unit | Step to execute | Belief to update |
| Progress | Done / not done | Posterior probability |
| Failure | Step failed → retry or skip | Assumption refuted → upstream revision |
| Action selection | Next item in sequence | Action that maximises information gain |
| Causal structure | None | Each action exists *because of* a hypothesis |
| Backtracking | Retry or skip | Backtrack to highest-posterior unexplored node |

The operative difference is the *reason* an action is taken. A task list says
"read `parser.ts`". The search tree says "read `parser.ts` because I
hypothesise the bug is in the parsing stage, and this action will confirm or
refute that". When it is refuted, everything downstream of that hypothesis is
invalidated — not just the next step.

---

## Hypothesis node

Each node in the tree is a *discriminable belief*, not a task:

```typescript
interface HypothesisNode {
  id: string;
  claim: string;            // "bug is in layout calculation"
  basis: string;            // "error only occurs after resize"
  prior: number;            // estimated probability before testing
  posterior: number;        // updated from action outcomes
  status: "unexplored" | "active" | "supported" | "refuted" | "abandoned";
  parentId: string | null;
  childIds: string[];
  actions: {
    tool: string;
    args: string;
    expectedOutcome: string;  // "if true, I expect to see X"
    actualOutcome: string;
    discriminated: "confirmed" | "refuted" | "inconclusive";
  }[];
}
```

The key field is `expectedOutcome`. Before taking an action, the agent states
what it expects to see if the hypothesis holds. That expected outcome is
compared to the actual result to produce a discriminating update — this is
what separates the tree from a task list.

---

## Search strategies

The agent has a real choice of search strategy:

- **Depth-first**: drill into the most probable hypothesis until refuted, then
  backtrack.
- **Best-first**: always expand the node with the highest posterior — A* over
  belief space.
- **Information-gain-first**: pick the action that most discriminates between
  competing hypotheses, regardless of which branch it is on.

Information-gain-first is preferred for coding: a cheap action (read one file)
that eliminates two hypotheses simultaneously is better than an expensive
action (write a test) that only confirms one.

---

## Architecture

### Structure and relationships

```
logs · error traces · test output
  │
  │ symptom extraction
  ▼
┌───────────────────────┐  fault space   ┌───────────────────────┐
│    CodebaseModel      │ ─────────────► │  HypothesisSearchTree │
│                       │                │                       │
│  dependency graph     │                │  node: claim          │
│  data flow paths      │                │        basis          │
│  component invariants │ ◄───────────── │        prior          │
│  call graph           │  model         │        posterior      │
│  confidence map       │  revision      │        prediction     │
└───────────────────────┘  (on surprise) └───────────────────────┘
          │                                         │
          └──────────────────┬──────────────────────┘
                             │ both injected into context
                             ▼
                    ┌─────────────────┐
                    │   Agent Loop    │
                    └─────────────────┘
```

The model flows **into** the tree (constrains which hypotheses are valid). The
tree flows **back into** the model only when an observation contradicts a
structural prediction — that is a model revision, not a posterior update.

Normal tool results flow only into the tree (posterior update). A result
propagates to the model only when it is a *structural surprise* — when it
contradicts something the model predicted about the system's architecture, not
just about which component is buggy.

### Per-turn flow

```
turn start
  │
  ├─ transformContext
  │     model  ──► inject fault space, confidence gaps
  │     tree   ──► inject active node + expected outcome
  │                ("if H1.1 is correct, reading X should show Y")
  │
  ├─ [LLM call — reasons within injected context]
  │
  ├─ beforeToolCall
  │     model: is this action within the fault space?
  │       outside ──► block, ask agent to justify
  │       inside  ──► allow
  │
  ├─ [tool executes]
  │
  ├─ afterToolCall
  │     compare result vs. active node's expected outcome
  │       matches     ──► tree: raise posterior
  │       refutes     ──► tree: lower posterior, mark dead end
  │       surprises   ──► model: log contradiction
  │                        tree: mark node inconclusive
  │
  └─ prepareNextTurn
        model has contradictions?
          yes ──► model-revision step (LLM call or static re-analysis)
                   revise dependency graph / data flow paths
                   re-derive fault space
                   push fault space delta to tree (add/remove branches)
        tree: active node posterior near 0?
          yes ──► backtrack, activate next highest-posterior node
        tree: active node posterior near 1?
          yes ──► transition: fix phase, then verify phase
```

---

## Integration with the agent loop

The agent loop exposes five hooks. The tree (and model) use four of them:

### `transformContext`

Called before every LLM call. Serialises the current tree state and injects
it as a structured block alongside the fault space from the model:

```typescript
transformContext: async (messages) => {
  const treeBlock = renderSearchTree(tree);       // compact serialisation
  const modelBlock = renderFaultSpace(model);     // model-derived constraints
  const injection = {
    role: "user",
    content: [{ type: "text", text:
      `<hypothesis_tree>\n${treeBlock}\n</hypothesis_tree>\n` +
      `<fault_space>\n${modelBlock}\n</fault_space>`
    }],
    timestamp: Date.now(),
  };
  return [injection, ...messages];
},
```

The LLM sees its own working theory in every turn rather than having to
re-derive it from raw tool output.

### `beforeToolCall`

Called after argument validation, before execution. Checks two things:

1. Is this action inside the model-derived fault space? If outside, block and
   ask the agent to justify before proceeding.
2. Does this action contradict a recorded dead end? If so, block with an
   explanation.

```typescript
beforeToolCall: async ({ toolCall, args }) => {
  if (!isInsideFaultSpace(model, toolCall, args)) {
    return {
      block: true,
      reason: `${toolCall.name}(${args}) is outside the model fault space. ` +
              `State your reasoning before proceeding.`,
    };
  }
  const deadEnd = tree.deadEnds.find(d => actionContradictsDeadEnd(toolCall, args, d));
  if (deadEnd) {
    return { block: true, reason: `Already tried: ${deadEnd}` };
  }
  return undefined;
},
```

### `afterToolCall`

Called after execution, before `tool_execution_end` is emitted. Compares the
result against the active node's `expectedOutcome`:

```typescript
afterToolCall: async ({ toolCall, args, result, isError }) => {
  const active = tree.activeNode();
  if (active) {
    const discrimination = discriminate(active.expectedOutcome, result);
    if (discrimination === "confirmed") {
      tree.raisePosterior(active.id);
    } else if (discrimination === "refuted") {
      tree.lowerPosterior(active.id);
      tree.markDeadEnd(active.id);
    } else {
      // Surprise: doesn't match model prediction at all
      model.logContradiction({
        prediction: active.expectedOutcome,
        observation: summarise(result),
        modelComponent: active.modelComponent,
      });
      tree.markInconclusive(active.id);
    }
  }
  return undefined;  // do not modify the tool result
},
```

### `prepareNextTurn`

Called after `turn_end`. Drives three decisions:

1. **Model revision**: if contradictions exist, fire a model-revision step
   (LLM call or static re-analysis), update the dependency graph, re-derive
   the fault space, push the delta to the tree.
2. **Backtrack**: if the active node's posterior is near zero, activate the
   next highest-posterior unexplored node.
3. **Phase transition**: if posterior is near one, transition from hypothesis
   resolution to fix-and-verify phase.

```typescript
prepareNextTurn: async () => {
  if (model.hasContradictions()) {
    await reviseModel(model, tree);   // updates fault space + tree branches
  }
  const active = tree.activeNode();
  if (active && active.posterior < REFUTED_THRESHOLD) {
    tree.backtrack();
  }
  if (active && active.posterior > CONFIRMED_THRESHOLD) {
    tree.transitionToFixPhase();
  }
  return undefined;
},
```

---

## Key properties

- **Compaction-safe**: the tree is a compact, structured summary. When the
  raw transcript is pruned by compaction, the tree preserves the search state
  that would otherwise be lost in raw tool output.
- **Traceable**: the agent can always answer "why are you doing this?" by
  pointing to the active hypothesis node and its basis.
- **Wrong-path detection is structural**: blocking is based on the model's
  fault space, not just on loop detection heuristics.
- **Separation of concerns**: the tree tracks epistemic state (what do I
  believe and how confident am I?). The model tracks structural state (how
  does this system work?). Neither does the other's job.
