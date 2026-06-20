/**
 * Check Guard Extension
 *
 * Registers a bash command that runs after every agent run. If the command
 * exits non-zero, the last N lines of output are fed back to the agent as a
 * follow-up user message so it can iterate and fix the problem.
 *
 * Usage:
 *   /check npm run check   - register a check command
 *   /check                 - clear the registered command
 *
 * The check runs after each full agent run (agent_end). If it fails, the
 * agent is given the error output and asked to fix it. A retry cap prevents
 * infinite loops.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_RETRIES = 3;
// Lines of non-empty output from the failed command to feed back to the agent.
// Blank lines are excluded from the count, so actual content may span more raw lines.
const TAIL_LINES = 20;
const CHECK_TIMEOUT_MS = 30 * 60 * 1000;

export default function checkGuard(pi: ExtensionAPI) {
	let checkCommand: string | null = null;
	let retryCount = 0;
	// True when agent_start fires as a continuation of our own followUp injection,
	// not as a fresh user-initiated run. Prevents resetting retryCount mid-loop.
	let pendingRetry = false;

	pi.on("agent_start", () => {
		if (!pendingRetry) {
			retryCount = 0;
		}
		pendingRetry = false;
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!checkCommand) return;

		const result = await pi.exec("sh", ["-c", checkCommand], { cwd: ctx.cwd, timeout: CHECK_TIMEOUT_MS });

		if (result.killed) {
			if (ctx.hasUI) {
				ctx.ui.notify(`/check: command timed out after ${CHECK_TIMEOUT_MS / 1000}s`, "warning");
			}
			return;
		}

		if (result.code === 0) {
			retryCount = 0;
			return;
		}

		if (retryCount >= MAX_RETRIES) {
			retryCount = 0;
			if (ctx.hasUI) {
				ctx.ui.notify(`/check: max retries (${MAX_RETRIES}) reached for \`${checkCommand}\``, "warning");
			}
			return;
		}

		retryCount++;
		pendingRetry = true;

		const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
		const tail = combined
			.split("\n")
			.filter((l) => l.length > 0)
			.slice(-TAIL_LINES)
			.join("\n");

		pi.sendUserMessage(
			`\`${checkCommand}\` failed (exit ${result.code}, attempt ${retryCount}/${MAX_RETRIES}):\n\`\`\`\n${tail}\n\`\`\`\nFix the errors above.`,
			{ deliverAs: "followUp" },
		);
	});

	pi.registerCommand("check", {
		description:
			"Register a bash command to run after each agent run. Agent iterates if it fails. No args clears it.",
		handler: async (args, ctx) => {
			const cmd = args.trim();
			if (!cmd) {
				checkCommand = null;
				retryCount = 0;
				pendingRetry = false;
				if (ctx.hasUI) {
					ctx.ui.notify("/check cleared", "info");
				}
				return;
			}
			checkCommand = cmd;
			retryCount = 0;
			pendingRetry = false;
			if (ctx.hasUI) {
				ctx.ui.notify(`/check registered: \`${cmd}\``, "info");
			}
		},
	});
}
