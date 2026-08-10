/**
 * Learning-validation subagent tool.
 *
 * Spawns a branch session with NO conversation history (seedContext: false)
 * to check whether a newly written learning is discoverable by a fresh agent.
 * The branch session inherits skills from the root resource loader (including
 * query-learnings) so it can apply the standard graph traversal, but it has
 * no memory of the /learn session that produced the learning.
 *
 * Used by Phase 5 of LEARN_ANALYSIS_PROMPT in memory.ts.
 */

import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { theme } from "../../modes/interactive/theme/theme.ts";
import type { AgentManager } from "../agent-manager.ts";
import type { AgentSession } from "../agent-session.ts";
import { runBranchSession } from "../branch-session.ts";
import { debugLog } from "../debug.ts";
import { defineTool, type ToolDefinition } from "../extensions/types.ts";

const TEST_LEARNING_SYSTEM_PROMPT = `\
# SYSTEM: LEARNING VALIDATION SUBAGENT
You are a learning-validation subagent. Your sole job is to determine whether the \
learnings graph for this project surfaces relevant knowledge when a fresh agent \
encounters the given scenario.

CRITICAL: You have no memory of prior sessions. Treat this as a clean-slate investigation.

Instructions:
1. Load and apply the \`query-learnings\` skill using the scenario as your goal.
2. Walk through the full query-learnings algorithm: ls relationships/, choose \
relevant ones, grep principles/ (two passes), sample summaries/.
3. Produce a structured findings report showing exactly what would be injected into a \
future agent session given this scenario:
   - **Relationships surfaced** — IDs, full file content
   - **Principles surfaced** — IDs, full file content
   - **Summary excerpts** — filenames and relevant passages
   - **Relevance verdict** — does the injected content directly address the scenario?
   - **Gaps** — anything that appears relevant by scenario content but was NOT surfaced, \
with a likely cause (vocabulary mismatch, no principle yet, thin citation count, etc.)
4. Do not modify any files, make commits, or spawn further subagents.
5. When your report is complete, stop immediately.`;

const TEST_LEARNING_REMINDER =
	"Reminder: complete all steps of the query-learnings skill algorithm (ls relationships/, read relevant files, grep principles/ both passes, sample summaries/) and return exactly what would be injected into a future session — the relationships, principles, and summary excerpts a real agent would receive. Then stop.";

export function makeTestLearningTool(session: AgentSession, manager: AgentManager): ToolDefinition {
	return defineTool({
		name: "testPromptResult",
		label: "Test Learning",
		description:
			"Spawn a fresh-context subagent (no conversation history) that applies the query-learnings " +
			"skill to a test scenario, validating whether a newly written learning is discoverable. " +
			"Use during /learn Phase 5 to probe each new relationship or principle.",
		promptSnippet: "testPromptResult(scenario): validate a learning against a fresh-context agent",
		promptGuidelines: [
			"Call testPromptResult only during /learn Phase 5, once per new learning written in Phase 4.",
			"Pass all test scenarios in a single turn so they run in parallel.",
			"The scenario must be self-contained — no reference to this session's history or specific files.",
		],
		parameters: Type.Object({
			scenario: Type.String({
				description:
					"A brief (1–3 sentence) self-contained prompt a future agent would naturally " +
					"receive that the new learning should inform. No session-specific references.",
			}),
		}),
		renderCall(args, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const scenario = typeof args?.scenario === "string" ? args.scenario : "";
			text.setText(
				theme.fg("toolTitle", theme.bold("testPromptResult")) +
					theme.fg("toolOutput", scenario ? `: ${scenario.slice(0, 80)}${scenario.length > 80 ? "…" : ""}` : ""),
			);
			return text;
		},
		execute: async (_toolCallId, params, signal, _onUpdate, _ctx) => {
			debugLog(`[test-learning] starting: scenario.length=${params.scenario.length}`);
			let text: string | undefined;
			try {
				text = await runBranchSession(
					`# TEST SCENARIO\n${params.scenario}`,
					{
						systemPrompt: TEST_LEARNING_SYSTEM_PROMPT,
						systemPromptOverride: false,
						tools: ["read", "grep", "find", "ls", "bash"],
						blockedTools: ["edit", "write"],
						label: "test-learning",
						seedContext: false,
						abortSignal: signal,
						injectEvery: { turns: 5, message: TEST_LEARNING_REMINDER },
					},
					session,
					manager,
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				debugLog(`[test-learning] session error: ${msg}`);
				return {
					content: [{ type: "text" as const, text: `Learning validation failed: ${msg}` }],
					details: undefined,
				};
			}
			debugLog(`[test-learning] complete, findings.length=${text?.length ?? 0}`);
			return {
				content: [
					{
						type: "text" as const,
						text:
							text ?? "(validation subagent produced no output — it may have exited without writing findings)",
					},
				],
				details: undefined,
			};
		},
	});
}
