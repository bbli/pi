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
import { runBranchSession } from "../branch-session.ts";
import { debugLog } from "../debug.ts";
import { defineTool, type ToolDefinition } from "../extensions/types.ts";
import type { SubagentRegistry } from "../subagent-registry.ts";

const RESEARCH_SYSTEM_PROMPT = `\
You are a research subagent. Your sole job is to investigate a question about the \
codebase and return structured findings to the main session.

Guidelines:
- Use read, grep, find, ls, and bash to investigate thoroughly.
- Produce a focused, structured report: relevant file paths, key code snippets \
(with line numbers), and a clear conclusion that directly answers the question.
- Do not make any edits, commits, or other side-effecting operations.
- Do not spawn further subagents or advisory sessions.
- When you have enough information to answer the question, stop immediately and \
write your findings. Do not over-investigate.`;

export function makeResearchTool(session: AgentSession, registry: SubagentRegistry): ToolDefinition {
	return defineTool({
		name: "research",
		label: "Research",
		description:
			"Spawn a subagent to investigate a question about the codebase using read, grep, find, ls, " +
			"and bash. Returns structured findings: relevant file paths, key code snippets, and a conclusion. " +
			"Use this when you need to look something up before acting, or when the answer requires " +
			"exploring multiple files. Do not use for simple single-file reads.",
		promptSnippet: "research(question, seedHistory?): investigate a codebase question and return structured findings",
		promptGuidelines: [
			"Use the research tool to explore the codebase before making changes when the answer is not obvious.",
			"Pass seedHistory: true only when the question explicitly references the current conversation.",
		],
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
		execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
			debugLog(
				`[research] starting: question.length=${params.question.length} seedHistory=${params.seedHistory ?? false}`,
			);
			let text: string | undefined;
			try {
				text = await runBranchSession(
					params.question,
					{
						systemPrompt: RESEARCH_SYSTEM_PROMPT,
						tools: ["read", "grep", "find", "ls", "bash"],
						label: "research",
						seedContext: params.seedHistory === true,
					},
					session,
					registry,
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				debugLog(`[research] session error: ${msg}`);
				return {
					content: [{ type: "text" as const, text: `Research failed: ${msg}` }],
					details: undefined,
				};
			}
			debugLog(`[research] complete, findings.length=${text?.length ?? 0}`);
			return {
				content: [{ type: "text" as const, text: text ?? "(no findings returned)" }],
				details: undefined,
			};
		},
	});
}
