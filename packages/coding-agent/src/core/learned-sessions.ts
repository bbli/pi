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
 * and expectations, writing them into a structured learnings graph at
 * .pi/learnings/.
 *
 * Graph structure:
 *   .pi/learnings/relationships/  — atomic relationship/heuristic definitions
 *   .pi/learnings/observations/   — one file per session, paragraphs per relationship
 *   .pi/learnings/README.md       — entry point, most-referenced relationships
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

Using the relationships and heuristics identified in Phase 1 and Phase 2, write to the learnings graph. The graph has two parts:

**\`relationships/\`** — one file per relationship or heuristic. This includes directly observed patterns AND corollaries: synthesized insights derived by combining existing relationships. Every file has the same format regardless of how it was produced:

\`\`\`
---
id: kebab-case-identifier
links-to: []
used-in: []
---
Rich prose defining the relationship. Composition is implicit in the sentences — if this
relationship builds on another, name it in the prose rather than in the frontmatter.
Use real function names, file names, and component names as anchors so the file is
greppable by concept. Write at the density of a design doc: complete sentences, specific,
with real names attached to every claim.
\`\`\`

- \`id\` — a kebab-case name using real vocabulary from the codebase. Choose names that a future agent would naturally grep for when the concept arises: \`synthesize-before-explore\`, \`failure-at-boundaries\`, \`structured-before-action\`.
- \`links-to\` — relationship IDs or observation paths that are **tangentially related** (context worth reading alongside this one, but not part of its reasoning). Not for composition — composition lives in the prose.
- \`used-in\` — IDs of relationships (corollaries) that were derived from this one. Updated when a new corollary is written that builds on this relationship.

**\`observations/\`** — one file per session reviewed. Each file contains multiple paragraphs, one per relationship or heuristic noticed in that session. Each paragraph begins with the relationship ID, followed by a colon, followed by a description of how that relationship manifested in this specific session. Observations are not immutable: as new relationships are discovered, new paragraphs can be added to past observation files if the new relationship applies to what happened in that session.

\`\`\`
---
goal: "the session goal"
---

relationship-id: How this relationship manifested in this session — what the agent did,
what the user did, what the outcome was. Concrete and specific to this session.

another-relationship-id: How this one showed up — a different paragraph for each
distinct relationship or observation worth recording.
\`\`\`

---

**Follow these steps in order:**

**Step 1 — Discover what already exists.**
\`\`\`
bash ls .pi/learnings/relationships/ 2>/dev/null
bash ls .pi/learnings/observations/ 2>/dev/null
\`\`\`
Create the directories if they do not exist.

**Step 2 — Find applicable existing relationships.**
For each heuristic or pattern identified in Phase 1 and Phase 2, grep the relationships directory for relevant terms — use real names from the session (function names, component names, behavioral descriptions):
\`\`\`
bash grep -rl "<term>" .pi/learnings/relationships/ 2>/dev/null
\`\`\`
Read any matching files in full. Decide whether each applies as-is, needs revision to incorporate new understanding, or whether a gap exists that requires a new relationship.

**Step 3 — Write new relationship files for gaps.**
For each pattern that has no existing relationship, write a new file to \`relationships/<id>.md\`. Start with \`links-to: []\` and \`used-in: []\` — these are populated as connections become clear. Write prose that is greppable by the concept names it discusses. If this relationship is a corollary — a synthesized insight derived from combining existing relationships — make that explicit in the prose by naming the relationships it builds on, and update the \`used-in\` field of each source relationship to include this new ID.

**Step 4 — Revise existing relationships if understanding has deepened.**
If a matching relationship exists but this session reveals a boundary condition, a narrower scope, or a more precise formulation — rewrite its prose. Relationships evolve as understanding accumulates.

**Step 5 — Write this session's observation file.**
Get today's date and derive a short slug from the session goal:
\`\`\`
bash date +%Y-%m-%d
\`\`\`
Write to \`.pi/learnings/observations/<date>-<goal-slug>.md\`. One paragraph per relationship noticed, each paragraph starting with the relationship ID and a colon. If the session had no notable relationships, write a brief observation noting what was absent — the absence is also signal.

**Step 6 — Retroactive annotation.**
Read the prose of existing observation files. If any newly created relationship clearly applies to what happened in a past session, add a new paragraph to that observation file citing the new relationship ID. This is how the graph accumulates meaning over time — new concepts applied retroactively to old evidence.

**Step 7 — Update \`used-in\` on source relationships.**
For any new corollary written in Step 3, read each source relationship file and add the new corollary's ID to its \`used-in\` list. A source relationship is one whose ID or concept appears in the corollary's prose as something it builds on.

**Step 8 — Regenerate README.md.**
Grep \`observations/\` for each relationship ID to count how many observation paragraphs reference it:
\`\`\`
bash grep -rl "<relationship-id>" .pi/learnings/observations/ 2>/dev/null | wc -l
\`\`\`
Write \`.pi/learnings/README.md\` listing relationships ordered by observation count, each with its ID and a one-sentence summary drawn from its prose. This is the entry point a future agent reads first when it does not yet know what to query.

Only write what the conversation gives clear evidence for. If a pattern occurred once and is ambiguous, say so in the prose. Do not speculate beyond what the history shows.`;
