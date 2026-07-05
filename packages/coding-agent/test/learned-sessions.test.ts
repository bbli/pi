import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { addLearnedSession, readLearnedSet } from "../src/core/learned-sessions.ts";

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

	describe("readLearnedSet", () => {
		test("returns empty Set when learned.json does not exist", async () => {
			const result = await readLearnedSet();
			expect(result.size).toBe(0);
		});

		test("returns all IDs from an existing learned.json", async () => {
			await addLearnedSession("id-one");
			await addLearnedSession("id-two");
			const result = await readLearnedSet();
			expect(result.has("id-one")).toBe(true);
			expect(result.has("id-two")).toBe(true);
			expect(result.size).toBe(2);
		});

		test("returns empty Set when learned.json contains malformed JSON", async () => {
			mkdirSync(join(tempDir, "sessions"), { recursive: true });
			writeFileSync(join(tempDir, "sessions", "learned.json"), "not json");
			const result = await readLearnedSet();
			expect(result.size).toBe(0);
		});
	});

	describe("addLearnedSession", () => {
		test("creates learned.json on first write", async () => {
			await addLearnedSession("session-abc");
			const result = await readLearnedSet();
			expect(result.has("session-abc")).toBe(true);
		});

		test("creates the sessions directory if it does not exist", async () => {
			const sessionsDir = join(tempDir, "sessions");
			expect(existsSync(sessionsDir)).toBe(false);
			await addLearnedSession("session-xyz");
			expect(existsSync(sessionsDir)).toBe(true);
			expect((await readLearnedSet()).has("session-xyz")).toBe(true);
		});

		test("is idempotent — adding the same ID twice does not duplicate it", async () => {
			await addLearnedSession("dup-id");
			await addLearnedSession("dup-id");
			const result = await readLearnedSet();
			expect(result.size).toBe(1);
			expect(result.has("dup-id")).toBe(true);
		});

		test("preserves existing IDs when adding a new one", async () => {
			await addLearnedSession("first");
			await addLearnedSession("second");
			await addLearnedSession("third");
			const result = await readLearnedSet();
			expect(result.size).toBe(3);
			expect(result.has("first")).toBe(true);
			expect(result.has("second")).toBe(true);
			expect(result.has("third")).toBe(true);
		});
	});
});
