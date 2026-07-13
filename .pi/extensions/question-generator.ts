/**
 * Question Generator Extension
 *
 * Fires at agent_end when a session goal is active and no continuation advisory
 * fired. Runs a branch session that reads the conversation and generates at most
 * 3 blocking questions a user would ask to progress the goal — prioritising:
 *   1. Assumption challenges (things stated without verification)
 *   2. Blocking unknowns (what is needed but not known how to obtain)
 *   3. Next-step clarity (unclear path forward)
 *
 * Procedural questions are routed to researchProcedure; factual questions to
 * researchConversationQuestion. The questions are injected as a followUp user
 * message so the agent addresses them in the next turn.
 *
 * Skip conditions:
 *   - No active goal
 *   - A continuation advisory already fired this cycle (event.continuationFired)
 *   - The branch session returns NONE or unparseable output
 *   - All generated questions already appear verbatim in the conversation
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildPrompt(goal: string): string {
	return `\
You are a goal-oriented investigative observer for this session.
Active goal: ${goal}

PHASE 1 — BUILD UNDERSTANDING (internal only, do not output this phase)
Read the full conversation. Establish:
  - What is the stated situation or problem?
  - What has the agent confirmed as fact vs. inferred or assumed without verification?
  - What has been tried and what was the result?
  - Where is the investigation right now, and what is the agent about to do next?
  - What conclusions were reached quickly that may not have been verified?

PHASE 2 — GENERATE QUESTIONS (output only this)
Generate at most 3 questions that a user sitting next to the agent would ask \
right now to help it make progress toward the goal. Frame each question as the \
user speaking to the agent — direct, specific, and conversational.

Prioritise in this order:
  1. ASSUMPTION CHALLENGE — the agent stated or acted on something that was not \
verified. Ask whether that assumption was actually confirmed before building on it.
     Example: "Did we actually confirm that X is the case, or did we assume it?"
  2. BLOCKING UNKNOWN — something is needed to progress but how to obtain it is \
unknown: a log location, an SSH path, a CLI flag, a service name, an internal URL.
     Example: "Where are the test logs for a failed ir_test run?"
  3. NEXT STEP CLARITY — the goal is clear but the path forward is untested or ambiguous.
     Example: "Have we ruled out Y as a cause, or did we skip straight to Z?"

For each question output exactly this block (no extra text between fields):
  TYPE: factual | procedural
  PRIORITY: critical | high | medium
  QUESTION: <precise, self-contained question the user would ask>
  WHY: <one sentence — what assumption or gap does answering this resolve>

  factual    = answer lives in source code, logs, config, or files already on disk
               → the agent should use researchConversationQuestion
  procedural = answer requires accessing a system, following a workflow, or locating
               an operational artifact not confirmed in this session
               → the agent should use researchProcedure

Separate each question block with a blank line.
If no blocking questions exist, output exactly: NONE
Do not output any preamble, explanation, or text outside the blocks above.`;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface Question {
	type: "factual" | "procedural";
	priority: "critical" | "high" | "medium";
	question: string;
	why: string;
}

function parseQuestions(raw: string): Question[] {
	const text = raw.trim();
	if (!text || text.toUpperCase() === "NONE") return [];

	const questions: Question[] = [];

	// Split on blank lines to get candidate blocks
	const blocks = text.split(/\n\s*\n/);

	for (const block of blocks) {
		const lines = block.trim().split("\n");
		const fields: Record<string, string> = {};
		for (const line of lines) {
			const match = line.match(/^(TYPE|PRIORITY|QUESTION|WHY):\s*(.+)$/i);
			if (match) {
				fields[match[1].toUpperCase()] = match[2].trim();
			}
		}

		if (!fields["TYPE"] || !fields["PRIORITY"] || !fields["QUESTION"] || !fields["WHY"]) {
			continue;
		}

		const rawType = fields["TYPE"].toLowerCase();
		const rawPriority = fields["PRIORITY"].toLowerCase();
		if (rawType !== "factual" && rawType !== "procedural") continue;
		if (rawPriority !== "critical" && rawPriority !== "high" && rawPriority !== "medium") continue;

		questions.push({
			type: rawType as "factual" | "procedural",
			priority: rawPriority as "critical" | "high" | "medium",
			question: fields["QUESTION"],
			why: fields["WHY"],
		});
	}

	return questions;
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

const TOOL_HINT: Record<"factual" | "procedural", string> = {
	factual: "→ researchConversationQuestion",
	procedural: "→ researchProcedure",
};

function formatQuestions(questions: Question[], goal: string): string {
	const header =
		`[Question Generator] ${questions.length} blocking question(s) toward goal: ${goal}\n`;

	const body = questions
		.map((q) => {
			const priorityTag = q.priority.toUpperCase();
			const typeTag = q.type.toUpperCase();
			return `${priorityTag} [${typeTag}]\nQ: ${q.question}\nWhy: ${q.why}\n${TOOL_HINT[q.type]}`;
		})
		.join("\n\n");

	return `${header}\n${body}`;
}

// ---------------------------------------------------------------------------
// Deduplication: drop questions already answered verbatim in the conversation
// ---------------------------------------------------------------------------

function serializeMessages(messages: readonly unknown[]): string {
	return JSON.stringify(messages);
}

function alreadyInConversation(question: string, serialized: string): boolean {
	return serialized.includes(question);
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function questionGenerator(pi: ExtensionAPI): void {
	pi.on("agent_end", async (event, _ctx) => {
		const goal = pi.getGoal();
		if (!goal) return;
		if (event.continuationFired) return;

		const raw = await pi.runBranchSession(buildPrompt(goal), {
			seedContext: true,
			tools: [],
			label: "question-gen",
		});

		if (!raw) return;

		const questions = parseQuestions(raw);
		if (questions.length === 0) return;

		// Drop questions whose text already appears in the conversation
		const serialized = serializeMessages(event.messages);
		const fresh = questions.filter((q) => !alreadyInConversation(q.question, serialized));
		if (fresh.length === 0) return;

		const formatted = formatQuestions(fresh, goal);
		pi.sendUserMessage(formatted, { deliverAs: "followUp" });
	});
}
