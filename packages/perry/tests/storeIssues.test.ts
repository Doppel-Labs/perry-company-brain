import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { closeBrainStore, upsertIssue } from "@store";

test("upsertIssue keeps omitted fields and clears explicit empty strings", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-store-issues-"));
  const previousPath = process.env.PERRY_DB_PATH;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");

  try {
    upsertIssue({
      id: "issue:keep",
      project: "Perry",
      title: "Ship the queue",
      description: "Lease and retries",
      status: "in_progress",
      priority: "high",
      owner: "Ada",
      sourceMeetingId: "granola:meeting",
      sourceActionId: "granola:meeting:action:1",
      dueDate: "2026-11-01",
    });

    const kept = upsertIssue({ id: "issue:keep", title: "Ship the durable queue" });
    assert.equal(kept.title, "Ship the durable queue");
    assert.equal(kept.owner, "Ada");
    assert.equal(kept.status, "in_progress");
    assert.equal(kept.priority, "high");
    assert.equal(kept.project, "Perry");
    assert.equal(kept.description, "Lease and retries");
    assert.equal(kept.dueDate, "2026-11-01");
    assert.equal(kept.sourceMeetingId, "granola:meeting");
    assert.equal(kept.sourceActionId, "granola:meeting:action:1");

    const cleared = upsertIssue({ id: "issue:keep", title: "Ship the durable queue", owner: "", dueDate: "" });
    assert.equal(cleared.owner, undefined);
    assert.equal(cleared.dueDate, undefined);
    assert.equal(cleared.project, "Perry");

    const preserved = upsertIssue({ id: "issue:keep", title: "Projected", owner: "Bo", status: "open", preserveMutableFields: true });
    assert.equal(preserved.owner, undefined);
    assert.equal(preserved.status, "in_progress");
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) {
      delete process.env.PERRY_DB_PATH;
    } else {
      process.env.PERRY_DB_PATH = previousPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
