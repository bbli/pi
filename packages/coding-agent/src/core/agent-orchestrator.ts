import { randomUUID } from "node:crypto";
import type { AgentSession, AgentSessionEventListener } from "./agent-session.ts";
import type { AgentSessionRuntime } from "./agent-session-runtime.ts";
import type { ConversationSession } from "./conversation-session.ts";
import { createExtensionRuntime } from "./extensions/loader.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { createAgentSession } from "./sdk.ts";
import { SessionManager } from "./session-manager.ts";
import { type SubagentRecord, SubagentRegistry } from "./subagent-registry.ts";

/**
 * Sits above AgentSessionRuntime and manages multi-session concerns:
 * which session is focused (rendered + receives input), and the registry
 * of live subagent sessions.
 *
 * AgentSessionRuntime remains responsible only for replacing the root session
 * (fork, new, switch). AgentOrchestrator is responsible for everything else.
 */
export class AgentOrchestrator implements ConversationSession {
	readonly registry: SubagentRegistry;
	private _focused: SubagentRecord | undefined = undefined;
	private readonly _runtime: AgentSessionRuntime;

	constructor(runtime: AgentSessionRuntime) {
		this._runtime = runtime;
		this.registry = new SubagentRegistry();
		runtime.session.setSubagentRegistry(this.registry);
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
	// ConversationSession implementation — routes to focusedSession
	// =========================================================================

	get isStreaming(): boolean {
		return this.focusedSession.isStreaming;
	}

	get retryAttempt(): number {
		return this.focusedSession.retryAttempt;
	}

	prompt(...args: Parameters<AgentSession["prompt"]>): ReturnType<AgentSession["prompt"]> {
		return this.focusedSession.prompt(...args);
	}

	subscribe(listener: AgentSessionEventListener): () => void {
		return this.focusedSession.subscribe(listener);
	}

	async abort(): Promise<void> {
		return this.focusedSession.abort();
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

		const extensionRuntime = createExtensionRuntime();
		const resourceLoader: ResourceLoader = {
			getExtensions: () => ({ extensions: [], errors: [], runtime: extensionRuntime }),
			getSkills: () => ({ skills: [], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }),
			getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => undefined,
			getAppendSystemPrompt: () => [],
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
			// Wire the registry into the newly created root session.
			this._runtime.session.setSubagentRegistry(this.registry);
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
