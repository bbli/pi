import { afterEach, describe, expect, it } from "vitest";
import { userMsg } from "../../utilities.ts";
import { createHarness, type Harness } from "../harness.ts";

describe("addTreeFilter / rewind tree filter behavior", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("getTreeFilter() returns undefined when no filters are registered", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		expect(harness.session.extensionRunner.getTreeFilter()).toBeUndefined();
	});

	it("getTreeFilter() AND-composes multiple addTreeFilter predicates", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.addTreeFilter((id) => id !== "blocked-a");
					pi.addTreeFilter((id) => id !== "blocked-b");
				},
			],
		});
		harnesses.push(harness);

		const filter = harness.session.extensionRunner.getTreeFilter();
		expect(filter).toBeDefined();
		expect(filter!("allowed")).toBe(true);
		expect(filter!("blocked-a")).toBe(false);
		expect(filter!("blocked-b")).toBe(false);
	});

	it("session_start restores rewound IDs from a persisted rewind-state entry", async () => {
		// Mirrors the session_start handler in .pi/extensions/rewind.ts:
		// registers the filter once at load time with a live-closure over rewoundIds,
		// then populates rewoundIds from the last persisted "rewind-state" custom entry.
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					const rewoundIds = new Set<string>();
					pi.addTreeFilter((id) => !rewoundIds.has(id));

					pi.on("session_start", (_event, ctx) => {
						rewoundIds.clear();
						const entries = ctx.sessionManager.getEntries();
						for (let i = entries.length - 1; i >= 0; i--) {
							const entry = entries[i];
							if (entry.type === "custom" && entry.customType === "rewind-state") {
								const data = (entry as { data?: { rewoundIds?: string[] } }).data;
								if (data?.rewoundIds) {
									for (const id of data.rewoundIds) rewoundIds.add(id);
								}
								break;
							}
						}
					});
				},
			],
		});
		harnesses.push(harness);

		// Seed the session as if a prior rewind had been persisted.
		const rewoundId = harness.sessionManager.appendMessage(userMsg("branch to hide"));
		harness.sessionManager.appendCustomEntry("rewind-state", { rewoundIds: [rewoundId] });

		// bindExtensions fires session_start, which restores rewoundIds from the custom entry.
		await harness.session.bindExtensions({});

		const filter = harness.session.extensionRunner.getTreeFilter();
		expect(filter).toBeDefined();
		expect(filter!(rewoundId)).toBe(false);
		expect(filter!("unrelated-id")).toBe(true);
	});

	it("addTreeFilter predicate reflects live mutations to the closed-over set", async () => {
		// Validates the core fix: addTreeFilter is called once at load time with a closure
		// over a mutable Set; mutations to the Set after registration are reflected immediately
		// without re-calling addTreeFilter.
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					const rewoundIds = new Set<string>();
					pi.addTreeFilter((id) => !rewoundIds.has(id));

					pi.registerCommand("mark-rewound", {
						description: "test: add IDs to the rewound set",
						handler: async (args) => {
							for (const id of args.split(",").map((s) => s.trim())) {
								rewoundIds.add(id);
							}
						},
					});
				},
			],
		});
		harnesses.push(harness);

		const filter = harness.session.extensionRunner.getTreeFilter();
		expect(filter).toBeDefined();

		// Before any mutation, all nodes are visible.
		expect(filter!("node-1")).toBe(true);
		expect(filter!("node-2")).toBe(true);

		// Mutate the set via the registered command (bypasses UI, no picker needed).
		const cmd = harness.session.extensionRunner.getCommand("mark-rewound");
		expect(cmd).toBeDefined();
		await cmd!.handler("node-1, node-2", harness.session.extensionRunner.createCommandContext());

		// The already-registered filter now reflects the mutations.
		expect(filter!("node-1")).toBe(false);
		expect(filter!("node-2")).toBe(false);
		expect(filter!("node-3")).toBe(true);
	});
});
