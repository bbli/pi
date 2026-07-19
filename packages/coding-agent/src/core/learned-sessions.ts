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
# System Role
You are reviewing a past pi agent session to extract what the user knows, how they operate, and what they value — knowledge the agent can draw on in future sessions to work more closely with how this user operates. Work through the two phases below in order.

The session being reviewed is the conversation history that precedes this message — the one that was loaded when this learn session started. Focus your analysis on that conversation, not on this current exchange.

## Phase 1: Observe

Read every user message in the session. For each, note what the user contributed. Do not filter to reactions or corrections only — every message is signal for understanding how this user operates. Classify each contribution by type:

- **Domain knowledge** — the user named a file, component, mechanism, or log path
- **Debugging method** — the user described or demonstrated a procedure for diagnosing a problem
- **Preference or style** — the user pushed back on format, asked for a different structure, or expressed how they like to work
- **Correction or redirect** — the user fixed an agent assumption, redirected the approach, or short-circuited a path that wouldn't work
- **Task direction** — the user issued a new instruction or extended the scope

For each message, note: the contribution type, what the user brought, and whether it was acted on.

Build a list of raw observations — these are the inputs to Phase 2.

## Phase 2: Learn

Using the observations from Phase 1, propose changes to the learnings graph at \`.pi/learnings/\`.

### Step 1 — Find pertinent relationships and observations

Use the \`search-relationships-and-observations\` skill to apply the traversal sequence to the patterns identified in Phase 1. The goal is triangulation: do this session's observations extend, refine, or contradict what is already in the graph?

A single occurrence in one session is low-confidence. A pattern corroborated by existing graph entries, or repeated across multiple turns, is the primary signal.

### Step 2 — Propose and present

Use the \`relationship-design\` skill to evaluate the observations from Step 1 and prepare a proposal.

After presenting, ask: **"Does this look right? Let me know any corrections or additions, or say 'write it' to commit these to disk."**

Do not proceed to Step 3 until the user explicitly approves.

### Step 3 — Write

Once the user approves — with or without requested changes — execute all writes:

1. Create \`.pi/learnings/relationships/\` and \`.pi/learnings/observations/\` if they do not exist.
2. Write each new relationship file to \`relationships/<id>.md\`.
3. Rewrite any revised relationship files.
4. Write this session's observation file. Get today's date first:
   \`\`\`
   date +%Y-%m-%d
   \`\`\`
   Write to \`observations/<date>-<goal-slug>.md\`. One line per observation, no line breaks within a line. Relationship IDs cited inline in brackets.
5. Retroactive citations: for each newly created relationship, check whether any existing observation lines should cite it. Limit to the most recent 10 observation files — sort by filename date descending and stop after 10. For each matching line, update it to add the inline citation.
6. Update \`used-in\` in source relationship files for any new corollaries.
7. Regenerate \`README.md\`: grep \`observations/\` for each relationship ID to count line occurrences, then write \`README.md\` listing relationships ordered by count, each with its ID and a one-sentence summary drawn from its prose.

Only write what the conversation gives clear evidence for. If a pattern occurred once and is ambiguous, say so in the prose. Do not speculate beyond what the history shows.`;
