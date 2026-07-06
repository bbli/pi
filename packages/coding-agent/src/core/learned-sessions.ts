/**
 * Utilities for tracking which sessions have been reviewed ("learned from").
 *
 * Learned state is stored in a global index at:
 *   ~/.pi/agent/sessions/learned.json
 *
 * Format: { "learned": ["session-id-1", "session-id-2", ...] }
 *
 * Used by `pi --learn` to filter the session picker and by the `/learned`
 * slash command to mark the current session as reviewed.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { getSessionsDir } from "../config.ts";

interface LearnedData {
	learned: string[];
}

function learnedFilePath(): string {
	return join(getSessionsDir(), "learned.json");
}

/** Read the set of learned session IDs. Returns an empty set if the file doesn't exist. */
export async function readLearnedSet(): Promise<Set<string>> {
	try {
		const raw = await readFile(learnedFilePath(), "utf8");
		const data = JSON.parse(raw) as LearnedData;
		return new Set(Array.isArray(data.learned) ? data.learned : []);
	} catch {
		return new Set();
	}
}

/**
 * Add a session ID to the learned set.
 * No-ops if the ID is already present. Creates the file if it doesn't exist.
 */
export async function addLearnedSession(id: string): Promise<void> {
	const path = learnedFilePath();
	const set = await readLearnedSet();
	if (set.has(id)) return;
	set.add(id);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify({ learned: [...set] }, null, 2), "utf8");
}

/**
 * The analysis prompt injected at the start of a `pi --learn` session.
 * Sent as the first user message so the LLM immediately analyzes the
 * conversation history for guideline/continuation effectiveness.
 */
export const LEARN_ANALYSIS_PROMPT = `\
### System Role
You are reviewing a past pi agent session to evaluate how well its automated guidelines and continuations performed, and to identify patterns in user responses that reveal gaps worth addressing. Work through the following three phases in order.

## Phase 1: Existing Continuations and Guidelines

For each \`[SYSTEM CONTINUATION INSTRUCTIONS: X]\` or \`[SYSTEM GUIDELINE INSTRUCTIONS: X]\` marker in the conversation history, evaluate:

1. **Timing** — Did it fire at the right point, or was it premature, late, or unnecessary given what the conversation shows was actually happening?
2. **Compliance** — Did the agent follow the instructions it was given, or did it dismiss or ignore them?

For each marker:
- Name the sentinel (e.g. \`CODE_WORKFLOW\`, \`FLESH_OUT\`, \`CODE_REVIEW\`)
- State your verdict on timing and compliance
- Cite specific evidence from the conversation that led to your assessment

If no markers are found in the history, note it in one sentence and proceed to Phase 2.

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

## Phase 3: New Guideline and Continuation Candidates

Based on the patterns identified in Phase 2, propose any new guidelines or continuations that would have prevented the friction. For each candidate:

1. **Type** — \`guideline\` (single-turn behavioral nudge) or \`continuation\` (multi-turn workflow tracking), with a one-sentence rationale
2. **Trigger condition** — a specific, observable pattern in the conversation the evaluator could detect
3. **Instruction to inject** — what the agent should be told when the trigger fires
4. **Evidence** — which user messages in this conversation justify the proposal

Only propose a candidate if there is clear evidence in the conversation that it was needed. Do not speculate beyond what the history shows.`;
