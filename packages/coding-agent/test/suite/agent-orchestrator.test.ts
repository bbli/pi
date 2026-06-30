import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOrchestrator } from "../../src/core/agent-orchestrator.ts";
import type { AgentSession } from "../../src/core/agent-session.ts";
import type { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import type { SubagentRecord } from "../../src/core/subagent-registry.ts";

// ─── Minimal mocks ────────────────────────────────────────────────────────────

function makeMockSession(): AgentSession {
	return {
		subscribe: vi.fn().mockReturnValue(() => {}),
		abort: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn(),
		setSubagentRegistry: vi.fn(),
		addBuiltinTool: vi.fn(),
		prompt: vi.fn().mockResolvedValue(undefined),
		get isStreaming() {
			return false;
		},
		get retryAttempt() {
			return 0;
		},
	} as unknown as AgentSession;
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

function makeRecord(id: string, session: AgentSession, kind: SubagentRecord["kind"] = "branch"): SubagentRecord {
	return { id, label: id, kind, session, ttlTimer: undefined, unsubscribeStatus: undefined };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentOrchestrator", () => {
	let rootSession: AgentSession;
	let mock: MockRuntime;
	let orchestrator: AgentOrchestrator;

	beforeEach(() => {
		vi.useFakeTimers();
		rootSession = makeMockSession();
		mock = makeMockRuntime(rootSession);
		orchestrator = new AgentOrchestrator(mock.runtime);
	});

	afterEach(async () => {
		await orchestrator.dispose();
		vi.useRealTimers();
	});

	// ── rootSession / focusedSession ─────────────────────────────────────────

	it("rootSession always returns the runtime session", () => {
		expect(orchestrator.rootSession).toBe(rootSession);
	});

	it("focusedSession returns rootSession when nothing is focused", () => {
		expect(orchestrator.focusedSession).toBe(rootSession);
	});

	it("focusedRecord is undefined when nothing is focused", () => {
		expect(orchestrator.focusedRecord).toBeUndefined();
	});

	// ── focus ────────────────────────────────────────────────────────────────

	it("focus sets focusedSession to the record's session", () => {
		const sub = makeMockSession();
		const record = makeRecord("r1", sub);
		orchestrator.registry.register(record);
		orchestrator.focus(orchestrator.registry.get("r1"));
		expect(orchestrator.focusedSession).toBe(sub);
		expect(orchestrator.focusedRecord?.id).toBe("r1");
	});

	it("focus(undefined) resets focusedSession back to root", () => {
		const sub = makeMockSession();
		const record = makeRecord("r1", sub);
		orchestrator.registry.register(record);
		orchestrator.focus(orchestrator.registry.get("r1"));
		orchestrator.focus(undefined);
		expect(orchestrator.focusedSession).toBe(rootSession);
		expect(orchestrator.focusedRecord).toBeUndefined();
	});

	it("focusing a branch-kind record does not start a TTL", () => {
		const sub = makeMockSession();
		orchestrator.registry.register(makeRecord("u1", sub, "user"));
		orchestrator.focus(orchestrator.registry.get("u1"));

		vi.advanceTimersByTime(120_000);
		expect(orchestrator.registry.get("u1")).toBeDefined();
	});

	// ── kill ─────────────────────────────────────────────────────────────────

	it("kill removes the record from the registry", () => {
		const sub = makeMockSession();
		orchestrator.registry.register(makeRecord("r1", sub));
		orchestrator.kill("r1");
		expect(orchestrator.registry.get("r1")).toBeUndefined();
	});

	it("kill resets focus to root if the killed record was focused", () => {
		const sub = makeMockSession();
		orchestrator.registry.register(makeRecord("r1", sub));
		orchestrator.focus(orchestrator.registry.get("r1"));
		orchestrator.kill("r1");
		expect(orchestrator.focusedSession).toBe(rootSession);
		expect(orchestrator.focusedRecord).toBeUndefined();
	});

	it("kill refocuses to the most recently registered remaining record", () => {
		const s1 = makeMockSession();
		const s2 = makeMockSession();
		orchestrator.registry.register(makeRecord("r1", s1));
		orchestrator.registry.register(makeRecord("r2", s2));
		orchestrator.focus(orchestrator.registry.get("r1"));
		orchestrator.kill("r1");
		expect(orchestrator.focusedRecord?.id).toBe("r2");
	});

	it("kill of a non-focused record leaves focus unchanged", () => {
		const s1 = makeMockSession();
		const s2 = makeMockSession();
		orchestrator.registry.register(makeRecord("r1", s1));
		orchestrator.registry.register(makeRecord("r2", s2));
		orchestrator.focus(orchestrator.registry.get("r2"));
		orchestrator.kill("r1");
		expect(orchestrator.focusedRecord?.id).toBe("r2");
		expect(orchestrator.focusedSession).toBe(s2);
	});

	// ── setBeforeSessionInvalidate chaining ──────────────────────────────────

	it("clears registry before the user beforeInvalidate callback runs", () => {
		const sub = makeMockSession();
		orchestrator.registry.register(makeRecord("r1", sub));

		let registrySizeWhenCalled = -1;
		orchestrator.setBeforeSessionInvalidate(() => {
			registrySizeWhenCalled = orchestrator.registry.getAll().length;
		});

		mock.fireBeforeInvalidate();
		expect(registrySizeWhenCalled).toBe(0);
	});

	it("resets focusedSession to root before the user beforeInvalidate callback runs", () => {
		const sub = makeMockSession();
		orchestrator.registry.register(makeRecord("r1", sub));
		orchestrator.focus(orchestrator.registry.get("r1"));

		let focusedWhenCalled: AgentSession | undefined;
		orchestrator.setBeforeSessionInvalidate(() => {
			focusedWhenCalled = orchestrator.focusedSession;
		});

		mock.fireBeforeInvalidate();
		expect(focusedWhenCalled).toBe(rootSession);
	});

	it("still calls the user rebind callback when rebind fires", async () => {
		const rebindCb = vi.fn().mockResolvedValue(undefined);
		orchestrator.setRebindSession(rebindCb);
		await mock.fireRebind();
		expect(rebindCb).toHaveBeenCalledTimes(1);
	});

	// ── pass-throughs ────────────────────────────────────────────────────────

	it("delegates newSession to the runtime", async () => {
		await orchestrator.newSession();
		expect(mock.runtime.newSession).toHaveBeenCalled();
	});

	it("delegates fork to the runtime", async () => {
		await orchestrator.fork("entry-id");
		expect(mock.runtime.fork).toHaveBeenCalledWith("entry-id");
	});
});
