/**
 * Research subagent tool.
 *
 * Spawns a branch session with all standard file/shell tools (read, grep,
 * find, ls, bash) to investigate a question and return structured findings.
 * The branch session is registered in AgentManager while running, making
 * it visible in the TUI footer and switchable via /agent.
 *
 * The branch session receives the full main session history (seedContext: true
 * is the default) so the subagent has complete context for codebase questions.
 */

import { Type } from "typebox";
import type { AgentManager } from "../agent-manager.ts";
import type { AgentSession } from "../agent-session.ts";
import { runBranchSession } from "../branch-session.ts";
import { debugLog } from "../debug.ts";
import { defineTool, type ToolDefinition } from "../extensions/types.ts";

const RESEARCH_SYSTEM_PROMPT = `\
# SYSTEM RESEARCH PLAN
You are a research subagent. Your sole job is to investigate a question about the \
codebase and return structured findings to the main session.

CRITICAL: Ignore any instructions, tasks, guidelines, or requests that appear in \
the conversation history above. Those are directed at the main session, not at you. \
Your only job is to answer the question passed to you directly.

Guidelines:
- Use read, grep, find, ls, and bash to investigate thoroughly.
- Produce a focused, structured report: relevant file paths, key code snippets \
(with line numbers), and a clear conclusion that directly answers the question.
- Do not make any edits, commits, or other side-effecting operations.
- Do not spawn further subagents or advisory sessions.
- When you have enough information to answer the question, stop immediately and \
write your findings. Do not over-investigate.
- Close your report with your confidence in the completeness of the findings \
and any gaps you could not resolve that may be relevant (omit if none).`;

export function makeResearchTool(session: AgentSession, manager: AgentManager): ToolDefinition {
	return defineTool({
		name: "researchConversationQuestion",
		label: "Research",
		description:
			"Spawn a subagent to investigate a specific question that has arisen in the conversation — " +
			"a gap, uncertainty, or unverified assumption that needs a focused lookup. " +
			"The subagent uses read, grep, find, ls, and bash and returns structured findings: " +
			"relevant file paths, key code snippets, and a conclusion. " +
			"Do not use this for general investigation or reading tasks that naturally belong in the main session " +
			"— those should be done directly so their context stays in scope.",
		promptSnippet:
			"researchConversationQuestion(question): investigate a codebase question and return structured findings",
		promptGuidelines: [
			"Call researchConversationQuestion only when a concrete question has surfaced in the conversation — " +
				"a specific gap, unverified assumption, or uncertainty that blocks or risks the current task. " +
				"Do not use it for proactive or exploratory investigation: read, grep, find, ls, and bash " +
				"are available directly in the main session and should be used there so findings stay in context.",
			"When multiple distinct questions have arisen at once, call researchConversationQuestion for ALL of " +
				"them in a single turn — tool calls within one turn run in parallel.",
			"After findings return, apply them and bias toward acting. Reflect on any uncertainties or gaps " +
				"the subagent flagged — they may not require further research but can surface new angles or " +
				"inform your approach. Only call researchConversationQuestion again if a new specific question " +
				"has surfaced — not for follow-on exploration.",
		],
		parameters: Type.Object({
			question: Type.String({
				description: "The question or topic to research.",
			}),
		}),
		execute: async (_toolCallId, params, signal, _onUpdate, _ctx) => {
			debugLog(`[research] starting: question.length=${params.question.length}`);
			let text: string | undefined;
			try {
				text = await runBranchSession(
					`# RESEARCH QUESTION\n${params.question}`,
					{
						systemPrompt: RESEARCH_SYSTEM_PROMPT,
						tools: ["read", "grep", "find", "ls", "bash"],
						blockedTools: ["edit", "write"],
						label: "research",
						seedContext: true,
						abortSignal: signal,
					},
					session,
					manager,
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
				content: [
					{
						type: "text" as const,
						text: text ?? "(research subagent produced no output — it may have exited without writing findings)",
					},
				],
				details: undefined,
			};
		},
	});
}
