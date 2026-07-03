/**
 * AgentPane — per-session state container for InteractiveMode.
 *
 * Each interactive agent session (root, user-spawned subagent, or branch
 * session) owns one AgentPane. InteractiveMode holds a Map<id, AgentPane>
 * and focuses one at a time by switching this.focusedId.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Container, type LoaderIndicatorOptions, type Spacer, type Text } from "@earendil-works/pi-tui";
import type { AgentSession, AgentSessionEventListener } from "../../core/agent-session.ts";
import { debugLog } from "../../core/debug.ts";
import type { AssistantMessageComponent } from "./components/assistant-message.ts";
import type { BashExecutionComponent } from "./components/bash-execution.ts";
import type { CustomEditor } from "./components/custom-editor.ts";
import type { ToolExecutionComponent } from "./components/tool-execution.ts";

export type CompactionQueuedMessage = {
	text: string;
	mode: "steer" | "followUp";
};

/**
 * All per-session state for one interactive agent conversation.
 * InteractiveMode creates one pane per session and mounts the active pane's
 * editor + pendingMessages into the shared TUI layout on each focus switch.
 */
export class AgentPane {
	/** The underlying agent session. Mutable to allow root session replacement on /new, /fork. */
	session: AgentSession;
	readonly id: string;
	readonly label: string;

	// ── Editor (per-pane, swapped into editorContainer on focus) ──────────
	/** This pane's native CustomEditor. Set after construction by wirePaneEditor(). */
	editor!: CustomEditor;
	/** Whether the editor currently starts with "!" (bash mode). */
	isBashMode = false;

	// ── Bash execution (per-pane) ──────────────────────────────────────────
	/** The currently-executing (or just-completed) bash UI component. */
	bashComponent: BashExecutionComponent | undefined = undefined;
	/** Bash components shown in pendingMessages while the session is streaming;
	 *  moved to chatContainer by flushPendingBashComponents() on the next submit. */
	pendingBashComponents: BashExecutionComponent[] = [];

	// ── Pending messages container (per-pane, swapped into layout slot) ───
	/** Container for steering/follow-up queue display and pending bash components. */
	readonly pendingMessages: Container = new Container();

	// ── Event subscription ─────────────────────────────────────────────────
	private _unsubscribe?: () => void;

	// ── Conversation-local data ────────────────────────────────────────────
	compactionQueuedMessages: CompactionQueuedMessage[] = [];
	workingMessage: string | undefined = undefined;
	workingVisible = true;
	workingIndicatorOptions: LoaderIndicatorOptions | undefined = undefined;

	// ── Render state (valid only while this pane is focused) ───────────────
	streamingComponent: AssistantMessageComponent | undefined = undefined;
	streamingMessage: AssistantMessage | undefined = undefined;
	pendingTools = new Map<string, ToolExecutionComponent>();
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

	subscribe(listener: AgentSessionEventListener): () => void {
		this._unsubscribe?.();
		const unsub = this.session.subscribe(listener);
		this._unsubscribe = unsub;
		return unsub;
	}

	unsubscribe(): void {
		this._unsubscribe?.();
		this._unsubscribe = undefined;
	}

	// =========================================================================
	// Passthrough helpers
	// =========================================================================

	get isStreaming(): boolean {
		return this.session.isStreaming;
	}

	get retryAttempt(): number {
		return this.session.retryAttempt;
	}

	prompt(...args: Parameters<AgentSession["prompt"]>): ReturnType<AgentSession["prompt"]> {
		return this.session.prompt(...args);
	}

	abort(): Promise<void> {
		return this.session.abort();
	}
}
