/**
 * Tests for newBranchSession — interactive loop with session_done tool.
 *
 * Test strategy
 * -------------
 * newBranchSession injects a `session_done(procedure)` tool and runs a loop
 * collecting user input via ctx.ui.input() between turns until the tool fires
 * or the user cancels. All tests are effectively single-turn from the faux
 * provider's perspective (no infinite-loop risk):
 *
 *   - session_done fires on the first turn → loop exits before ctx is used
 *   - ctx.ui.input() returns falsy → loop breaks after one turn, no second prompt
 *   - maxTurns=0 → loop exits before ctx is used
 */

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newBranchSession, runBranchSession } from "../../src/core/branch-session.ts";
import type { ExtensionContext } from "../../src/core/extensions/types.ts";
import { createHarness, type Harness } from "./harness.ts";

/** Minimal ctx mock for testing user-input interaction. */
function makeCtx(inputReturn: string | undefined): ExtensionContext {
	return {
		ui: {
			notify: vi.fn(),
			input: vi.fn().mockResolvedValue(inputReturn),
		},
	} as unknown as ExtensionContext;
}

// ---------------------------------------------------------------------------
// newBranchSession — session_done and loop exit paths
// ---------------------------------------------------------------------------

describe("newBranchSession", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("returns the procedure when the branch session calls session_done", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Branch session calls session_done; terminate:true prevents a follow-up LLM call.
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("session_done", { procedure: "Step 1: do X\nConfidence: high" })),
		]);

		// No ctx needed — session_done fires before the loop calls ctx.ui.input
		const result = await newBranchSession("How do I do X?", { tools: [], seedContext: false }, harness.session);

		expect(result).toBe("Step 1: do X\nConfidence: high");
	});

	it("returns fallback message and calls ctx.ui.input once when the user cancels (undefined)", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("Here is my question.")]);

		const ctx = makeCtx(undefined);

		const result = await newBranchSession("prompt", { tools: [], seedContext: false, ctx }, harness.session);

		expect(result).toBe("Could not find a procedure. Take a step back and consider a different approach.");
		expect(ctx.ui.input).toHaveBeenCalledOnce();
		// Confirm notify was called with the branch session's last text
		expect(ctx.ui.notify).toHaveBeenCalledWith("Here is my question.", "info");
	});

	it("returns fallback message when ctx.ui.input returns empty string (treated as cancel)", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("What is your system?")]);

		const ctx = makeCtx("");

		const result = await newBranchSession("prompt", { tools: [], seedContext: false, ctx }, harness.session);

		expect(result).toBe("Could not find a procedure. Take a step back and consider a different approach.");
		expect(ctx.ui.input).toHaveBeenCalledOnce();
	});

	it("returns fallback message immediately when maxTurns is 0 (ctx never called)", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("initial response")]);

		const ctx = makeCtx("answer");

		const result = await newBranchSession(
			"prompt",
			{ tools: [], seedContext: false, ctx, maxTurns: 0 },
			harness.session,
		);

		expect(result).toBe("Could not find a procedure. Take a step back and consider a different approach.");
		// maxTurns=0 exits before calling ctx.ui
		expect(ctx.ui.input).not.toHaveBeenCalled();
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("returns fallback message when ctx is not provided", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("I need more information.")]);

		// No ctx — loop cannot collect user input, exits after first turn
		const result = await newBranchSession("prompt", { tools: [], seedContext: false }, harness.session);

		expect(result).toBe("Could not find a procedure. Take a step back and consider a different approach.");
	});
});

// ---------------------------------------------------------------------------
// runBranchSession regression — single-turn behavior unchanged
// ---------------------------------------------------------------------------

describe("runBranchSession — single-turn behavior unchanged", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("returns lastAssistantText and does not involve session_done or user input", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("the answer")]);

		const result = await runBranchSession("prompt", { tools: [], seedContext: false }, harness.session);

		expect(result).toBe("the answer");
	});
});
