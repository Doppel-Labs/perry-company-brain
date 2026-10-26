import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildCompanyBrainInsights, getOntologyHealthReport, parseOwnershipDecision } from "@brain";
import { paged } from "@brain/paging";
import { closeBrainStore, materializeOntologyFromChangeSet, statement, withDb, type DecisionRecord } from "@store";
import type { GraphChangeSet } from "@core";

function decision(id: string, text: string, createdAt = "2026-05-01T10:00:00.000Z"): DecisionRecord {
  return { id, meetingId: `m-${id}`, text, status: "accepted", createdAt };
}

test("ownership parsing keeps the fallback reviewer out of previousOwner", () => {
  const cases: Array<[string, { owner: string; subject: string; previousOwner?: string; fallbackReviewer?: string }]> = [
    ["Ben now owns Wallace onboarding; Ada is the fallback reviewer.", { owner: "Ben", subject: "Wallace onboarding", fallbackReviewer: "Ada" }],
    ["Ben now owns Wallace onboarding, with Ada Lovelace as the fallback reviewer", { owner: "Ben", subject: "Wallace onboarding", fallbackReviewer: "Ada Lovelace" }],
    ["Ben now owns Wallace onboarding (fallback reviewer: Ada).", { owner: "Ben", subject: "Wallace onboarding", fallbackReviewer: "Ada" }],
    ["Ben now owns Wallace onboarding; fallback reviewer is Ada", { owner: "Ben", subject: "Wallace onboarding", fallbackReviewer: "Ada" }],
    ["Ben now owns Wallace onboarding.", { owner: "Ben", subject: "Wallace onboarding" }],
    ["Ben now owns Wallace onboarding, taking over from Ada.", { owner: "Ben", subject: "Wallace onboarding", previousOwner: "Ada" }],
    ["Ben now owns Wallace onboarding (previously Ada); Cy is the fallback reviewer.", { owner: "Ben", subject: "Wallace onboarding", previousOwner: "Ada", fallbackReviewer: "Cy" }],
    ["Ben takes over Wallace onboarding from Ada; Cy is the fallback reviewer", { owner: "Ben", subject: "Wallace onboarding", previousOwner: "Ada", fallbackReviewer: "Cy" }],
    ["Ownership of Wallace onboarding moves from Ada to Ben.", { owner: "Ben", subject: "Wallace onboarding", previousOwner: "Ada" }],
    ["Ownership of Wallace onboarding passes to Ben", { owner: "Ben", subject: "Wallace onboarding" }],
    ["Ada owns Wallace onboarding until the next planning review; Ben is the fallback reviewer.", { owner: "Ada", subject: "Wallace onboarding", fallbackReviewer: "Ben" }],
  ];
  for (const [text, expected] of cases) {
    assert.deepEqual(parseOwnershipDecision(decision("d", text)), { previousOwner: undefined, fallbackReviewer: undefined, ...expected }, text);
  }
  assert.equal(parseOwnershipDecision(decision("d", "We agreed to ship on Friday.")), undefined);
});

test("a first ownership decision naming a fallback reviewer is not an ownership change", () => {
  const insights = buildCompanyBrainInsights({
    decisions: [
      decision("d1", "Ben now owns Wallace onboarding; Ada is the fallback reviewer.", "2026-05-01T10:00:00.000Z"),
      decision("d2", "Ben now owns Wallace onboarding; Cy is the fallback reviewer.", "2026-05-08T10:00:00.000Z"),
      decision("d3", "Mira now owns Wallace onboarding; Ben is the fallback reviewer.", "2026-05-15T10:00:00.000Z"),
    ],
    actions: [],
  });
  assert.deepEqual(
    insights.ownershipHistory.map((item) => [item.owner, item.previousOwner, item.fallbackReviewer]),
    [
      ["Ben", undefined, "Ada"],
      ["Ben", "Ben", "Cy"],
      ["Mira", "Ben", "Ben"],
    ]
  );
  assert.equal(insights.counts.ownershipChanges, 1);
});

test("paged reads full pages of the given size and stops on a short page", () => {
  const rows = Array.from({ length: 12 }, (_, index) => index);
  const reads: Array<[number, number]> = [];
  const read = (offset: number, pageSize: number) => {
    reads.push([offset, pageSize]);
    return rows.slice(offset, offset + pageSize);
  };
  assert.deepEqual(paged(read, 100, 5), rows);
  assert.deepEqual(reads, [[0, 5], [5, 5], [10, 5]]);
  assert.deepEqual(paged(read, 7, 5), rows.slice(0, 7));
});

test("ontology health checks every sampled relation's evidence, even beyond the evidence sample", () => {
  const dir = mkdtempSync(join(tmpdir(), "perry-ontology-health-"));
  const previousDb = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(dir, "perry.sqlite");
  const risks = ["r1", "r2", "r3"];
  const changeSet: GraphChangeSet = {
    schemaVersion: 1,
    sourceMeetingId: "m1",
    generatedAt: "2026-05-01T10:00:00.000Z",
    entities: [
      { type: "project", stableKey: "project:wallace", name: "Wallace", evidenceIds: [] },
      ...risks.map((id) => ({ type: "risk" as const, stableKey: `risk:${id}`, name: `Risk ${id}`, evidenceIds: [`ev-${id}`] })),
    ],
    relations: risks.map((id) => ({
      subjectKey: "project:wallace",
      relation: "HAS_RISK" as const,
      objectKey: `risk:${id}`,
      evidenceId: `ev-${id}`,
      confidence: 0.9,
    })),
    retirements: [],
    evidence: risks.map((id) => ({ evidenceId: `ev-${id}`, kind: "decision" as const, source: "perry" as const, sourceId: id, meetingId: "m1" })),
    warnings: [],
  };
  try {
    withDb((db) => materializeOntologyFromChangeSet(db, JSON.stringify(changeSet), "m1", "2026-05-01T10:00:00.000Z"));

    // Only one evidence row is sampled, but all three relations' evidence exists.
    const healthy = getOntologyHealthReport({ evidenceLimit: 1 });
    assert.equal(healthy.checks.find((item) => item.id === "relations_have_evidence")?.passed, true);
    assert.deepEqual(healthy.relationIdsMissingEvidence, []);

    withDb((db) => statement(db, "DELETE FROM ontology_evidence WHERE evidence_id = ?").run("ev-r2"));
    const broken = getOntologyHealthReport({ evidenceLimit: 1 });
    assert.equal(broken.ok, false);
    assert.deepEqual(broken.relationIdsMissingEvidence, ["project:wallace|HAS_RISK|risk:r2|ev-r2"]);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousDb === undefined) delete process.env.PERRY_DB_PATH;
    else process.env.PERRY_DB_PATH = previousDb;
    rmSync(dir, { recursive: true, force: true });
  }
});
