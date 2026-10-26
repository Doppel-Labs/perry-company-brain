import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { closeBrainStore } from "@store";
import { getDiagnostics } from "@server";

const keys = [
  "PERRY_CONFIG_PATH",
  "PERRY_DB_PATH",
  "PERRY_GRAPHITI_ENABLED",
  "PERRY_GRAPHITI_BRIDGE_URL",
  "DISCORD_TOKEN",
  "NOTION_TOKEN",
  "DISCORD_MEETING_CHANNEL_ID",
  "NOTION_MEETING_NOTES_DATA_SOURCE_ID",
  "GRANOLA_MODE",
  "PERRY_EXTRACTION_MODE",
  "PERRY_EXTRACTION_BACKEND",
  "TOGETHER_API_KEY",
  "TOGETHER_AI_API_KEY",
];

function withSetup(granolaMode: string, envValues: Record<string, string>, run: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), "perry-diagnostics-"));
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  const configPath = join(dir, "perry.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      discord: { clientId: "client", guildId: "guild", standupChannelId: "standup" },
      notion: { standupDataSourceId: "standup-source" },
      granola: { mode: granolaMode },
      roster: [{ name: "Ada", discordUserId: "111" }],
    })
  );
  Object.assign(
    process.env,
    { PERRY_CONFIG_PATH: configPath, PERRY_DB_PATH: join(dir, "perry.sqlite"), DISCORD_TOKEN: "token", NOTION_TOKEN: "token" },
    envValues
  );
  try {
    run();
  } finally {
    closeBrainStore(process.env.PERRY_DB_PATH);
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("diagnostics are ready when only optional features are off (warnings allowed)", () => {
  withSetup("manual", {}, () => {
    const diagnostics = getDiagnostics();
    const status = (id: string) => diagnostics.checks.find((check) => check.id === id)?.status;
    assert.equal(status("graphiti"), "warning");
    assert.equal(status("granola-mode"), "warning");
    assert.equal(status("routing"), "warning");
    assert.equal(status("meeting-channel"), "warning");
    assert.equal(status("meeting-source"), "warning");
    assert.equal(status("db-path"), "ready");
    assert.equal(diagnostics.checks.some((check) => check.status === "missing"), false);
    assert.equal(diagnostics.ready, true);
    assert.equal(diagnostics.dbHealth.parentWritable, true);
  });
});

test("diagnostics are not ready when a required check is missing", () => {
  withSetup("zapier-webhook", { PERRY_GRAPHITI_ENABLED: "true" }, () => {
    delete process.env.NOTION_TOKEN;
    const diagnostics = getDiagnostics();
    assert.equal(diagnostics.checks.find((check) => check.id === "notion-token")?.status, "missing");
    assert.equal(diagnostics.checks.find((check) => check.id === "granola-mode")?.status, "ready");
    assert.equal(diagnostics.ready, false);
  });
});

test("diagnostics warn that the api-poll Granola mode is not implemented", () => {
  withSetup("api-poll", {}, () => {
    const granola = getDiagnostics().checks.find((check) => check.id === "granola-mode");
    assert.equal(granola?.status, "warning");
    assert.match(granola?.detail ?? "", /not implemented.*zapier-webhook/u);
  });
});

test("diagnostics report the extraction mode and a missing Together key", () => {
  const extraction = () => getDiagnostics().checks.find((check) => check.id === "extraction");
  withSetup("zapier-webhook", {}, () => {
    assert.equal(extraction()?.status, "ready");
    assert.match(extraction()?.detail ?? "", /Rules-based/u);
  });
  withSetup("zapier-webhook", { PERRY_EXTRACTION_MODE: "hybrid", PERRY_EXTRACTION_BACKEND: "together" }, () => {
    assert.equal(extraction()?.status, "missing");
    assert.equal(getDiagnostics().ready, false);
  });
  withSetup("zapier-webhook", { PERRY_EXTRACTION_MODE: "llm" }, () => {
    assert.equal(extraction()?.status, "ready");
    assert.match(extraction()?.detail ?? "", /^llm via http/u);
  });
});
