---
name: diagrams
description: Creating diagrams — ASCII flow diagrams, callpath trees, file trees, lifecycle diagrams, and tables. Use when producing or editing any visual structure in documentation or comments.
---

# Diagrams

This project uses ASCII diagrams exclusively. No Mermaid, PlantUML, or other rendered formats — plain text only, so diagrams render correctly in terminals, markdown previews, and raw file views.

Choose the format that matches the structure you are describing. When in doubt, prefer a simpler format over a more visually elaborate one.

---

## Formats and When to Use Each

### Callpath / execution tree
For tracing a call sequence end-to-end through functions, module boundaries, async handoffs, and shared state. Annotate semantics inline rather than in a separate legend.

```
├─ entryPoint()
│      └─ primaryCall()                         ← sync point (await)
│              ├─ sideEffect()  ──fire-and-forget──
│              └─ sharedWriter()                ← shared writer
```

Useful annotation labels: `← sync point (await)`, `← shared writer`, `──fire-and-forget──`.

### Flow diagram
For event lifecycles, pipelines, or sequences where order and branching matter more than code structure.

```
user sends prompt
  │
  ├─► input hook (can intercept or transform)
  │       ┌─── turn loop ───────────────────┐
  │       │                                 │
  │       ├─► turn_start                    │
  │       ├─► tool_call (can block)         │
  │       └─► turn_end ────────────────────►│
  └─► agent_end
```

### Lifecycle / decision tree
For trigger → evaluation → action flows, especially where idempotency or branching decisions are involved.

```
trigger fires
    └─ evaluator checks condition
            ├─ already done → skip
            └─ not done → proceed
                    └─ agent applies with judgment
                            ├─ applicable → acts
                            └─ not applicable → continues
```

### File tree
For directory structures and package layouts.

```
.pi/
├── skills/
│   ├── diagrams.md
│   └── prompt-and-skill-design.md
└── prompts/
    └── cl.md
```

### Markdown table
For comparisons, reference lookups, and structured multi-column data. Prefer tables over prose lists when there are three or more parallel properties.

| Column A | Column B | Column C |
|---|---|---|
| value    | value    | value    |

---

## ASCII Character Reference

| Purpose              | Characters                        |
|---|---|
| Tree branches        | `├─`, `└─`, `│`                   |
| Flow arrows          | `─►`, `◄─`, `──►`                |
| Box corners          | `┌─`, `─┐`, `└─`, `─┘`           |
| Inline annotation    | `← label`, `──label──`            |
| Loop/group boundary  | `┌─── label ───┐` / `└──────────►│` |

---

## Style guidance

- Keep diagrams narrow enough to read without horizontal scrolling (aim for ~80 columns).
- Label branch conditions at the fork point, not at the destination.
- Prefer concise identifiers in diagrams; expand in surrounding prose if needed.
- Omit nodes that add no information — a diagram that omits a passthrough is clearer than one that includes it for completeness.
- If a diagram is getting complex, split it into two focused ones rather than adding more branches.
