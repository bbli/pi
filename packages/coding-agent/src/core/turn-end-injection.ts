/**
 * Reviewer side-session runner.
 *
 * Runs a separate read-only LLM call seeded with the full main session history.
 * Used by pi.runReviewer() to power per-turn checks registered via the
 * turn-checks extension. If the reviewer determines there is something
 * actionable, it signals with HAS_TURN_END_QUESTION and returns the response.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession } from "./agent-session.ts";
import { createExtensionRuntime } from "./extensions/loader.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { createAgentSession } from "./sdk.ts";
import { buildSessionContext, SessionManager } from "./session-manager.ts";

/**
 * Sentinel token the reviewer must place on its own line at the start of its
 * response when it has something actionable to flag. Responses that do not
 * contain this token are silently discarded, so a forgetful or uncertain
 * reviewer produces no injection rather than noise.
 */
const SENTINEL = "HAS_TURN_END_QUESTION";

const REVIEWER_SYSTEM_PROMPT = [
	"You are a read-only reviewer of a completed coding session.",
	"You have access to the full conversation history and read-only tools (read, grep, find, ls).",
	"Your sole purpose is to inspect the current conversation history and answer the provided questions, possibly searching the codebase if necessary.",
	"Do not make any edits, writes, or other modifications.",
	"Be direct and concise.",
	`RESPONSE FORMAT: only respond if you identify something genuinely actionable. If you do, your response MUST begin with the token ${SENTINEL} on its own line, followed by your message. If there is nothing actionable, output nothing at all.`,
].join(" ");

/**
 * Parse the reviewer's raw response text. Returns the actionable content
 * (everything after the sentinel line) or undefined if the sentinel is absent.
 */
function parseReviewerResponse(text: string): string | undefined {
	const lines = text.split("\n");
	const idx = lines.findIndex((l) => l.trim() === SENTINEL);
	if (idx === -1) return undefined;
	return (
		lines
			.slice(idx + 1)
			.join("\n")
			.trim() || undefined
	);
}

function createReviewerResourceLoader(): ResourceLoader {
	const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	return {
		getExtensions: () => extensionsResult,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [REVIEWER_SYSTEM_PROMPT],
		extendResources: () => {},
		reload: async () => {},
	};
}

/**
 * Run a separate read-only LLM call with the given questions against the main
 * session's context. Returns the actionable content from the reviewer's
 * response (the text after the HAS_TURN_END_QUESTION sentinel), or undefined
 * if the reviewer found nothing actionable or the side call failed.
 */
export async function runTurnEndInjection(questions: string[], mainSession: AgentSession): Promise<string | undefined> {
	if (questions.length === 0) return undefined;

	const model = mainSession.model;
	if (!model) return undefined;

	const { session } = await createAgentSession({
		sessionManager: SessionManager.inMemory(),
		model,
		modelRegistry: mainSession.modelRegistry,
		thinkingLevel: "off",
		tools: ["read", "grep", "find", "ls"],
		resourceLoader: createReviewerResourceLoader(),
		cwd: mainSession.cwd,
	});

	try {
		// Seed the side session with the full main conversation history.
		const context = buildSessionContext(
			mainSession.sessionManager.getEntries(),
			mainSession.sessionManager.getLeafId(),
		);
		session.agent.state.messages = context.messages;

		// Restate the format rule in the user message so the sentinel instruction
		// appears at both ends of the prompt (system prompt + user turn).
		const prompt = [
			...questions,
			"",
			`If any of the above warrant action, start your response with ${SENTINEL} on its own line. Otherwise output nothing.`,
		].join("\n");
		await session.prompt(prompt, { source: "extension" });

		// Single backward scan: validate stop reason and extract text together
		// so both checks operate on the same message.
		for (let i = session.state.messages.length - 1; i >= 0; i--) {
			const m = session.state.messages[i];
			if (m.role !== "assistant") continue;
			const assistant = m as AssistantMessage;
			if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
				return undefined;
			}
			const raw = assistant.content
				.filter((c) => c.type === "text")
				.map((c) => (c as Extract<typeof c, { type: "text" }>).text)
				.join("\n")
				.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
				.trim();
			if (raw) return parseReviewerResponse(raw);
			// Last assistant message had no text (tool-use only); keep scanning.
		}
		return undefined;
	} finally {
		try {
			await session.abort();
		} catch {
			// ignore abort errors on side-session teardown
		}
		session.dispose();
	}
}
