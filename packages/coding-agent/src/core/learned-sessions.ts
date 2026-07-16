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
 *   .pi/learnings/relationships/  — atomic relationship/heuristic definitions
 *   .pi/learnings/observations/   — one file per session, one line per relationship
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

## Phase 3: Propose changes to .pi/learnings/

Using the relationships and heuristics identified in Phase 1 and Phase 2, prepare a proposal for the learnings graph. **Do not write any files yet.** Present the full proposal to the user first and wait for their explicit approval before writing anything.

The graph has two parts:

**\`relationships/\`** — one file per relationship or heuristic, including corollaries derived by combining existing relationships. Every file has the same format regardless of how it was produced:

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

- \`id\` — kebab-case, using real vocabulary from the codebase. Choose names a future agent would naturally grep for when the concept arises: \`synthesize-before-explore\`, \`failure-at-boundaries\`, \`structured-before-action\`.
- \`links-to\` — IDs of tangentially related relationships (context worth reading alongside this one, not part of its reasoning). Composition lives in the prose, not here.
- \`used-in\` — IDs of corollaries derived from this relationship. Updated when a corollary is written that builds on it.

**\`observations/\`** — one file per session reviewed. Contains one line per relationship noticed — no line breaks within a line. Each line begins with the relationship ID followed by a colon, then describes how that relationship manifested in this specific session. Keeping each observation on a single line means grep returns the entire observation in one match. Observations are not immutable: as new relationships are discovered, new lines can be appended to past observation files when the new relationship applies.

\`\`\`
---
goal: "the session goal"
---

relationship-id: How this relationship manifested — what the agent did, what the user did, what the outcome was. Concrete and specific to this session. All on one line, no line breaks.
another-relationship-id: A separate line for each distinct relationship noticed. No line breaks within a line.
\`\`\`

---

**Follow these steps in order:**

**Step 1 — Discover what already exists.**

Run:
\`\`\`
ls .pi/learnings/relationships/ 2>/dev/null
ls .pi/learnings/observations/  2>/dev/null
\`\`\`

**Step 2 — Find applicable existing relationships.**

For each heuristic or pattern identified in Phase 1 and Phase 2, grep the relationships directory for relevant terms — real names from the session (function names, component names, behavioral descriptions):

\`\`\`
grep -rl "<term>" .pi/learnings/relationships/ 2>/dev/null
\`\`\`

Read any matching files in full.

**Step 3 — Draft the proposal.**

For each heuristic or pattern from Phase 1 and Phase 2, decide:
- Does an existing relationship cover it as-is?
- Does an existing relationship need revision to incorporate new understanding?
- Is this a gap requiring a new relationship?
- Is this a corollary — a synthesized insight combining existing relationships, grounded in evidence from this session?

Also check existing observation files: does any newly proposed relationship clearly apply to a past session's prose? If so, note the retroactive annotation.

**Step 4 — Present the full proposal and wait for approval.**

Present the following clearly, then stop and wait for the user to respond:

1. **New relationships** — the complete file content (frontmatter + prose) for each new relationship to be created.
2. **Revised relationships** — the updated prose for any existing relationship being revised, with a brief note on what changed and why.
3. **This session's observation** — the full observation file content that would be written, with one line per relationship (no line breaks within a line).
4. **Retroactive annotations** — any lines to be appended to past observation files, with the target filename and line content.
5. **\`used-in\` updates** — any source relationship files whose \`used-in\` field would be updated, and what would be added.

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
   Write to \`observations/<date>-<goal-slug>.md\`. One line per relationship, no line breaks within a line.
5. Append retroactive annotation lines to the relevant past observation files.
6. Update \`used-in\` in source relationship files for any new corollaries.
7. Regenerate \`README.md\`: grep \`observations/\` for each relationship ID to count occurrences, then write \`README.md\` listing relationships ordered by count, each with its ID and a one-sentence summary drawn from its prose.

Only write what the conversation gives clear evidence for. If a pattern occurred once and is ambiguous, say so in the prose. Do not speculate beyond what the history shows.`;
