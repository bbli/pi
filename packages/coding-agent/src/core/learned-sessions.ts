/**
 * Utilities for managing the learning queue — sessions explicitly opted in
 * for review via `pi --learn`.
 *
 * Queue state is stored in a global index at:
 *   ~/.pi/agent/sessions/learned.json
 *
 * Format: { "queue": ["session-id-1", "session-id-2", ...] }
 *
 * Sessions are added to the queue via the `/to-learn` slash command or the
 * exit prompt (when the advisory system is enabled). `pi --learn` shows only
 * queued sessions. After the analysis prompt runs, the session is automatically
 * removed from the queue.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { getSessionsDir } from "../config.ts";

interface LearnQueueData {
	queue: string[];
}

function learnedFilePath(): string {
	return join(getSessionsDir(), "learned.json");
}

async function readQueueData(): Promise<LearnQueueData> {
	try {
		const raw = await readFile(learnedFilePath(), "utf8");
		const data = JSON.parse(raw) as LearnQueueData;
		return { queue: Array.isArray(data.queue) ? data.queue : [] };
	} catch {
		return { queue: [] };
	}
}

async function writeQueueData(data: LearnQueueData): Promise<void> {
	const path = learnedFilePath();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

/** Read the set of session IDs queued for learning. Returns an empty set if the file doesn't exist. */
export async function readLearnQueueSet(): Promise<Set<string>> {
	const data = await readQueueData();
	return new Set(data.queue);
}

/**
 * Add a session ID to the learning queue.
 * No-ops if the ID is already present. Creates the file if it doesn't exist.
 */
export async function addToLearnQueue(id: string): Promise<void> {
	const data = await readQueueData();
	if (data.queue.includes(id)) return;
	data.queue.push(id);
	await writeQueueData(data);
}

/**
 * Remove a session ID from the learning queue.
 * Returns true if the ID was present and removed, false if it was not in the queue.
 */
export async function removeFromLearnQueue(id: string): Promise<boolean> {
	const data = await readQueueData();
	const filtered = data.queue.filter((qid) => qid !== id);
	if (filtered.length === data.queue.length) return false;
	await writeQueueData({ queue: filtered });
	return true;
}

/**
 * The analysis prompt injected at the start of a `pi --learn` session.
 * Sent as the first user message so the LLM analyzes the conversation
 * history, proposes changes to the learnings graph, and waits for explicit
 * user approval before writing anything to .pi/learnings/.
 *
 * Graph structure:
 *   .pi/learnings/relationships/  — higher-level ideas and patterns derived from sessions
 *   .pi/learnings/observations/   — semantic/procedural knowledge about this codebase
 *   .pi/learnings/README.md       — entry point, most-referenced relationships
 */
export const LEARN_ANALYSIS_PROMPT = `\
### System Role
You are reviewing a past pi agent session to build a mental model of what the user knows, how they think, and what they expect — knowledge the agent can draw on in future sessions to work more closely with how this user operates. Work through the following three phases in order.

The session being reviewed is the conversation history that precedes this message — the one that was loaded when this learn session started. Focus your analysis on that conversation, not on this current exchange.

## Phase 1: User Message Impact

Read every user message in the conversation being reviewed. For each message that is a **reaction** to agent behavior — not a raw task request, not a routine clarifying question, but a response to something the agent did or failed to do — work through the following.

A reaction message is one where the user:
- Brings domain knowledge the agent had not surfaced (names a file, a component, a mechanism, or a log path the agent hadn't looked at)
- Redirects the agent's approach or trajectory mid-task
- Corrects an assumption the agent stated or acted on
- Offers an architectural observation the agent's own reading of the code hadn't produced
- Pushes back on format or communication style (asks for a diagram, asks for less prose, asks for synthesis instead of more exploration)
- Short-circuits the agent's current path ("that approach won't work here because...")

A message that says "ok, now do X" or "can you also add Y" is a task request — do not flag it as a reaction. Only flag messages where the user is responding to something the agent did wrong or incompletely, or bringing knowledge the agent lacked.

For each reaction message found:
1. Describe the agent state that prompted it — what was the agent doing or failing to do immediately before?
2. What did the user bring to the conversation that the agent lacked? Be specific: what knowledge, model, or expectation?
3. Did the agent act on it? If so, did the conversation converge after, or did the same pattern recur?

A single occurrence is noted but treated as low-confidence. The same pattern appearing across multiple turns is the primary signal.

If no reaction messages are found, note it in one sentence and proceed to Phase 2.

## Phase 2: Gaps Revealed by User Responses

Read every user message in the conversation and look for friction signals — moments where the conversation shows the agent did not behave as the user expected:

1. **Corrections** — the user had to fix or restate something after the agent acted
2. **Repeated instructions** — the user gave the same instruction more than once
3. **Redirections** — the user had to steer the agent back on track mid-task
4. **Mismatched expectations** — the agent's response clearly did not match what was asked for

For each pattern found:
- Describe what the user had to do and what agent behavior prompted it
- Note how many times it occurred
- Flag single occurrences as low-confidence; recurring patterns are the primary signal

Routine follow-up questions and conversational elaboration are not friction signals — only flag turns where the user had to correct or compensate for the agent.

## Phase 3: Propose changes to .pi/learnings/

Using the patterns and knowledge identified in Phase 1 and Phase 2, prepare a proposal for the learnings graph. **Do not write any files yet.** Present the full proposal to the user first and wait for their explicit approval before writing anything.

The graph has two complementary layers:

**\`relationships/\`** — higher-level ideas and patterns derived from the conversation. These are the abstract, transferable insights about how this user thinks, what they expect, and how they reason. A relationship captures a pattern that generalises across sessions and codebases — what the user corrects toward, what they value, how they interpret a situation. It is not a description of what happened in one session; it is the principle the session revealed.

Format:
\`\`\`
---
id: kebab-case-identifier
links-to: []
used-in: []
---
Rich prose stating the relationship. Use real codebase names where they ground the
abstraction — but the claim itself should be portable: another agent on another session
should recognise it as applying when the same pattern appears.
\`\`\`

- \`id\` — kebab-case, using vocabulary from the codebase and conversation. Choose names that would be natural to grep for when the pattern arises: \`synthesize-before-explore\`, \`failure-at-boundaries\`, \`structured-before-action\`.
- \`links-to\` — IDs of tangentially related relationships worth reading alongside this one. Composition is in the prose.
- \`used-in\` — IDs of corollaries derived from this relationship.

**\`observations/\`** — concrete, semantic knowledge about how this specific codebase works. Observations are not session records — they are the factual and procedural knowledge about this codebase that sessions have revealed: how specific mechanisms behave, where failures tend to surface, which files or components are involved in which kinds of problems, what procedures actually work. Each observation is a single line (no line breaks) so that grep returns the full statement in one match. Relationship-ids are cited inline in the prose — they are not line headers. This is what makes observations searchable: a future agent grepping for a relationship-id will find the concrete codebase knowledge associated with it.

\`\`\`
---
goal: "the session goal"
---

In this codebase, when debugging runBranchSession failures [failure-at-boundaries], the error surfaces at the caller in interactive-mode.ts rather than inside branch-session.ts — the try/catch wrapper swallows it and the trace must start from the call site.
When the agent is reading act-as-user.ts or extension-runner.ts in a loop without new findings [synthesize-before-explore], the user's redirect typically involves naming the call boundary between the main session and the branch session rather than pointing to specific files.
\`\`\`

Note the format: each line is a concrete statement about how this codebase works, with the relationship-id cited in brackets within the prose. The relationship-id is what makes the line greppable; the prose is what makes it useful.

---

**Follow these steps in order:**

**Step 1 — Discover what already exists.**

Run:
\`\`\`
ls .pi/learnings/relationships/ 2>/dev/null
ls .pi/learnings/observations/  2>/dev/null
\`\`\`

**Step 2 — Find applicable existing relationships.**

For each pattern identified in Phase 1 and Phase 2, grep the relationships directory for relevant terms — real names from the session (function names, component names, behavioral descriptions):

\`\`\`
grep -rl "<term>" .pi/learnings/relationships/ 2>/dev/null
\`\`\`

Read any matching files in full.

**Step 3 — Draft the proposal.**

Decide for each pattern from Phase 1 and Phase 2:
- Does an existing relationship capture the abstract idea? Does it need revision?
- Is this a gap requiring a new relationship?
- What concrete codebase knowledge did this session reveal that should become an observation line?
- Does any newly proposed relationship apply to knowledge already captured in existing observation files? If so, note the retroactive citation.

**Step 4 — Present the full proposal and wait for approval.**

Present the following clearly, then stop and wait for the user to respond:

1. **New relationships** — complete file content (frontmatter + prose) for each new relationship.
2. **Revised relationships** — updated prose for any existing relationship being revised, with a note on what changed and why.
3. **New observation lines** — the single-line codebase knowledge statements that would be added to this session's observation file, with relationship-ids cited inline.
4. **Retroactive citations** — any new relationship-id citations to be added inline to lines in past observation files, with the target filename and the updated line.
5. **\`used-in\` updates** — source relationship files whose \`used-in\` field would be updated.

After presenting, ask: **"Does this look right? Let me know any corrections or additions, or say 'write it' to commit these to disk."**

Do not proceed to Step 5 until the user explicitly approves.

**Step 5 — Write (only after explicit user approval).**

Once the user approves — with or without requested changes — execute all writes:

1. Create \`.pi/learnings/relationships/\` and \`.pi/learnings/observations/\` if they do not exist.
2. Write each new relationship file to \`relationships/<id>.md\`.
3. Rewrite any revised relationship files.
4. Write this session's observation file. Get today's date first:
   \`\`\`
   date +%Y-%m-%d
   \`\`\`
   Write to \`observations/<date>-<goal-slug>.md\`. One line per observation, no line breaks within a line. Relationship-ids cited inline in brackets.
5. Retroactive citations: for each newly created relationship, check whether any existing observation lines should cite it. Limit to the most recent 10 observation files — sort by filename date descending and stop after 10. For each matching line, update it to add the inline citation.
6. Update \`used-in\` in source relationship files for any new corollaries.
7. Regenerate \`README.md\`: grep \`observations/\` for each relationship ID to count line occurrences, then write \`README.md\` listing relationships ordered by count, each with its ID and a one-sentence summary drawn from its prose.

Only write what the conversation gives clear evidence for. If a pattern occurred once and is ambiguous, say so in the prose. Do not speculate beyond what the history shows.`;
