/**
 * OS Agent Extension
 *
 * Registers the built-in advisory guidelines and continuations.
 *
 * Guidelines (evaluated at turn_start, async):
 *   - code-workflow: inject coding workflow instructions when a feature is requested
 *   - debug-workflow: inject debugging workflow instructions when a bug fix is requested
 *
 * Continuations (evaluated at agent_end, sync):
 *   - review-after-commit: inject a review checklist after a git commit
 *
 * The advisory system can be toggled at runtime via /advisor [on|off].
 * Pass --no-advisor on the CLI to start with it disabled.
 *
 * Each inject prompt begins with an [ADVISORY: ID] sentinel that:
 * - Identifies the message as coming from a background monitor
 * - Gives the main agent explicit discretion to follow or ignore it
 * - Provides an idempotency skip condition for the main agent
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Inject prompts
// Each begins with an [ADVISORY: ID] sentinel that identifies the source,
// grants the main agent discretion, and carries an idempotency skip condition.
// ---------------------------------------------------------------------------

const CODE_WORKFLOW_PROMPT = `\
[ADVISORY: CODE_WORKFLOW — injected by a background monitor. Decide for yourself \
whether this is relevant to your current task; you are not required to follow it. \
Skip if you have already received and are acting on these instructions.]

You are about to implement a feature. Before writing any code:

1. Restate the request in your own words to confirm your understanding.
2. Identify knowledge gaps — anything you need to understand about the existing \
codebase. Research them using available tools.
3. Implement step by step, committing after each logical unit of work.
4. Run npm run check after each change and fix all errors before moving on.
5. Stay on the happy path — do not attempt to fix unrelated issues you encounter.`;

const DEBUG_WORKFLOW_PROMPT = `\
[ADVISORY: DEBUG_WORKFLOW — injected by a background monitor. Decide for yourself \
whether this is relevant to your current task; you are not required to follow it. \
Skip if you have already received and are acting on these instructions.]

You are about to debug an issue. Before making any changes:

1. Reproduce the problem — confirm you can see the failure.
2. Form a hypothesis about the root cause.
3. Verify the hypothesis by reading the relevant code (do not guess).
4. Apply the minimal fix.
5. Confirm the failure no longer occurs, then run npm run check.`;

const REVIEW_PROMPT = `\
[ADVISORY: CODE_REVIEW — injected by a background monitor. Decide for yourself \
whether this checklist is relevant to the commit just made; you are not required to follow it. \
Skip if a review for this commit has already been completed.]

A commit was just made. Before considering this task done:

1. Run npm run check — fix any remaining errors or warnings.
2. Re-read the original request and confirm the implementation matches it fully.
3. Check for missing error handling or edge cases.
4. Confirm all relevant files are committed.`;

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// /advisor TUI component
// ---------------------------------------------------------------------------

class AdvisoryStatusComponent extends Container {
	private settingsList: SettingsList;

	constructor(pi: ExtensionAPI, onClose: () => void) {
		super();

		const guidelines = pi.getGuidelines();
		const continuations = pi.getContinuations();

		const items: SettingItem[] = [
			{
				id: "system",
				label: "Advisory System",
				currentValue: pi.getAdvisoryEnabled() ? "enabled" : "disabled",
				values: ["enabled", "disabled"],
				description:
					"Toggle the advisory system on or off. When disabled, no guidelines " +
					"or continuations are evaluated.",
			},
			...guidelines.map((g) => ({
				id: `guideline:${g.id}`,
				label: g.id,
				currentValue: "guideline",
				description: `Trigger: ${g.triggerPrompt}`,
			})),
			...continuations.map((c) => ({
				id: `continuation:${c.id}`,
				label: c.id,
				currentValue: "continuation",
				description: `Trigger: ${c.triggerPrompt}`,
			})),
		];

		this.settingsList = new SettingsList(
			items,
			Math.min(items.length + 2, 12),
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "system") {
					pi.setAdvisoryEnabled(newValue === "enabled");
				}
			},
			onClose,
		);

		this.addChild(new DynamicBorder());
		this.addChild(this.settingsList);
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		this.settingsList.handleInput(data);
	}
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function osAgent(pi: ExtensionAPI): void {
	// --- Guidelines (turn_start, async) ---

	pi.registerGuideline({
		id: "code-workflow",
		triggerPrompt:
			"Is the user starting a new feature implementation task that hasn't already received " +
			"coding workflow guidance in the recent conversation? " +
			"The user's latest message should be requesting new feature work " +
			'(e.g. "implement X", "add Y", "build Z"). ' +
			"Use your judgment: if this looks like a fresh implementation request that hasn't " +
			"been covered by a recent [ADVISORY: CODE_WORKFLOW] message, trigger. " +
			"If the conversation already has workflow guidance covering this task, do not trigger.",
		injectPrompt: CODE_WORKFLOW_PROMPT,
		label: "advisory:code-workflow",
	});

	pi.registerGuideline({
		id: "debug-workflow",
		triggerPrompt:
			"Is the user starting a new debugging or bug-fix task that hasn't already received " +
			"debugging workflow guidance in the recent conversation? " +
			"Use your judgment: if this looks like a fresh debugging request that hasn't " +
			"been covered by a recent [ADVISORY: DEBUG_WORKFLOW] message, trigger. " +
			"If the conversation already has debug guidance covering this task, do not trigger.",
		injectPrompt: DEBUG_WORKFLOW_PROMPT,
		label: "advisory:debug-workflow",
	});

	// --- Continuations (agent_end, sync) ---

	pi.registerContinuation({
		id: "review-after-commit",
		triggerPrompt:
			"Was a git commit made during this agent run that has not yet been followed by a code review? " +
			"Find the most recent successful git commit in the tool call results. " +
			"Then check whether a [ADVISORY: CODE_REVIEW] review checklist has appeared in the " +
			"conversation AFTER that specific commit. " +
			"Use your judgment: if the commit is recent and no review has followed it yet, trigger. " +
			"If a review has already been conducted for this specific commit, do not trigger.",
		injectPrompt: REVIEW_PROMPT,
		label: "advisory:review",
	});

	// --- /advisor command ---

	pi.registerCommand("advisor", {
		description:
			"Show advisory system status and registered guidelines/continuations. " +
			"Toggle: /advisor on | /advisor off",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") {
				pi.setAdvisoryEnabled(true);
				ctx.ui.notify("[advisory] enabled", "info");
				return;
			}
			if (arg === "off") {
				pi.setAdvisoryEnabled(false);
				ctx.ui.notify("[advisory] disabled", "warning");
				return;
			}
			await ctx.ui.custom<void>((_tui, _theme, _kb, done) => new AdvisoryStatusComponent(pi, done));
		},
	});

	// --- Startup logging (fires after bindCore, so advisory API is live) ---

	pi.on("session_start", (_, ctx) => {
		const guidelines = pi.getGuidelines();
		const continuations = pi.getContinuations();
		console.error(
			`[advisory] registered ${guidelines.length} guideline(s), ${continuations.length} continuation(s)`,
		);

		// Apply --no-advisor flag if set.
		if (pi.getFlag("no-advisor") === true) {
			pi.setAdvisoryEnabled(false);
			console.error("[advisory] disabled via --no-advisor flag");
			if (ctx.hasUI) ctx.ui.notify("[advisory] disabled via --no-advisor", "warning");
		}
	});

	// --- CLI flags ---

	pi.registerFlag("no-advisor", {
		description: "Disable the advisory system on startup",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("keep-branch-sessions", {
		description: "Keep branch sessions alive after completion (skip dispose) for debugging",
		type: "boolean",
		default: false,
	});
}
