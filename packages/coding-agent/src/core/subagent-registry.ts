import type { AgentSession } from "./agent-session.ts";

export type SubagentKind = "reviewer" | "user" | "branch";

export interface SubagentRecord {
	readonly id: string;
	readonly label: string;
	readonly kind: SubagentKind;
	readonly session: AgentSession;
	ttlTimer: ReturnType<typeof setTimeout> | undefined;
	unsubscribeStatus: (() => void) | undefined;
	/** Called by consider.ts after sendUserMessage — refreshes the TTL from injection time. */
	onInjected: (() => void) | undefined;
}

export class SubagentRegistry {
	private readonly _records = new Map<string, SubagentRecord>();
	onStatusChange: (() => void) | undefined = undefined;
	/** Fired after a new record is added. Orchestrator uses this to start TTLs. */
	onRegister: ((record: SubagentRecord) => void) | undefined = undefined;

	register(record: Pick<SubagentRecord, "id" | "label" | "kind" | "session">): void {
		const unsubscribeStatus = record.session.subscribe((event) => {
			if (event.type === "agent_start" || event.type === "agent_end") {
				this.onStatusChange?.();
			}
		});
		const stored: SubagentRecord = { ...record, ttlTimer: undefined, unsubscribeStatus, onInjected: undefined };
		this._records.set(record.id, stored);
		this.onRegister?.(stored);
		this.onStatusChange?.();
	}

	remove(id: string): void {
		const record = this._records.get(id);
		if (!record) return;
		if (record.ttlTimer !== undefined) {
			clearTimeout(record.ttlTimer);
		}
		record.unsubscribeStatus?.();
		void record.session.abort().catch(() => {});
		record.session.dispose();
		this._records.delete(id);
		this.onStatusChange?.();
	}

	get(id: string): SubagentRecord | undefined {
		return this._records.get(id);
	}

	getAll(): readonly SubagentRecord[] {
		return Array.from(this._records.values());
	}

	startTTL(id: string, ms: number, onExpire: () => void): void {
		const record = this._records.get(id);
		if (!record) return;
		const timer = setTimeout(onExpire, ms);
		timer.unref?.();
		record.ttlTimer = timer;
	}

	refreshTTL(id: string, ms: number, onExpire: () => void): void {
		const record = this._records.get(id);
		if (!record) return;
		if (record.ttlTimer !== undefined) {
			clearTimeout(record.ttlTimer);
		}
		const timer = setTimeout(onExpire, ms);
		timer.unref?.();
		record.ttlTimer = timer;
	}

	clearAll(): void {
		for (const id of Array.from(this._records.keys())) {
			this.remove(id);
		}
	}

	dispose(): void {
		this.clearAll();
	}
}
