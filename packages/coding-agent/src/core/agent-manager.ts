/**
 * AgentManager — unified subagent registry and session orchestration.
 *
 * Merges the former SubagentRegistry (record storage, TTL, status callbacks)
 * and AgentOrchestrator (focus management, spawn, runtime lifecycle) into a
 * single class. AgentSession holds a reference to this via setAgentManager()
 * so branch-session.ts can register/remove sessions without a separate
 * registry handle.
 */

import { randomUUID } from "node:crypto";
import type { AgentSession, AgentSessionEvent } from "./agent-session.ts";
import type { AgentSessionRuntime } from "./agent-session-runtime.ts";
import { debugLog } from "./debug.ts";
import { createExtensionRuntime } from "./extensions/loader.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { createAgentSession } from "./sdk.ts";
import { buildSessionContext, SessionManager } from "./session-manager.ts";
import { makeInjectMessageTool } from "./tools/inject-message.ts";
import { makeResearchTool } from "./tools/research.ts";
import { makeTestLearningTool } from "./tools/test-learning.ts";

// ============================================================================
// Types
// ============================================================================

export type SubagentKind = "user" | "branch";

export interface SubagentRecord {
	readonly id: string;
	readonly label: string;
	readonly kind: SubagentKind;
	readonly session: AgentSession;
	ttlTimer: ReturnType<typeof setTimeout> | undefined;
	unsubscribeStatus: (() => void) | undefined;
	/**
	 * Set to true by onDone() when a branch session finishes while focused.
	 * The session stays alive until focus moves away; focus() calls remove()
	 * on the previously focused record when this flag is set.
	 */
	completed: boolean;
	/**
	 * Set to true when the user explicitly requests the session be kept.
	 * Prevents auto-disposal in onDone() and focus() regardless of focus state.
	 * Only cleared by an explicit kill().
	 */
	kept: boolean;
}

// ============================================================================
// AgentManager
// ============================================================================

export class AgentManager {
	// ── Registry state ───────────────────────────────────────────────────────
	private readonly _records = new Map<string, SubagentRecord>();

	/** Fired when any registered session emits agent_start or agent_end. */
	onStatusChange: (() => void) | undefined = undefined;
	/** Fired after a new record is added. */
	onRegister: ((record: SubagentRecord) => void) | undefined = undefined;
	/** Fired after a record is removed (session aborted and disposed). */
	onRemove: ((id: string) => void) | undefined = undefined;

	// ── Orchestrator state ───────────────────────────────────────────────────
	private _focused: SubagentRecord | undefined = undefined;
	private readonly _runtime: AgentSessionRuntime;

	constructor(runtime: AgentSessionRuntime) {
		this._runtime = runtime;
		runtime.session.setAgentManager(this);
		runtime.session.addBuiltinTool(makeResearchTool(runtime.session, this));
		runtime.session.addBuiltinTool(makeTestLearningTool(runtime.session, this));
	}

	// =========================================================================
	// Registry — record storage
	// =========================================================================

	register(record: Pick<SubagentRecord, "id" | "label" | "kind" | "session">): void {
		debugLog(`[AgentManager] register id=${record.id} label=${record.label} kind=${record.kind}`);
		const unsubscribeStatus = record.session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "agent_start" || event.type === "agent_end") {
				this.onStatusChange?.();
			}
		});
		const stored: SubagentRecord = {
			...record,
			ttlTimer: undefined,
			unsubscribeStatus,
			completed: false,
			kept: false,
		};
		this._records.set(record.id, stored);
		this.onRegister?.(stored);
		this.onStatusChange?.();
	}

	remove(id: string): void {
		const record = this._records.get(id);
		if (!record) return;
		debugLog(`[AgentManager] remove id=${id} label=${record.label} kind=${record.kind}`);
		if (record.ttlTimer !== undefined) {
			clearTimeout(record.ttlTimer);
		}
		record.unsubscribeStatus?.();
		void record.session.abort().catch(() => {});
		record.session.dispose();
		this._records.delete(id);
		this.onRemove?.(id);
		this.onStatusChange?.();
	}

	get(id: string): SubagentRecord | undefined {
		return this._records.get(id);
	}

	getAll(): readonly SubagentRecord[] {
		return Array.from(this._records.values());
	}

	startTTL(id: string, ms: number, onExpire: () => void): void {
		const record = this._records.get(id);
		if (!record) return;
		const timer = setTimeout(onExpire, ms);
		timer.unref?.();
		record.ttlTimer = timer;
	}

	refreshTTL(id: string, ms: number, onExpire: () => void): void {
		const record = this._records.get(id);
		if (!record) return;
		if (record.ttlTimer !== undefined) {
			clearTimeout(record.ttlTimer);
		}
		const timer = setTimeout(onExpire, ms);
		timer.unref?.();
		record.ttlTimer = timer;
	}

	clearAll(): void {
		for (const id of Array.from(this._records.keys())) {
			this.remove(id);
		}
	}

	// =========================================================================
	// Orchestrator — session accessors
	// =========================================================================

	/** The root session — always the one managed by AgentSessionRuntime. */
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
	// Orchestrator — focus management
	// =========================================================================

	/** Switch focus to a subagent record, or pass undefined to return to root.
	 *  If the previously focused record was a completed branch session, disposes it now.
	 *  Kept sessions are never auto-disposed on focus switch. */
	focus(record: SubagentRecord | undefined): void {
		const prev = this._focused;
		this._focused = record;
		if (prev?.completed && !prev.kept && prev.id !== record?.id) {
			debugLog(`[AgentManager] focus flush: removing completed id=${prev.id} label=${prev.label}`);
			this.remove(prev.id);
		}
	}

	/**
	 * Mark a branch session as kept so it survives completion without disposal.
	 * Has no effect on user sessions or unknown ids.
	 */
	setKept(id: string, kept: boolean): void {
		const record = this._records.get(id);
		if (!record || record.kind !== "branch") return;
		debugLog(`[AgentManager] setKept id=${id} label=${record.label} kept=${kept}`);
		record.kept = kept;
	}

	/**
	 * Called by runBranchSession when a branch prompt completes.
	 * Defers disposal if the session is currently focused so the user can read
	 * the output; disposes immediately otherwise.
	 * Long-lived user sessions (kind === "user") are never auto-disposed here.
	 */
	onDone(id: string): void {
		const record = this._records.get(id);
		if (!record) return;
		if (record.kind !== "branch") return;
		record.completed = true;
		if (record.kept) {
			// User explicitly wants this session preserved — abort but do not dispose.
			debugLog(`[AgentManager] onDone id=${id} label=${record.label} — kept, aborting only`);
			void record.session.abort().catch(() => {});
			return;
		}
		const isFocused = this._focused?.id === id;
		if (isFocused) {
			debugLog(`[AgentManager] onDone id=${id} label=${record.label} — focused, deferring disposal`);
		} else {
			debugLog(`[AgentManager] onDone id=${id} label=${record.label} — not focused, removing now`);
			this.remove(id);
		}
	}

	// =========================================================================
	// Orchestrator — kill
	// =========================================================================

	/** Kill a registered subagent by id. Focuses the next live session or root. */
	kill(id: string): void {
		if (this._focused?.id === id) {
			const remaining = this.getAll().filter((r) => r.id !== id);
			this._focused = remaining.length > 0 ? remaining[remaining.length - 1] : undefined;
		}
		this.remove(id);
	}

	// =========================================================================
	// Orchestrator — spawn
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
			getExtensions: () => ({ extensions: [], errors: [], warnings: [], runtime: extensionRuntime }),
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
		// seedEntries populates the SessionManager so /tree works on the subagent;
		// agent.state.messages is the separate LLM inference path.
		const rootEntries = root.sessionManager.getEntries();
		const rootLeafId = root.sessionManager.getLeafId();
		if (rootEntries.length > 0) {
			session.sessionManager.seedEntries(rootEntries, rootLeafId);
		}
		const context = buildSessionContext(rootEntries, rootLeafId);
		if (context.messages.length > 0) {
			session.agent.state.messages = [...context.messages];
		}

		session.addBuiltinTool(makeInjectMessageTool(root));

		const userCount = this.getAll().filter((r) => r.kind === "user").length;
		const label = `agent-${userCount + 1}`;
		const id = randomUUID();
		this.register({ id, label, kind: "user", session });
		return this.get(id)!;
	}

	// =========================================================================
	// Orchestrator — runtime lifecycle
	// =========================================================================

	/**
	 * Chain session-replacement callbacks so that when the root session is
	 * replaced the manager clears subagents before the TUI rebinds.
	 */
	setBeforeSessionInvalidate(cb: () => void): void {
		this._runtime.setBeforeSessionInvalidate(() => {
			this._focused = undefined;
			this.clearAll();
			cb();
		});
	}

	setRebindSession(cb: () => Promise<void>): void {
		this._runtime.setRebindSession(async () => {
			// Wire the manager and built-in tools into the newly created root session.
			this._runtime.session.setAgentManager(this);
			this._runtime.session.addBuiltinTool(makeResearchTool(this._runtime.session, this));
			this._runtime.session.addBuiltinTool(makeTestLearningTool(this._runtime.session, this));
			await cb();
		});
	}

	async dispose(): Promise<void> {
		this.clearAll();
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
