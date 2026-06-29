/**
 * Debug trace logging. Enable with --debug CLI flag or PI_DEBUG=1 env var.
 */

let enabled = process.env.PI_DEBUG === "1";

export function setDebug(on: boolean): void {
	enabled = on;
}

export function isDebugEnabled(): boolean {
	return enabled;
}

export function debugLog(...args: unknown[]): void {
	if (!enabled) return;
	console.error("[debug]", ...args);
}
