/**
 * Learnings Extension
 *
 * Provides a /convert-learnings command that injects a maintenance prompt into the
 * main session. The agent inspects .pi/learnings/, compares the current
 * on-disk state against the canonical schema spec, proposes any needed
 * updates (migrations, README repairs, format fixes), and executes after
 * explicit user approval ("write it" / "proceed").
 *
 * This is the answer to schema drift: when the learnings schema changes,
 * run /learnings and the agent brings the project's graph up to date.
 */

import {
	RELATIONSHIP_DESIGN_SKILL_TEXT,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Maintenance prompt
// ---------------------------------------------------------------------------

const LEARNINGS_MAINTENANCE_PROMPT = `\
You have been asked to inspect \`.pi/learnings/\` and bring it in sync with \
the current schema. This is a **schema maintenance task** — you migrate \
existing knowledge to the current format. You do not analyze sessions or \
create new principles; that is the job of \`/learn\`.

## Algorithm

\`\`\`
maintain([
  step(1, "Inspect",   ls + sample files from each subdirectory),
  step(2, "Compare",
    check(principles/ exists),
    check(observations/ migrated or retired),         // ≥3 citations → migrate; else retire
    check(README format is current),
    check(frontmatter schema correct),
    check(inferred: true cleaned up),                 // demonstrated if cited in ≥1 summary
    check(summary citations),                         // [principle-id] or [rel-id] directly
  ),
  step(3, "Propose",   listChanges(), stop(), waitForApproval()),
  step(4, "Execute",
    applyChanges(),
    regenerateReadme(),
  ),
])
\`\`\`

---

## The Expected Schema

${RELATIONSHIP_DESIGN_SKILL_TEXT}

## Expected README Format

\`.pi/learnings/README.md\` should follow this structure:

\`\`\`
## Codebase Principles

### <relationship-id>
(one entry per principle grouped under its instance-of relationship,
sorted by citation count descending)
- [<principle-id>] — <first sentence>  · <N> sessions

### User preferences
(meta-scoped principles — no parent relationship)
- [<principle-id>] — <first sentence>  · <N> sessions

## Relationships (no principle yet)
(relationships cited in summaries but with no corresponding principle,
sorted by highest citation count descending)
- <relationship-id> — <N>/3 sessions
\`\`\`

The \`N/3 sessions\` count comes from grepping summaries for \`\\[<relationship-id>\\]\` \
citations — this is how the learn workflow detects when a pattern is approaching \
principle threshold.

## Step 1 — Inspect

Read what is actually on disk:
\`\`\`
ls .pi/learnings/ 2>/dev/null
\`\`\`

Read the README if it exists, and sample one or two files from each \
subdirectory to check their format.

## Step 2 — Compare

Check for each of the following:

- **Missing \`principles/\`** — does the directory exist?

- **Old \`observations/\` present** — for each observation file, count how \
  many summaries cite its ID (grep for \`[<obs-id>]\`, not \`[principle-id]\` \
  which does not exist yet). If ≥3 summaries cite it AND the observation \
  represents a specific recurring codebase-level pattern (not just the \
  abstract relationship being applied), migrate it to \`principles/\`. \
  Otherwise retire it — it did not meet the threshold.

- **Stale README format** — old format has \`## Established\` / \`## Accumulating\`; \
  current format has \`## Codebase Principles\` / \`## Relationships (no principle yet)\`.

- **Frontmatter schema mismatches** — principle files should have \`id\`, \`instance-of\`, \
  \`links-to\`; relationship files should have \`id\`, \`links-to\`, \`used-in\`, and \
  optionally \`corollary-of\` / \`composition\`.

- **Stale \`inferred: true\` flags** — corollary principles marked \`inferred: true\` \
  that have since been cited in at least one summary are now demonstrated. \
  Remove the flag.

- **Summary citation format** — summaries should cite \`[principle-id]\` for \
  established patterns and \`[relationship-id]\` directly for themes without a \
  principle yet. The \`[relationship-id]\` citation form is what the learn \
  workflow greps to count recurrences toward the ≥3 threshold. Old \`[obs-id]\` \
  citations still function as a search fallback — flag but do not rewrite \
  unless explicitly asked.

## Step 3 — Propose

List every change you plan to make: which files, what content, which \
directory. Be specific. If there is nothing to update, say so explicitly.

**Stop here.** Do not execute any writes until the user says \
"write it", "proceed", or "go ahead".

## Step 4 — Execute (only after approval)

Make the approved changes. Then regenerate \`.pi/learnings/README.md\` from \
scratch:

1. For every principle file: extract its ID, count summaries citing \
   \`\\[<id>\\]\`, read its \`instance-of\`, take the first \
   sentence of its prose.
2. For every relationship file with no corresponding principle: count \
   summaries citing \`\\[<relationship-id>\\]\` directly.
3. Write \`.pi/learnings/README.md\` in the current format above.

Only write what the on-disk state gives clear evidence for. Do not invent \
entries.`;

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function learningsExtension(pi: ExtensionAPI): void {
	let isPending = false;

	pi.on("agent_end", () => {
		isPending = false;
	});

	pi.registerCommand("convert-learnings", {
		description:
			"Inspect .pi/learnings/ and bring it in sync with the current schema. " +
			"Agent compares on-disk state to the spec, proposes updates, and executes after approval.",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			if (isPending) {
				ctx.ui.notify("[convert-learnings] already pending — wait for the current inspection to complete", "warning");
				return;
			}
			isPending = true;
			ctx.ui.notify("[convert-learnings] inspecting .pi/learnings/ ...", "info");
			pi.sendUserMessage(LEARNINGS_MAINTENANCE_PROMPT, { deliverAs: "followUp" });
		},
	});
}
