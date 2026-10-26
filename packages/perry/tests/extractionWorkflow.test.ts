// End to end: the ingestion workflow calling a (fake) LM Studio server through
// the real backend client and extraction pipeline.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { approvePendingMeeting, previewGranolaZapierPayload, processGranolaZapierPayload } from "@ingestion";
import { closeBrainStore, getApproval, listDecisions } from "@store";

const managedEnv = [
  "PERRY_DB_PATH",
  "PERRY_CONFIG_PATH",
  "PERRY_DEFAULT_PUBLISH_MODE",
  "PERRY_NOTION_DRY_RUN",
  "PERRY_DISCORD_DRY_RUN",
  "PERRY_GRAPHITI_ENABLED",
  "PERRY_EXTRACTION_MODE",
  "PERRY_EXTRACTION_BACKEND",
  "LMSTUDIO_BASE_URL",
  "GRAPHITI_OPENAI_BASE_URL",
];

const payload = {
  note_id: "llm-note",
  title: "Atlas launch retro",
  summary:
    "After some back and forth the group settled on moving the public beta to June 18 so the Stripe webhook retries can land first. Priya is going to write the incident postmortem.",
};

/** A fake OpenAI-compatible endpoint; `reply` is what the "model" returns next. */
async function withFakeModel(run: (setReply: (content: object) => void, calls: () => number) => Promise<void>): Promise<void> {
  let reply: object = {};
  let count = 0;
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      count += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");

  const tempDir = mkdtempSync(join(tmpdir(), "perry-extraction-workflow-"));
  const previous = new Map(managedEnv.map((name) => [name, process.env[name]]));
  for (const name of managedEnv) delete process.env[name];
  Object.assign(process.env, {
    PERRY_DB_PATH: join(tempDir, "perry.sqlite"),
    PERRY_CONFIG_PATH: join(tempDir, "perry.config.json"),
    PERRY_DEFAULT_PUBLISH_MODE: "approval",
    PERRY_NOTION_DRY_RUN: "true",
    PERRY_DISCORD_DRY_RUN: "true",
    PERRY_EXTRACTION_MODE: "hybrid",
    LMSTUDIO_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
  });
  try {
    await run((content) => (reply = content), () => count);
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const modelReply = {
  decisions: [{ text: "Move the public beta to June 18" }],
  actionItems: [{ text: "Write the incident postmortem", owner: "Priya" }],
  entities: [{ type: "project", name: "Atlas" }],
  confidence: 0.9,
};

test("a prose meeting the rules miss is extracted by the model and held for approval", async () => {
  await withFakeModel(async (setReply) => {
    setReply(modelReply);
    const held = await processGranolaZapierPayload(payload);

    assert.equal(held.record.status, "pending_approval");
    assert.equal(held.knowledge?.extraction?.method, "hybrid");
    assert.equal(held.knowledge?.extraction?.backend, "lmstudio");
    assert.deepEqual(held.knowledge?.decisions, [{ text: "Move the public beta to June 18" }]);
    // Priya is not an attendee or on the roster, so the model's owner is not trusted.
    assert.deepEqual(held.knowledge?.actionItems, [{ text: "Write the incident postmortem", owner: undefined, dueDate: undefined }]);
    assert.deepEqual(held.knowledge?.entities, [{ type: "project", name: "Atlas" }]);
    const stored = JSON.parse(getApproval(held.approval!.id)!.knowledgeJson);
    assert.equal(stored.extraction.method, "hybrid");
  });
});

test("approving publishes the reviewed knowledge without asking the model again", async () => {
  await withFakeModel(async (setReply, calls) => {
    setReply(modelReply);
    const held = await processGranolaZapierPayload(payload);
    const callsAfterHold = calls();

    // If approval re-extracted, this different answer would be published instead.
    setReply({ ...modelReply, decisions: [{ text: "Move the public beta to the Stripe webhook retries" }] });
    const published = await approvePendingMeeting(held.approval!.id);

    assert.equal(calls(), callsAfterHold, "approval must not call the model");
    assert.equal(published.record.status, "processed");
    assert.deepEqual(published.knowledge?.decisions, [{ text: "Move the public beta to June 18" }]);
    assert.deepEqual(
      listDecisions().map((decision) => decision.text),
      ["Move the public beta to June 18"]
    );
  });
});

test("previews run the configured extraction and fall back visibly when the model is down", async () => {
  await withFakeModel(async (setReply) => {
    setReply(modelReply);
    const preview = await previewGranolaZapierPayload(payload);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.knowledge?.extraction?.method, "hybrid");

    process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:9/v1";
    const offline = await previewGranolaZapierPayload(payload);
    assert.equal(offline.knowledge?.extraction?.method, "rules");
    assert.equal(offline.knowledge?.extraction?.requestedMode, "hybrid");
    assert.match(offline.knowledge?.extraction?.fallbackReason ?? "", /LLM extraction failed/u);
  });
});
