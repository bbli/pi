import { describe, expect, test } from "vitest";
import type { Args } from "../src/cli/args.ts";
import { buildInitialMessage } from "../src/cli/initial-message.ts";
import { LEARN_ANALYSIS_PROMPT } from "../src/core/learned-sessions.ts";

function createArgs(messages: string[] = []): Args {
	return {
		messages: [...messages],
		fileArgs: [],
		unknownFlags: new Map(),
		diagnostics: [],
	};
}

describe("buildInitialMessage", () => {
	test("merges piped stdin with the first CLI message into one prompt", () => {
		const parsed = createArgs(["Summarize the text given"]);
		const result = buildInitialMessage({
			parsed,
			stdinContent: "README contents\n",
		});

		expect(result.initialMessage).toBe("README contents\nSummarize the text given");
		expect(parsed.messages).toEqual([]);
	});

	test("uses stdin as the initial prompt when no CLI message is present", () => {
		const parsed = createArgs();
		const result = buildInitialMessage({
			parsed,
			stdinContent: "README contents",
		});

		expect(result.initialMessage).toBe("README contents");
		expect(parsed.messages).toEqual([]);
	});

	test("LEARN_ANALYSIS_PROMPT injected via unshift is consumed as initialMessage, not left in initialMessages", () => {
		// The --learn flow calls parsed.messages.unshift(LEARN_ANALYSIS_PROMPT).
		// buildInitialMessage shifts parsed.messages[0] into initialMessage, so the
		// analysis prompt lands in initialMessage (sent first in interactive mode)
		// rather than in initialMessages (sent later). This test locks in that coupling.
		const parsed = createArgs([]);
		parsed.messages.unshift(LEARN_ANALYSIS_PROMPT);
		const result = buildInitialMessage({ parsed });
		expect(result.initialMessage).toBe(LEARN_ANALYSIS_PROMPT);
		expect(parsed.messages).toHaveLength(0);
	});

	test("combines stdin, file text, and first CLI message in one prompt", () => {
		const parsed = createArgs(["Explain it", "Second message"]);
		const result = buildInitialMessage({
			parsed,
			stdinContent: "stdin\n",
			fileText: "file\n",
		});

		expect(result.initialMessage).toBe("stdin\nfile\nExplain it");
		expect(parsed.messages).toEqual(["Second message"]);
	});
});
