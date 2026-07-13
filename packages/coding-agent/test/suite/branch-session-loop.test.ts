/**
 * Tests for newBranchSession — blocking await on session_done tool.
 *
 * Test strategy
 * -------------
 * newBranchSession injects a `session_done(procedure)` tool and blocks on a
 * Promise until the tool fires or the abort signal fires.
 *
 * The user drives the branch session by switching focus to its pane; their
 * replies flow through the normal editor submit path directly to the branch
 * session's prompt(). These tests cover the two exit paths:
 *
 *   - session_done fires → Promise resolves with the procedure string.
 *   - abort signal fires → Promise resolves with undefined → fallback returned.
 */

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newBranchSession, runBranchSession } from "../../src/core/branch-session.ts";
import { createHarness, type Harness } from "./harness.ts";

// ---------------------------------------------------------------------------
// newBranchSession — session_done and abort exit paths
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

		const result = await newBranchSession("How do I do X?", { tools: [], seedContext: false }, harness.session);

		expect(result).toBe("Step 1: do X\nConfidence: high");
	});

	it("calls onWaiting when the first turn completes without session_done", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Branch asks a question, no session_done.
		harness.setResponses([fauxAssistantMessage("What system are you on?")]);

		// onWaiting fires after branchSession.prompt() returns without session_done.
		// Abort from within the callback — this is the only reliable way to unblock
		// donePromise in a test without a real user interaction, because aborting
		// before newBranchSession reaches branchSession.prompt() hits the early-return
		// guard and skips onWaiting entirely.
		const controller = new AbortController();
		const onWaiting = vi.fn().mockImplementation(() => controller.abort());
		const result = await newBranchSession(
			"prompt",
			{ tools: [], seedContext: false, abortSignal: controller.signal, onWaiting },
			harness.session,
		);

		expect(onWaiting).toHaveBeenCalledOnce();
		expect(result).toBe("Could not find a procedure. Take a step back and consider a different approach.");
	});

	it("does not call onWaiting when session_done fires on the first turn", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("session_done", { procedure: "Step 1\nConfidence: high" })),
		]);

		const onWaiting = vi.fn();
		await newBranchSession("prompt", { tools: [], seedContext: false, onWaiting }, harness.session);

		expect(onWaiting).not.toHaveBeenCalled();
	});

	it("returns fallback message when abort signal fires before session_done", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Branch session asks a question without calling session_done.
		harness.setResponses([fauxAssistantMessage("What system are you on?")]);

		const controller = new AbortController();
		const resultPromise = newBranchSession(
			"prompt",
			{ tools: [], seedContext: false, abortSignal: controller.signal },
			harness.session,
		);

		// Abort after the first branch turn completes (donePromise is pending).
		controller.abort();

		const result = await resultPromise;
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
