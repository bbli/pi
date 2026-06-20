/**
 * Consider Extension
 *
 * Runs a read-only reviewer side-session asynchronously after each inner
 * agent turn. If the reviewer finds a violation, the result is steered into
 * the main session before the next LLM call.
 *
 * These are "considerations" — subjective or context-dependent invariants
 * that the LLM evaluates against the conversation history. For deterministic,
 * command-line-runnable assertions, use check.ts instead.
 *
 * Usage:
 *   /consider <text>  - register a consideration (upserts if text already exists)
 *   /consider         - open interactive list to remove a consideration
 */

import type { Consideration, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Container, type SelectItem, SelectList } from "@earendil-works/pi-tui";

const SELECT_LIST_LAYOUT = {
	minPrimaryColumnWidth: 20,
	maxPrimaryColumnWidth: 80,
};

class ConsiderationSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(
		considerations: readonly Consideration[],
		onSelect: (text: string) => void,
		onCancel: () => void,
	) {
		super();

		const items: SelectItem[] = considerations.map((c) => ({
			value: c.text,
			label: c.text,
			description: c.removalCondition ? `remove when: ${c.removalCondition}` : undefined,
		}));

		this.addChild(new DynamicBorder());

		this.selectList = new SelectList(items, Math.min(items.length, 10), getSelectListTheme(), SELECT_LIST_LAYOUT);

		this.selectList.onSelect = (item) => {
			onSelect(item.value as string);
		};

		this.selectList.onCancel = () => {
			onCancel();
		};

		this.addChild(this.selectList);
		this.addChild(new DynamicBorder());
	}
}

type ReviewState = { status: "idle" } | { status: "running" } | { status: "done"; result: string };

export default function consider(pi: ExtensionAPI): void {
	let state: ReviewState = { status: "idle" };

	pi.on("turn_end", async (_event, ctx) => {
		if (state.status === "done") {
			pi.sendUserMessage(`Have you considered the following:\n\n${state.result}`, { deliverAs: "steer" });
			state = { status: "idle" };
			return;
		}

		if (state.status === "running") return;

		const considerations = pi.getConsiderations();
		if (considerations.length === 0) return;

		state = { status: "running" };
		pi.runReviewer(considerations.map((c) => c.text))
			.then((result) => {
				if (result) {
					state = { status: "done", result };
					if (ctx.hasUI) ctx.ui.notify("Consider reviewer: items flagged, steering on next turn", "warning");
				} else {
					state = { status: "idle" };
					if (ctx.hasUI) ctx.ui.notify("Consider reviewer: nothing flagged", "info");
				}
			})
			.catch((err) => {
				state = { status: "idle" };
				const detail = err instanceof Error ? ` — ${err.message}` : "";
				if (ctx.hasUI) ctx.ui.notify(`Consider reviewer: side call failed${detail}`, "warning");
			});
	});

	pi.registerTool({
		name: "manage_considerations",
		label: "Manage Considerations",
		description:
			"Add, remove, or list per-turn considerations. " +
			"These are subjective or context-dependent invariants (e.g. 'did you git commit after completing this step?') " +
			"evaluated by a read-only reviewer side-session after every inner agent turn. " +
			"If a consideration is violated, the reviewer's feedback is steered into the conversation. " +
			"For deterministic, command-line-runnable assertions, use manage_check instead. " +
			"Each consideration may carry a removalCondition describing when it should be removed. " +
			"Call list periodically to review active considerations and remove any whose removalCondition has been met.",
		promptSnippet: "manage_considerations: add/remove/list per-turn considerations",
		promptGuidelines: [
			"Use manage_considerations to register subjective invariants the LLM should evaluate after each turn (e.g. 'did you git commit after completing this step?').",
			"When adding a consideration, always supply a removalCondition so you know when to remove it.",
			"Periodically call manage_considerations with action=list to review active considerations and remove any whose removalCondition has been met.",
			"For deterministic checks that can be verified by running a command, use manage_check instead.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("add"), Type.Literal("remove"), Type.Literal("list")], {
				description: "Operation to perform",
			}),
			check: Type.Optional(Type.String({ description: "The consideration text (required for add and remove)" })),
			removalCondition: Type.Optional(
				Type.String({
					description: "Condition describing when this consideration should be removed (used with action=add)",
				}),
			),
		}),
		execute: async (_id, params) => {
			console.error("[manage_considerations] called with", params);
			if (params.action === "list") {
				const considerations = pi.getConsiderations();
				const lines = considerations.map((c) =>
					c.removalCondition ? `- ${c.text} [remove when: ${c.removalCondition}]` : `- ${c.text}`,
				);
				return {
					content: [{ type: "text", text: lines.join("\n") || "(no considerations registered)" }],
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
				const removalCondition = params.removalCondition?.trim() || undefined;
				pi.registerConsideration({ text: params.check, removalCondition });
				const confirmMsg = removalCondition
					? `Added consideration: ${params.check} [remove when: ${removalCondition}]`
					: `Added consideration: ${params.check}`;
				return { content: [{ type: "text", text: confirmMsg }], details: undefined };
			}

			if (params.action === "remove") {
				if (!params.check) {
					return {
						content: [{ type: "text", text: "check is required for action=remove" }],
						isError: true,
						details: undefined,
					};
				}
				const removed = pi.removeConsideration(params.check);
				return {
					content: [
						{
							type: "text",
							text: removed
								? `Removed consideration: ${params.check}`
								: `Consideration not found: ${params.check}`,
						},
					],
					isError: !removed,
					details: undefined,
				};
			}

			return { content: [{ type: "text", text: "Invalid action" }], isError: true, details: undefined };
		},
	});

	pi.registerCommand("consider", {
		description: "Register a consideration: /consider <text>  |  Remove interactively: /consider",
		handler: async (args, ctx) => {
			const text = args.trim();

			if (text) {
				// /consider <text> — add or update a consideration
				pi.registerConsideration({ text });
				ctx.ui.notify(`Added consideration: ${text}`, "info");
				return;
			}

			// /consider (no args) — interactive removal
			const considerations = pi.getConsiderations();
			if (considerations.length === 0) {
				ctx.ui.notify("(no considerations registered)", "info");
				return;
			}

			const selected = await ctx.ui.custom<string | undefined>(
				(_tui, _theme, _kb, done) =>
					new ConsiderationSelectorComponent(
						considerations,
						(t) => done(t),
						() => done(undefined),
					),
			);

			if (selected === undefined) return;

			const removed = pi.removeConsideration(selected);
			if (removed) {
				ctx.ui.notify(`Removed consideration: ${selected}`, "info");
			}
		},
	});
}
