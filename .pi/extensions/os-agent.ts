/**
 * OS Agent Extension
 *
 * Runs a single synchronous branch session before every user prompt that
 * evaluates all registered considerations and optionally:
 *   - calls injectMessage(promptName) to prepend a named workflow prompt
 *   - calls askQuestions to research knowledge gaps before the agent starts
 *
 * After each agent run, checks whether the current task is complete and
 * queues a review prompt if so.
 *
 * Prompt names passed to injectMessage are resolved via NAMED_PROMPTS,
 * which separates the triggering condition (in the consideration text)
 * from the actual prompt content (stored here).
 *
 * consider.ts owns the UI for registering/removing user considerations.
 * os-agent.ts owns evaluation, injection, and completion detection.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Named workflow prompts
// Injected by name via injectMessage("PROMPT_NAME"). The consideration text
// only references the name; the content lives here.
// ---------------------------------------------------------------------------

const NAMED_PROMPTS: Record<string, string> = {
	CODE_WORKFLOW_PROMPT: `\
You are about to implement a feature. Before writing any code, follow this workflow:

1. Restate the feature request in your own words to confirm your understanding.
2. Identify knowledge gaps — anything you need to understand about the existing \
codebase before you can implement correctly. Call askQuestions() with these gaps.
3. Wait for answers before proceeding.
4. Implement step by step, committing after each logical unit of work.
5. Run npm run check after each change and fix all errors before moving on.
6. Stay on the happy path — do not attempt to fix unrelated issues you encounter.`,

	REVIEW_WORKFLOW_PROMPT: `\
I detected that the current implementation appears complete. \
Before we consider this task done, run through this checklist:

1. Run npm run check — fix any remaining errors or warnings.
2. Re-read the original request and confirm the implementation matches it fully.
3. Check for missing error handling or edge cases.
4. Confirm all relevant files are committed.`,
};

// ---------------------------------------------------------------------------
// Built-in considerations
// Condition and payload are separated: the consideration references the prompt
// by name; the content is resolved via NAMED_PROMPTS.
// ---------------------------------------------------------------------------

const CODE_WORKFLOW_CONSIDERATION = `\
If the user's latest message clearly indicates they want to implement a new feature \
(e.g. "implement X", "add feature Y", "build Z", "create a ..."), \
call injectMessage with the prompt name "CODE_WORKFLOW_PROMPT".`;

// ---------------------------------------------------------------------------
// Branch session system prompts
// ---------------------------------------------------------------------------

const CONSIDERATION_SYSTEM_PROMPT = `\
You are a pre-run assistant that runs before a coding agent processes a user message.

Responsibilities:
1. Evaluate the considerations listed in the prompt.
2. For considerations that say to call injectMessage: do so when the condition is met.
3. For all other considerations: if violated, describe the finding concisely as your response text.
4. If the conversation would benefit from concept clarification, call askQuestions first.

Available tools:
- injectMessage(prompt): Inject a named or literal prompt before the user's message. \
  Call at most once. Available named prompts: ${Object.keys(NAMED_PROMPTS).join(", ")}.
- askQuestions(questions): Research specific questions. Answers will be included in \
  the agent's context.

Use read, grep, find, ls, bash only if you need to inspect the codebase directly.

Rules:
- Output response text only if there is a genuine consideration violation.
- Output nothing if all considerations pass and no injection is needed.
- Do not explain your reasoning. Do not greet the user.`;

const WORKER_SYSTEM_PROMPT = `\
You are a research assistant. Answer the following question concisely based on the \
conversation history and codebase. Be direct and technical. \
When referencing code, include the file path and relevant function or line numbers. \
Focus only on what is relevant to the question.`;

const COMPLETION_SYSTEM_PROMPT = `\
You are evaluating whether the current task has been fully completed.
Examine the conversation history.

If the conversation shows that a review checklist was already presented AND the agent \
completed it without flagging new issues, output nothing — the review is done.

If the implementation task appears newly complete (code written, errors fixed, \
changes committed) and no review has been presented yet, respond with TASK_COMPLETE \
on its own line followed by a one-sentence summary.

Otherwise output nothing.`;

const TASK_COMPLETE_SENTINEL = "TASK_COMPLETE";

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function osAgent(pi: ExtensionAPI): void {
	pi.registerConsideration({
		text: CODE_WORKFLOW_CONSIDERATION,
		removalCondition: "never — built-in OS agent consideration",
	});

	// -------------------------------------------------------------------------
	// before_agent_start — single consideration session
	// Resolves named prompts via NAMED_PROMPTS so the condition text stays short.
	// -------------------------------------------------------------------------
	pi.on("before_agent_start", async (event, ctx) => {
		const considerations = pi.getConsiderations();
		const start = Date.now();

		console.error(
			`[os-agent] before_agent_start: prompt="${event.prompt.slice(0, 80)}" considerations=${considerations.length}`,
		);

		let injectedPrompt: string | undefined;
		let researchAnswers: string | undefined;

		const prompt = [
			`The user's latest message is:`,
			`"${event.prompt}"`,
			``,
			`Considerations to evaluate:`,
			...considerations.map((c, i) => `${i + 1}. ${c.text}`),
			``,
			`For considerations that say to call injectMessage: do so if the condition is met. \
For all others: report findings as text if violated. \
Call askQuestions if the conversation would benefit from concept clarification. \
If nothing requires action, output nothing.`,
		].join("\n");

		const result = await pi.runBranchSession(prompt, {
			systemPrompt: CONSIDERATION_SYSTEM_PROMPT,
			tools: ["read", "grep", "find", "ls", "bash"],
			customTools: [
				{
					name: "injectMessage",
					label: "Inject Message",
					description:
						"Inject a prompt before the user's message for this turn. " +
						`Pass a named prompt (${Object.keys(NAMED_PROMPTS).join(", ")}) or literal content. Call at most once.`,
					parameters: Type.Object({
						prompt: Type.String({
							description: "Named prompt key or literal content to inject.",
						}),
					}),
					execute: async (_id, params) => {
						// Resolve named prompts; fall back to literal content.
						injectedPrompt = NAMED_PROMPTS[params.prompt] ?? params.prompt;
						console.error(`[os-agent] injectMessage: resolved "${params.prompt.slice(0, 40)}"`);
						return { content: [{ type: "text", text: "Injection queued." }] };
					},
				},
				{
					name: "askQuestions",
					label: "Ask Questions",
					description:
						"Research specific questions before the agent starts. " +
						"Answers are prepended to the agent's context. Use when the conversation " +
						"would benefit from clarifying concepts or knowledge gaps.",
					parameters: Type.Object({
						questions: Type.Array(Type.String(), {
							description: "Specific questions to research about the codebase or concepts.",
						}),
					}),
					execute: async (_id, params) => {
						const answers: string[] = [];
						for (const question of params.questions) {
							console.error(`[os-agent] askQuestions: "${question.slice(0, 60)}"`);
							const answer = await pi.runBranchSession(question, {
								systemPrompt: WORKER_SYSTEM_PROMPT,
								tools: ["read", "grep", "find", "ls", "bash"],
								label: "os-agent:worker",
							});
							if (answer) answers.push(`Q: ${question}\nA: ${answer}`);
						}
						const combined = answers.join("\n\n");
						if (combined) researchAnswers = combined;
						return { content: [{ type: "text", text: combined || "(no answers found)" }] };
					},
				},
			],
			label: "os-agent",
		});

		console.error(
			`[os-agent] before_agent_start done: elapsed=${Date.now() - start}ms inject=${!!injectedPrompt} answers=${!!researchAnswers} finding=${!!result}`,
		);

		const parts: string[] = [];
		if (injectedPrompt) parts.push(injectedPrompt);
		if (researchAnswers) parts.push(`Research answers:\n\n${researchAnswers}`);
		if (result) parts.push(`Before responding, address:\n\n${result}`);

		if (parts.length === 0) return;

		if (ctx.hasUI) {
			const label = injectedPrompt ? "[os-agent] injecting workflow prompt" : "[os-agent] consideration flagged";
			ctx.ui.notify(label, injectedPrompt ? "info" : "warning");
		}
		return { prependUserMessage: parts.join("\n\n---\n\n") };
	});

	// -------------------------------------------------------------------------
	// agent_end — completion classifier
	// Uses a line-anchored sentinel so substring mentions don't false-positive.
	// Delivers the review as a followUp (not steer) to avoid re-entrancy.
	// -------------------------------------------------------------------------
	pi.on("agent_end", async (_event, ctx) => {
		const start = Date.now();
		console.error("[os-agent] agent_end: checking completion");

		const result = await pi.runBranchSession(
			"Has the current task been fully completed? Examine the conversation.",
			{
				systemPrompt: COMPLETION_SYSTEM_PROMPT,
				tools: ["read", "grep", "find", "ls", "bash"],
				label: "os-agent:completion",
			},
		);

		const isComplete = result !== undefined && /^TASK_COMPLETE$/m.test(result);

		console.error(
			`[os-agent] agent_end done: elapsed=${Date.now() - start}ms complete=${isComplete}`,
		);

		if (!isComplete) return;

		if (ctx.hasUI) ctx.ui.notify("[os-agent] task complete — queuing review", "info");
		pi.sendUserMessage(NAMED_PROMPTS.REVIEW_WORKFLOW_PROMPT, { deliverAs: "followUp" });
	});
}
