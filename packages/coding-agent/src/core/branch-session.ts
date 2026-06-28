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

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

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
 * Step 1 — Create an in-memory agent session configured for branch use.
 * Caller must have already verified mainSession.model is non-null.
 */
async function createBranchAgentSession(
	options: BranchSessionOptions,
	mainSession: AgentSession,
): Promise<AgentSession> {
	const builtinTools = options.tools ?? ["read", "grep", "find", "ls", "bash"];
	// sdk.ts uses the `tools` array as an allow-list (allowedToolNames) that every tool
	// must pass through isAllowedTool() to reach agent.state.tools. Custom tools are not
	// in that list by default, so they get filtered before the agent loop can call them.
	const customToolNames = (options.customTools ?? []).map((t) => t.name);
	const { session } = await createAgentSession({
		sessionManager: SessionManager.inMemory(),
		model: mainSession.model!,
		modelRegistry: mainSession.modelRegistry,
		thinkingLevel: "off",
		tools: [...builtinTools, ...customToolNames],
		customTools: options.customTools,
		resourceLoader: createBranchResourceLoader(options.systemPrompt),
		cwd: mainSession.cwd,
	});
	return session;
}

/**
 * Step 2 — Seed the branch session with the main session's conversation history.
 * Returns the number of messages seeded (for logging).
 */
function seedBranchContext(branchSession: AgentSession, mainSession: AgentSession): number {
	const context = buildSessionContext(mainSession.sessionManager.getEntries(), mainSession.sessionManager.getLeafId());
	branchSession.agent.state.messages = context.messages;
	return context.messages.length;
}

/**
 * Step 4 — Scan the branch session's messages backwards for the last assistant
 * text response. Returns the trimmed text, or undefined if the session errored,
 * was aborted, or produced no text output (tool-use only turns are skipped).
 */
function processBranchResponse(branchSession: AgentSession, label: string, start: number): string | undefined {
	for (let i = branchSession.state.messages.length - 1; i >= 0; i--) {
		const m = branchSession.state.messages[i];
		if (m.role !== "assistant") continue;
		const assistant = m as AssistantMessage;
		if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
			console.error(
				`[branch-session] stopReason=${assistant.stopReason} label=${label} elapsed=${Date.now() - start}ms`,
			);
			return undefined;
		}
		const raw = assistant.content
			.filter((c) => c.type === "text")
			.map((c) => (c as Extract<typeof c, { type: "text" }>).text)
			.join("\n")
			.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
			.trim();
		if (raw) {
			console.error(`[branch-session] result label=${label} elapsed=${Date.now() - start}ms:\n${raw}`);
			return raw;
		}
		// Tool-use only turn — keep scanning backwards.
	}
	console.error(`[branch-session] no text output label=${label} elapsed=${Date.now() - start}ms`);
	return undefined;
}

/**
 * Step 5 — Abort and optionally dispose the branch session.
 * When keepAlive is true (e.g. --keep-branch-sessions flag), only abort is
 * called so the session remains inspectable after the run.
 */
async function cleanupBranchSession(
	branchSession: AgentSession,
	registry: SubagentRegistry | undefined,
	registeredId: string | undefined,
	keepAlive: boolean,
): Promise<void> {
	if (keepAlive) {
		try {
			await branchSession.abort();
		} catch {
			// ignore abort errors on teardown
		}
		return;
	}
	if (registry && registeredId) {
		// registry.remove() handles abort + dispose
		registry.remove(registeredId);
	} else {
		try {
			await branchSession.abort();
		} catch {
			// ignore abort errors on teardown
		}
		branchSession.dispose();
	}
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run a separate agentic session seeded with the full main session history.
 *
 * Returns the last assistant text produced, or undefined if the session
 * produced no text output or errored/aborted. Sentinel parsing (e.g. looking
 * for YES/NO markers or structured output) is left to the caller.
 */
export async function runBranchSession(
	prompt: string,
	options: BranchSessionOptions,
	mainSession: AgentSession,
	registry?: SubagentRegistry,
): Promise<string | undefined> {
	if (!prompt.trim()) return undefined;
	if (!mainSession.model) return undefined;

	const label = options.label ?? "branch";
	const start = Date.now();

	// Step 1: create session
	const branchSession = await createBranchAgentSession(options, mainSession);

	let registeredId: string | undefined;
	try {
		// Step 2: seed context
		const messageCount = seedBranchContext(branchSession, mainSession);

		if (registry) {
			registeredId = crypto.randomUUID();
			registry.register({ id: registeredId, label, kind: "branch", session: branchSession });
		}

		console.error(
			`[branch-session] start label=${label} model=${mainSession.model.id} context_messages=${messageCount}`,
		);

		// Step 3: run the prompt
		await branchSession.prompt(prompt, { source: "extension" });

		// Step 4: process response
		return processBranchResponse(branchSession, label, start);
	} finally {
		// Step 5: cleanup
		await cleanupBranchSession(branchSession, registry, registeredId, options.keepAlive ?? false);
	}
}
