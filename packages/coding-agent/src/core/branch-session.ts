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
import { Type } from "typebox";
import type { AgentManager } from "./agent-manager.ts";
import type { AgentSession } from "./agent-session.ts";
import { debugLog } from "./debug.ts";
import { createExtensionRuntime } from "./extensions/loader.ts";
import { type BranchSessionOptions, defineTool } from "./extensions/types.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { createAgentSession } from "./sdk.ts";
import { buildSessionContext, SessionManager } from "./session-manager.ts";

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

/**
 * Build a resource loader for a branch session.
 *
 * By default delegates skills, AGENTS.md, and system prompt to the root loader
 * so the branch session's system prompt is identical to root's (KV cache stable).
 *
 * When overrideSystemPrompt is provided the branch session gets that string as
 * its custom system prompt instead of inheriting root's — use this for
 * role-override sessions (advisory evaluators) that need system-level authority.
 */
function createBranchResourceLoader(rootLoader: ResourceLoader, overrideSystemPrompt?: string): ResourceLoader {
	const extensionsResult = { extensions: [], errors: [], warnings: [], runtime: createExtensionRuntime() };
	return {
		getExtensions: () => extensionsResult,
		getSkills: () => rootLoader.getSkills(),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => rootLoader.getAgentsFiles(),
		getSystemPrompt: () => overrideSystemPrompt ?? rootLoader.getSystemPrompt(),
		getAppendSystemPrompt: () => (overrideSystemPrompt ? [] : rootLoader.getAppendSystemPrompt()),
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
	// Default to the same built-in tool set as the root session so the
	// "Available tools:" section of the system prompt is identical, maximising
	// KV cache reuse. Callers that need a restricted set pass an explicit list.
	const builtinTools = options.tools ?? ["read", "bash", "edit", "write"];
	// sdk.ts uses the `tools` array as an allow-list (allowedToolNames) that every tool
	// must pass through isAllowedTool() to reach agent.state.tools. Custom tools are not
	// in that list by default, so they get filtered before the agent loop can call them.
	const customToolNames = (options.customTools ?? []).map((t) => t.name);
	const overrideSystemPrompt = options.systemPromptOverride ? options.systemPrompt : undefined;
	const { session } = await createAgentSession({
		sessionManager: SessionManager.inMemory(),
		model: options.model ?? mainSession.model!,
		modelRegistry: mainSession.modelRegistry,
		thinkingLevel: options.thinkingLevel ?? "off",
		tools: [...builtinTools, ...customToolNames],
		customTools: options.customTools,
		resourceLoader: createBranchResourceLoader(mainSession.resourceLoader, overrideSystemPrompt),
		cwd: mainSession.cwd,
	});

	// NOTE: installed after createAgentSession — _installAgentToolHooks already set
	// agent.beforeToolCall to the extension-runner delegate; we chain on top here.
	// If _installAgentToolHooks is called again on this session the guard is lost.
	if (options.blockedTools && options.blockedTools.length > 0) {
		const blocked = new Set(options.blockedTools);
		const existing = session.agent.beforeToolCall;
		session.agent.beforeToolCall = async (context, signal) => {
			if (blocked.has(context.toolCall.name)) {
				debugLog(`[branch:${options.label ?? "branch"}] blocked tool call: "${context.toolCall.name}"`);
				return { block: true, reason: `Tool "${context.toolCall.name}" is not available in this session.` };
			}
			return existing?.(context, signal);
		};
	}

	return session;
}

/**
 * Step 2 — Seed the branch session with the main session's conversation history.
 * Returns the number of messages seeded (for logging).
 */
function seedBranchContext(branchSession: AgentSession, mainSession: AgentSession): number {
	const entries = mainSession.sessionManager.getEntries();
	const leafId = mainSession.sessionManager.getLeafId();
	if (entries.length > 0) {
		branchSession.sessionManager.seedEntries(entries, leafId);
	}
	const context = buildSessionContext(entries, leafId);
	branchSession.agent.state.messages = context.messages;
	return context.messages.length;
}

/**
 * Step 3a — Wire the injectEvery subscription onto a branch session.
 * Validates the turns value and installs a turn_end subscriber that steers
 * a reminder message every `turns` completed turns.
 * Returns the unsubscribe function, or undefined if nothing was wired.
 */
function wireInjectEvery(
	branchSession: AgentSession,
	injectEvery: { turns: number; message: string } | undefined,
	label: string,
): (() => void) | undefined {
	if (!injectEvery) return undefined;
	const { turns, message } = injectEvery;
	if (!Number.isFinite(turns) || turns <= 0) {
		console.warn(`[branch:${label}] injectEvery.turns must be a finite positive number, got ${turns}; skipping`);
		return undefined;
	}
	let turnCount = 0;
	return branchSession.subscribe((event) => {
		if (event.type !== "turn_end") return;
		turnCount++;
		if (turnCount % turns === 0) {
			debugLog(`[branch:${label}] injectEvery: injecting reminder at turn ${turnCount}`);
			void branchSession.steer(message);
		}
	});
}

/**
 * Step 5 — Abort and optionally dispose the branch session.
 * When keepAlive is true (e.g. --keep-branch-sessions flag), only abort is
 * called so the session remains inspectable after the run.
 */
async function cleanupBranchSession(
	branchSession: AgentSession,
	manager: AgentManager | undefined,
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
	if (manager && registeredId) {
		// onDone() defers disposal when the session is focused; removes immediately otherwise.
		manager.onDone(registeredId);
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
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Run a separate agentic session seeded with the full main session history.
 * Returns the last assistant text produced by the branch session, or undefined
 * if nothing was output or the session errored. Sentinel parsing is the caller's job.
 */
export async function runBranchSession(
	prompt: string,
	options: BranchSessionOptions,
	mainSession: AgentSession,
	manager?: AgentManager,
): Promise<string | undefined> {
	if (!prompt.trim()) return undefined;
	if (!mainSession.model) return undefined;

	const label = options.label ?? "branch";

	// Step 1: create session
	const branchSession = await createBranchAgentSession(options, mainSession);

	let registeredId: string | undefined;
	let text: string | undefined;
	let _unsubInjectEvery: (() => void) | undefined;
	try {
		// Step 2: seed context (skipped when seedContext: false)
		if (options.seedContext !== false) {
			seedBranchContext(branchSession, mainSession);
		}

		if (manager) {
			registeredId = crypto.randomUUID();
			manager.register({ id: registeredId, label, kind: "branch", session: branchSession });
		}

		// Step 3a: wire injectEvery
		_unsubInjectEvery = wireInjectEvery(branchSession, options.injectEvery, label);

		// Step 3b: wire abort signal — if the caller cancels, abort the branch session too.
		// Without this the branch session runs to completion even after the parent turn is aborted,
		// keeping the main turn blocked until the branch finishes.
		const abortSignal = options.abortSignal;
		if (abortSignal) {
			if (abortSignal.aborted) {
				// Already cancelled before we started — skip the prompt entirely.
				debugLog(`[branch:${label}] aborted before start`);
				return undefined;
			}
			abortSignal.addEventListener("abort", () => void branchSession.abort(), { once: true });
		}

		// Step 3c: run the prompt.
		// When systemPromptOverride is false (default): options.systemPrompt is prepended
		// to the first user-turn message so the system prompt stays identical to root's
		// for KV cache consistency.
		// When systemPromptOverride is true: options.systemPrompt was already baked into
		// the session system prompt by createBranchResourceLoader — do not prepend here.
		const prependText = options.systemPrompt && !options.systemPromptOverride ? options.systemPrompt : undefined;
		if (prependText) {
			debugLog(`[branch:${label}] systemPrompt prepended (${prependText.length} chars)`);
		}
		const fullPrompt = prependText ? `${prependText}\n\n${prompt}` : prompt;
		await branchSession.prompt(fullPrompt, { source: "extension" });

		// Step 4: capture last assistant text
		text = branchSession.lastAssistantText;
		debugLog(`[branch:${label}] session complete, text.length=${text?.length ?? 0}`);
	} finally {
		// Step 5: cleanup
		_unsubInjectEvery?.();
		await cleanupBranchSession(branchSession, manager, registeredId, options.keepAlive ?? false);
	}
	return text;
}

/**
 * Run a branch session with a built-in `session_done(procedure)` tool.
 *
 * Blocks until the branch session calls session_done or the abort signal fires.
 * The user can drive the branch session by switching focus to its pane via
 * /agent; their replies flow through the normal editor submit path directly
 * to the branch session's prompt(). The caller's execute() stays blocked,
 * keeping the main session awaiting the tool result.
 *
 * Returns the procedure string when session_done is called, or a fallback
 * message if the abort signal fires before session_done is called.
 */
export async function newBranchSession(
	prompt: string,
	options: BranchSessionOptions,
	mainSession: AgentSession,
	manager?: AgentManager,
): Promise<string> {
	const fallback = "Could not find a procedure. Take a step back and consider a different approach.";

	if (!prompt.trim()) return fallback;
	if (!mainSession.model) return fallback;

	const label = options.label ?? "branch";

	// Promise resolved by session_done (with the procedure) or by abort (with undefined).
	let resolveDone!: (result: string | undefined) => void;
	const donePromise = new Promise<string | undefined>((resolve) => {
		resolveDone = resolve;
	});

	const effectiveOptions: BranchSessionOptions = {
		...options,
		customTools: [
			...(options.customTools ?? []),
			defineTool({
				name: "session_done",
				label: "Session Done",
				description:
					"Call this when you have a complete procedure ready to return. " +
					"Include a Confidence: high/medium/low line in the procedure text. " +
					"Only call this when you have actual steps to provide. " +
					"If you have exhausted all options including asking the user, " +
					"call this with your best-effort answer and Confidence: low.",
				parameters: Type.Object({
					procedure: Type.String({
						description: "The complete procedure text to return to the caller.",
					}),
				}),
				execute: async (_id, params) => {
					resolveDone(params.procedure);
					return {
						content: [{ type: "text" as const, text: "Procedure recorded. Session complete." }],
						details: {},
						terminate: true,
					};
				},
			}),
		],
	};

	const branchSession = await createBranchAgentSession(effectiveOptions, mainSession);

	let registeredId: string | undefined;
	let _unsubInjectEvery: (() => void) | undefined;
	try {
		if (options.seedContext !== false) {
			seedBranchContext(branchSession, mainSession);
		}

		if (manager) {
			registeredId = crypto.randomUUID();
			manager.register({ id: registeredId, label, kind: "branch", session: branchSession });
		}

		_unsubInjectEvery = wireInjectEvery(branchSession, options.injectEvery, label);

		const abortSignal = options.abortSignal;
		if (abortSignal) {
			if (abortSignal.aborted) {
				debugLog(`[branch:${label}] aborted before start`);
				return fallback;
			}
			abortSignal.addEventListener(
				"abort",
				() => {
					void branchSession.abort();
					resolveDone(undefined);
				},
				{ once: true },
			);
		}

		const prependText = options.systemPrompt && !options.systemPromptOverride ? options.systemPrompt : undefined;
		if (prependText) {
			debugLog(`[branch:${label}] systemPrompt prepended (${prependText.length} chars)`);
		}
		const fullPrompt = prependText ? `${prependText}\n\n${prompt}` : prompt;
		await branchSession.prompt(fullPrompt, { source: "extension" });

		const result = await donePromise;
		debugLog(`[branch:${label}] session complete, result.length=${result?.length ?? 0}`);
		return result ?? fallback;
	} finally {
		_unsubInjectEvery?.();
		await cleanupBranchSession(branchSession, manager, registeredId, options.keepAlive ?? false);
	}
}
