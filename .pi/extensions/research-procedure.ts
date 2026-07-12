/**
 * Research Procedure Extension
 *
 * Registers `researchProcedure` as a custom tool. The agent calls this when
 * it knows WHAT is needed but not HOW to obtain it — unknown SSH paths, log
 * locations, CLI flags, or operational workflows not confirmed by code already
 * read in the session.
 *
 * A single branch session handles all phases in order:
 *   1. Skills — reads matching skill files from <available_skills>
 *   2. Knowledge — reasons from training, uses bash for docs/internet if needed
 *   3. User — asks the user directly when the system is internal/proprietary
 *
 * The branch session calls session_done(procedure) when it has a result.
 * Between turns, getUserInput relays the branch session's questions to the user
 * via ctx.ui.input() and feeds the answers back as the next prompt.
 * injectEvery: 5 keeps the session on track for longer investigations.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Branch session prompts
// ---------------------------------------------------------------------------

const UNIFIED_SYSTEM_PROMPT = `\
You are a procedure research assistant. Your job is to find or produce a concrete, \
step-by-step procedure for the goal given by the user.

Work through these steps in order:
1. SKILLS: Check the <available_skills> block in this prompt. If any skill file \
   covers this goal, use the read tool to load it and extract the procedure.
2. KNOWLEDGE: If no skill covers it, reason from your training knowledge and produce \
   a procedure. Include a Confidence: high/medium/low line.
3. DOCUMENTATION: If your confidence is low, use bash to consult man pages, --help \
   flags, or public documentation (curl to authoritative sources).
4. USER: If you cannot produce reliable steps — for example the system is internal \
   or proprietary — ask the user directly. They will reply and you can continue.

When you have a complete procedure ready to return, call session_done with the full \
procedure text. Include a Confidence: high/medium/low line in the procedure.

Do not call session_done with a question or a statement that you cannot help. \
Instead, write the question or request as your reply and the user will respond.`;

const PROCEDURE_REMINDER = `\
Are you still working toward finding a procedure? \
If you have one ready, call session_done now. \
If you need information from the user, ask your question directly as a reply.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPrompt(params: { goal: string; system: string; context?: string }): string {
	let prompt = `Goal: ${params.goal}\nSystem: ${params.system}`;
	if (params.context) {
		prompt += `\nContext: ${params.context}`;
	}
	return prompt;
}

function buildUserQuestion(params: { goal: string; system: string; context?: string }): string {
	let question =
		`How do I ${params.goal} on ${params.system}? ` +
		`Please provide the exact steps, access method, or path needed.`;
	if (params.context) {
		question += `\n\nContext already established: ${params.context}`;
	}
	return question;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function researchProcedureExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "researchProcedure",
		label: "Research Procedure",
		description:
			"Look up how to accomplish an operational task on a specific system — " +
			"use this when you know WHAT is needed but not HOW to obtain it: " +
			"unknown SSH paths, log file locations, CLI flags, or access workflows.",
		promptSnippet:
			"researchProcedure(goal, system, context?): look up operational steps for a system task",
		promptGuidelines: [
			"Call researchProcedure when you know WHAT data or access is needed but not HOW " +
				"to obtain it — unknown SSH paths, log locations, CLI flags, or operational " +
				"workflows not confirmed by code or logs already read in this session.",
			"Do not guess SSH paths, log locations, or CLI flags for unfamiliar systems — " +
				"call researchProcedure instead.",
			"researchProcedure returns a procedure for you to follow or present to the user. " +
				"If it returns source: user-required, surface the included question to the user " +
				"before continuing.",
		],
		parameters: Type.Object({
			goal: Type.String({ description: "What you want to accomplish" }),
			system: Type.String({ description: "Which component or system is involved" }),
			context: Type.Optional(
				Type.String({ description: "Known facts already established in the investigation" }),
			),
		}),

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const goal = typeof args?.goal === "string" ? args.goal : "";
			const system = typeof args?.system === "string" ? args.system : "";
			const label = system ? `${goal} on ${system}` : goal;
			text.setText(
				theme.fg("toolTitle", theme.bold("researchProcedure")) +
					theme.fg("toolOutput", label ? `: ${label}` : ""),
			);
			return text;
		},

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const prompt = buildPrompt(params);
			onUpdate?.({ content: [{ type: "text" as const, text: "Researching procedure..." }] });

			let result: string | undefined;
			try {
				result = await pi.runBranchSession(prompt, {
					seedContext: false,
					tools: ["read", "bash"],
					systemPrompt: UNIFIED_SYSTEM_PROMPT,
					systemPromptOverride: true,
					abortSignal: signal,
					label: "procedure",
					injectEvery: { turns: 5, message: PROCEDURE_REMINDER },
					loop: {
						getUserInput: async (lastText: string) => {
							// Show the branch session's last reply (its question) via notify,
							// then collect the user's response. Use a fallback when lastText is
							// empty so the user always sees context before the input dialog.
							const contextMessage = lastText || "Research is asking for your input.";
							ctx.ui.notify(contextMessage, "info");
							const answer = await ctx.ui.input("Research needs your input:");
							return answer ?? undefined;
						},
					},
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `researchProcedure failed: ${msg}` }],
					details: {},
				};
			}

			if (!result) {
				// Branch session exited without calling session_done —
				// user cancelled or session genuinely could not help.
				const userQuestion = buildUserQuestion(params);
				ctx.ui.notify(userQuestion, "info");
				return {
					content: [
						{
							type: "text" as const,
							text:
								`source: user-required\n\n` +
								`researchProcedure could not find a procedure.\n\n` +
								`Please ask the user:\n${userQuestion}`,
						},
					],
					details: {},
				};
			}

			return {
				content: [{ type: "text" as const, text: result }],
				details: {},
			};
		},
	});
}
