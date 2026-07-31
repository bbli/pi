# Task Delegation Criteria

A task is well-suited for delegation to a subagent when you can write a complete, self-contained brief for it: here is the input, here is the question, here is what the output should look like, here is when to stop. The main session's role becomes integrator — applying judgment to the result — rather than doing the work itself.

## Properties that favor delegation

**Context isolation is the point.** The subagent should not see how the main session is currently thinking. Verification and review tasks fall here: a subagent checking whether an implementation matches a spec is more trustworthy if it did not write the implementation. Act-as-user is the clearest example — the observer's value is the external perspective, not a reflection of the main session's own reasoning.

**Intermediate steps do not matter to the main session.** If the work involves reading many files or traversing a graph and the main session only needs the summary, keep that churn out of the main session's context window. Triangulation in the learn workflow is this: ten grep commands and five file reads, distilled into "this entry already exists / conflicts / is new."

**Parallelizable units of the same task.** When the same bounded operation needs to run on independent inputs, subagents can run simultaneously in one turn. One call per proposed entry, all in the same turn.

**Validation against a fixed checklist.** Here is an artifact, here is the criteria set, return what passes and what fails. No main session judgment needed mid-traversal. Prompt design review is this shape — the skill defines the criteria, the subagent applies them.

**Impact and cross-reference analysis.** "What in the codebase depends on this thing being changed?" Bounded search, structured output — the main session decides what to do with the list.

**Spec extraction from earlier in the conversation.** When the main session has drifted deep into implementation, a focused subagent reading only the original user messages is more reliable than the main session reconstructing intent from memory.

## What does not delegate well

- Anything requiring live main session state at each step
- Anything interactive with the user
- Anything where the judgment is the whole task — if the output is a decision rather than data, delegation adds a hop without adding value
- Tasks simple enough that delegation overhead exceeds the benefit (two grep commands do not need a subagent)

## The underlying principle

A subagent is a specialist that produces data; the main session is the generalist that acts on it. Delegation pays off when the specialist's focused context makes their output more reliable than what the main session would produce while simultaneously tracking five other things.
