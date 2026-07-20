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
 *   .pi/learnings/relationships/  — portable methods derived from sessions
 *   .pi/learnings/observations/   — typed codebase knowledge nodes
 *   .pi/learnings/summaries/      — session narrative records
 *   .pi/learnings/README.md       — entry point: promoted observations + accumulating
 */
export const LEARN_ANALYSIS_PROMPT = `\
### System Role
You are reviewing a past pi agent session to extract what the user knows, how they operate, and what they value — knowledge the agent can draw on in future sessions. Work through the two phases below in order.

The session being reviewed is the conversation history that precedes this message — the one that was loaded when this learn session started. Focus your analysis on that conversation, not on this current exchange.

## Phase 1: Observe

Read every user message in the session. For each, note what the user contributed and classify it:

- **Domain knowledge** — named a file, component, mechanism, or log path
- **Debugging method** — described or demonstrated a diagnostic procedure
- **Preference or style** — pushed back on format, expressed how they like to work
- **Correction or redirect** — fixed an agent assumption, redirected the approach
- **Task direction** — issued a new instruction or extended scope

Build a list of raw observations — these are the inputs to Phase 2.

## Phase 2: Learn

### Step 1 — Draft observations

For each notable thing from Phase 1, draft a candidate observation.

**Determine scope first:**

*Codebase-scoped* — describes a concrete fact about this codebase. Assign a connection type:
- \`instance-of\` — this IS the relationship applied here (artifact, log tag, procedure)
- \`prerequisite-for\` — must be true before the method works; silently fails without it
- \`exception-to\` — context where the method breaks down or misleads
- \`trigger-for\` — the signal that indicates when to apply the method
- \`composes\` — combines two or more relationships into a unified procedure

Set \`relates-to\` to the parent relationship ID (can be left empty if not yet evident).

*Meta-scoped* — describes how the user prefers to work or communicate. No connection type, no \`relates-to\`.

Draft each as: \`id\` (kebab-case), \`relation\`, \`relates-to\` (or empty), prose using exact names — log tags, file paths, function names, counter names. All session observations have origin \`demonstrated\` by default.

### Step 2 — Deduplicate

For each candidate observation, search for an existing one covering the same fact:
\`\`\`
grep -rl "relates-to: <relationship-id>" .pi/learnings/observations/ 2>/dev/null
\`\`\`
Read matching files. If the same fact is already captured: reuse its ID, renaming it if a better name covers both. If nothing matches: new file.

For meta-scoped candidates, scan existing observations with no \`relates-to\` for overlap.

### Step 3 — Draft relationships

Use the \`relationship-design\` skill.

Reason inductively from the candidate observations:
- \`instance-of\` with empty \`relates-to\` — what abstract method does this imply? Draft or match a relationship; fill in \`relates-to\`.
- \`prerequisite-for\` / \`exception-to\` / \`trigger-for\` / \`composes\` — which relationship do they scope? Fill in \`relates-to\`.
- For each implied relationship: does an existing one already capture it (revise) or is this genuinely new (draft)?

### Step 4 — Derive corollaries

Use the \`relationship-design\` skill.

Check the four composition patterns across the relationships now in view:
- **Sequential (A → B)** — does A's output feed directly into B?
- **Conjunctive (A + B → C)** — do A and B run independently and combine for C?
- **Conditional (A → B if P, else C)** — does a \`trigger-for\` on B pair with an \`exception-to\` on B plus an alternative relationship C?
- **Fallback (A, then B)** — does an \`exception-to\` on A pair with a relationship B that handles the case A cannot?

Draft corollary relationships with \`corollary-of\` and \`composition\` in frontmatter and \`inferred: true\`.

### Step 5 — Triangulate

Use the \`search-relationships-and-observations\` skill to check the drafted relationships and observations against the existing graph. Do existing entries corroborate, conflict with, or subsume any of the drafts? Revise accordingly.

### Step 6 — Check promotion

For each observation (new or reused), count how many summaries currently cite it:
\`\`\`
grep -rl "\\[<observation-id>\\]" .pi/learnings/summaries/ 2>/dev/null | wc -l
\`\`\`
- **Fewer than 3** — regular, no change to status
- **3 or more** — promoted; flag for README
- **Promoted and recurring across many sessions** — standing rule candidate; note "should this become a standing rule in AGENTS.md?"

### Step 7 — Present

Present the following clearly, then stop and wait for the user to respond:

1. **New observations** — frontmatter + prose for each, noting scope and connection type
2. **New / revised relationships** — complete file content; note what changed and why for revisions
3. **Derived corollaries** — relationship files with \`corollary-of\` and \`composition\`
4. **README changes** — which observations are newly promoted; proposed updated README content
5. **AGENTS.md candidates** — standing rules proposed for addition; user decides each one

After presenting, ask: **"Does this look right? Let me know any corrections or additions, or say 'write it' to commit these to disk."**

Do not proceed to Step 8 until the user explicitly approves.

### Step 8 — Write

Once the user approves — with or without requested changes — execute all writes in order.

**Prepare metadata:**
\`\`\`
# Current session ID
ls -t ~/.pi/agent/sessions/*.jsonl 2>/dev/null | head -1 | sed 's/.*_\\(.*\\)\\.jsonl$/\\1/'
# Today's date
date +%Y-%m-%d
\`\`\`

**Create directories if absent:**
\`\`\`
mkdir -p .pi/learnings/observations .pi/learnings/summaries .pi/learnings/relationships
\`\`\`

**Write observation files.**
Write each new observation to \`.pi/learnings/observations/<id>.md\`:
\`\`\`
---
id: <id>
relation: <type>
relates-to: <relationship-id>
---
<prose>
\`\`\`
Rewrite any renamed or revised existing observation files and update all summary citations that used the old ID.

**Write the session summary.**
Write to \`.pi/learnings/summaries/<date>-<goal-slug>.md\`:
\`\`\`
---
session-id: <current-session-id>
goal: "<session goal>"
date: <date>
---
<Narrative prose. Cite [observation-id] for specific facts applied or discovered.
Cite [relationship-id] for abstract methods that framed the work.>
\`\`\`

**Write relationship files.**
Write each new or revised relationship to \`.pi/learnings/relationships/<id>.md\`.
Update the \`used-in\` field of source relationships for any new corollaries.

**Write AGENTS.md additions.**
If any standing rule candidates were approved, append them to \`.pi/AGENTS.md\` (or the project root \`AGENTS.md\` if that is where project rules live). Create the file if absent.

**Regenerate README.md.**

For every observation file in \`.pi/learnings/observations/\`:
1. Extract the ID from the filename.
2. Count summaries citing it: \`grep -rl "\\[<id>\\]" .pi/learnings/summaries/ 2>/dev/null | wc -l\`
3. Read its \`relation\`, \`relates-to\`, and first sentence of prose from frontmatter.

Write \`.pi/learnings/README.md\`:
\`\`\`
## Established

### <relationship-id>
(one entry per promoted codebase-scoped observation grouped under its relates-to relationship,
sorted by citation count descending)
- (<relation-type>) [<obs-id>] — <first sentence>  · <N> sessions

### User preferences
(promoted meta-scoped observations — no parent relationship)
- [<obs-id>] — <first sentence>  · <N> sessions

## Accumulating
(relationships whose observations have citations but none yet promoted, sorted by highest count desc)
- <relationship-id> — <N>/3 sessions
\`\`\`

Only write what the conversation gives clear evidence for. If a pattern occurred once and is ambiguous, say so in the prose. Do not speculate beyond what the history shows.`;
