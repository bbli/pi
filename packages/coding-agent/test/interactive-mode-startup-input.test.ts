import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

/**
 * Minimal context shape that satisfies the onSubmit closure for a plain
 * (non-slash, non-bash) message on an idle, non-compacting session.
 *
 * `defaultEditor` is an own property so it shadows the `get defaultEditor()`
 * prototype getter; `setupEditorSubmitHandler` writes `onSubmit` onto it.
 * `active` is an own property so `this.active.*` reads work without the real
 * AgentPane/focusedId machinery.
 */
type SubmitContext = {
	defaultEditor: { onSubmit?: (text: string) => Promise<void> };
	editor: {
		addToHistory?: (text: string) => void;
		setText: (text: string) => void;
	};
	active: {
		isCompacting: boolean;
		isStreaming: boolean;
		session: {
			isBashRunning: boolean;
			prompt: (text: string, options?: unknown) => Promise<void>;
		};
	};
	isPaneCommand: (text: string) => boolean;
	flushPendingBashComponents: () => void;
	showError: (msg: string) => void;
};

type InteractiveModePrivate = {
	setupEditorSubmitHandler(this: SubmitContext): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrivate;

function createSubmitContext(): SubmitContext {
	return {
		defaultEditor: {},
		editor: {
			addToHistory: vi.fn(),
			setText: vi.fn(),
		},
		active: {
			isCompacting: false,
			isStreaming: false,
			session: {
				isBashRunning: false,
				prompt: vi.fn(async () => {}),
			},
		},
		isPaneCommand: vi.fn(() => false),
		flushPendingBashComponents: vi.fn(),
		showError: vi.fn(),
	};
}

describe("InteractiveMode onSubmit — idle session dispatch", () => {
	it("calls active.session.prompt() directly for a plain message on an idle session", async () => {
		const context = createSubmitContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.(" hello world ");

		expect(context.active.session.prompt).toHaveBeenCalledWith("hello world");
		expect(context.flushPendingBashComponents).toHaveBeenCalledTimes(1);
		expect(context.editor.addToHistory).toHaveBeenCalledWith("hello world");
	});

	it("surfaces prompt() rejections via showError", async () => {
		const context = createSubmitContext();
		const boom = new Error("no model selected");
		context.active.session.prompt = vi.fn(async () => {
			throw boom;
		});
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("hello");

		// Give the fire-and-forget .catch() a microtask to run
		await Promise.resolve();

		expect(context.showError).toHaveBeenCalledWith("no model selected");
	});
});
