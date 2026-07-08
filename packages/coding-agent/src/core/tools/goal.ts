import { Type } from "typebox";
import type { ExtensionRunner } from "../extensions/runner.ts";
import { defineTool } from "../extensions/types.ts";

/**
 * Creates the goal_satisfied built-in tool definition.
 *
 * The tool is always registered in the main agent's tool list. The LLM calls it
 * when it determines that the active session goal (set via /goal) has been fully
 * addressed. Calling it clears the goal and stops re-injection at agent_end.
 */
export function createGoalSatisfiedToolDefinition(runner: ExtensionRunner) {
	return defineTool({
		name: "goal_satisfied",
		label: "Goal Satisfied",
		description:
			"Mark the current session goal as completed. Call this when the goal " +
			"injected via [GOAL] has been fully addressed. Do not call this " +
			"speculatively — only call it when the goal is genuinely met.",
		parameters: Type.Object({}),
		execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => {
			runner.markGoalSatisfied();
			return {
				content: [{ type: "text" as const, text: "Goal marked as satisfied." }],
				details: undefined,
			};
		},
	});
}
