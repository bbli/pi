/**
 * Branch session runner.
 *
 * Creates a separate in-memory agentic session seeded with the full main
 * session history. Used by pi.runBranchSession() to power synchronous
 * side-sessions (consideration classifiers, completion checkers, worker
 * research sessions, etc.).
 *
 * Unlike the old turn-end-injection reviewer, branch sessions:
 * - Accept a configurable system prompt
 * - Accept arbitrary custom tools (injectMessage, askQuestions, etc.)
 * - Return the raw last assistant text — sentinel parsing is the caller's job
 * - Are always synchronous (callers await them directly)
 * - Register in the subagent registry so they appear in the TUI footer while
 *   running, and are removed immediately on completion
 */

import * as crypto from "node:crypto";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession } from "./agent-session.ts";
import { createExtensionRuntime } from "./extensions/loader.ts";
import type { BranchSessionOptions } from "./extensions/types.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { createAgentSession } from "./sdk.ts";
import { buildSessionContext, SessionManager } from "./session-manager.ts";
import type { SubagentRegistry } from "./subagent-registry.ts";

function createBranchResourceLoader(systemPrompt: string): ResourceLoader {
	const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	return {
		getExtensions: () => extensionsResult,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [systemPrompt],
		extendResources: () => {},
		reload: async () => {},
	};
}

/**
 * Run a separate agentic session seeded with the full main session history.
 *
 * Returns the last assistant text produced, or undefined if the session
 * produced no text output or errored/aborted. Sentinel parsing (e.g. looking
 * for INJECT_PROMPT or TASK_COMPLETE markers) is left to the caller.
 */
export async function runBranchSession(
	prompt: string,
	options: BranchSessionOptions,
	mainSession: AgentSession,
	registry?: SubagentRegistry,
): Promise<string | undefined> {
	const model = mainSession.model;
	if (!model) return undefined;

	const { session } = await createAgentSession({
		sessionManager: SessionManager.inMemory(),
		model,
		modelRegistry: mainSession.modelRegistry,
		thinkingLevel: "off",
		tools: options.tools ?? ["read", "grep", "find", "ls", "bash"],
		customTools: options.customTools,
		resourceLoader: createBranchResourceLoader(options.systemPrompt),
		cwd: mainSession.cwd,
	});

	let registeredId: string | undefined;
	try {
		const context = buildSessionContext(
			mainSession.sessionManager.getEntries(),
			mainSession.sessionManager.getLeafId(),
		);
		session.agent.state.messages = context.messages;

		if (registry) {
			registeredId = crypto.randomUUID();
			registry.register({
				id: registeredId,
				label: options.label ?? "branch",
				kind: "branch",
				session,
			});
		}

		await session.prompt(prompt, { source: "extension" });

		// Scan backwards for the last assistant message with text content.
		for (let i = session.state.messages.length - 1; i >= 0; i--) {
			const m = session.state.messages[i];
			if (m.role !== "assistant") continue;
			const assistant = m as AssistantMessage;
			if (assistant.stopReason === "error" || assistant.stopReason === "aborted") return undefined;
			const raw = assistant.content
				.filter((c) => c.type === "text")
				.map((c) => (c as Extract<typeof c, { type: "text" }>).text)
				.join("\n")
				.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
				.trim();
			if (raw) return raw;
			// Tool-use only turn — keep scanning.
		}
		return undefined;
	} finally {
		try {
			await session.abort();
		} catch {
			// ignore abort errors on teardown
		}
		if (registry && registeredId) {
			registry.remove(registeredId);
		} else {
			session.dispose();
		}
	}
}
