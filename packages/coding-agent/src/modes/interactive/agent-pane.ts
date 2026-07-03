/**
 * AgentPane — per-session state container for InteractiveMode.
 *
 * Each interactive agent session (root, user-spawned subagent, or branch
 * session) owns one AgentPane. InteractiveMode holds a Map<id, AgentPane>
 * and focuses one at a time by switching this.focusedId.
 *
 * Fields here are the "backend" conversation-local variables that were
 * previously scattered on InteractiveMode and saved/restored through the
 * conversationStates / sessionHistories maps.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { LoaderIndicatorOptions, Spacer, Text } from "@earendil-works/pi-tui";
import type { AgentSession, AgentSessionEvent, AgentSessionEventListener } from "../../core/agent-session.ts";
import { debugLog } from "../../core/debug.ts";
import type { AssistantMessageComponent } from "./components/assistant-message.ts";
import type { ToolExecutionComponent } from "./components/tool-execution.ts";

export type CompactionQueuedMessage = {
	text: string;
	mode: "steer" | "followUp";
};

/**
 * All per-session state for one interactive agent conversation.
 */
export class AgentPane {
	readonly session: AgentSession;
	readonly id: string;
	readonly label: string;

	// Event subscription — replaced on every focus switch.
	private _unsubscribe?: () => void;

	// ── Conversation-local data ────────────────────────────────────────────
	/** Messages queued while this session's compaction was running. */
	compactionQueuedMessages: CompactionQueuedMessage[] = [];
	/** Status text shown in the working loader ("Working...", custom message, etc.). */
	workingMessage: string | undefined = undefined;
	/** Whether the working loader is shown at all for this session. */
	workingVisible = true;
	workingIndicatorOptions: LoaderIndicatorOptions | undefined = undefined;

	// ── Render state (valid only while this pane is focused) ───────────────
	streamingComponent: AssistantMessageComponent | undefined = undefined;
	streamingMessage: AssistantMessage | undefined = undefined;
	pendingTools = new Map<string, ToolExecutionComponent>();
	/** Status-line dedup pointers — reset on every focus switch. */
	lastStatusSpacer: Spacer | undefined = undefined;
	lastStatusText: Text | undefined = undefined;

	constructor(session: AgentSession, id: string, label: string) {
		this.session = session;
		this.id = id;
		this.label = label;
		debugLog(`[AgentPane] created id=${id} label=${label}`);
	}

	// =========================================================================
	// Subscription lifecycle
	// =========================================================================

	/**
	 * Subscribe to this pane's session events. Replaces any existing subscription.
	 * Returns an unsubscribe function so the caller can tear down cleanly.
	 */
	subscribe(listener: AgentSessionEventListener): () => void {
		this._unsubscribe?.();
		const unsub = this.session.subscribe(listener);
		this._unsubscribe = unsub;
		return unsub;
	}

	/** Tear down the current event subscription without disposing the session. */
	unsubscribe(): void {
		this._unsubscribe?.();
		this._unsubscribe = undefined;
	}

	// =========================================================================
	// Render state reset
	// =========================================================================

	/** Reset all render-tracking state. Called when chatContainer is cleared. */
	resetRenderState(): void {
		this.streamingComponent = undefined;
		this.streamingMessage = undefined;
		this.pendingTools.clear();
		this.lastStatusSpacer = undefined;
		this.lastStatusText = undefined;
	}

	// =========================================================================
	// Passthrough helpers used frequently in handleEvent
	// =========================================================================

	get isStreaming(): boolean {
		return this.session.isStreaming;
	}

	get retryAttempt(): number {
		return this.session.retryAttempt;
	}

	/** Forward a prompt to this pane's underlying session. */
	prompt(...args: Parameters<AgentSession["prompt"]>): ReturnType<AgentSession["prompt"]> {
		return this.session.prompt(...args);
	}

	/** Abort this pane's session and wait for it to go idle. */
	abort(): Promise<void> {
		return this.session.abort();
	}

	forwardEvent(event: AgentSessionEvent): boolean {
		return event.type === "agent_start" || event.type === "agent_end";
	}
}
