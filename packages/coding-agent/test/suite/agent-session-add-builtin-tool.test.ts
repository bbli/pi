/**
 * Tests for AgentSession.addBuiltinTool().
 *
 * Uses the faux provider harness so no real API keys are needed.
 */

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../../src/core/extensions/types.ts";
import { createHarness, type Harness } from "./harness.ts";

function makeStubTool(name: string): ToolDefinition {
	return {
		name,
		label: name,
		description: `stub tool ${name}`,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text" as const, text: "ok" }], details: undefined }),
	};
}

describe("AgentSession.addBuiltinTool", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("registers a tool that becomes callable in the next turn", async () => {
		// allowedToolNames must include the tool name so _refreshToolRegistry
		// activates it into agent.state.tools (the live list the agent loop uses).
		const harness = await createHarness({ allowedToolNames: ["myTool"] });
		harnesses.push(harness);

		let called = false;
		const tool = makeStubTool("myTool");
		tool.execute = async () => {
			called = true;
			return { content: [{ type: "text" as const, text: "done" }], details: undefined };
		};

		harness.session.addBuiltinTool(tool);

		// Two responses: first the tool call, then the follow-up after the result.
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("myTool", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("finished"),
		]);

		await harness.session.prompt("use myTool");

		expect(called).toBe(true);
	});

	it("is idempotent — calling twice with the same tool name registers it once", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const tool = makeStubTool("dedupTool");
		harness.session.addBuiltinTool(tool);
		harness.session.addBuiltinTool(tool);

		const allTools = harness.session.getAllTools();
		const matches = allTools.filter((t) => t.name === "dedupTool");
		expect(matches).toHaveLength(1);
	});

	it("is a no-op and logs an error when called while streaming", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// Spy on isStreaming to simulate a mid-turn call.
		vi.spyOn(harness.session, "isStreaming", "get").mockReturnValue(true);

		harness.session.addBuiltinTool(makeStubTool("lateAddedTool"));

		const allTools = harness.session.getAllTools();
		expect(allTools.find((t) => t.name === "lateAddedTool")).toBeUndefined();
		expect(consoleSpy).toHaveBeenCalledWith('addBuiltinTool called while streaming — ignored (tool="lateAddedTool")');

		consoleSpy.mockRestore();
	});
});
