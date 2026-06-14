/**
 * Rewind Extension
 *
 * Provides a /rewind command that lets the user navigate the session tree
 * and marks descendant nodes as "rewound" so they are hidden from future
 * /rewind and /tree selections.
 */

import { type CustomEntry, type FilterMode, TreeSelectorComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REWIND_STATE_TYPE = "rewind-state";

interface RewindState {
	rewoundIds: string[];
}

type TreeNode = { entry: { id: string }; children: TreeNode[] };

function pruneTree<T extends TreeNode>(nodes: T[], filter: (id: string) => boolean): T[] {
	return nodes
		.filter((n) => filter(n.entry.id))
		.map((n) => ({ ...n, children: pruneTree(n.children, filter) }));
}

function findNode<T extends TreeNode>(nodes: T[], targetId: string): T | undefined {
	for (const node of nodes) {
		if (node.entry.id === targetId) return node;
		const found = findNode(node.children as T[], targetId);
		if (found) return found;
	}
	return undefined;
}

function collectDescendants(node: TreeNode): string[] {
	const ids: string[] = [];
	for (const child of node.children) {
		ids.push(child.entry.id);
		ids.push(...collectDescendants(child));
	}
	return ids;
}

export default function rewindExtension(pi: ExtensionAPI): void {
	const rewoundIds = new Set<string>();

	pi.on("session_start", (_event, ctx) => {
		// Restore rewound IDs from the last persisted state in this session.
		rewoundIds.clear();
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "custom" && entry.customType === REWIND_STATE_TYPE) {
				const data = (entry as CustomEntry<RewindState>).data;
				if (data?.rewoundIds) {
					for (const id of data.rewoundIds) rewoundIds.add(id);
					pi.setTreeFilter((id) => !rewoundIds.has(id));
				}
				break;
			}
		}
	});

	pi.registerCommand("rewind", {
		description: "Navigate session tree and mark future branches as rewound",
		handler: async (_args, ctx) => {
			const rawTree = ctx.sessionManager.getTree();
			const leafId = ctx.sessionManager.getLeafId();

			const treeFilter = pi.getTreeFilter();
			const tree = treeFilter ? pruneTree(rawTree, treeFilter) : rawTree;

			const selectedId = await ctx.ui.custom<string | undefined>(
				(tui, _theme, _kb, done) =>
					new TreeSelectorComponent(
						tree,
						leafId,
						tui.terminal.rows,
						(entryId) => done(entryId),
						() => done(undefined),
						(entryId, label) => pi.setLabel(entryId, label),
						undefined,
						"default" as FilterMode,
						"Rewind to",
					),
			);

			if (selectedId === undefined) return;

			const result = await ctx.navigateTree(selectedId);
			if (result.cancelled) return;

			const targetNode = findNode(tree, selectedId);
			if (!targetNode) return;

			const toMark = collectDescendants(targetNode);
			if (toMark.length === 0) return;

			for (const id of toMark) {
				rewoundIds.add(id);
			}

			pi.setTreeFilter((id) => !rewoundIds.has(id));
			pi.appendEntry(REWIND_STATE_TYPE, { rewoundIds: [...rewoundIds] } satisfies RewindState);
		},
	});
}
