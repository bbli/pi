/**
 * OS Agent Extension
 *
 * Runs a single synchronous branch session before every user prompt.
 * That session evaluates ALL registered considerations — including the
 * built-in CODE_WORKFLOW_CONSIDERATION — and optionally calls injectMessage
 * to prepend a workflow prompt.
 *
 * consider.ts owns the UI for registering/removing user considerations.
 * os-agent.ts owns the evaluation and injection logic.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Workflow prompts
// ---------------------------------------------------------------------------

const CODE_WORKFLOW_PROMPT = `\
You are about to implement a feature. Before writing any code, follow this workflow:

1. Restate the feature request in your own words to confirm your understanding.
2. Identify knowledge gaps — anything you need to understand about the existing \
codebase before you can implement correctly. Call askQuestions() with these gaps.
3. Wait for answers before proceeding.
4. Implement step by step, committing after each logical unit of work.
5. Run npm run check after each change and fix all errors before moving on.
6. Stay on the happy path — do not attempt to fix unrelated issues you encounter.`;

// ---------------------------------------------------------------------------
// Built-in consideration
// ---------------------------------------------------------------------------

const CODE_WORKFLOW_CONSIDERATION = `\
If the user's latest message clearly indicates they want to implement a new feature \
(e.g. "implement X", "add feature Y", "build Z", "create a ..."), call injectMessage \
with the following prompt exactly:\n\n${CODE_WORKFLOW_PROMPT}`;

// ---------------------------------------------------------------------------
// Branch session system prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `\
You are a pre-run assistant. Before a coding agent processes a user message you have \
two responsibilities:

1. INJECT: If a consideration instructs you to call injectMessage, do so when its \
condition is met. The agent will see the injected message before the user's message.
2. EVALUATE: For all other considerations, check whether they are violated. If any \
are, describe the finding concisely as your text response.

Available tool: injectMessage — call it at most once with the exact prompt to inject.
Use read, grep, find, ls, bash only if you need to inspect the codebase to answer a \
consideration.

Rules:
- Output text only if there is a genuine finding. Output nothing if all is well.
- Do not explain your reasoning. Do not greet the user.`;

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function osAgent(pi: ExtensionAPI): void {
	// Register the built-in implementation workflow consideration.
	// It lives alongside user considerations so the single branch session
	// can evaluate everything in one pass.
	pi.registerConsideration({
		text: CODE_WORKFLOW_CONSIDERATION,
		removalCondition: "never — built-in OS agent consideration",
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const considerations = pi.getConsiderations();
		const start = Date.now();

		console.error(
			`[os-agent] before_agent_start: prompt="${event.prompt.slice(0, 80)}" considerations=${considerations.length}`,
		);

		let injectedPrompt: string | undefined;

		const prompt = [
			`The user's latest message is:`,
			`"${event.prompt}"`,
			``,
			`Considerations to evaluate:`,
			...considerations.map((c, i) => `${i + 1}. ${c.text}`),
			``,
			`For any consideration that instructs you to call injectMessage: do so if its \
condition is met. For all other considerations: report findings as text if violated. \
If nothing requires action, output nothing.`,
		].join("\n");

		const result = await pi.runBranchSession(prompt, {
			systemPrompt: SYSTEM_PROMPT,
			tools: ["read", "grep", "find", "ls", "bash"],
			customTools: [
				{
					name: "injectMessage",
					label: "Inject Message",
					description:
						"Inject a message that will be prepended before the user's message for this turn.",
					parameters: Type.Object({
						prompt: Type.String({ description: "The exact message content to inject." }),
					}),
					execute: async (_id, params) => {
						injectedPrompt = params.prompt;
						return { content: [{ type: "text", text: "Injection queued." }] };
					},
				},
			],
			label: "os-agent",
		});

		console.error(
			`[os-agent] before_agent_start done: elapsed=${Date.now() - start}ms inject=${!!injectedPrompt} finding=${!!result}`,
		);

		// Combine injection + finding into a single prepended message.
		let prependContent: string | undefined;
		if (injectedPrompt && result) {
			prependContent = `${injectedPrompt}\n\n---\n\nBefore responding, also address:\n\n${result}`;
		} else if (injectedPrompt) {
			prependContent = injectedPrompt;
		} else if (result) {
			prependContent = `Before responding, address the following:\n\n${result}`;
		}

		if (!prependContent) return;

		if (ctx.hasUI) {
			const msg = injectedPrompt ? "[os-agent] injecting workflow prompt" : "[os-agent] consideration flagged";
			ctx.ui.notify(msg, injectedPrompt ? "info" : "warning");
		}
		return { prependUserMessage: prependContent };
	});
}
