import type { AgentSessionEventListener, PromptOptions } from "./agent-session.ts";

/**
 * The minimal interface for the currently-active conversation.
 * Implemented by AgentOrchestrator, which routes each call to
 * whichever AgentSession is focused (root or subagent).
 *
 * InteractiveMode uses this for anything that should target the
 * live conversation: sending messages, subscribing to events,
 * reading streaming state, and aborting.
 *
 * Infrastructure concerns (settings, models, extensions, compaction,
 * bash) go through SessionResources / AgentSession instead.
 */
export interface ConversationSession {
	/** True while the focused session is actively streaming a response. */
	readonly isStreaming: boolean;
	/** Number of auto-retry attempts made on the current/last response. */
	readonly retryAttempt: number;

	/** Send a prompt to the focused session. */
	prompt(text: string, options?: PromptOptions): Promise<void>;

	/** Subscribe to events from the focused session. Returns an unsubscribe fn. */
	subscribe(listener: AgentSessionEventListener): () => void;

	/** Abort the focused session's current streaming turn. */
	abort(): Promise<void>;
}
