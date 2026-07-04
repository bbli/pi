import { randomUUID } from "node:crypto";
import type { AgentSession } from "./agent-session.ts";
import type { AgentSessionRuntime } from "./agent-session-runtime.ts";
import { createExtensionRuntime } from "./extensions/loader.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { createAgentSession } from "./sdk.ts";
import { buildSessionContext, SessionManager } from "./session-manager.ts";
import { type SubagentRecord, SubagentRegistry } from "./subagent-registry.ts";
import { makeResearchTool } from "./tools/research.ts";

/**
 * Sits above AgentSessionRuntime and manages multi-session concerns:
 * which session is focused (rendered + receives input), and the registry
 * of live subagent sessions.
 *
 * AgentSessionRuntime remains responsible only for replacing the root session
 * (fork, new, switch). AgentOrchestrator is responsible for everything else.
 */
export class AgentOrchestrator {
	readonly registry: SubagentRegistry;
	private _focused: SubagentRecord | undefined = undefined;
	private readonly _runtime: AgentSessionRuntime;

	constructor(runtime: AgentSessionRuntime) {
		this._runtime = runtime;
		this.registry = new SubagentRegistry();
		runtime.session.setSubagentRegistry(this.registry);
		runtime.session.addBuiltinTool(makeResearchTool(runtime.session, this.registry));
		// Branch sessions are removed immediately on completion — no TTL needed.
	}

	// =========================================================================
	// Session accessors
	// =========================================================================

	/** The root session — always the one managed by AgentSessionRuntime.
	 *  Used for all infrastructure access (settingsManager, modelRegistry, etc.). */
	get rootSession(): AgentSession {
		return this._runtime.session;
	}

	/** The session currently being rendered and receiving user input.
	 *  Defaults to rootSession when no subagent is focused. */
	get focusedSession(): AgentSession {
		return this._focused?.session ?? this.rootSession;
	}

	/** The currently focused subagent record, or undefined if root is focused. */
	get focusedRecord(): SubagentRecord | undefined {
		return this._focused;
	}

	// =========================================================================
	// Focus management
	// =========================================================================

	/** Switch focus to a subagent record, or pass undefined to return to root. */
	focus(record: SubagentRecord | undefined): void {
		this._focused = record;
	}

	// =========================================================================
	// Kill
	// =========================================================================

	/** Kill a registered subagent by id. Focuses the next live session or root. */
	kill(id: string): void {
		if (this._focused?.id === id) {
			const remaining = this.registry.getAll().filter((r) => r.id !== id);
			this._focused = remaining.length > 0 ? remaining[remaining.length - 1] : undefined;
		}
		this.registry.remove(id);
	}

	// =========================================================================
	// Spawn (implemented in a later step)
	// =========================================================================

	/**
	 * Spawn a new user-interactive subagent with a minimal resource loader (no extensions).
	 * Returns the registered record without firing a prompt — the caller is responsible
	 * for calling switchFocus then sending the first message.
	 */
	async spawn(): Promise<SubagentRecord> {
		const root = this.rootSession;
		if (!root.model) throw new Error("Cannot spawn subagent: no model selected");

		// Delegate reads to root's loader so the subagent inherits skills, prompts,
		// AGENTS.md context, and system prompt. Extensions are NOT shared — the
		// subagent gets its own empty ExtensionRuntime to keep handler state separate.
		// extendResources/reload are no-ops: bindExtensions is never called on subagents.
		const extensionRuntime = createExtensionRuntime();
		const rootLoader = root.resourceLoader;
		const resourceLoader: ResourceLoader = {
			getExtensions: () => ({ extensions: [], errors: [], runtime: extensionRuntime }),
			getSkills: () => rootLoader.getSkills(),
			getPrompts: () => rootLoader.getPrompts(),
			getThemes: () => rootLoader.getThemes(),
			getAgentsFiles: () => rootLoader.getAgentsFiles(),
			getSystemPrompt: () => rootLoader.getSystemPrompt(),
			getAppendSystemPrompt: () => rootLoader.getAppendSystemPrompt(),
			extendResources: () => {},
			reload: async () => {},
		};

		const { session } = await createAgentSession({
			sessionManager: SessionManager.inMemory(),
			model: root.model,
			modelRegistry: root.modelRegistry,
			thinkingLevel: root.thinkingLevel,
			cwd: root.cwd,
			resourceLoader,
		});

		// Seed the subagent with root's conversation history so it has full context.
		// Same mechanism as runBranchSession's seedBranchContext — reads persisted
		// entries so compaction boundaries and branching are respected.
		const context = buildSessionContext(root.sessionManager.getEntries(), root.sessionManager.getLeafId());
		if (context.messages.length > 0) {
			session.agent.state.messages = [...context.messages];
		}

		const userCount = this.registry.getAll().filter((r) => r.kind === "user").length;
		const label = `agent-${userCount + 1}`;
		const id = randomUUID();
		this.registry.register({ id, label, kind: "user", session });
		return this.registry.get(id)!;
	}

	// =========================================================================
	// Runtime lifecycle delegation
	// =========================================================================

	/**
	 * Chain session-replacement callbacks so that when the root session is
	 * replaced the orchestrator clears subagents before the TUI rebinds.
	 *
	 * beforeSessionInvalidate: clear focused + registry, then run the TUI's
	 * own beforeSessionInvalidate (e.g. resetExtensionUI).
	 *
	 * rebindSession: just delegate to the TUI's rebind callback.
	 */
	setBeforeSessionInvalidate(cb: () => void): void {
		this._runtime.setBeforeSessionInvalidate(() => {
			this._focused = undefined;
			this.registry.clearAll();
			cb();
		});
	}

	setRebindSession(cb: () => Promise<void>): void {
		this._runtime.setRebindSession(async () => {
			// Wire the registry and built-in tools into the newly created root session.
			this._runtime.session.setSubagentRegistry(this.registry);
			this._runtime.session.addBuiltinTool(makeResearchTool(this._runtime.session, this.registry));
			await cb();
		});
	}

	async dispose(): Promise<void> {
		this.registry.dispose();
		await this._runtime.dispose();
	}

	// =========================================================================
	// Pass-throughs for AgentSessionRuntime methods used by InteractiveMode
	// =========================================================================

	/** @deprecated Use rootSession instead */
	get session(): AgentSession {
		return this._runtime.session;
	}

	get services() {
		return this._runtime.services;
	}

	get cwd() {
		return this._runtime.cwd;
	}

	get diagnostics() {
		return this._runtime.diagnostics;
	}

	get modelFallbackMessage() {
		return this._runtime.modelFallbackMessage;
	}

	newSession(...args: Parameters<AgentSessionRuntime["newSession"]>): ReturnType<AgentSessionRuntime["newSession"]> {
		return this._runtime.newSession(...args);
	}

	fork(...args: Parameters<AgentSessionRuntime["fork"]>): ReturnType<AgentSessionRuntime["fork"]> {
		return this._runtime.fork(...args);
	}

	switchSession(
		...args: Parameters<AgentSessionRuntime["switchSession"]>
	): ReturnType<AgentSessionRuntime["switchSession"]> {
		return this._runtime.switchSession(...args);
	}

	importFromJsonl(
		...args: Parameters<AgentSessionRuntime["importFromJsonl"]>
	): ReturnType<AgentSessionRuntime["importFromJsonl"]> {
		return this._runtime.importFromJsonl(...args);
	}
}
