/**
 * Tests for ExtensionRunner - conflict detection, error handling, tool wrapping.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import * as branchSessionModule from "../src/core/branch-session.ts";
import { createExtensionRuntime, discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner, makeInjectGuidelineTool } from "../src/core/extensions/runner.ts";
import type {
	BranchSessionOptions,
	ExtensionActions,
	ExtensionContextActions,
	ExtensionUIContext,
	ProviderConfig,
	ToolDefinition,
	TurnEndEvent,
} from "../src/core/extensions/types.ts";
import { KeybindingsManager, type KeyId } from "../src/core/keybindings.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { makeResearchTool } from "../src/core/tools/research.ts";

describe("ExtensionRunner", () => {
	let tempDir: string;
	let extensionsDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;
	const defaultKeybindings = new KeybindingsManager().getEffectiveConfig();

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-runner-test-"));
		extensionsDir = path.join(tempDir, "extensions");
		fs.mkdirSync(extensionsDir);
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	const providerModelConfig: ProviderConfig = {
		baseUrl: "https://provider.test/v1",
		apiKey: "provider-test-key",
		api: "openai-completions",
		models: [
			{
				id: "instant-model",
				name: "Instant Model",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			},
		],
	};

	const extensionActions: ExtensionActions = {
		sendMessage: () => {},
		sendUserMessage: () => {},
		appendEntry: () => {},
		setSessionName: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: () => {},
		refreshTools: () => {},
		getCommands: () => [],
		setModel: async () => false,
		getThinkingLevel: () => "off",
		setThinkingLevel: () => {},
		runBranchSession: async () => undefined,
		newBranchSession: async () => "",
		makeInjectMessageTool: () => ({}) as unknown as ToolDefinition,
		getContinuations: () => [],
		injectUserMessage: () => {},
	};

	const extensionContextActions: ExtensionContextActions = {
		getModel: () => undefined,
		isIdle: () => true,
		getSignal: () => undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};

	describe("shortcut conflicts", () => {
		it("warns when extension shortcut conflicts with built-in", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerShortcut("ctrl+c", {
						description: "Conflicts with built-in",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "conflict.ts"), extCode);

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const shortcuts = runner.getShortcuts(defaultKeybindings);

			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));
			expect(shortcuts.has("ctrl+c")).toBe(false);

			warnSpy.mockRestore();
		});

		it("allows a shortcut when the reserved set no longer contains the default key", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerShortcut("ctrl+p", {
						description: "Uses freed default",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "rebinding.ts"), extCode);

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const keybindings = { ...defaultKeybindings, "app.model.cycleForward": "ctrl+n" as KeyId };
			const shortcuts = runner.getShortcuts(keybindings);

			expect(shortcuts.has("ctrl+p")).toBe(true);
			expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));

			warnSpy.mockRestore();
		});

		it("warns but allows when extension uses non-reserved built-in shortcut", async () => {
			const pasteImageKey = Array.isArray(defaultKeybindings["app.clipboard.pasteImage"])
				? (defaultKeybindings["app.clipboard.pasteImage"][0] ?? "")
				: defaultKeybindings["app.clipboard.pasteImage"];
			const extCode = `
				export default function(pi) {
					pi.registerShortcut("${pasteImageKey}", {
						description: "Overrides non-reserved",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "non-reserved.ts"), extCode);

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const shortcuts = runner.getShortcuts(defaultKeybindings);

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("built-in shortcut for app.clipboard.pasteImage"),
			);
			expect(shortcuts.has(pasteImageKey as KeyId)).toBe(true);

			warnSpy.mockRestore();
		});

		it("blocks shortcuts for reserved actions even when rebound", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerShortcut("ctrl+x", {
						description: "Conflicts with rebound reserved",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "rebound-reserved.ts"), extCode);

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const keybindings = { ...defaultKeybindings, "app.interrupt": "ctrl+x" as KeyId };
			const shortcuts = runner.getShortcuts(keybindings);

			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));
			expect(shortcuts.has("ctrl+x")).toBe(false);

			warnSpy.mockRestore();
		});

		it("blocks shortcuts when reserved key is also bound to non-reserved actions", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerShortcut("ctrl+p", {
						description: "Conflicts with shared reserved default",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "shared-reserved.ts"), extCode);

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const shortcuts = runner.getShortcuts(defaultKeybindings);

			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));
			expect(shortcuts.has("ctrl+p")).toBe(false);

			warnSpy.mockRestore();
		});

		it("blocks shortcuts when reserved action has multiple keys", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerShortcut("ctrl+y", {
						description: "Conflicts with multi-key reserved",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "multi-reserved.ts"), extCode);

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const keybindings = { ...defaultKeybindings, "app.clear": ["ctrl+x", "ctrl+y"] as KeyId[] };
			const shortcuts = runner.getShortcuts(keybindings);

			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"));
			expect(shortcuts.has("ctrl+y")).toBe(false);

			warnSpy.mockRestore();
		});

		it("warns but allows when non-reserved action has multiple keys", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerShortcut("ctrl+y", {
						description: "Overrides multi-key non-reserved",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "multi-non-reserved.ts"), extCode);

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const keybindings = { ...defaultKeybindings, "app.clipboard.pasteImage": ["ctrl+x", "ctrl+y"] as KeyId[] };
			const shortcuts = runner.getShortcuts(keybindings);

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("built-in shortcut for app.clipboard.pasteImage"),
			);
			expect(shortcuts.has("ctrl+y")).toBe(true);

			warnSpy.mockRestore();
		});

		it("warns when two extensions register same shortcut", async () => {
			// Use a non-reserved shortcut
			const extCode1 = `
				export default function(pi) {
					pi.registerShortcut("ctrl+shift+x", {
						description: "First extension",
						handler: async () => {},
					});
				}
			`;
			const extCode2 = `
				export default function(pi) {
					pi.registerShortcut("ctrl+shift+x", {
						description: "Second extension",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "ext1.ts"), extCode1);
			fs.writeFileSync(path.join(extensionsDir, "ext2.ts"), extCode2);

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const shortcuts = runner.getShortcuts(defaultKeybindings);

			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("shortcut conflict"));
			// Last one wins
			expect(shortcuts.has("ctrl+shift+x")).toBe(true);

			warnSpy.mockRestore();
		});
	});

	describe("tool collection", () => {
		it("collects tools from multiple extensions", async () => {
			const toolCode = (name: string) => `
				import { Type } from "typebox";
				export default function(pi) {
					pi.registerTool({
						name: "${name}",
						label: "${name}",
						description: "Test tool",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "tool-a.ts"), toolCode("tool_a"));
			fs.writeFileSync(path.join(extensionsDir, "tool-b.ts"), toolCode("tool_b"));

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const tools = runner.getAllRegisteredTools();

			expect(tools.length).toBe(2);
			expect(tools.map((t) => t.definition.name).sort()).toEqual(["tool_a", "tool_b"]);
		});

		it("keeps first tool when two extensions register the same name", async () => {
			const first = `
				import { Type } from "typebox";
				export default function(pi) {
					pi.registerTool({
						name: "shared",
						label: "shared",
						description: "first",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					});
				}
			`;
			const second = `
				import { Type } from "typebox";
				export default function(pi) {
					pi.registerTool({
						name: "shared",
						label: "shared",
						description: "second",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "a-first.ts"), first);
			fs.writeFileSync(path.join(extensionsDir, "b-second.ts"), second);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const tools = runner.getAllRegisteredTools();

			expect(tools).toHaveLength(1);
			expect(tools[0]?.definition.description).toBe("first");
		});
	});

	describe("command collection", () => {
		it("collects commands from multiple extensions", async () => {
			const cmdCode = (name: string) => `
				export default function(pi) {
					pi.registerCommand("${name}", {
						description: "Test command",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "cmd-a.ts"), cmdCode("cmd-a"));
			fs.writeFileSync(path.join(extensionsDir, "cmd-b.ts"), cmdCode("cmd-b"));

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const commands = runner.getRegisteredCommands();

			expect(commands.length).toBe(2);
			expect(commands.map((c) => c.name).sort()).toEqual(["cmd-a", "cmd-b"]);
			expect(commands.map((c) => c.invocationName).sort()).toEqual(["cmd-a", "cmd-b"]);
		});

		it("gets command by invocation name", async () => {
			const cmdCode = `
				export default function(pi) {
					pi.registerCommand("my-cmd", {
						description: "My command",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "cmd.ts"), cmdCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const cmd = runner.getCommand("my-cmd");
			expect(cmd).toBeDefined();
			expect(cmd?.name).toBe("my-cmd");
			expect(cmd?.invocationName).toBe("my-cmd");
			expect(cmd?.description).toBe("My command");

			const missing = runner.getCommand("not-exists");
			expect(missing).toBeUndefined();
		});

		it("suffixes duplicate extension commands in insertion order", async () => {
			const cmdCode = (description: string) => `
				export default function(pi) {
					pi.registerCommand("shared-cmd", {
						description: "${description}",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "cmd-a.ts"), cmdCode("First command"));
			fs.writeFileSync(path.join(extensionsDir, "cmd-b.ts"), cmdCode("Second command"));

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const commands = runner.getRegisteredCommands();
			const diagnostics = runner.getCommandDiagnostics();

			expect(commands).toHaveLength(2);
			expect(commands.map((command) => command.name)).toEqual(["shared-cmd", "shared-cmd"]);
			expect(commands.map((command) => command.invocationName)).toEqual(["shared-cmd:1", "shared-cmd:2"]);
			expect(commands.map((command) => command.description)).toEqual(["First command", "Second command"]);
			expect(diagnostics).toEqual([]);
			expect(runner.getCommand("shared-cmd:1")?.description).toBe("First command");
			expect(runner.getCommand("shared-cmd:2")?.description).toBe("Second command");
		});
	});

	describe("context creation", () => {
		it("exposes the current abort signal on ExtensionContext", async () => {
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const controller = new AbortController();

			runner.bindCore(extensionActions, {
				...extensionContextActions,
				getSignal: () => controller.signal,
			});

			const ctx = runner.createContext();
			expect(ctx.signal).toBe(controller.signal);
			expect(ctx.signal?.aborted).toBe(false);

			controller.abort();
			expect(ctx.signal?.aborted).toBe(true);
		});

		it("exposes print mode and hasUI false by default", async () => {
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			runner.bindCore(extensionActions, extensionContextActions);

			const ctx = runner.createContext();
			expect(ctx.mode).toBe("print");
			expect(ctx.hasUI).toBe(false);
		});

		it("exposes rpc mode with hasUI true when an RPC UI context is provided", async () => {
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			runner.bindCore(extensionActions, extensionContextActions);
			runner.setUIContext({} as ExtensionUIContext, "rpc");

			const ctx = runner.createContext();
			expect(ctx.mode).toBe("rpc");
			expect(ctx.hasUI).toBe(true);
		});

		it("exposes tui mode with hasUI true when a TUI UI context is provided", async () => {
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			runner.bindCore(extensionActions, extensionContextActions);
			runner.setUIContext({} as ExtensionUIContext, "tui");

			const ctx = runner.createContext();
			expect(ctx.mode).toBe("tui");
			expect(ctx.hasUI).toBe(true);
		});
	});

	describe("error handling", () => {
		it("calls error listeners when handler throws", async () => {
			const extCode = `
				export default function(pi) {
					pi.on("context", async () => {
						throw new Error("Handler error!");
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "throws.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const errors: Array<{ extensionPath: string; event: string; error: string }> = [];
			runner.onError((err) => {
				errors.push(err);
			});

			// Emit context event which will trigger the throwing handler
			await runner.emitContext([]);

			expect(errors.length).toBe(1);
			expect(errors[0].error).toContain("Handler error!");
			expect(errors[0].event).toBe("context");
		});
	});

	describe("message renderers", () => {
		it("gets message renderer by type", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerMessageRenderer("my-type", (message, options, theme) => null);
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "renderer.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const renderer = runner.getMessageRenderer("my-type");
			expect(renderer).toBeDefined();

			const missing = runner.getMessageRenderer("not-exists");
			expect(missing).toBeUndefined();
		});
	});

	describe("flags", () => {
		it("collects flags from extensions", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerFlag("my-flag", {
						description: "My flag",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "with-flag.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const flags = runner.getFlags();

			expect(flags.has("my-flag")).toBe(true);
		});

		it("keeps first flag when two extensions register the same name", async () => {
			const first = `
				export default function(pi) {
					pi.registerFlag("shared-flag", {
						description: "first",
						type: "boolean",
						default: true,
					});
				}
			`;
			const second = `
				export default function(pi) {
					pi.registerFlag("shared-flag", {
						description: "second",
						type: "boolean",
						default: false,
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "a-first.ts"), first);
			fs.writeFileSync(path.join(extensionsDir, "b-second.ts"), second);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const flags = runner.getFlags();

			expect(flags.get("shared-flag")?.description).toBe("first");
			expect(result.runtime.flagValues.get("shared-flag")).toBe(true);
		});

		it("can set flag values", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerFlag("test-flag", {
						description: "Test flag",
						handler: async () => {},
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "flag.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			// Setting a flag value should not throw
			runner.setFlagValue("--test-flag", true);

			// The flag values are stored in the shared runtime
			expect(result.runtime.flagValues.get("--test-flag")).toBe(true);
		});
	});

	describe("before_agent_start", () => {
		it("keeps ctx.getSystemPrompt() in sync with chained system prompt updates", async () => {
			const extCode1 = `
				export default function(pi) {
					pi.on("before_agent_start", async (_event, ctx) => {
						return {
							systemPrompt: ctx.getSystemPrompt() + "\\nfirst",
						};
					});
				}
			`;
			const extCode2 = `
				export default function(pi) {
					pi.on("before_agent_start", async (_event, ctx) => {
						return {
							systemPrompt: ctx.getSystemPrompt() + "\\nsecond",
						};
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "before-agent-start-1.ts"), extCode1);
			fs.writeFileSync(path.join(extensionsDir, "before-agent-start-2.ts"), extCode2);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			expect(result.errors).toEqual([]);
			expect(result.extensions).toHaveLength(2);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const errors: string[] = [];
			runner.onError((error) => errors.push(error.error));
			runner.bindCore(extensionActions, extensionContextActions);

			const chained = await runner.emitBeforeAgentStart("hello", undefined, "base", {
				cwd: tempDir,
			});

			expect(errors).toEqual([]);

			expect(chained).toEqual({
				messages: undefined,
				systemPrompt: "base\nfirst\nsecond",
			});
		});
	});

	describe("tool_result chaining", () => {
		it("chains content modifications across handlers", async () => {
			const extCode1 = `
				export default function(pi) {
					pi.on("tool_result", async (event) => {
						return {
							content: [...event.content, { type: "text", text: "ext1" }],
						};
					});
				}
			`;
			const extCode2 = `
				export default function(pi) {
					pi.on("tool_result", async (event) => {
						return {
							content: [...event.content, { type: "text", text: "ext2" }],
						};
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "tool-result-1.ts"), extCode1);
			fs.writeFileSync(path.join(extensionsDir, "tool-result-2.ts"), extCode2);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const chained = await runner.emitToolResult({
				type: "tool_result",
				toolName: "my_tool",
				toolCallId: "call-1",
				input: {},
				content: [{ type: "text", text: "base" }],
				details: { initial: true },
				isError: false,
			});

			expect(chained).toBeDefined();
			const chainedContent = chained?.content;
			expect(chainedContent).toBeDefined();
			expect(chainedContent![0]).toEqual({ type: "text", text: "base" });
			expect(chainedContent).toHaveLength(3);
			const appendedText = chainedContent!
				.slice(1)
				.filter((item): item is { type: "text"; text: string } => item.type === "text")
				.map((item) => item.text);
			expect(appendedText.sort()).toEqual(["ext1", "ext2"]);
		});

		it("preserves previous modifications when later handlers return partial patches", async () => {
			const extCode1 = `
				export default function(pi) {
					pi.on("tool_result", async () => {
						return {
							content: [{ type: "text", text: "first" }],
							details: { source: "ext1" },
						};
					});
				}
			`;
			const extCode2 = `
				export default function(pi) {
					pi.on("tool_result", async () => {
						return {
							isError: true,
						};
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "tool-result-partial-1.ts"), extCode1);
			fs.writeFileSync(path.join(extensionsDir, "tool-result-partial-2.ts"), extCode2);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const chained = await runner.emitToolResult({
				type: "tool_result",
				toolName: "my_tool",
				toolCallId: "call-2",
				input: {},
				content: [{ type: "text", text: "base" }],
				details: { initial: true },
				isError: false,
			});

			expect(chained).toEqual({
				content: [{ type: "text", text: "first" }],
				details: { source: "ext1" },
				isError: true,
			});
		});
	});

	describe("provider registration", () => {
		it("bindCore ignores invalid queued registrations and reports extension error", () => {
			const runtime = createExtensionRuntime();
			runtime.registerProvider(
				"broken-provider",
				{
					streamSimple: (() => {
						throw new Error("should not run");
					}) as any,
				},
				"/tmp/broken-extension.ts",
			);

			const runner = new ExtensionRunner([], runtime, tempDir, sessionManager, modelRegistry);
			const errors: string[] = [];
			runner.onError((error) => errors.push(`${error.extensionPath}: ${error.error}`));

			expect(() => runner.bindCore(extensionActions, extensionContextActions)).not.toThrow();
			expect(errors).toEqual([
				'/tmp/broken-extension.ts: Provider broken-provider: "api" is required when registering streamSimple.',
			]);
			expect(() => modelRegistry.refresh()).not.toThrow();
		});

		it("pre-bind unregister removes all queued registrations for a provider", () => {
			const runtime = createExtensionRuntime();

			runtime.registerProvider("queued-provider", providerModelConfig);
			runtime.registerProvider("queued-provider", {
				...providerModelConfig,
				models: [
					{
						id: "instant-model-2",
						name: "Instant Model 2",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 128000,
						maxTokens: 4096,
					},
				],
			});
			expect(runtime.pendingProviderRegistrations).toHaveLength(2);

			runtime.unregisterProvider("queued-provider");
			expect(runtime.pendingProviderRegistrations).toHaveLength(0);
		});

		it("post-bind register and unregister take effect immediately", () => {
			const runtime = createExtensionRuntime();
			const runner = new ExtensionRunner([], runtime, tempDir, sessionManager, modelRegistry);

			runner.bindCore(extensionActions, extensionContextActions);
			expect(runtime.pendingProviderRegistrations).toHaveLength(0);

			runtime.registerProvider("instant-provider", providerModelConfig);
			expect(runtime.pendingProviderRegistrations).toHaveLength(0);
			expect(modelRegistry.find("instant-provider", "instant-model")).toBeDefined();

			runtime.unregisterProvider("instant-provider");
			expect(modelRegistry.find("instant-provider", "instant-model")).toBeUndefined();
		});
	});

	describe("command context", () => {
		it("passes fork options through to the bound handler", async () => {
			const runtime = createExtensionRuntime();
			const runner = new ExtensionRunner([], runtime, tempDir, sessionManager, modelRegistry);
			const fork = vi.fn(async () => ({ cancelled: false }));

			runner.bindCommandContext({
				waitForIdle: async () => {},
				newSession: async () => ({ cancelled: false }),
				fork,
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
			});

			const commandContext = runner.createCommandContext();
			await commandContext.fork("entry-1");
			expect(fork).toHaveBeenCalledWith("entry-1", undefined);

			await commandContext.fork("entry-2", { position: "at" });
			expect(fork).toHaveBeenLastCalledWith("entry-2", { position: "at" });
		});
	});

	describe("continuations", () => {
		it("registers continuations from extension state", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerContinuation({ id: "c1", triggerPrompt: "trigger 1", injectPrompt: "inject 1" });
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "continuations.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			expect(runner.getAllContinuations()).toEqual([
				{ id: "c1", triggerPrompt: "trigger 1", injectPrompt: "inject 1" },
			]);
		});

		it("getAllContinuations deduplicates by id across extensions (first wins)", async () => {
			const ext1 = `export default function(pi) { pi.registerContinuation({ id: "shared", triggerPrompt: "from-ext1", injectPrompt: "i" }); }`;
			const ext2 = `export default function(pi) { pi.registerContinuation({ id: "shared", triggerPrompt: "from-ext2", injectPrompt: "i" }); }`;
			fs.writeFileSync(path.join(extensionsDir, "ext1.ts"), ext1);
			fs.writeFileSync(path.join(extensionsDir, "ext2.ts"), ext2);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const continuations = runner.getAllContinuations();

			expect(continuations).toHaveLength(1);
			expect(continuations[0]?.triggerPrompt).toBe("from-ext1");
		});

		it("emitTurnEnd never fires a branch session regardless of advisory state", async () => {
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			let branchCalled = false;
			runner.bindCore(
				{
					...extensionActions,
					runBranchSession: async () => {
						branchCalled = true;
						return undefined;
					},
				},
				extensionContextActions,
			);
			runner.setAdvisoryEnabled(true);

			await runner.emitTurnEnd({ type: "turn_end" } as unknown as TurnEndEvent);

			expect(branchCalled).toBe(false);
		});
	});

	describe("makeInjectGuidelineTool", () => {
		it("calls onInject with the correct prompt and returns injected for a valid id+reason", async () => {
			const entries = [{ id: "g1", injectPrompt: "inject-payload" }];
			const injected: string[] = [];
			const tool = makeInjectGuidelineTool(entries, (prompt) => injected.push(prompt));

			const result = await tool.execute(
				"call1",
				{ id: "g1", reason: "assistant listed open questions" },
				undefined,
				undefined,
				{} as never,
			);

			expect(injected).toEqual(["[Advisory observation: assistant listed open questions]\n\ninject-payload"]);
			expect((result.content[0] as { text: string } | undefined)?.text).toBe("injected");
		});

		it("returns error content and does not call onInject for an unrecognised id", async () => {
			const entries = [{ id: "g1", injectPrompt: "inject-payload" }];
			const injected: string[] = [];
			const tool = makeInjectGuidelineTool(entries, (prompt) => injected.push(prompt));

			const result = await tool.execute(
				"call1",
				{ id: "nonexistent", reason: "test" },
				undefined,
				undefined,
				{} as never,
			);

			expect(injected).toHaveLength(0);
			expect((result.content[0] as { text: string } | undefined)?.text).toBe("unknown id: nonexistent");
		});
	});

	describe("makeResearchTool", () => {
		it("returns error content when runBranchSession throws", async () => {
			vi.spyOn(branchSessionModule, "runBranchSession").mockRejectedValueOnce(new Error("model unavailable"));

			const mockSession = { model: "claude-sonnet", modelRegistry: {} } as never;
			const mockRegistry = {} as never;
			const tool = makeResearchTool(mockSession, mockRegistry);

			const result = await tool.execute("call1", { question: "what is X?" }, undefined, undefined, {} as never);

			const text = (result.content[0] as { text: string } | undefined)?.text ?? "";
			expect(text).toMatch(/^Research failed: model unavailable/);
		});

		it("returns fallback message when runBranchSession returns undefined", async () => {
			vi.spyOn(branchSessionModule, "runBranchSession").mockResolvedValueOnce(undefined);

			const mockSession = { model: "claude-sonnet", modelRegistry: {} } as never;
			const mockRegistry = {} as never;
			const tool = makeResearchTool(mockSession, mockRegistry);

			const result = await tool.execute("call1", { question: "what is X?" }, undefined, undefined, {} as never);

			const text = (result.content[0] as { text: string } | undefined)?.text ?? "";
			expect(text).toContain("produced no output");
		});

		it("forwards the abort signal to runBranchSession", async () => {
			const capturedOptions: import("../src/core/extensions/types.ts").BranchSessionOptions[] = [];
			vi.spyOn(branchSessionModule, "runBranchSession").mockImplementationOnce(async (_prompt, options) => {
				capturedOptions.push(options);
				return "findings";
			});

			const controller = new AbortController();
			const mockSession = { model: "claude-sonnet", modelRegistry: {} } as never;
			const tool = makeResearchTool(mockSession, {} as never);

			await tool.execute("call1", { question: "q" }, controller.signal, undefined, {} as never);

			expect(capturedOptions[0]?.abortSignal).toBe(controller.signal);
		});
	});

	describe("hasHandlers", () => {
		it("returns true when handlers exist for event type", async () => {
			const extCode = `
				export default function(pi) {
					pi.on("tool_call", async () => undefined);
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "handler.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			expect(runner.hasHandlers("tool_call")).toBe(true);
			expect(runner.hasHandlers("agent_end")).toBe(false);
		});
	});

	describe("goal injection", () => {
		const makeRunner = () => {
			const runtime = createExtensionRuntime();
			const runner = new ExtensionRunner([], runtime, tempDir, sessionManager, modelRegistry);
			const injected: Array<{ text: string; mode: "steer" | "followUp" }> = [];
			runner.bindCore(
				{ ...extensionActions, injectUserMessage: (text, mode) => injected.push({ text, mode }) },
				extensionContextActions,
			);
			return { runner, injected };
		};

		// Goal injection via injectUserMessage was removed. The act-as-user
		// extension now handles goal-related followUps via pi.sendUserMessage.
		// These tests verify the runner itself does not call injectUserMessage for goals.

		it("does not call injectUserMessage for goal (act-as-user handles injection)", async () => {
			const { runner, injected } = makeRunner();
			runner.setGoal("Summarize what you did");

			await runner.emitAgentEnd({ type: "agent_end", messages: [] });

			expect(injected).toHaveLength(0);
		});

		it("markGoalSatisfied clears the goal", async () => {
			const { runner, injected } = makeRunner();
			runner.setGoal("Do X");
			expect(runner.getGoal()).toBe("Do X");

			runner.markGoalSatisfied();
			expect(runner.getGoal()).toBeUndefined();

			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(injected).toHaveLength(0);
		});

		it("setGoal(undefined) clears the goal", async () => {
			const { runner, injected } = makeRunner();
			runner.setGoal("Do Y");
			expect(runner.getGoal()).toBe("Do Y");

			runner.setGoal(undefined);
			expect(runner.getGoal()).toBeUndefined();

			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(injected).toHaveLength(0);
		});

		it("does not inject when no goal is set", async () => {
			const { runner, injected } = makeRunner();

			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(injected).toHaveLength(0);
		});

		it("suppresses goal when a continuation fires in the same cycle", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerContinuation({ id: "c1", triggerPrompt: "t1", injectPrompt: "inject-c1" });
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "continuations.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const injected: string[] = [];

			runner.bindCore(
				{
					...extensionActions,
					injectUserMessage: (text) => injected.push(text),
					runBranchSession: async (_prompt, options) => {
						const tool = options.customTools?.find((t) => t.name === "injectGuideline");
						await tool?.execute("c1", { id: "c1", reason: "test" }, undefined, undefined, {} as never);
						return undefined;
					},
				},
				extensionContextActions,
			);
			runner.setAdvisoryEnabled(true);
			runner.setGoal("My goal");

			await runner.emitAgentEnd({ type: "agent_end", messages: [] });

			// Only the continuation should be injected, not the goal
			expect(injected).toHaveLength(1);
			expect(injected[0]).toBe("[Advisory observation: test]\n\ninject-c1");
		});

		it("injects goal after continuation queue is fully drained", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerContinuation({ id: "c1", triggerPrompt: "t1", injectPrompt: "inject-c1" });
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "continuations.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			const injected: string[] = [];

			runner.bindCore(
				{
					...extensionActions,
					injectUserMessage: (text) => injected.push(text),
					runBranchSession: async (_prompt, options) => {
						const tool = options.customTools?.find((t) => t.name === "injectGuideline");
						// First call: fire c1
						if (injected.length === 0) {
							await tool?.execute("c1", { id: "c1", reason: "test" }, undefined, undefined, {} as never);
						}
						return undefined;
					},
				},
				extensionContextActions,
			);
			runner.setAdvisoryEnabled(true);
			runner.setGoal("My goal");

			// Cycle 1: continuation fires, goal suppressed
			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(injected).toEqual(["[Advisory observation: test]\n\ninject-c1"]);

			// Cycle 2: no continuation fires, goal is NOT injected via injectUserMessage
			// (the act-as-user extension handles this via sendUserMessage instead)
			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(injected).toHaveLength(1); // still only the continuation from cycle 1
		});

		it("emits continuationFired: false when goal is set and no continuation fires", async () => {
			const extCode = `
				export default function(pi) {
					pi.on("agent_end", (event) => {
						globalThis.__testCapturedContinuationFired = event.continuationFired;
					});
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "capture-agent-end.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			runner.bindCore(extensionActions, extensionContextActions);
			runner.setGoal("My goal");

			(globalThis as Record<string, unknown>).__testCapturedContinuationFired = undefined;
			await runner.emitAgentEnd({ type: "agent_end", messages: [] });

			expect((globalThis as Record<string, unknown>).__testCapturedContinuationFired).toBe(false);
		});
	});

	describe("continuation task queue", () => {
		/** Helper: find the injectGuideline tool in branch session options and call it for given ids. */
		const fireInjectTool = async (options: BranchSessionOptions, ids: string[]): Promise<void> => {
			const tool = options.customTools?.find((t) => t.name === "injectGuideline");
			if (!tool) return;
			for (const id of ids) {
				await tool.execute("call-" + id, { id, reason: "test reason" }, undefined, undefined, {} as never);
			}
		};

		it("queues multiple tasks in one branch session pass and injects them one per emitAgentEnd", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerContinuation({ id: "c1", triggerPrompt: "t1", injectPrompt: "inject-c1" });
					pi.registerContinuation({ id: "c2", triggerPrompt: "t2", injectPrompt: "inject-c2" });
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "continuations.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const injected: string[] = [];
			let branchSessionCalls = 0;

			runner.bindCore(
				{
					...extensionActions,
					injectUserMessage: (text) => injected.push(text),
					runBranchSession: async (_prompt, options) => {
						branchSessionCalls++;
						await fireInjectTool(options, ["c1", "c2"]);
						return undefined;
					},
				},
				extensionContextActions,
			);
			runner.setAdvisoryEnabled(true);

			// First agent_end: branch session fires c1+c2, first task (c1) is immediately injected.
			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(branchSessionCalls).toBe(1);
			expect(injected).toEqual(["[Advisory observation: test reason]\n\ninject-c1"]);

			// Second agent_end: task c2 still pending — branch session must NOT run.
			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(branchSessionCalls).toBe(1);
			expect(injected).toEqual([
				"[Advisory observation: test reason]\n\ninject-c1",
				"[Advisory observation: test reason]\n\ninject-c2",
			]);
		});

		it("skips the branch session while tasks are pending", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerContinuation({ id: "c1", triggerPrompt: "t1", injectPrompt: "inject-c1" });
					pi.registerContinuation({ id: "c2", triggerPrompt: "t2", injectPrompt: "inject-c2" });
					pi.registerContinuation({ id: "c3", triggerPrompt: "t3", injectPrompt: "inject-c3" });
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "continuations.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const injected: string[] = [];
			let branchSessionCalls = 0;

			runner.bindCore(
				{
					...extensionActions,
					injectUserMessage: (text) => injected.push(text),
					runBranchSession: async (_prompt, options) => {
						branchSessionCalls++;
						await fireInjectTool(options, ["c1", "c2", "c3"]);
						return undefined;
					},
				},
				extensionContextActions,
			);
			runner.setAdvisoryEnabled(true);

			// First agent_end: branch session fires all three, injects c1.
			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(branchSessionCalls).toBe(1);
			expect(injected).toEqual(["[Advisory observation: test reason]\n\ninject-c1"]);

			// Second agent_end: c2 and c3 still pending — branch session skipped, c2 injected.
			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(branchSessionCalls).toBe(1);
			expect(injected).toEqual([
				"[Advisory observation: test reason]\n\ninject-c1",
				"[Advisory observation: test reason]\n\ninject-c2",
			]);

			// Third agent_end: c3 still pending — branch session skipped, c3 injected.
			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(branchSessionCalls).toBe(1);
			expect(injected).toEqual([
				"[Advisory observation: test reason]\n\ninject-c1",
				"[Advisory observation: test reason]\n\ninject-c2",
				"[Advisory observation: test reason]\n\ninject-c3",
			]);
		});

		it("re-evaluates after tasks are drained", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerContinuation({ id: "c1", triggerPrompt: "t1", injectPrompt: "inject-c1" });
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "continuations.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const injected: string[] = [];
			let branchSessionCalls = 0;

			runner.bindCore(
				{
					...extensionActions,
					injectUserMessage: (text) => injected.push(text),
					runBranchSession: async (_prompt, options) => {
						branchSessionCalls++;
						await fireInjectTool(options, ["c1"]);
						return undefined;
					},
				},
				extensionContextActions,
			);
			runner.setAdvisoryEnabled(true);

			// First agent_end: branch session fires c1 (queued + injected immediately).
			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(branchSessionCalls).toBe(1);
			expect(injected).toEqual(["[Advisory observation: test reason]\n\ninject-c1"]);

			// Second agent_end: task list empty, branch session re-evaluates immediately.
			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(branchSessionCalls).toBe(2);
		});

		it("does not inject when the branch session fires nothing", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerContinuation({ id: "c1", triggerPrompt: "t1", injectPrompt: "inject-c1" });
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "continuations.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const injected: string[] = [];

			runner.bindCore(
				{
					...extensionActions,
					injectUserMessage: (text) => injected.push(text),
					runBranchSession: async () => undefined, // LLM fires nothing
				},
				extensionContextActions,
			);
			runner.setAdvisoryEnabled(true);

			await runner.emitAgentEnd({ type: "agent_end", messages: [] });
			expect(injected).toEqual([]);
		});
	});

	describe("per-item continuation toggles", () => {
		/** Minimal runner with no extensions — sufficient for pure state tests. */
		const makeRunner = () => {
			const runtime = createExtensionRuntime();
			return new ExtensionRunner([], runtime, tempDir, sessionManager, modelRegistry);
		};

		it("getContinuationEnabled returns true by default including for unknown ids", () => {
			const runner = makeRunner();
			expect(runner.getContinuationEnabled("unknown-id")).toBe(true);
		});

		it("setContinuationEnabled false then true round-trips correctly", () => {
			const runner = makeRunner();
			runner.setContinuationEnabled("c1", false);
			expect(runner.getContinuationEnabled("c1")).toBe(false);
			runner.setContinuationEnabled("c1", true);
			expect(runner.getContinuationEnabled("c1")).toBe(true);
		});

		it("emitAgentEnd skips branch session when all continuations are disabled", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerContinuation({ id: "c1", triggerPrompt: "t1", injectPrompt: "i1" });
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "continuations.ts"), extCode);
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			let branchCalled = false;
			runner.bindCore(
				{
					...extensionActions,
					runBranchSession: async () => {
						branchCalled = true;
						return undefined;
					},
				},
				extensionContextActions,
			);
			runner.setAdvisoryEnabled(true);
			runner.setContinuationEnabled("c1", false);

			await runner.emitAgentEnd({ type: "agent_end", messages: [] });

			expect(branchCalled).toBe(false);
		});

		it("emitAgentEnd passes only enabled continuations to branch session", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerContinuation({ id: "c1", triggerPrompt: "trigger-for-c1", injectPrompt: "i1" });
					pi.registerContinuation({ id: "c2", triggerPrompt: "trigger-for-c2", injectPrompt: "i2" });
				}
			`;
			fs.writeFileSync(path.join(extensionsDir, "continuations.ts"), extCode);
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			let capturedPrompt = "";
			runner.bindCore(
				{
					...extensionActions,
					runBranchSession: async (prompt) => {
						capturedPrompt = prompt;
						return undefined;
					},
				},
				extensionContextActions,
			);
			runner.setAdvisoryEnabled(true);
			runner.setContinuationEnabled("c1", false);

			await runner.emitAgentEnd({ type: "agent_end", messages: [] });

			expect(capturedPrompt).not.toContain("trigger-for-c1");
			expect(capturedPrompt).toContain("trigger-for-c2");
		});
	});
});
