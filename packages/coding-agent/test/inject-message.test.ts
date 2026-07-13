import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { makeInjectMessageTool } from "../src/core/tools/inject-message.ts";

function makeRootSession(isStreaming: boolean): AgentSession {
	return {
		isStreaming,
		steer: vi.fn().mockResolvedValue(undefined),
		sendUserMessage: vi.fn().mockResolvedValue(undefined),
	} as unknown as AgentSession;
}

describe("makeInjectMessageTool", () => {
	it("steers into the root session when root is streaming", async () => {
		const root = makeRootSession(true);
		const tool = makeInjectMessageTool(root);

		const result = await tool.execute("c1", { message: "found the bug" }, undefined, undefined, {} as never);

		expect(root.steer).toHaveBeenCalledWith("[User observation: found the bug]");
		expect(root.sendUserMessage).not.toHaveBeenCalled();
		expect((result.content[0] as { text: string }).text).toBe("injected");
	});

	it("sends a user message to the root session when root is idle", async () => {
		const root = makeRootSession(false);
		const tool = makeInjectMessageTool(root);

		const result = await tool.execute("c1", { message: "key insight" }, undefined, undefined, {} as never);

		expect(root.sendUserMessage).toHaveBeenCalledWith("[User observation: key insight]");
		expect(root.steer).not.toHaveBeenCalled();
		expect((result.content[0] as { text: string }).text).toBe("injected");
	});

	it("returns error and does not inject for an empty message", async () => {
		const root = makeRootSession(false);
		const tool = makeInjectMessageTool(root);

		const result = await tool.execute("c1", { message: "" }, undefined, undefined, {} as never);

		expect(root.sendUserMessage).not.toHaveBeenCalled();
		expect(root.steer).not.toHaveBeenCalled();
		expect((result.content[0] as { text: string }).text).toBe("error: message must not be empty");
	});

	it("returns error and does not inject for a whitespace-only message", async () => {
		const root = makeRootSession(false);
		const tool = makeInjectMessageTool(root);

		const result = await tool.execute("c1", { message: "   " }, undefined, undefined, {} as never);

		expect(root.sendUserMessage).not.toHaveBeenCalled();
		expect(root.steer).not.toHaveBeenCalled();
		expect((result.content[0] as { text: string }).text).toBe("error: message must not be empty");
	});
});
