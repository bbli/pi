import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { addToLearnQueue, readLearnQueueSet, removeFromLearnQueue } from "../src/core/learned-sessions.ts";

describe("learned-sessions", () => {
	let tempDir: string;
	let originalEnv: string | undefined;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-test-learned-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		originalEnv = process.env[ENV_AGENT_DIR];
		process.env[ENV_AGENT_DIR] = tempDir;
	});

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env[ENV_AGENT_DIR];
		} else {
			process.env[ENV_AGENT_DIR] = originalEnv;
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("readLearnQueueSet", () => {
		test("returns empty Set when learned.json does not exist", async () => {
			const result = await readLearnQueueSet();
			expect(result.size).toBe(0);
		});

		test("returns all IDs from an existing learned.json", async () => {
			await addToLearnQueue("id-one");
			await addToLearnQueue("id-two");
			const result = await readLearnQueueSet();
			expect(result.has("id-one")).toBe(true);
			expect(result.has("id-two")).toBe(true);
			expect(result.size).toBe(2);
		});

		test("returns empty Set when learned.json contains malformed JSON", async () => {
			mkdirSync(join(tempDir, "sessions"), { recursive: true });
			writeFileSync(join(tempDir, "sessions", "learned.json"), "not json");
			const result = await readLearnQueueSet();
			expect(result.size).toBe(0);
		});
	});

	describe("addToLearnQueue", () => {
		test("creates learned.json on first write", async () => {
			await addToLearnQueue("session-abc");
			const result = await readLearnQueueSet();
			expect(result.has("session-abc")).toBe(true);
		});

		test("creates the sessions directory if it does not exist", async () => {
			const sessionsDir = join(tempDir, "sessions");
			expect(existsSync(sessionsDir)).toBe(false);
			await addToLearnQueue("session-xyz");
			expect(existsSync(sessionsDir)).toBe(true);
			expect((await readLearnQueueSet()).has("session-xyz")).toBe(true);
		});

		test("is idempotent — adding the same ID twice does not duplicate it", async () => {
			await addToLearnQueue("dup-id");
			await addToLearnQueue("dup-id");
			const result = await readLearnQueueSet();
			expect(result.size).toBe(1);
			expect(result.has("dup-id")).toBe(true);
		});

		test("preserves existing IDs when adding a new one", async () => {
			await addToLearnQueue("first");
			await addToLearnQueue("second");
			await addToLearnQueue("third");
			const result = await readLearnQueueSet();
			expect(result.size).toBe(3);
			expect(result.has("first")).toBe(true);
			expect(result.has("second")).toBe(true);
			expect(result.has("third")).toBe(true);
		});
	});

	describe("removeFromLearnQueue", () => {
		test("removes an existing ID from the queue", async () => {
			await addToLearnQueue("to-remove");
			await addToLearnQueue("to-keep");
			await removeFromLearnQueue("to-remove");
			const result = await readLearnQueueSet();
			expect(result.has("to-remove")).toBe(false);
			expect(result.has("to-keep")).toBe(true);
			expect(result.size).toBe(1);
		});

		test("is idempotent — removing an absent ID does not error", async () => {
			await addToLearnQueue("present");
			await removeFromLearnQueue("absent");
			const result = await readLearnQueueSet();
			expect(result.size).toBe(1);
			expect(result.has("present")).toBe(true);
		});

		test("no-ops when learned.json does not exist", async () => {
			await removeFromLearnQueue("ghost-id");
			const result = await readLearnQueueSet();
			expect(result.size).toBe(0);
		});
	});
});
