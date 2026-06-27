/**
 * OS Agent Extension
 *
 * Core orchestration framework. Hooks into before_agent_start to run a
 * synchronous classification session before every user prompt, deciding
 * whether to inject a workflow prompt. Also hooks agent_end for
 * completion classification.
 *
 * Workflow-specific behavior is expressed directly in the branch session
 * prompts below. No considerations are registered here — user-registered
 * considerations are handled by consider.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Hardcoded workflow prompts (in-memory for now)
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
// System prompt for the classification branch session
// ---------------------------------------------------------------------------

const CLASSIFICATION_SYSTEM_PROMPT = `\
You are a pre-run classifier for a coding assistant. You run before the assistant \
processes a user message. Your sole job: decide whether to inject a preparatory \
prompt before the user's message.

You have one tool: injectMessage. Call it with the exact prompt text to inject. \
The assistant will see your injected message first, then the user's original message.

Rules:
- Call injectMessage only when you are confident injection is warranted.
- Output nothing at all when no action is needed.
- Do not explain your reasoning. Do not greet the user.`;

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function osAgent(pi: ExtensionAPI): void {
	// -------------------------------------------------------------------------
	// before_agent_start: intent classification
	// Runs synchronously before the agent starts, blocking until complete.
	// -------------------------------------------------------------------------
	pi.on("before_agent_start", async (event, ctx) => {
		let injectedPrompt: string | undefined;

		const classificationPrompt = [
			`The user's latest message is:`,
			`"${event.prompt}"`,
			``,
			`If this message clearly indicates the user wants to implement a new feature \
(e.g. "implement X", "add feature Y", "build Z", "create a ..."), call injectMessage \
with the Code Workflow Prompt below. Otherwise output nothing.`,
			``,
			`Code Workflow Prompt:`,
			CODE_WORKFLOW_PROMPT,
		].join("\n");

		await pi.runBranchSession(classificationPrompt, {
			systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
			tools: [],
			customTools: [
				{
					name: "injectMessage",
					label: "Inject Message",
					description: "Inject a message that will be prepended before the user's message for this turn.",
					parameters: Type.Object({
						prompt: Type.String({ description: "The exact message content to inject." }),
					}),
					execute: async (_id, params) => {
						injectedPrompt = params.prompt;
						return { content: [{ type: "text", text: "Injection queued." }] };
					},
				},
			],
			label: "os-agent:classify",
		});

		if (!injectedPrompt) return;

		if (ctx.hasUI) ctx.ui.notify("[os-agent] injecting workflow prompt", "info");
		return { prependUserMessage: injectedPrompt };
	});
}
