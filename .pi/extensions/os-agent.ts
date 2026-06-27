/**
 * OS Agent Extension
 *
 * Runs a single synchronous branch session before every user prompt that
 * evaluates all registered considerations and optionally:
 *   - calls injectMessage to prepend a workflow prompt
 *   - calls askQuestions to research knowledge gaps before the agent starts
 *
 * After each agent run, checks whether the current task is complete and
 * steers a review prompt if so.
 *
 * consider.ts owns the UI for registering/removing user considerations.
 * os-agent.ts owns evaluation, injection, and completion detection.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Workflow prompts (in-memory for now)
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

const REVIEW_WORKFLOW_PROMPT = `\
The implementation appears complete. Before finishing, run through this checklist:

1. Run npm run check — fix any remaining errors or warnings.
2. Re-read the original request and confirm the implementation matches it fully.
3. Check for missing error handling or edge cases.
4. Confirm all relevant files are committed.`;

// ---------------------------------------------------------------------------
// Built-in consideration
// ---------------------------------------------------------------------------

const CODE_WORKFLOW_CONSIDERATION = `\
If the user's latest message clearly indicates they want to implement a new feature \
(e.g. "implement X", "add feature Y", "build Z", "create a ..."), call injectMessage \
with the following prompt exactly:\n\n${CODE_WORKFLOW_PROMPT}`;

// ---------------------------------------------------------------------------
// Branch session system prompts
// ---------------------------------------------------------------------------

const CONSIDERATION_SYSTEM_PROMPT = `\
You are a pre-run assistant. Before a coding agent processes a user message you have \
two responsibilities:

1. INJECT: If a consideration instructs you to call injectMessage, do so when its \
condition is met. The agent will see the injected message before the user's message.
2. EVALUATE: For all other considerations, check whether they are violated. If any \
are, describe the finding concisely as your text response.
3. RESEARCH: If the conversation would benefit from clarifying specific concepts or \
questions before the agent starts, call askQuestions with those questions.

Available tools:
- injectMessage(prompt): Inject a preparatory prompt. Call at most once.
- askQuestions(questions): Research specific questions. Answers will be prepended \
to the agent's context alongside any injected prompt.
Use read, grep, find, ls, bash only if you need to inspect the codebase directly.

Rules:
- Output text only if there is a genuine consideration finding. Output nothing otherwise.
- Do not explain your reasoning. Do not greet the user.`;

const WORKER_SYSTEM_PROMPT = `\
You are a research assistant. Answer the following question concisely based on the \
conversation history and codebase. Be direct and technical. Focus only on what is \
relevant to the question.`;

const COMPLETION_SYSTEM_PROMPT = `\
You are evaluating whether the current task has been fully completed. \
Examine the conversation history. If the implementation task appears complete \
(code written, errors fixed, changes committed), respond with TASK_COMPLETE on its \
own line followed by a one-sentence summary. Otherwise output nothing at all.`;

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
	// Step 3: before_agent_start — consideration session with injectMessage
	// and askQuestions tools
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
			`For any consideration that instructs you to call injectMessage: do so if its \
condition is met. For all other considerations: report findings as text if violated. \
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
						"Inject a message prepended before the user's message for this turn. Call at most once.",
					parameters: Type.Object({
						prompt: Type.String({ description: "The exact message content to inject." }),
					}),
					execute: async (_id, params) => {
						injectedPrompt = params.prompt;
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
							if (answer) {
								answers.push(`Q: ${question}\nA: ${answer}`);
							}
						}
						const combined = answers.join("\n\n");
						if (combined) researchAnswers = combined;
						return {
							content: [{ type: "text", text: combined || "(no answers found)" }],
						};
					},
				},
			],
			label: "os-agent",
		});

		console.error(
			`[os-agent] before_agent_start done: elapsed=${Date.now() - start}ms inject=${!!injectedPrompt} answers=${!!researchAnswers} finding=${!!result}`,
		);

		// Combine all parts into a single prepended message.
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
	// Step 4: agent_end — completion classifier
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

		console.error(
			`[os-agent] agent_end done: elapsed=${Date.now() - start}ms complete=${result?.includes(TASK_COMPLETE_SENTINEL) ?? false}`,
		);

		if (!result?.includes(TASK_COMPLETE_SENTINEL)) return;

		if (ctx.hasUI) ctx.ui.notify("[os-agent] task complete — steering review", "info");
		pi.sendUserMessage(REVIEW_WORKFLOW_PROMPT, { deliverAs: "steer" });
	});
}
