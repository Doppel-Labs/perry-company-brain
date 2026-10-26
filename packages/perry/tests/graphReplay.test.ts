import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGraphChangeSet,
  diffGraphChangeSetReadback,
  enqueueMeetingGraphSync,
  replayGraphChangeSet,
  GraphChangeSetReplayError,
  type GraphChangeSet,
  type GraphMemorySyncInput,
} from "@graph";
import { closeBrainStore, enqueueGraphSyncJob, getGraphChangeSet, listGraphChangeSets } from "@store";

type Handler = (url: URL, req: IncomingMessage, res: ServerResponse) => void;

test("replay records an accepted write whose readback fails as unverified, not applied", async () => {
  // The bridge accepts the write but has none of the evidence when read back.
  await withBridge(
    (url, _req, res) => {
      if (url.pathname === "/change-sets") return json(res, { ok: true, applied: true });
      if (url.pathname === "/entity-context") {
        return json(res, { ok: true, entity: { stableKey: url.searchParams.get("stableKey") }, facts: [], retirements: [] });
      }
      if (url.pathname === "/evidence") return json(res, { ok: true, evidence: null });
      json(res, { ok: true });
    },
    async () => {
      assert(enqueueMeetingGraphSync(sampleInput()));
      const id = listGraphChangeSets({ limit: 1 })[0].id;

      const replay = await replayGraphChangeSet(id);

      assert.equal(replay.diff.passed, false);
      assert.equal(replay.status, "unverified");
      assert.equal(replay.record.applyStatus, "unverified");
      assert.match(replay.record.lastError ?? "", /^Replay readback did not pass: .*evidence missing/u);
      assert.equal(Boolean(replay.record.appliedAt), true);
      assert.equal(getGraphChangeSet(id)?.applyStatus, "unverified");
    }
  );
});

test("replay refuses a change set stored as invalid without calling the bridge", async () => {
  const requests: string[] = [];
  await withBridge(
    (url, _req, res) => {
      requests.push(url.pathname);
      json(res, { ok: true });
    },
    async () => {
      enqueueGraphSyncJob({
        id: "graph-sync:meeting:invalid-1",
        entityId: "invalid-1",
        payloadJson: "{}",
        graphChangeSet: {
          id: "graph-change-set:meeting:invalid-1",
          groupId: "doppel-replay",
          validationStatus: "invalid",
          validationErrors: ["Graph evidence contains private notes or transcript content: evidence:meeting:x"],
          validationWarnings: [],
          changeSet: buildGraphChangeSet(sampleInput()),
        },
      });

      await assert.rejects(replayGraphChangeSet("graph-change-set:meeting:invalid-1"), (error: unknown) => {
        assert(error instanceof GraphChangeSetReplayError);
        assert.equal(error.status, 400);
        assert.deepEqual(error.validation?.errors, ["Graph evidence contains private notes or transcript content: evidence:meeting:x"]);
        return true;
      });
      assert.deepEqual(requests, []);
    }
  );
});

test("readback narrows past the bridge's 100-row cap instead of reporting rows missing", async () => {
  // Subject contexts are full pages of unrelated rows; the real fact is only
  // found by an exact /facts query and the retirement in the object's context.
  const changeSet = readbackChangeSet();
  const filler = (index: number) => ({ subjectKey: "project:wallace", relation: "MENTIONS_GOAL", objectKey: `goal:${index}`, evidenceId: `evidence:${index}` });
  const factQueries: string[] = [];
  await withBridge(
    (url, _req, res) => {
      if (url.pathname === "/entity-context") {
        const stableKey = url.searchParams.get("stableKey");
        assert.equal(url.searchParams.get("limit"), "100");
        if (stableKey === "project:wallace") {
          return json(res, {
            ok: true,
            entity: { stableKey },
            facts: Array.from({ length: 100 }, (_, index) => ({ fact: filler(index) })),
            retirements: Array.from({ length: 100 }, (_, index) => ({ retirement: filler(index) })),
          });
        }
        return json(res, {
          ok: true,
          entity: { stableKey },
          facts: [],
          retirements: stableKey === "person:ben" ? [{ retirement: changeSet.retirements[0] }] : [],
        });
      }
      if (url.pathname === "/facts") {
        factQueries.push(`${url.searchParams.get("subject")} ${url.searchParams.get("relation")} ${url.searchParams.get("object")}`);
        return json(res, { ok: true, facts: [{ fact: changeSet.relations[0] }] });
      }
      if (url.pathname === "/evidence") return json(res, { ok: true, evidence: { evidenceId: url.searchParams.get("evidenceId") } });
      json(res, { ok: true });
    },
    async () => {
      const diff = await diffGraphChangeSetReadback(changeSet);

      assert.deepEqual(diff.missing, { entities: [], relations: [], retirements: [], evidence: [] });
      assert.deepEqual(diff.errors, []);
      assert.equal(diff.passed, true);
      assert.deepEqual(factQueries, ["project:wallace ASSIGNED_OWNER person:ada"]);
    }
  );
});

test("readback reports a row it cannot see in a still-full page as unverifiable, not missing", async () => {
  const changeSet = readbackChangeSet();
  const filler = { subjectKey: "project:wallace", relation: "ASSIGNED_OWNER", objectKey: "person:ada", evidenceId: "evidence:other" };
  await withBridge(
    (url, _req, res) => {
      if (url.pathname === "/entity-context") {
        const stableKey = url.searchParams.get("stableKey");
        return json(res, {
          ok: true,
          entity: { stableKey },
          facts: stableKey === "project:wallace" ? Array.from({ length: 100 }, () => ({ fact: filler })) : [],
          retirements: [{ retirement: changeSet.retirements[0] }],
        });
      }
      if (url.pathname === "/facts") return json(res, { ok: true, facts: Array.from({ length: 100 }, () => ({ fact: filler })) });
      if (url.pathname === "/evidence") return json(res, { ok: true, evidence: { evidenceId: url.searchParams.get("evidenceId") } });
      json(res, { ok: true });
    },
    async () => {
      const diff = await diffGraphChangeSetReadback(changeSet);

      assert.deepEqual(diff.missing.relations, []);
      assert.deepEqual(diff.errors, ["Could not verify project:wallace ASSIGNED_OWNER person:ada: readback truncated"]);
      assert.equal(diff.passed, false);
    }
  );
});

function readbackChangeSet(): GraphChangeSet {
  return {
    schemaVersion: 1,
    sourceMeetingId: "readback-1",
    generatedAt: "2026-05-23T15:00:00.000Z",
    entities: [
      { type: "project", stableKey: "project:wallace", name: "Wallace", evidenceIds: ["evidence:owner"] },
      { type: "person", stableKey: "person:ada", name: "Ada", evidenceIds: ["evidence:owner"] },
      { type: "person", stableKey: "person:ben", name: "Ben", evidenceIds: ["evidence:owner"] },
    ],
    relations: [
      {
        subjectKey: "project:wallace",
        relation: "ASSIGNED_OWNER",
        objectKey: "person:ada",
        evidenceId: "evidence:owner",
        validFrom: "2026-05-23T15:00:00.000Z",
        confidence: 0.95,
      },
    ],
    retirements: [
      {
        subjectKey: "project:wallace",
        relation: "ASSIGNED_OWNER",
        objectKey: "person:ben",
        evidenceId: "evidence:owner",
        validUntil: "2026-05-23T15:00:00.000Z",
        reason: "Ada now owns Wallace.",
      },
    ],
    evidence: [{ evidenceId: "evidence:owner", kind: "decision", source: "perry", sourceId: "decision:1", meetingId: "readback-1" }],
    warnings: [],
  };
}

function sampleInput(): GraphMemorySyncInput {
  return {
    note: {
      source: "granola",
      sourceId: "replay-note-1",
      title: "Wallace Replay Review",
      attendees: [{ name: "Ada", email: "ada@doppel.example" }],
      startedAt: "2026-05-23T15:00:00.000Z",
      summaryMarkdown: "Decision: Ada owns Wallace onboarding.",
    },
    record: {
      id: "granola:replay-note-1",
      source: "granola",
      sourceId: "replay-note-1",
      title: "Wallace Replay Review",
      createdAt: "2026-05-23T15:00:00.000Z",
      updatedAt: "2026-05-23T15:01:00.000Z",
      status: "processed",
    },
    knowledge: { decisions: [{ text: "Ada owns Wallace onboarding." }], actionItems: [] },
    route: { project: "Wallace", publishMode: "approval", reason: "Matched Wallace" },
  };
}

function json(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
}

// Runs `body` against a fresh database and a fake bridge, with graph memory on in direct mode.
async function withBridge(handler: Handler, body: () => Promise<void>): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-graph-replay-"));
  const keys = ["PERRY_DB_PATH", "PERRY_GRAPHITI_ENABLED", "PERRY_GRAPHITI_BRIDGE_URL", "PERRY_GRAPHITI_GROUP_ID", "PERRY_GRAPHITI_DIRECT_CHANGESETS"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => handler(new URL(req.url ?? "/", "http://127.0.0.1"), req, res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_GRAPHITI_ENABLED = "true";
  process.env.PERRY_GRAPHITI_BRIDGE_URL = `http://127.0.0.1:${address.port}`;
  process.env.PERRY_GRAPHITI_GROUP_ID = "doppel-replay";
  process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS = "true";
  try {
    await body();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeBrainStore(process.env.PERRY_DB_PATH);
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}
