import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { closeBrainStore, listIssueEvents, updateIssue, type ActionItemRecord } from "@store";
import { processGranolaZapierPayload } from "@ingestion";
import { MULTIPLAYER_PROJECTION_ACTOR, projectMultiplayerState, projectMultiplayerStateFromRecords } from "@graph";

test("projects meeting actions and ownership pivots into multiplayer state", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-multiplayer-"));
  const env = preserveEnv([
    "PERRY_DB_PATH",
    "PERRY_CONFIG_PATH",
    "PERRY_DEFAULT_PUBLISH_MODE",
    "PERRY_DISCORD_DRY_RUN",
    "PERRY_NOTION_DRY_RUN",
    "PERRY_GRAPHITI_ENABLED",
  ]);

  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_CONFIG_PATH = join(tempDir, "perry.config.json");
  process.env.PERRY_DEFAULT_PUBLISH_MODE = "auto";
  process.env.PERRY_DISCORD_DRY_RUN = "true";
  process.env.PERRY_NOTION_DRY_RUN = "true";
  process.env.PERRY_GRAPHITI_ENABLED = "false";

  try {
    await processGranolaZapierPayload({
      note_id: "multiplayer-1",
      title: "Wallace Multiplayer Review",
      summary:
        "Decisions:\n" +
        "- Ada owns Wallace onboarding until the next planning review.\n" +
        "- Ben now owns Wallace onboarding; Ada is the fallback reviewer.\n\n" +
        "Action items:\n" +
        "- Ben: Prepare the Wallace onboarding checklist by 2026-06-01.\n" +
        "- Ada: Review the Wallace handoff.",
    });

    const projected = projectMultiplayerState();

    assert(projected.users.some((user) => user.displayName === "Ada"));
    assert(projected.users.some((user) => user.displayName === "Ben"));
    assert.equal(projected.issues.length, 2);
    assert.equal(projected.pivots.length, 2);
    assert(projected.pivots.some((pivot) => pivot.newOwner === "Ben" && pivot.fallbackReviewer === "Ada"));
    const benIssue = projected.issues.find((issue) => issue.owner === "Ben");
    assert(benIssue);
    assert.equal(benIssue.project, "Wallace");
    assert.equal(listIssueEvents(benIssue.id).length, 1);

    const reassigned = updateIssue({
      id: benIssue.id,
      owner: "Ada",
      status: "blocked",
      actor: "Perry",
      comment: "Waiting on design confirmation.",
    });
    assert(reassigned);
    assert.equal(reassigned.owner, "Ada");
    assert.equal(reassigned.status, "blocked");
    assert.equal(listIssueEvents(benIssue.id).length, 4);

    const projectedAgain = projectMultiplayerState();
    assert.equal(projectedAgain.issues.length, 2);
    assert.equal(projectedAgain.pivots.length, 2);
    const preservedIssue = projectedAgain.issues.find((issue) => issue.id === benIssue.id);
    assert.equal(preservedIssue?.owner, "Ada");
    assert.equal(preservedIssue?.status, "blocked");
    assert.equal(listIssueEvents(benIssue.id).length, 4);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    env.restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function preserveEnv(keys: string[]): { restore: () => void } {
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  return {
    restore() {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

test("a done action closes its issue unless someone set the issue's status by hand", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-multiplayer-close-"));
  const env = preserveEnv(["PERRY_DB_PATH"]);
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    const action = (id: string, status: ActionItemRecord["status"]): ActionItemRecord => ({
      id,
      meetingId: "meeting-close",
      text: `Ship Wallace checklist ${id}`,
      owner: "Ada",
      status,
      createdAt: "2026-05-23T15:00:00.000Z",
    });
    projectMultiplayerStateFromRecords({
      decisions: [],
      actions: [action("untouched", "open"), action("reassigned", "open"), action("hand-set", "open"), action("dropped", "open")],
    });
    // Owner edits do not express intent about completion; a hand-set status does.
    updateIssue({ id: "issue:reassigned", owner: "Ben", actor: "Ada" });
    updateIssue({ id: "issue:hand-set", status: "in_progress", actor: "Ada" });

    const projected = projectMultiplayerStateFromRecords({
      decisions: [],
      actions: [action("untouched", "done"), action("reassigned", "done"), action("hand-set", "done"), action("dropped", "wont-do")],
    });
    const status = (id: string) => projected.issues.find((issue) => issue.id === `issue:${id}`)?.status;

    assert.equal(status("untouched"), "done");
    assert.equal(status("reassigned"), "done");
    assert.equal(projected.issues.find((issue) => issue.id === "issue:reassigned")?.owner, "Ben");
    assert.equal(status("hand-set"), "in_progress");
    assert.equal(status("dropped"), "canceled");
    const closeEvent = listIssueEvents("issue:untouched").find((event) => event.type === "status_changed");
    assert.equal(closeEvent?.actor, MULTIPLAYER_PROJECTION_ACTOR);

    // Re-projecting is a no-op, and an action reopened at the source never reopens its issue.
    const eventCount = listIssueEvents("issue:untouched").length;
    const again = projectMultiplayerStateFromRecords({ decisions: [], actions: [action("untouched", "open")] });
    assert.equal(again.issues.find((issue) => issue.id === "issue:untouched")?.status, "done");
    assert.equal(listIssueEvents("issue:untouched").length, eventCount);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    env.restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
