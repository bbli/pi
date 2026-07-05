import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubagentRecord } from "../../src/core/agent-manager.ts";
import { AgentManager } from "../../src/core/agent-manager.ts";
import type { AgentSession, AgentSessionEvent } from "../../src/core/agent-session.ts";
import type { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";

// ─── Minimal mocks ────────────────────────────────────────────────────────────

interface MockSession {
	session: AgentSession;
	emit: (event: AgentSessionEvent) => void;
	abort: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
}

function makeMockSession(): MockSession {
	const listeners: Array<(event: AgentSessionEvent) => void> = [];
	const abort = vi.fn().mockResolvedValue(undefined);
	const dispose = vi.fn();

	const session = {
		subscribe(listener: (event: AgentSessionEvent) => void) {
			listeners.push(listener);
			return () => {
				const i = listeners.indexOf(listener);
				if (i !== -1) listeners.splice(i, 1);
			};
		},
		abort,
		dispose,
		setAgentManager: vi.fn(),
		addBuiltinTool: vi.fn(),
		prompt: vi.fn().mockResolvedValue(undefined),
		get isStreaming() {
			return false;
		},
		get retryAttempt() {
			return 0;
		},
	} as unknown as AgentSession;

	return {
		session,
		emit: (event) => {
			for (const l of [...listeners]) l(event);
		},
		abort,
		dispose,
	};
}

interface MockRuntime {
	runtime: AgentSessionRuntime;
	fireBeforeInvalidate: () => void;
	fireRebind: () => Promise<void>;
}

function makeMockRuntime(session: AgentSession): MockRuntime {
	let beforeInvalidateCb: (() => void) | undefined;
	let rebindCb: (() => Promise<void>) | undefined;

	const runtime = {
		get session() {
			return session;
		},
		setBeforeSessionInvalidate(cb: () => void) {
			beforeInvalidateCb = cb;
		},
		setRebindSession(cb: () => Promise<void>) {
			rebindCb = cb;
		},
		newSession: vi.fn().mockResolvedValue({ cancelled: false }),
		fork: vi.fn().mockResolvedValue({ cancelled: false }),
		switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
		importFromJsonl: vi.fn().mockResolvedValue({ cancelled: false }),
		dispose: vi.fn().mockResolvedValue(undefined),
		get services() {
			return {} as AgentSessionRuntime["services"];
		},
		get cwd() {
			return "/test";
		},
		get diagnostics() {
			return [];
		},
		get modelFallbackMessage() {
			return undefined;
		},
	} as unknown as AgentSessionRuntime;

	return {
		runtime,
		fireBeforeInvalidate: () => {
			if (!beforeInvalidateCb) throw new Error("setBeforeSessionInvalidate was never called");
			beforeInvalidateCb();
		},
		fireRebind: () => {
			if (!rebindCb) throw new Error("setRebindSession was never called");
			return rebindCb();
		},
	};
}

function makeRecord(
	id: string,
	session: AgentSession,
	kind: SubagentRecord["kind"] = "branch",
): Pick<SubagentRecord, "id" | "label" | "kind" | "session"> {
	return { id, label: id, kind, session };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentManager", () => {
	let rootMock: MockSession;
	let mock: MockRuntime;
	let manager: AgentManager;

	beforeEach(() => {
		vi.useFakeTimers();
		rootMock = makeMockSession();
		mock = makeMockRuntime(rootMock.session);
		manager = new AgentManager(mock.runtime);
	});

	afterEach(async () => {
		await manager.dispose();
		vi.useRealTimers();
	});

	// ── rootSession / focusedSession ─────────────────────────────────────────

	it("rootSession always returns the runtime session", () => {
		expect(manager.rootSession).toBe(rootMock.session);
	});

	it("focusedSession returns rootSession when nothing is focused", () => {
		expect(manager.focusedSession).toBe(rootMock.session);
	});

	it("focusedRecord is undefined when nothing is focused", () => {
		expect(manager.focusedRecord).toBeUndefined();
	});

	// ── register / getAll / get ──────────────────────────────────────────────

	it("stores a registered record accessible via getAll and get", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("r1", session));
		expect(manager.getAll()).toHaveLength(1);
		expect(manager.get("r1")?.id).toBe("r1");
		expect(manager.get("r1")?.label).toBe("r1");
	});

	it("stores multiple records", () => {
		const { session: s1 } = makeMockSession();
		const { session: s2 } = makeMockSession();
		manager.register(makeRecord("r1", s1, "branch"));
		manager.register(makeRecord("u1", s2, "user"));
		expect(manager.getAll()).toHaveLength(2);
	});

	// ── onStatusChange via agent_start / agent_end ───────────────────────────

	it("fires onStatusChange when a registered session emits agent_start", () => {
		const { session, emit } = makeMockSession();
		manager.register(makeRecord("r1", session));
		const cb = vi.fn();
		manager.onStatusChange = cb;

		emit({ type: "agent_start" } as AgentSessionEvent);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("fires onStatusChange when a registered session emits agent_end", () => {
		const { session, emit } = makeMockSession();
		manager.register(makeRecord("r1", session));
		const cb = vi.fn();
		manager.onStatusChange = cb;

		emit({ type: "agent_end", messages: [], willRetry: false } as AgentSessionEvent);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("does not fire onStatusChange for other event types", () => {
		const { session, emit } = makeMockSession();
		manager.register(makeRecord("r1", session));
		const cb = vi.fn();
		manager.onStatusChange = cb;

		emit({ type: "queue_update", steering: [], followUp: [] } as AgentSessionEvent);
		expect(cb).not.toHaveBeenCalled();
	});

	// ── remove ───────────────────────────────────────────────────────────────

	it("remove calls abort and dispose on the session", () => {
		const { session, abort, dispose } = makeMockSession();
		manager.register(makeRecord("r1", session));
		manager.remove("r1");
		expect(abort).toHaveBeenCalled();
		expect(dispose).toHaveBeenCalled();
	});

	it("remove deletes the record", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("r1", session));
		manager.remove("r1");
		expect(manager.getAll()).toHaveLength(0);
		expect(manager.get("r1")).toBeUndefined();
	});

	it("remove fires onStatusChange", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("r1", session));
		const cb = vi.fn();
		manager.onStatusChange = cb;
		manager.remove("r1");
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("remove with unknown id is a no-op", () => {
		expect(() => manager.remove("nonexistent")).not.toThrow();
	});

	it("remove unsubscribes the status listener so no further callbacks fire", () => {
		const { session, emit } = makeMockSession();
		manager.register(makeRecord("r1", session));
		const cb = vi.fn();
		manager.onStatusChange = cb;
		manager.remove("r1");
		cb.mockClear();
		emit({ type: "agent_start" } as AgentSessionEvent);
		expect(cb).not.toHaveBeenCalled();
	});

	// ── focus ────────────────────────────────────────────────────────────────

	it("focus sets focusedSession to the record's session", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("r1", session));
		manager.focus(manager.get("r1"));
		expect(manager.focusedSession).toBe(session);
		expect(manager.focusedRecord?.id).toBe("r1");
	});

	it("focus(undefined) resets focusedSession back to root", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("r1", session));
		manager.focus(manager.get("r1"));
		manager.focus(undefined);
		expect(manager.focusedSession).toBe(rootMock.session);
		expect(manager.focusedRecord).toBeUndefined();
	});

	it("focusing a user-kind record does not start a TTL", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("u1", session, "user"));
		manager.focus(manager.get("u1"));

		vi.advanceTimersByTime(120_000);
		expect(manager.get("u1")).toBeDefined();
	});

	// ── kill ─────────────────────────────────────────────────────────────────

	it("kill removes the record", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("r1", session));
		manager.kill("r1");
		expect(manager.get("r1")).toBeUndefined();
	});

	it("kill resets focus to root if the killed record was focused", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("r1", session));
		manager.focus(manager.get("r1"));
		manager.kill("r1");
		expect(manager.focusedSession).toBe(rootMock.session);
		expect(manager.focusedRecord).toBeUndefined();
	});

	it("kill refocuses to the most recently registered remaining record", () => {
		const { session: s1 } = makeMockSession();
		const { session: s2 } = makeMockSession();
		manager.register(makeRecord("r1", s1));
		manager.register(makeRecord("r2", s2));
		manager.focus(manager.get("r1"));
		manager.kill("r1");
		expect(manager.focusedRecord?.id).toBe("r2");
	});

	it("kill of a non-focused record leaves focus unchanged", () => {
		const { session: s1 } = makeMockSession();
		const { session: s2 } = makeMockSession();
		manager.register(makeRecord("r1", s1));
		manager.register(makeRecord("r2", s2));
		manager.focus(manager.get("r2"));
		manager.kill("r1");
		expect(manager.focusedRecord?.id).toBe("r2");
		expect(manager.focusedSession).toBe(s2);
	});

	// ── startTTL ─────────────────────────────────────────────────────────────

	it("startTTL fires the callback after the specified delay", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("r1", session));
		const onExpire = vi.fn();
		manager.startTTL("r1", 60_000, onExpire);

		vi.advanceTimersByTime(59_999);
		expect(onExpire).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(onExpire).toHaveBeenCalledTimes(1);
	});

	it("startTTL on unknown id is a no-op", () => {
		expect(() => manager.startTTL("nonexistent", 1000, vi.fn())).not.toThrow();
	});

	// ── refreshTTL ───────────────────────────────────────────────────────────

	it("refreshTTL cancels the old timer so its callback never fires", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("r1", session));

		const oldExpire = vi.fn();
		manager.startTTL("r1", 60_000, oldExpire);

		vi.advanceTimersByTime(30_000);
		const newExpire = vi.fn();
		manager.refreshTTL("r1", 60_000, newExpire);

		vi.advanceTimersByTime(30_000);
		expect(oldExpire).not.toHaveBeenCalled();
		expect(newExpire).not.toHaveBeenCalled();

		vi.advanceTimersByTime(30_000);
		expect(newExpire).toHaveBeenCalledTimes(1);
	});

	// ── clearAll / dispose ───────────────────────────────────────────────────

	it("clearAll removes all records and disposes each session", () => {
		const m1 = makeMockSession();
		const m2 = makeMockSession();
		manager.register(makeRecord("r1", m1.session));
		manager.register(makeRecord("r2", m2.session));
		manager.clearAll();
		expect(manager.getAll()).toHaveLength(0);
		expect(m1.dispose).toHaveBeenCalled();
		expect(m2.dispose).toHaveBeenCalled();
	});

	it("clearAll cancels pending TTL timers", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("r1", session));
		const onExpire = vi.fn();
		manager.startTTL("r1", 60_000, onExpire);
		manager.clearAll();
		vi.advanceTimersByTime(60_000);
		expect(onExpire).not.toHaveBeenCalled();
	});

	// ── setBeforeSessionInvalidate chaining ──────────────────────────────────

	it("clears registry before the user beforeInvalidate callback runs", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("r1", session));

		let recordCountWhenCalled = -1;
		manager.setBeforeSessionInvalidate(() => {
			recordCountWhenCalled = manager.getAll().length;
		});

		mock.fireBeforeInvalidate();
		expect(recordCountWhenCalled).toBe(0);
	});

	it("resets focusedSession to root before the user beforeInvalidate callback runs", () => {
		const { session } = makeMockSession();
		manager.register(makeRecord("r1", session));
		manager.focus(manager.get("r1"));

		let focusedWhenCalled: AgentSession | undefined;
		manager.setBeforeSessionInvalidate(() => {
			focusedWhenCalled = manager.focusedSession;
		});

		mock.fireBeforeInvalidate();
		expect(focusedWhenCalled).toBe(rootMock.session);
	});

	it("still calls the user rebind callback when rebind fires", async () => {
		const rebindCb = vi.fn().mockResolvedValue(undefined);
		manager.setRebindSession(rebindCb);
		await mock.fireRebind();
		expect(rebindCb).toHaveBeenCalledTimes(1);
	});

	it("re-wires setAgentManager and addBuiltinTool on session rebind", async () => {
		const setAgentManagerSpy = vi.spyOn(rootMock.session, "setAgentManager");
		const addBuiltinToolSpy = vi.spyOn(rootMock.session, "addBuiltinTool");
		manager.setRebindSession(vi.fn().mockResolvedValue(undefined));
		await mock.fireRebind();
		expect(setAgentManagerSpy).toHaveBeenCalledTimes(1);
		expect(addBuiltinToolSpy).toHaveBeenCalledTimes(1);
	});

	// ── pass-throughs ────────────────────────────────────────────────────────

	it("delegates newSession to the runtime", async () => {
		await manager.newSession();
		expect(mock.runtime.newSession).toHaveBeenCalled();
	});

	it("delegates fork to the runtime", async () => {
		await manager.fork("entry-id");
		expect(mock.runtime.fork).toHaveBeenCalledWith("entry-id");
	});
});
