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
 * Sent as the first user message so the LLM immediately analyzes the
 * conversation history to build a mental model of the user's heuristics
 * and expectations, then writes that knowledge to .pi/learnings/.
 */
export const LEARN_ANALYSIS_PROMPT = `\
### System Role
You are reviewing a past pi agent session to build a mental model of what the user knows, how they think, and what they expect — knowledge the agent can draw on in future sessions to work more closely with how this user operates. Work through the following three phases in order.

## Phase 1: User Message Impact

Read every user message in the conversation. For each message that is a **reaction** to agent behavior — not a raw task request, not a routine clarifying question, but a response to something the agent did or failed to do — work through the following.

A reaction message is one where the user:
- Brings domain knowledge the agent had not surfaced (names a file, a component, a mechanism, or a log path the agent hadn't looked at)
- Redirects the agent's approach or trajectory mid-task
- Corrects an assumption the agent stated or acted on
- Offers an architectural observation the agent's own reading of the code hadn't produced
- Pushes back on format or communication style (asks for a diagram, asks for less prose, asks for synthesis instead of more exploration)
- Short-circuits the agent's current path ("that approach won't work here because...")

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

## Phase 3: Write to .pi/learnings/

Based on Phase 1 and Phase 2, extract what the user knows, expects, and applies — the mental model and heuristics behind their interventions. Then write that knowledge to \`.pi/learnings/\`.

**What is worth writing:**

The agent already has access to the codebase and can derive static structure from it — call paths, type definitions, module boundaries. What it cannot derive is what the user has learned from working with this system over time. Write the judgment, the shortcut, the experience: what the user reaches for first when a particular kind of problem appears; what patterns they have learned to distrust and why; what they expect in terms of format or approach and what draws a redirect; what they know about how subsystems behave that is not obvious from reading a single file; when they intervene versus when they let the agent continue.

Do not write call paths or structural facts the agent can get from a single grep or file read. Write what takes many sessions to accumulate.

**How to write it:**

Start by discovering what already exists:

\`\`\`
bash: ls .pi/learnings/ 2>/dev/null
\`\`\`

For each heuristic or expectation extracted, determine which topic file it belongs in. Name files after the concept they describe, using the same vocabulary the codebase uses. If the heuristic is about how the user reasons about \`act-as-user\` behavior, write to \`act-as-user.md\`. If it is about what the user expects when an investigation stalls, write to \`investigation-style.md\`. If it is about format preferences that apply across tasks, write to \`user-preferences.md\`. If it is about a specific subsystem — branch sessions, the advisory system, the session queue — name the file after that subsystem.

The file name is the index. A future agent reasoning about \`runBranchSession\` will try \`read .pi/learnings/branch-sessions.md\`; a future agent about to run \`/learn\` will try \`read .pi/learnings/learned-sessions.md\`. Name files so that the concept name in the conversation maps directly to the file name.

Before writing any file, read the existing version if it exists. Then write prose — not bullet points, not structured fields — that captures what the user knows and when they apply it, using actual function names, file names, and component names from the codebase as natural anchors so the text is greppable by concept. Write at the density of a well-commented design doc: complete sentences, concrete, with specific names attached to every claim.

If an existing file covers the same topic, revise and extend it rather than duplicating. Each file should accumulate into a richer model across sessions, not fragment.

Only write what the conversation gives clear evidence for. If a pattern appeared once and is ambiguous, say so in the prose. Do not speculate beyond what the history shows.`;
