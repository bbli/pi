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
		name: "researchConversationPoint",
		label: "Research",
		description:
			"Spawn a subagent to investigate a question, implementation uncertainty, or candidate behavior/edge case " +
			"about the codebase using read, grep, find, ls, and bash. " +
			"Returns structured findings: relevant file paths, key code snippets, and a conclusion. " +
			"Invoke when: (1) an injected advisory or guideline requests it, " +
			"(2) an uncertainty is rated 🔴 CRITICAL or 🟠 LOW in the Code Workflow Prompt, or " +
			"(3) a candidate behavior or edge case from the System Fleshing Out Prompt needs codebase investigation.",
		promptSnippet:
			"researchConversationPoint(question): investigate a codebase question, uncertainty, or candidate behavior/edge case and return structured findings",
		promptGuidelines: [
			"Invoke researchConversationPoint in three situations: " +
				"(1) when an injected advisory or guideline explicitly requests it; " +
				"(2) to resolve an implementation uncertainty rated 🔴 CRITICAL or 🟠 LOW in the " +
				"Code Workflow Prompt's ⚠️ IMPLEMENTATION UNCERTAINTIES table — the Code Workflow Prompt " +
				"instructs you to resolve those before implementing, and this tool is the mechanism; " +
				"(3) to investigate a specific candidate behavior or edge case surfaced by the " +
				"System Fleshing Out Prompt when concrete codebase evidence is needed to assess " +
				"its scope, feasibility, or risk. " +
				"Do not invoke it on your own initiative beyond these three triggers — " +
				"explore the codebase directly in the main session using read, bash, grep, and find instead.",
			"When you have multiple distinct points to research, call researchConversationPoint for ALL of " +
				"them in a single turn — do not call it sequentially across multiple turns. " +
				"Tool calls within one turn run in parallel, so batching all points into one turn is faster " +
				"than issuing them one at a time.",
			"After researchConversationPoint returns findings, apply them to the task at hand and bias " +
				"toward acting. Also reflect on any uncertainties or gaps the subagent flagged — " +
				"they may not apply directly but can surface new angles or inform your approach. " +
				"Only invoke researchConversationPoint again if a specific remaining gap would cause a concrete " +
				"mistake — not for exploratory or derivative follow-on questions.",
		],
		parameters: Type.Object({
			question: Type.String({
				description: "The question, uncertainty, or candidate behavior/edge case to investigate.",
			}),
		}),
		execute: async (_toolCallId, params, signal, _onUpdate, _ctx) => {
			debugLog(`[research] starting: question.length=${params.question.length}`);
			let text: string | undefined;
			try {
				text = await runBranchSession(
					params.question,
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
