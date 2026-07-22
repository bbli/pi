/**
 * Learnings Extension
 *
 * Provides a /learnings command that injects a maintenance prompt into the
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
the current schema.

## The Expected Schema

${RELATIONSHIP_DESIGN_SKILL_TEXT}

## Expected README Format

\`.pi/learnings/README.md\` should follow this structure:

\`\`\`
## Codebase Principles

### <relationship-id>
(one entry per principle grouped under its relates-to relationship,
sorted by citation count descending)
- (<relation-type>) [<principle-id>] — <first sentence>  · <N> sessions

### User preferences
(meta-scoped principles — no parent relationship)
- [<principle-id>] — <first sentence>  · <N> sessions

## Relationships (no principle yet)
(relationships cited in summaries but with no corresponding principle,
sorted by highest citation count descending)
- <relationship-id> — <N>/3 sessions
\`\`\`

## Step 1 — Inspect

Read what is actually on disk:
\`\`\`
ls .pi/learnings/ 2>/dev/null
\`\`\`

Read the README if it exists, and sample one or two files from each \
subdirectory to check their format.

## Step 2 — Compare

Check for each of the following gaps:

- **Missing \`principles/\`** — does the directory exist?
- **Old \`observations/\` present** — if it still exists with files, those \
  with ≥3 summary citations should be migrated to \`principles/\`; the rest \
  can be left or removed.
- **Stale README format** — old format has \`## Established\` and \
  \`## Accumulating\`; current format has \`## Codebase Principles\` and \
  \`## Relationships (no principle yet)\`.
- **Frontmatter schema mismatches** — principle files should have \`id\`, \
  \`relation\`, and \`relates-to\`; relationship files should have \`id\`, \
  \`links-to\`, \`used-in\`, and optionally \`corollary-of\` / \`composition\`.
- **Summary citation format** — old summaries cite \`[obs-id]\`; new ones \
  should cite \`[principle-id]\` for established patterns or \`[rel-id]\` \
  directly for patterns without a principle yet. Old citations still \
  function via the search fallback — flag if present but do not rewrite \
  unless explicitly asked.

## Step 3 — Propose

List every change you plan to make: which files, what content, which \
directory. Be specific. If there is nothing to update, say so explicitly.

**Stop here.** Do not execute any writes until the user says \
"write it", "proceed", or "go ahead".

## Step 4 — Execute (only after approval)

Make the approved changes. Then regenerate \`.pi/learnings/README.md\` from \
scratch:

1. For every file in \`principles/\`: extract its ID, count summaries citing \
   \`\\[<id>\\]\`, read its \`relation\` and \`relates-to\`, take the first \
   sentence of its prose.
2. For every relationship file with no corresponding principle: count \
   summaries citing \`\\[<relationship-id>\\]\` directly.
3. Write \`.pi/learnings/README.md\` in the current format shown above.

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

	pi.registerCommand("learnings", {
		description:
			"Inspect .pi/learnings/ and bring it in sync with the current schema. " +
			"Agent compares on-disk state to the spec, proposes updates, and executes after approval.",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			if (isPending) {
				ctx.ui.notify("[learnings] already pending — wait for the current inspection to complete", "warning");
				return;
			}
			isPending = true;
			ctx.ui.notify("[learnings] inspecting .pi/learnings/ ...", "info");
			pi.sendUserMessage(LEARNINGS_MAINTENANCE_PROMPT, { deliverAs: "followUp" });
		},
	});
}
