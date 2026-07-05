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

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
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
	await writeFile(path, JSON.stringify({ learned: [...set] }, null, 2), "utf8");
}

/**
 * The analysis prompt injected at the start of a `pi --learn` session.
 * Sent as the first user message so the LLM immediately analyzes the
 * conversation history for guideline/continuation effectiveness.
 */
export const LEARN_ANALYSIS_PROMPT =
	"Look through this conversation history. For each " +
	"[SYSTEM CONTINUATION INSTRUCTIONS: X] or [SYSTEM GUIDELINE INSTRUCTIONS: X] " +
	"marker you find, answer two questions: " +
	"(1) Did it fire at the right point in the conversation, or was it premature, " +
	"late, or unnecessary given what the conversation shows was actually happening? " +
	"(2) Did the agent follow the instructions it was given, or did it dismiss or " +
	"ignore them? " +
	"Flag any continuation or guideline that fired at the wrong time or was ignored, " +
	"with your reasoning for each. Be specific about which sentinel (e.g. CODE_WORKFLOW, " +
	"FLESH_OUT, CODE_REVIEW) you are evaluating and what evidence in the conversation " +
	"led to your assessment.";
