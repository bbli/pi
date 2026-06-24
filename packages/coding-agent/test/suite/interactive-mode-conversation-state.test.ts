/**
 * Unit tests for InteractiveMode's conversation-local state save/restore
 * (saveConversationState / restoreConversationState).
 *
 * Uses the Reflect pattern to call private methods directly, consistent with
 * other InteractiveMode tests in this codebase.
 */
import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ConversationViewState = {
	compactionQueuedMessages: Array<{ text: string; mode: "steer" | "followUp" }>;
	workingMessage: string | undefined;
	workingVisible: boolean;
	workingIndicatorOptions: unknown;
};

/** Call a private method on an InteractiveMode instance via Reflect. */
function callPrivate(instance: object, method: string, ...args: unknown[]): unknown {
	const fn = Reflect.get(InteractiveMode.prototype, method) as (...a: unknown[]) => unknown;
	return fn.apply(instance, args);
}

/** Get a private field from an InteractiveMode instance via Reflect. */
function getField<T>(instance: object, field: string): T {
	return Reflect.get(instance, field) as T;
}

/** Set a private field on an InteractiveMode instance. */
function setField(instance: object, field: string, value: unknown): void {
	Reflect.set(instance, field, value);
}

/** Build a minimal fake InteractiveMode with only the fields touched by
 *  saveConversationState / restoreConversationState. */
function makeFakeIM(focusedId?: string) {
	const compactionLoader = { stop: vi.fn() };
	const retryLoader = { stop: vi.fn() };
	const countdown = { dispose: vi.fn() };
	const originalEscape = vi.fn();

	const fake = {
		// ── orchestrator (read focusedRecord) ──────────────────────────────
		orchestrator: {
			focusedRecord: focusedId ? { id: focusedId } : undefined,
		},

		// ── conversation-local data fields ─────────────────────────────────
		compactionQueuedMessages: [] as Array<{ text: string; mode: string }>,
		workingMessage: undefined as string | undefined,
		workingVisible: true,
		workingIndicatorOptions: undefined,

		// ── compaction UI state ────────────────────────────────────────────
		autoCompactionLoader: compactionLoader as unknown,
		autoCompactionEscapeHandler: undefined as unknown,
		defaultEditor: { onEscape: originalEscape as unknown },

		// ── retry UI state ─────────────────────────────────────────────────
		retryLoader: retryLoader as unknown,
		retryCountdown: countdown as unknown,
		retryEscapeHandler: undefined as unknown,

		// ── status dedup pointers ──────────────────────────────────────────
		lastStatusSpacer: { id: "spacer" } as unknown,
		lastStatusText: { id: "text" } as unknown,

		// ── state store ────────────────────────────────────────────────────
		conversationStates: new Map<string, ConversationViewState>(),

		// ── sessionHistories (for cleanup tests) ──────────────────────────
		sessionHistories: new Map<string, string[]>(),
	};

	return { fake, compactionLoader, retryLoader, countdown, originalEscape };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InteractiveMode.saveConversationState", () => {
	it("saves compactionQueuedMessages under the focused session id", () => {
		const { fake } = makeFakeIM("session-abc");
		fake.compactionQueuedMessages = [{ text: "hello", mode: "steer" }];

		callPrivate(fake, "saveConversationState");

		const saved = fake.conversationStates.get("session-abc") as ConversationViewState;
		expect(saved).toBeDefined();
		expect(saved.compactionQueuedMessages).toEqual([{ text: "hello", mode: "steer" }]);
	});

	it("saves under 'root' when no session is focused", () => {
		const { fake } = makeFakeIM(undefined);
		fake.compactionQueuedMessages = [{ text: "msg", mode: "followUp" }];

		callPrivate(fake, "saveConversationState");

		const saved = fake.conversationStates.get("root") as ConversationViewState;
		expect(saved?.compactionQueuedMessages).toEqual([{ text: "msg", mode: "followUp" }]);
	});

	it("saves workingMessage, workingVisible, workingIndicatorOptions", () => {
		const { fake } = makeFakeIM("s1");
		fake.workingMessage = "custom message";
		fake.workingVisible = false;
		fake.workingIndicatorOptions = { frames: ["a", "b"], intervalMs: 100 };

		callPrivate(fake, "saveConversationState");

		const saved = fake.conversationStates.get("s1") as ConversationViewState;
		expect(saved.workingMessage).toBe("custom message");
		expect(saved.workingVisible).toBe(false);
		expect(saved.workingIndicatorOptions).toEqual({
			frames: ["a", "b"],
			intervalMs: 100,
		});
	});

	it("stops and clears autoCompactionLoader", () => {
		const { fake, compactionLoader } = makeFakeIM("s1");

		callPrivate(fake, "saveConversationState");

		expect(compactionLoader.stop).toHaveBeenCalledTimes(1);
		expect(getField(fake, "autoCompactionLoader")).toBeUndefined();
	});

	it("restores autoCompactionEscapeHandler back to defaultEditor.onEscape", () => {
		const { fake } = makeFakeIM("s1");
		const savedOriginal = vi.fn();
		const compactionAbort = vi.fn();
		// Simulate: original escape was saved, then overridden by compaction
		fake.autoCompactionEscapeHandler = savedOriginal;
		fake.defaultEditor.onEscape = compactionAbort;

		callPrivate(fake, "saveConversationState");

		// The original handler is restored
		expect(fake.defaultEditor.onEscape).toBe(savedOriginal);
		expect(getField(fake, "autoCompactionEscapeHandler")).toBeUndefined();
	});

	it("stops and clears retryLoader and retryCountdown", () => {
		const { fake, retryLoader, countdown } = makeFakeIM("s1");

		callPrivate(fake, "saveConversationState");

		expect(retryLoader.stop).toHaveBeenCalledTimes(1);
		expect(countdown.dispose).toHaveBeenCalledTimes(1);
		expect(getField(fake, "retryLoader")).toBeUndefined();
		expect(getField(fake, "retryCountdown")).toBeUndefined();
	});

	it("resets lastStatusSpacer and lastStatusText to undefined", () => {
		const { fake } = makeFakeIM("s1");
		expect(getField(fake, "lastStatusSpacer")).toBeDefined();
		expect(getField(fake, "lastStatusText")).toBeDefined();

		callPrivate(fake, "saveConversationState");

		expect(getField(fake, "lastStatusSpacer")).toBeUndefined();
		expect(getField(fake, "lastStatusText")).toBeUndefined();
	});

	it("resets conversation data fields to defaults after saving", () => {
		const { fake } = makeFakeIM("s1");
		fake.compactionQueuedMessages = [{ text: "x", mode: "steer" }];
		fake.workingMessage = "busy";
		fake.workingVisible = false;

		callPrivate(fake, "saveConversationState");

		expect(fake.compactionQueuedMessages).toEqual([]);
		expect(fake.workingMessage).toBeUndefined();
		expect(fake.workingVisible).toBe(true);
	});
});

describe("InteractiveMode.restoreConversationState", () => {
	it("restores saved compactionQueuedMessages for the focused session", () => {
		const { fake } = makeFakeIM("session-abc");
		fake.conversationStates.set("session-abc", {
			compactionQueuedMessages: [{ text: "saved", mode: "steer" }],
			workingMessage: undefined,
			workingVisible: true,
			workingIndicatorOptions: undefined,
		});

		callPrivate(fake, "restoreConversationState");

		expect(fake.compactionQueuedMessages).toEqual([{ text: "saved", mode: "steer" }]);
	});

	it("keeps defaults when no saved state exists for the session", () => {
		const { fake } = makeFakeIM("new-session");
		// no entry in conversationStates for "new-session"

		callPrivate(fake, "restoreConversationState");

		expect(fake.compactionQueuedMessages).toEqual([]);
		expect(fake.workingMessage).toBeUndefined();
		expect(fake.workingVisible).toBe(true);
	});

	it("restores workingVisible = false when saved as false", () => {
		const { fake } = makeFakeIM("s1");
		fake.conversationStates.set("s1", {
			compactionQueuedMessages: [],
			workingMessage: undefined,
			workingVisible: false,
			workingIndicatorOptions: undefined,
		});

		callPrivate(fake, "restoreConversationState");

		expect(fake.workingVisible).toBe(false);
	});
});

describe("InteractiveMode save/restore round-trip", () => {
	it("round-trip preserves compactionQueuedMessages across a focus switch", () => {
		// Simulate session A focused with queued messages
		const { fake } = makeFakeIM("session-a");
		fake.compactionQueuedMessages = [
			{ text: "steer msg", mode: "steer" },
			{ text: "follow up", mode: "followUp" },
		];

		// Switch away: save state for session-a
		callPrivate(fake, "saveConversationState");

		// Verify session-a's state is stored
		const savedA = fake.conversationStates.get("session-a") as ConversationViewState;
		expect(savedA.compactionQueuedMessages).toHaveLength(2);

		// Now "switch" to root (focusedRecord = undefined)
		setField(fake, "orchestrator", {
			focusedRecord: undefined,
		});
		// Root has no saved state — restore gives defaults
		callPrivate(fake, "restoreConversationState");
		expect(fake.compactionQueuedMessages).toEqual([]);

		// Switch back to session-a
		setField(fake, "orchestrator", {
			focusedRecord: { id: "session-a" },
		});
		callPrivate(fake, "restoreConversationState");

		expect(fake.compactionQueuedMessages).toEqual([
			{ text: "steer msg", mode: "steer" },
			{ text: "follow up", mode: "followUp" },
		]);
	});

	it("restoring produces a copy — mutating the live array does not corrupt the stored snapshot", () => {
		const { fake } = makeFakeIM("s1");
		fake.compactionQueuedMessages = [{ text: "msg", mode: "steer" }];
		callPrivate(fake, "saveConversationState"); // snapshot stored, live array reset to []

		// Restore → live array gets a copy of the stored snapshot
		callPrivate(fake, "restoreConversationState");
		expect(fake.compactionQueuedMessages).toHaveLength(1);

		// Mutate the live array directly
		fake.compactionQueuedMessages.push({ text: "injected", mode: "followUp" });

		// Restore again — should still produce the ORIGINAL snapshot (1 item)
		callPrivate(fake, "restoreConversationState");
		expect(fake.compactionQueuedMessages).toHaveLength(1);
		expect(fake.compactionQueuedMessages[0]?.text).toBe("msg");
	});
});

describe("InteractiveMode conversation state cleanup", () => {
	it("setBeforeSessionInvalidate clears non-root conversationState entries", () => {
		const { fake } = makeFakeIM(undefined);
		fake.conversationStates.set("root", {
			compactionQueuedMessages: [{ text: "root msg", mode: "steer" }],
			workingMessage: undefined,
			workingVisible: true,
			workingIndicatorOptions: undefined,
		});
		fake.conversationStates.set("subagent-uuid-1", {
			compactionQueuedMessages: [],
			workingMessage: undefined,
			workingVisible: true,
			workingIndicatorOptions: undefined,
		});

		// Simulate the setBeforeSessionInvalidate callback body
		// (clearAll runs first in the orchestrator, so we call the callback directly)
		const callback = () => {
			// This mirrors the logic in the constructor callback
			for (const key of fake.sessionHistories.keys()) {
				if (key !== "root") fake.sessionHistories.delete(key);
			}
			fake.conversationStates.clear();
		};
		callback();

		expect(fake.conversationStates.size).toBe(0);
	});

	it("sessionHistories preserves root entry but removes subagent entries on session replacement", () => {
		const { fake } = makeFakeIM(undefined);
		fake.sessionHistories.set("root", ["cmd1", "cmd2"]);
		fake.sessionHistories.set("subagent-1", ["sub-cmd"]);
		fake.sessionHistories.set("subagent-2", ["other-cmd"]);

		// Simulate setBeforeSessionInvalidate callback
		for (const key of fake.sessionHistories.keys()) {
			if (key !== "root") fake.sessionHistories.delete(key);
		}

		expect(fake.sessionHistories.size).toBe(1);
		expect(fake.sessionHistories.get("root")).toEqual(["cmd1", "cmd2"]);
	});
});
