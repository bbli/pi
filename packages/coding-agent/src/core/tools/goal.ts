import { Type } from "typebox";
import type { ExtensionRunner } from "../extensions/runner.ts";
import { defineTool } from "../extensions/types.ts";

/**
 * Creates the set_goal built-in tool definition.
 *
 * The LLM calls this at the start of a session once it understands the user's
 * goal. Setting a goal enables the question generator and tracks progress.
 */
export function createSetGoalToolDefinition(runner: ExtensionRunner) {
	return defineTool({
		name: "set_goal",
		label: "Set Goal",
		description:
			"Set the current session goal. Call this early in the conversation once you understand " +
			"the user's objective, so progress can be tracked and blocking questions surfaced. " +
			"Pass an empty string to clear the goal.",
		promptGuidelines: [
			"When you receive a user request and understand the session's objective, consider " +
				"calling set_goal with a concise statement of that objective. This enables question " +
				"generation and goal tracking. It tends to apply for multi-step tasks with a clear " +
				"end state — debugging, investigation, implementation. It may not be needed for a " +
				"quick lookup or a one-turn clarifying question.",
			"Call set_goal at most once per distinct objective — call it again only if the user " +
				"explicitly redirects the task to a different goal.",
		],
		parameters: Type.Object({
			goal: Type.String({
				description: "The session goal, stated clearly and concisely. Pass empty string to clear.",
			}),
		}),
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const text = params.goal.trim();
			runner.setGoal(text || undefined);
			if (text) {
				ctx.ui.notify(`Goal set: ${text.slice(0, 60)}${text.length > 60 ? "\u2026" : ""}`, "info");
				return {
					content: [{ type: "text" as const, text: `Goal set: ${text}` }],
					details: undefined,
				};
			}
			ctx.ui.notify("Goal cleared.", "info");
			return {
				content: [{ type: "text" as const, text: "Goal cleared." }],
				details: undefined,
			};
		},
	});
}

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
			"Mark the current session goal as completed. Call this when the active " +
			"session goal has been fully addressed. Do not call this " +
			"speculatively — only call it when the goal is genuinely met.",
		parameters: Type.Object({}),
		execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
			if (!runner.getGoal()) {
				return {
					content: [{ type: "text" as const, text: "No active goal." }],
					details: undefined,
				};
			}
			runner.markGoalSatisfied();
			ctx.ui.notify("Goal satisfied.", "info");
			return {
				content: [{ type: "text" as const, text: "Goal marked as satisfied." }],
				details: undefined,
			};
		},
	});
}
