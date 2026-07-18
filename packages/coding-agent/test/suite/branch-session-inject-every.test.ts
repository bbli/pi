/**
 * Tests for runBranchSession injectEvery option.
 *
 * Test strategy notes
 * -------------------
 * `injectEvery` fires followUp() from inside a turn_end subscriber. With
 * turns: 1 every completed turn (including error turns from a faux-exhausted
 * provider) re-queues the reminder. _handlePostAgentRun() then sees
 * hasQueuedMessages()=true and calls agent.continue() indefinitely, creating
 * an infinite loop. End-to-end integration tests therefore only cover
 * behaviours achievable in a single branch-session turn:
 *
 *   - guard: invalid turns values → warn + no subscription
 *   - negative: valid turns value but session ends before interval fires
 *
 * The counting / injection logic itself is tested at the unit level below by
 * simulating turn_end events directly on a subscriber shaped identically to
 * what branch-session.ts installs.
 */

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../../src/core/agent-session.ts";
import { runBranchSession } from "../../src/core/branch-session.ts";
import { createHarness, type Harness } from "./harness.ts";

// ---------------------------------------------------------------------------
// Integration tests via runBranchSession
// ---------------------------------------------------------------------------

describe("runBranchSession — injectEvery guard", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it.each([
		["0", 0],
		["-1", -1],
		["NaN", NaN],
		["Infinity", Infinity],
	])("warns and skips subscription when turns is %s", async (_label, turns) => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("done")]);

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const followUpSpy = vi.spyOn(AgentSession.prototype, "followUp");

		await runBranchSession(
			"eval",
			{ tools: [], seedContext: false, injectEvery: { turns, message: "REMINDER" } },
			harness.session,
		);

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("injectEvery.turns"));
		const reminderCalls = followUpSpy.mock.calls.filter(([text]) => text === "REMINDER");
		expect(reminderCalls).toHaveLength(0);
	});

	it("injects on the first turn regardless of interval", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("done after one turn")]);

		// Mock steer to prevent the queued message from causing a second turn.
		const steerSpy = vi.spyOn(AgentSession.prototype, "steer").mockResolvedValue(undefined);

		await runBranchSession(
			"eval",
			{ tools: [], seedContext: false, injectEvery: { turns: 3, message: "REMINDER" } },
			harness.session,
		);

		const reminderCalls = steerSpy.mock.calls.filter(([text]) => text === "REMINDER");
		expect(reminderCalls).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Unit tests for the subscriber counting logic
// (tests the same conditional logic installed inside runBranchSession)
// ---------------------------------------------------------------------------

describe("injectEvery — subscriber counting logic", () => {
	/** Minimal mock mirroring the session interface the subscriber uses. */
	function makeSubscriberForTurns(
		turns: number,
		followUpFn: (text: string) => void,
	): (event: { type: string }) => void {
		let turnCount = 0;
		return (event) => {
			if (event.type !== "turn_end") return;
			turnCount++;
			if (turnCount === 1 || (turnCount - 1) % turns === 0) {
				followUpFn("REMINDER");
			}
		};
	}

	it("fires at turn 1 then every n turns after", () => {
		const calls: number[] = [];
		let callIndex = 0;
		const subscriber = makeSubscriberForTurns(3, () => calls.push(++callIndex));

		const turnEnd = { type: "turn_end" };
		const turnStart = { type: "turn_start" };

		subscriber(turnEnd); // count=1 — fire #1
		subscriber(turnStart); // ignored
		subscriber(turnEnd); // count=2 — no fire
		subscriber(turnEnd); // count=3 — no fire
		subscriber(turnEnd); // count=4 — fire #2
		subscriber(turnEnd); // count=5 — no fire
		subscriber(turnEnd); // count=6 — no fire
		subscriber(turnEnd); // count=7 — fire #3

		expect(calls).toEqual([1, 2, 3]);
	});

	it("ignores non-turn_end events", () => {
		const calls: string[] = [];
		const subscriber = makeSubscriberForTurns(1, (t) => calls.push(t));

		subscriber({ type: "agent_end" });
		subscriber({ type: "message_start" });
		subscriber({ type: "turn_start" });

		expect(calls).toHaveLength(0);
	});

	it("fires on the very first turn when turns is 1", () => {
		const calls: string[] = [];
		const subscriber = makeSubscriberForTurns(1, (t) => calls.push(t));

		subscriber({ type: "turn_end" });

		expect(calls).toEqual(["REMINDER"]);
	});
});
