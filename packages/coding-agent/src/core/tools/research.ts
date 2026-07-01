/**
 * Research subagent tool.
 *
 * Spawns a branch session with all standard file/shell tools (read, grep,
 * find, ls, bash) to investigate a question and return structured findings.
 * The branch session is registered in SubagentRegistry while running, making
 * it visible in the TUI footer and switchable via /agent.
 *
 * History seeding is always enabled so the subagent has full context from the
 * main session.
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
write your findings. Do not over-investigate.
- End your report with two explicit lines: (1) whether the findings are \
sufficient for the main session to act on the question, and (2) any unknowns \
you could not resolve that may still be relevant.`;

export function makeResearchTool(session: AgentSession, registry: SubagentRegistry): ToolDefinition {
	return defineTool({
		name: "research",
		label: "Research",
		description:
			"Spawn a subagent to investigate a question about the codebase using read, grep, find, ls, " +
			"and bash. Returns structured findings: relevant file paths, key code snippets, and a conclusion. " +
			"Use this when you need to look something up before acting, or when the answer requires " +
			"exploring multiple files. Do not use for simple single-file reads.",
		promptSnippet: "research(question): investigate a codebase question and return structured findings",
		promptGuidelines: [
			"Research is most useful when exploring unfamiliar codebase territory across " +
				"multiple files where inline exploration would consume significant context. " +
				"It is less warranted when the relevant file is already open, a single read " +
				"would suffice, or bash can answer in one command.",
			"Before invoking research, enumerate all open questions for the current task " +
				"and research them together rather than one at a time.",
			"After research returns findings, apply them to the task at hand and bias " +
				"toward acting. Only invoke research again if a specific remaining gap would " +
				"cause a concrete mistake — not for exploratory or derivative follow-on questions.",
		],
		parameters: Type.Object({
			question: Type.String({
				description: "The question or topic to research.",
			}),
		}),
		execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
			// Note: _signal is not forwarded to runBranchSession. Aborting the main session
			// while research is running will not interrupt the subagent — the main turn
			// remains blocked until the branch session completes.
			// TODO: add timeoutMs to BranchSessionOptions to bound long-running sessions.
			debugLog(`[research] starting: question.length=${params.question.length}`);
			let text: string | undefined;
			try {
				text = await runBranchSession(
					params.question,
					{
						systemPrompt: RESEARCH_SYSTEM_PROMPT,
						tools: ["read", "grep", "find", "ls", "bash"],
						label: "research",
						seedContext: true,
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
