/**
 * Research Procedure Extension
 *
 * Registers `researchProcedure` as a custom tool. The agent calls this when
 * it knows WHAT is needed but not HOW to obtain it — unknown SSH paths, log
 * locations, CLI flags, or operational workflows not confirmed by code already
 * read in the session.
 *
 * Three-phase search, stopping at the first successful result:
 *   Phase 1 — skill files: branch session with read tool reads the
 *             <available_skills> block and extracts a matching procedure.
 *   Phase 2 — reasoning + web: branch session with bash tool reasons from
 *             training knowledge, consulting docs/internet if confidence is low.
 *   Phase 3 — user raise: returns a targeted question for the agent to surface
 *             in conversation, with a TUI notification.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Branch session system prompts
// ---------------------------------------------------------------------------

const PHASE1_SYSTEM_PROMPT = `\
You are a procedure lookup assistant. Your only job is to determine whether any \
loaded skill file contains a procedure relevant to the goal given by the user.

The <available_skills> block appended to this prompt lists the loaded skill files \
with their file locations and descriptions. If any skill appears relevant to the \
goal, use the read tool to load that file and extract a concrete, actionable procedure.

When you find a relevant procedure, output:
Source: skill — <skill name>
Confidence: high | medium | low
<step-by-step procedure, prerequisites, warnings>

When no loaded skill covers the goal, output exactly this and nothing else:
NO_MATCH`;

const PHASE2_SYSTEM_PROMPT = `\
You are a procedure research assistant. Your only job is to produce a concrete \
step-by-step procedure for the goal given by the user.

Work in this order:
1. Reason from your training knowledge. Include a Confidence line \
   (high / medium / low) reflecting how certain you are these steps are \
   correct for this specific system.
2. If your confidence is low, use bash to consult documentation — \
   man pages, --help flags, or curl to public documentation sites.

When you have steps to provide, output:
Confidence: high | medium | low
<step-by-step procedure with copy-pasteable commands, prerequisites, warnings>

When you genuinely cannot produce steps — for example the system is internal \
and undocumented publicly — output exactly this and nothing else:
UNKNOWN`;

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

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const prompt = buildPrompt(params);

			// Phase 1 — skill files
			let phase1: string | undefined;
			try {
				phase1 = await pi.runBranchSession(prompt, {
					seedContext: false,
					tools: ["read"],
					systemPrompt: PHASE1_SYSTEM_PROMPT,
					systemPromptOverride: true,
					abortSignal: signal,
					label: "procedure/skills",
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `researchProcedure Phase 1 (skills) failed: ${msg}` }],
					details: {},
				};
			}

			if (phase1 && !phase1.includes("NO_MATCH")) {
				return {
					content: [{ type: "text" as const, text: `source: skill\n\n${phase1}` }],
					details: {},
				};
			}

			if (signal?.aborted) {
				return { content: [{ type: "text" as const, text: "(cancelled)" }], details: {} };
			}

			// Phase 2 — reasoning + web
			let phase2: string | undefined;
			try {
				phase2 = await pi.runBranchSession(prompt, {
					seedContext: false,
					tools: ["bash"],
					systemPrompt: PHASE2_SYSTEM_PROMPT,
					systemPromptOverride: true,
					abortSignal: signal,
					label: "procedure/reasoning",
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `researchProcedure Phase 2 (reasoning) failed: ${msg}` }],
					details: {},
				};
			}

			if (phase2 && !phase2.includes("UNKNOWN")) {
				return {
					content: [{ type: "text" as const, text: `source: reasoning\n\n${phase2}` }],
					details: {},
				};
			}

			if (signal?.aborted) {
				return { content: [{ type: "text" as const, text: "(cancelled)" }], details: {} };
			}

			// Phase 3 — user raise
			const userQuestion = buildUserQuestion(params);
			ctx.ui.notify(userQuestion, "info");
			return {
				content: [
					{
						type: "text" as const,
						text:
							`source: user-required\n\n` +
							`researchProcedure could not find a procedure in loaded skills ` +
							`or from general knowledge.\n\n` +
							`Please ask the user:\n${userQuestion}`,
					},
				],
				details: {},
			};
		},
	});
}
