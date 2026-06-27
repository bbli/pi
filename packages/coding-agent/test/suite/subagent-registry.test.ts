import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, AgentSessionEvent } from "../../src/core/agent-session.ts";
import { SubagentRegistry } from "../../src/core/subagent-registry.ts";

// ─── Minimal AgentSession mock ────────────────────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SubagentRegistry", () => {
	let registry: SubagentRegistry;

	beforeEach(() => {
		vi.useFakeTimers();
		registry = new SubagentRegistry();
	});

	afterEach(() => {
		registry.dispose();
		vi.useRealTimers();
	});

	// ── register / getAll / get ──────────────────────────────────────────────

	it("stores a registered record accessible via getAll and get", () => {
		const { session } = makeMockSession();
		registry.register({ id: "r1", label: "reviewer", kind: "branch", session });
		expect(registry.getAll()).toHaveLength(1);
		expect(registry.get("r1")?.id).toBe("r1");
		expect(registry.get("r1")?.label).toBe("reviewer");
	});

	it("stores multiple records", () => {
		const { session: s1 } = makeMockSession();
		const { session: s2 } = makeMockSession();
		registry.register({ id: "r1", label: "reviewer-1", kind: "branch", session: s1 });
		registry.register({ id: "u1", label: "agent-1", kind: "user", session: s2 });
		expect(registry.getAll()).toHaveLength(2);
	});

	// ── onStatusChange via agent_start / agent_end ───────────────────────────

	it("fires onStatusChange when a registered session emits agent_start", () => {
		const { session, emit } = makeMockSession();
		registry.register({ id: "r1", label: "reviewer", kind: "branch", session });
		const cb = vi.fn();
		registry.onStatusChange = cb;

		emit({ type: "agent_start" } as AgentSessionEvent);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("fires onStatusChange when a registered session emits agent_end", () => {
		const { session, emit } = makeMockSession();
		registry.register({ id: "r1", label: "reviewer", kind: "branch", session });
		const cb = vi.fn();
		registry.onStatusChange = cb;

		emit({ type: "agent_end", messages: [], willRetry: false } as AgentSessionEvent);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("does not fire onStatusChange for other event types", () => {
		const { session, emit } = makeMockSession();
		registry.register({ id: "r1", label: "reviewer", kind: "branch", session });
		const cb = vi.fn();
		registry.onStatusChange = cb;

		emit({ type: "queue_update", steering: [], followUp: [] } as AgentSessionEvent);
		expect(cb).not.toHaveBeenCalled();
	});

	// ── remove ───────────────────────────────────────────────────────────────

	it("remove calls abort and dispose on the session", () => {
		const { session, abort, dispose } = makeMockSession();
		registry.register({ id: "r1", label: "reviewer", kind: "branch", session });
		registry.remove("r1");
		expect(abort).toHaveBeenCalled();
		expect(dispose).toHaveBeenCalled();
	});

	it("remove deletes the record from the registry", () => {
		const { session } = makeMockSession();
		registry.register({ id: "r1", label: "reviewer", kind: "branch", session });
		registry.remove("r1");
		expect(registry.getAll()).toHaveLength(0);
		expect(registry.get("r1")).toBeUndefined();
	});

	it("remove fires onStatusChange", () => {
		const { session } = makeMockSession();
		registry.register({ id: "r1", label: "reviewer", kind: "branch", session });
		const cb = vi.fn();
		registry.onStatusChange = cb;
		registry.remove("r1");
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("remove with unknown id is a no-op", () => {
		expect(() => registry.remove("nonexistent")).not.toThrow();
	});

	it("remove unsubscribes the status listener so no further callbacks fire", () => {
		const { session, emit } = makeMockSession();
		registry.register({ id: "r1", label: "reviewer", kind: "branch", session });
		const cb = vi.fn();
		registry.onStatusChange = cb;
		registry.remove("r1");
		cb.mockClear();
		emit({ type: "agent_start" } as AgentSessionEvent);
		expect(cb).not.toHaveBeenCalled();
	});

	// ── startTTL ─────────────────────────────────────────────────────────────

	it("startTTL fires the callback after the specified delay", () => {
		const { session } = makeMockSession();
		registry.register({ id: "r1", label: "reviewer", kind: "branch", session });
		const onExpire = vi.fn();
		registry.startTTL("r1", 60_000, onExpire);

		vi.advanceTimersByTime(59_999);
		expect(onExpire).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(onExpire).toHaveBeenCalledTimes(1);
	});

	it("startTTL on unknown id is a no-op", () => {
		expect(() => registry.startTTL("nonexistent", 1000, vi.fn())).not.toThrow();
	});

	// ── refreshTTL ───────────────────────────────────────────────────────────

	it("refreshTTL cancels the old timer so its callback never fires", () => {
		const { session } = makeMockSession();
		registry.register({ id: "r1", label: "reviewer", kind: "branch", session });

		const oldExpire = vi.fn();
		registry.startTTL("r1", 60_000, oldExpire);

		vi.advanceTimersByTime(30_000);
		const newExpire = vi.fn();
		registry.refreshTTL("r1", 60_000, newExpire);

		// Old timer would have fired at t=60s but was cancelled
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
		registry.register({ id: "r1", label: "reviewer-1", kind: "branch", session: m1.session });
		registry.register({ id: "r2", label: "reviewer-2", kind: "branch", session: m2.session });
		registry.clearAll();
		expect(registry.getAll()).toHaveLength(0);
		expect(m1.dispose).toHaveBeenCalled();
		expect(m2.dispose).toHaveBeenCalled();
	});

	it("clearAll cancels pending TTL timers", () => {
		const { session } = makeMockSession();
		registry.register({ id: "r1", label: "reviewer", kind: "branch", session });
		const onExpire = vi.fn();
		registry.startTTL("r1", 60_000, onExpire);
		registry.clearAll();
		vi.advanceTimersByTime(60_000);
		expect(onExpire).not.toHaveBeenCalled();
	});
});
