/**
 * Tests for newBranchSession — interactive loop with session_done tool.
 *
 * Test strategy
 * -------------
 * newBranchSession injects a `session_done(procedure)` tool and runs a loop
 * calling `getUserInput` between turns until the tool fires or getUserInput
 * exits. All tests are effectively single-turn from the faux provider's
 * perspective: either session_done fires on the first turn (no getUserInput
 * call needed), or getUserInput returns falsy after the first turn (no second
 * prompt is needed). This avoids the infinite-loop issue that limits
 * injectEvery integration tests.
 */

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newBranchSession, runBranchSession } from "../../src/core/branch-session.ts";
import { createHarness, type Harness } from "./harness.ts";

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

		const getUserInput = vi.fn().mockResolvedValue(undefined);

		const result = await newBranchSession(
			"How do I do X?",
			{ tools: [], seedContext: false, getUserInput },
			harness.session,
		);

		expect(result).toBe("Step 1: do X\nConfidence: high");
		// session_done fired on the first turn — getUserInput must never be called
		expect(getUserInput).not.toHaveBeenCalled();
	});

	it("returns undefined and calls getUserInput once when it returns undefined", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("Here is my question.")]);

		const getUserInput = vi.fn().mockResolvedValue(undefined);

		const result = await newBranchSession("prompt", { tools: [], seedContext: false, getUserInput }, harness.session);

		expect(result).toBeUndefined();
		// Loop ran once, getUserInput returned undefined → break
		expect(getUserInput).toHaveBeenCalledOnce();
		// Confirm the last text was passed as the first argument
		const [lastText] = getUserInput.mock.calls[0] as [string, AbortSignal | undefined];
		expect(lastText).toBe("Here is my question.");
	});

	it("returns undefined when getUserInput returns an empty string (treated as cancel)", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("What is your system?")]);

		const getUserInput = vi.fn().mockResolvedValue("");

		const result = await newBranchSession("prompt", { tools: [], seedContext: false, getUserInput }, harness.session);

		expect(result).toBeUndefined();
		expect(getUserInput).toHaveBeenCalledOnce();
	});

	it("returns undefined and never calls getUserInput when maxTurns is 0", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("initial response")]);

		const getUserInput = vi.fn().mockResolvedValue("answer");

		const result = await newBranchSession(
			"prompt",
			{ tools: [], seedContext: false, getUserInput, maxTurns: 0 },
			harness.session,
		);

		expect(result).toBeUndefined();
		// maxTurns=0: loop exits before the first getUserInput call
		expect(getUserInput).not.toHaveBeenCalled();
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

	it("returns lastAssistantText and does not involve session_done or getUserInput", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("the answer")]);

		const result = await runBranchSession("prompt", { tools: [], seedContext: false }, harness.session);

		expect(result).toBe("the answer");
	});
});
