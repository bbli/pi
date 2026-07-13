/**
 * injectMessage tool — lets a spawned user-subagent steer a message back
 * into the root (main) session.
 *
 * Added as a builtin tool by AgentManager.spawn() so every user-kind subagent
 * can surface learnings or observations to the main agent without the user
 * having to manually relay them.
 */

import { Type } from "typebox";
import type { AgentSession } from "../agent-session.ts";
import { debugLog } from "../debug.ts";
import { defineTool, type ToolDefinition } from "../extensions/types.ts";

export function makeInjectMessageTool(rootSession: AgentSession, label: string): ToolDefinition {
	return defineTool({
		name: "injectMessage",
		label: "Inject Message",
		description:
			"Send a message or learning back to the main session as a steering message. " +
			"Use this to surface key findings, conclusions, or important observations " +
			"from this side conversation to the main agent.",
		promptSnippet: "injectMessage(message): send a learning or observation back to the main session",
		promptGuidelines: [
			"Use injectMessage to send a specific, self-contained finding or conclusion back to the " +
				"main session — not ongoing commentary. Call it once when you have a clear result to share.",
		],
		parameters: Type.Object({
			message: Type.String({
				description: "The text to inject into the main session as a user observation.",
			}),
		}),
		execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
			if (!params.message.trim()) {
				return {
					content: [{ type: "text" as const, text: "error: message must not be empty" }],
					details: undefined,
				};
			}
			const text = `[User observation from ${label}: ${params.message}]`;
			const via = rootSession.isStreaming ? "steer" : "sendUserMessage";
			debugLog(`[injectMessage] via=${via} chars=${text.length}`);
			if (rootSession.isStreaming) {
				await rootSession.steer(text);
			} else {
				await rootSession.sendUserMessage(text);
			}
			return { content: [{ type: "text" as const, text: "injected" }], details: undefined };
		},
	});
}
