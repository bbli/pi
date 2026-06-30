/**
 * Research subagent tool.
 *
 * Spawns a branch session with all standard file/shell tools (read, grep,
 * find, ls, bash) to investigate a question and return structured findings.
 * The branch session is registered in SubagentRegistry while running, making
 * it visible in the TUI footer and switchable via /agent.
 *
 * History seeding is opt-in (seedHistory param) — the research question is
 * usually self-contained and seeding the full main-session history wastes tokens.
 */

import { Type } from "typebox";
import type { AgentSession } from "../agent-session.ts";
import { defineTool, type ToolDefinition } from "../extensions/types.ts";
import type { SubagentRegistry } from "../subagent-registry.ts";

export function makeResearchTool(session: AgentSession, registry: SubagentRegistry): ToolDefinition {
	return defineTool({
		name: "research",
		label: "Research",
		description:
			"[STUB] Spawn a subagent to research a question using read, grep, find, ls, and bash. " +
			"Returns structured findings. Not yet implemented.",
		promptSnippet: "research(question, seedHistory?): investigate a codebase question and return findings",
		parameters: Type.Object({
			question: Type.String({
				description: "The question or topic to research.",
			}),
			seedHistory: Type.Optional(
				Type.Boolean({
					description:
						"If true, seed the research session with the full conversation history. " +
						"Use when the question references prior context. Default false.",
					default: false,
				}),
			),
		}),
		execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => {
			// Stub — real implementation added in Step 2.
			void session;
			void registry;
			return {
				content: [{ type: "text" as const, text: "[research stub — not yet implemented]" }],
				details: undefined,
			};
		},
	});
}
