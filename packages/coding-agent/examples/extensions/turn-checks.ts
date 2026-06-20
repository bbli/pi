/**
 * Turn Checks Extension
 *
 * Runs a read-only reviewer side-session asynchronously after each inner
 * agent turn. If the reviewer finds a violation, the result is steered into
 * the main session before the next LLM call.
 *
 * Users manage checks via the /check slash command.
 * The LLM manages checks via the manage_turn_checks tool.
 *
 * Example: register "Did you git commit after completing each step?" at the
 * start of a plan to enforce per-step commits throughout execution.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ReviewState = { status: "idle" } | { status: "running" } | { status: "done"; result: string };

export default function turnChecksExtension(pi: ExtensionAPI): void {
	let state: ReviewState = { status: "idle" };

	pi.on("turn_end", async () => {
		if (state.status === "done") {
			pi.sendUserMessage(`Have you consider the following:\n\n${state.result}`, { deliverAs: "steer" });
			state = { status: "idle" };
			return;
		}

		if (state.status === "running") return;

		const checks = pi.getTurnChecks();
		if (checks.length === 0) return;

		state = { status: "running" };
		pi.runReviewer([...checks])
			.then((result) => {
				state = result ? { status: "done", result } : { status: "idle" };
			})
			.catch(() => {
				state = { status: "idle" };
			});
	});

	pi.registerCommand("check", {
		description: "Manage turn checks: /check add <text> | remove <text> | list",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const spaceIdx = trimmed.indexOf(" ");
			const action = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
			const text =
				spaceIdx === -1
					? ""
					: trimmed
							.slice(spaceIdx + 1)
							.replace(/^"|"$/g, "")
							.trim();

			if (action === "list") {
				const checks = pi.getTurnChecks();
				ctx.ui.notify(checks.length ? checks.join("\n") : "(no checks registered)", "info");
				return;
			}

			if (action === "add") {
				if (!text) {
					ctx.ui.notify("Usage: /check add <text>", "warning");
					return;
				}
				pi.registerTurnCheck(text);
				ctx.ui.notify(`Added check: ${text}`, "info");
				return;
			}

			if (action === "remove") {
				if (!text) {
					ctx.ui.notify("Usage: /check remove <text>", "warning");
					return;
				}
				const removed = pi.removeTurnCheck(text);
				ctx.ui.notify(
					removed ? `Removed check: ${text}` : `Check not found: ${text}`,
					removed ? "info" : "warning",
				);
				return;
			}

			ctx.ui.notify("Usage: /check add <text> | remove <text> | list", "warning");
		},
	});

	pi.registerTool({
		name: "manage_turn_checks",
		label: "Manage Turn Checks",
		description:
			"Add, remove, or list per-turn invariant checks. " +
			"A reviewer side-session evaluates each check after every inner agent turn and steers feedback into the conversation if a check is violated. " +
			"Register checks at the start of a long task and remove them when the task is complete.",
		promptSnippet: "manage_turn_checks: add/remove/list per-turn reviewer checks",
		promptGuidelines: [
			"Use manage_turn_checks to register invariants that must hold after each turn (e.g. 'did you git commit after completing this step?').",
			"Register checks at the start of a multi-step plan. Remove them when the plan is complete.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("add"), Type.Literal("remove"), Type.Literal("list")], {
				description: "Operation to perform",
			}),
			check: Type.Optional(Type.String({ description: "The check text (required for add and remove)" })),
		}),
		execute: async (_id, params) => {
			if (params.action === "list") {
				const checks = pi.getTurnChecks();
				return {
					content: [{ type: "text", text: checks.join("\n") || "(no checks registered)" }],
					details: undefined,
				};
			}

			if (params.action === "add") {
				if (!params.check) {
					return {
						content: [{ type: "text", text: "check is required for action=add" }],
						isError: true,
						details: undefined,
					};
				}
				pi.registerTurnCheck(params.check);
				return { content: [{ type: "text", text: `Added check: ${params.check}` }], details: undefined };
			}

			if (params.action === "remove") {
				if (!params.check) {
					return {
						content: [{ type: "text", text: "check is required for action=remove" }],
						isError: true,
						details: undefined,
					};
				}
				const removed = pi.removeTurnCheck(params.check);
				return {
					content: [
						{
							type: "text",
							text: removed ? `Removed check: ${params.check}` : `Check not found: ${params.check}`,
						},
					],
					isError: !removed,
					details: undefined,
				};
			}

			return { content: [{ type: "text", text: "Invalid action" }], isError: true, details: undefined };
		},
	});
}
