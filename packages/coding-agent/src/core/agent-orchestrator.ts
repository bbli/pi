import type { AgentSession } from "./agent-session.ts";
import type { AgentSessionRuntime } from "./agent-session-runtime.ts";
import { type SubagentRecord, SubagentRegistry } from "./subagent-registry.ts";

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
		if (record?.kind === "reviewer") {
			this.registry.refreshTTL(record.id, 60_000, () => {
				if (this._focused?.id === record.id) {
					this._focused = undefined;
				}
				this.registry.remove(record.id);
			});
		}
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

	async spawn(_prompt: string): Promise<SubagentRecord> {
		throw new Error("spawn not yet implemented");
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
