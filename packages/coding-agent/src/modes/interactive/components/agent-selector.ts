/**
 * Searchable, scrollable selector for agent sessions (/agent command).
 */

import type { Component } from "@earendil-works/pi-tui";
import { fuzzyFilter, getKeybindings, Input, truncateToWidth } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

const MAX_VISIBLE = 10;

export interface AgentSelectorItem {
	id: string;
	label: string;
}

export class AgentSelectorComponent implements Component {
	private items: AgentSelectorItem[];
	private filteredItems: AgentSelectorItem[];
	private selectedIndex = 0;
	private searchInput: Input;
	private onSelectCallback: (id: string) => void;
	private onCancelCallback: () => void;
	private title: string;

	constructor(title: string, items: AgentSelectorItem[], onSelect: (id: string) => void, onCancel: () => void) {
		this.title = title;
		this.items = items;
		this.filteredItems = items;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		this.searchInput = new Input();
	}

	invalidate(): void {
		// No cached state to invalidate
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const border = theme.fg("border", "─".repeat(width));

		// Top border
		lines.push(border);
		lines.push("");

		// Title
		lines.push(theme.fg("accent", theme.bold(`  ${this.title}`)));
		lines.push("");

		// Search input
		const inputLines = this.searchInput.render(width);
		lines.push(...inputLines);
		lines.push("");

		// Empty state
		if (this.filteredItems.length === 0) {
			lines.push(theme.fg("muted", "  No matching sessions"));
			lines.push("");
		} else {
			// Calculate visible window
			const startIndex = Math.max(
				0,
				Math.min(this.selectedIndex - Math.floor(MAX_VISIBLE / 2), this.filteredItems.length - MAX_VISIBLE),
			);
			const endIndex = Math.min(startIndex + MAX_VISIBLE, this.filteredItems.length);

			// Render visible items
			for (let i = startIndex; i < endIndex; i++) {
				const item = this.filteredItems[i];
				if (!item) continue;
				const isSelected = i === this.selectedIndex;
				const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
				const label = isSelected ? theme.fg("accent", item.label) : theme.fg("text", item.label);
				lines.push(truncateToWidth(prefix + label, width));
			}

			// Scroll indicator
			if (startIndex > 0 || endIndex < this.filteredItems.length) {
				lines.push(theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredItems.length})`));
			}

			lines.push("");
		}

		// Hints
		lines.push(
			rawKeyHint("↑↓", "navigate") +
				"  " +
				keyHint("tui.select.confirm", "select") +
				"  " +
				keyHint("tui.select.cancel", "cancel"),
		);
		lines.push("");

		// Bottom border
		lines.push(border);

		return lines;
	}

	handleInput(data: string): void {
		const kb = getKeybindings();

		if (kb.matches(data, "tui.select.up")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
		} else if (kb.matches(data, "tui.select.down")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
		} else if (kb.matches(data, "tui.select.confirm") || data === "\n") {
			const item = this.filteredItems[this.selectedIndex];
			if (item) this.onSelectCallback(item.id);
		} else if (kb.matches(data, "tui.select.cancel")) {
			this.onCancelCallback();
		} else {
			// Forward to search input (strip spaces like SettingsList does)
			const sanitized = data.replace(/ /g, "");
			if (!sanitized) return;
			this.searchInput.handleInput(sanitized);
			this.applyFilter(this.searchInput.getValue());
		}
	}

	private applyFilter(query: string): void {
		this.filteredItems = fuzzyFilter(this.items, query, (item) => item.label);
		this.selectedIndex = 0;
	}
}
