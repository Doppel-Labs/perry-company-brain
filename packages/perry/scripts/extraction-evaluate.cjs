// extraction-evaluate — compares rules, llm, and hybrid extraction on the
// fixtures in tests/fixtures/lmstudio-extraction-eval.json, through the same
// pipeline ingestion uses (grounding, owner matching, fallback).
//
// Usage (after `pnpm build`, with the model backend configured as for ingestion):
//   pnpm perry extraction:evaluate                 # all three modes
//   pnpm perry extraction:evaluate -- --modes=rules,hybrid --strict
// --strict exits 1 when any case in a non-rules mode scores below 0.75 or falls back.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { extractMeetingKnowledge } = require("../dist/extraction/index.js");

const strict = process.argv.includes("--strict");
const modesArg = process.argv.find((arg) => arg.startsWith("--modes="));
const modes = (modesArg ? modesArg.slice("--modes=".length) : "rules,llm,hybrid").split(",").map((mode) => mode.trim());
const cases = JSON.parse(readFileSync(join(__dirname, "..", "tests", "fixtures", "lmstudio-extraction-eval.json"), "utf8"));

async function main() {
  const rows = [];
  for (const mode of modes) {
    for (const fixture of cases) {
      const note = { source: "granola", sourceId: fixture.id, attendees: [], ...fixture };
      const people = fixture.attendees.map((attendee) => attendee.name).filter(Boolean);
      const started = performance.now();
      const knowledge = await extractMeetingKnowledge(note, { mode, people });
      rows.push({
        mode,
        id: fixture.id,
        score: score(knowledge, fixture.expected),
        method: knowledge.extraction?.method ?? mode,
        fallback: knowledge.extraction?.fallbackReason,
        dropped: knowledge.extraction?.droppedUngrounded ?? 0,
        items: knowledge.decisions.length + knowledge.actionItems.length,
        ms: performance.now() - started,
      });
    }
  }

  for (const row of rows) {
    const status = row.fallback ? `FALLBACK (${row.fallback})` : row.method;
    console.log(
      `${row.mode.padEnd(7)} ${row.id.padEnd(28)} score=${row.score.toFixed(2)} items=${row.items} dropped=${row.dropped} ${row.ms.toFixed(0)}ms ${status}`
    );
  }
  console.log("");
  for (const mode of modes) {
    const scores = rows.filter((row) => row.mode === mode).map((row) => row.score);
    console.log(`${mode.padEnd(7)} mean score ${(scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2)}`);
  }

  const failed = rows.filter((row) => row.mode !== "rules" && (row.score < 0.75 || row.fallback));
  if (strict && failed.length > 0) process.exit(1);
}

/** Share of expected keywords found among decisions, action items, and entities. */
function score(knowledge, expected) {
  const decisions = knowledge.decisions.map((item) => item.text).join("\n").toLowerCase();
  const actions = knowledge.actionItems.map((item) => item.text).join("\n").toLowerCase();
  const entities = (knowledge.entities ?? []).map((item) => item.name).join("\n").toLowerCase();
  const checks = [
    ...expected.decisionKeywords.map((keyword) => decisions.includes(keyword.toLowerCase())),
    ...expected.actionKeywords.map((keyword) => actions.includes(keyword.toLowerCase())),
    // Rules never extract entities, so entity keywords only count for model-backed modes.
    ...(knowledge.extraction?.method === "rules" ? [] : expected.entityKeywords.map((keyword) => entities.includes(keyword.toLowerCase()))),
  ];
  return checks.length === 0 ? 1 : checks.filter(Boolean).length / checks.length;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
