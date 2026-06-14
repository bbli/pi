/**
 * Turn-end injection framework.
 *
 * Runs a separate read-only LLM call after the main agent loop completes.
 * Extensions register questions via pi.registerTurnEndQuestion(); the last
 * assistant response from the side call is returned as plain text to be
 * surfaced to the user (and later injected into the main context).
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession } from "./agent-session.ts";
import { createExtensionRuntime } from "./extensions/loader.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { createAgentSession } from "./sdk.ts";
import { buildSessionContext, SessionManager } from "./session-manager.ts";

const REVIEWER_SYSTEM_PROMPT = [
	"You are a read-only reviewer of a completed coding session.",
	"You have access to the full conversation history and read-only tools (read, grep, find, ls).",
	"Your sole purpose is to inspect the codebase and answer the provided questions.",
	"Do not make any edits, writes, or other modifications.",
	"Be direct and concise.",
].join(" ");

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

function getLastAssistantText(session: AgentSession): string | undefined {
	for (let i = session.state.messages.length - 1; i >= 0; i--) {
		const msg = session.state.messages[i];
		if (msg.role !== "assistant") continue;
		const assistant = msg as AssistantMessage;
		const text = assistant.content
			.filter((c) => c.type === "text")
			.map((c) => (c as Extract<typeof c, { type: "text" }>).text)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return undefined;
}

/**
 * Run a separate read-only LLM call with the given questions against the main
 * session's context. Returns the reviewer's last assistant response text, or
 * undefined if the side call produced no usable response.
 */
export async function runTurnEndInjection(questions: string[], mainSession: AgentSession): Promise<string | undefined> {
	const model = mainSession.model;
	if (!model) return undefined;

	const { session } = await createAgentSession({
		sessionManager: SessionManager.inMemory(),
		model,
		modelRegistry: mainSession.modelRegistry,
		thinkingLevel: "off",
		tools: ["read", "grep", "find", "ls"],
		resourceLoader: createReviewerResourceLoader(),
	});

	try {
		// Seed the side session with the full main conversation history.
		const context = buildSessionContext(
			mainSession.sessionManager.getEntries(),
			mainSession.sessionManager.getLeafId(),
		);
		session.agent.state.messages = context.messages;

		await session.prompt(questions.join("\n\n"), { source: "extension" });

		// Find the last assistant message to check stop reason.
		let lastMsg: AssistantMessage | undefined;
		for (let i = session.state.messages.length - 1; i >= 0; i--) {
			const m = session.state.messages[i];
			if (m.role === "assistant") {
				lastMsg = m as AssistantMessage;
				break;
			}
		}

		if (!lastMsg || lastMsg.stopReason === "error" || lastMsg.stopReason === "aborted") {
			return undefined;
		}

		return getLastAssistantText(session);
	} finally {
		try {
			await session.abort();
		} catch {
			// ignore abort errors on side-session teardown
		}
		session.dispose();
	}
}
