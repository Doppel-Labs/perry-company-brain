import assert from "node:assert/strict";
import test from "node:test";
import { extractMeetingKnowledge, getExtractionMode, isGrounded, resolveOwner, type LocalSemanticExtraction } from "@extraction";
import type { MeetingNote } from "@meetings";

const note: MeetingNote = {
  source: "granola",
  sourceId: "pipeline-1",
  title: "Wallace launch review",
  attendees: [{ name: "Ada Lovelace" }, { name: "Ben Ortiz" }],
  summaryMarkdown: [
    "We reviewed the Wallace onboarding launch with the Acme pilot customer.",
    "Ada will ship the onboarding checklist by 2026-11-02.",
    "Decisions:",
    "- Keep the Friday demo cadence.",
    "Action items:",
    "- Ben: update the perry-discord-bot runbook",
  ].join("\n"),
};

const reply = (overrides: Partial<LocalSemanticExtraction> = {}): LocalSemanticExtraction => ({
  decisions: [{ text: "Keep the weekly Friday demo cadence" }],
  actionItems: [{ text: "Ship the onboarding checklist", owner: "Ada", dueDate: "2026-11-02" }],
  entities: [
    { type: "customer", name: "Acme" },
    { type: "repository", name: "perry-discord-bot" },
  ],
  confidence: 0.9,
  ...overrides,
});

const people = ["Ada Lovelace", "Ben Ortiz"];

test("rules mode is the default and never calls a model", async () => {
  assert.equal(getExtractionMode({} as NodeJS.ProcessEnv), "rules");
  assert.equal(getExtractionMode({ PERRY_EXTRACTION_MODE: "nonsense" } as NodeJS.ProcessEnv), "rules");
  const knowledge = await extractMeetingKnowledge(note, {
    env: {} as NodeJS.ProcessEnv,
    extractor: async () => assert.fail("rules mode must not call the model"),
  });
  assert.deepEqual(knowledge.extraction, { method: "rules", requestedMode: "rules" });
  assert.deepEqual(knowledge.decisions, [{ text: "Keep the Friday demo cadence." }]);
});

test("llm mode keeps grounded items and resolves owners to known people", async () => {
  const knowledge = await extractMeetingKnowledge(note, { mode: "llm", people, extractor: async () => reply() });
  assert.equal(knowledge.extraction?.method, "llm");
  assert.deepEqual(knowledge.actionItems, [{ text: "Ship the onboarding checklist", owner: "Ada Lovelace", dueDate: "2026-11-02" }]);
  assert.deepEqual(knowledge.entities, [
    { type: "customer", name: "Acme" },
    { type: "repository", name: "perry-discord-bot" },
  ]);
});

test("ungrounded items, owners, entities, and due dates are dropped", async () => {
  const knowledge = await extractMeetingKnowledge(note, {
    mode: "llm",
    people,
    extractor: async () =>
      reply({
        decisions: [{ text: "Keep the Friday demo cadence" }, { text: "Acquire Initech for forty million dollars" }],
        actionItems: [{ text: "Update the perry-discord-bot runbook", owner: "Zed", dueDate: "next quarter" }],
        entities: [{ type: "customer", name: "Initech" }],
      }),
  });
  assert.deepEqual(knowledge.decisions, [{ text: "Keep the Friday demo cadence" }]);
  assert.deepEqual(knowledge.actionItems, [{ text: "Update the perry-discord-bot runbook", owner: undefined, dueDate: undefined }]);
  assert.deepEqual(knowledge.entities, []);
  assert.equal(knowledge.extraction?.droppedUngrounded, 1);
});

test("hybrid adds rule items the model missed and borrows their owners", async () => {
  const knowledge = await extractMeetingKnowledge(note, {
    mode: "hybrid",
    people,
    extractor: async () =>
      reply({ actionItems: [{ text: "Update the perry-discord-bot runbook" }, { text: "Ship the onboarding checklist", owner: "Ada" }] }),
  });
  assert.equal(knowledge.extraction?.method, "hybrid");
  // The model's decision covers the rule decision, so it is not duplicated.
  assert.equal(knowledge.decisions.length, 1);
  const runbook = knowledge.actionItems.find((item) => item.text.includes("runbook"));
  assert.equal(runbook?.owner, "Ben", "owner borrowed from the rule item that covers it");
  assert.equal(knowledge.actionItems.length, 2);
});

test("model failures and low confidence fall back to rules with a reason", async () => {
  const failed = await extractMeetingKnowledge(note, {
    mode: "hybrid",
    extractor: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1234");
    },
  });
  assert.equal(failed.extraction?.method, "rules");
  assert.equal(failed.extraction?.requestedMode, "hybrid");
  assert.match(failed.extraction?.fallbackReason ?? "", /ECONNREFUSED/u);
  assert.deepEqual(failed.decisions, [{ text: "Keep the Friday demo cadence." }]);

  const unsure = await extractMeetingKnowledge(note, {
    mode: "llm",
    env: { PERRY_EXTRACTION_MIN_CONFIDENCE: "0.8" } as NodeJS.ProcessEnv,
    extractor: async () => reply({ confidence: 0.4 }),
  });
  assert.equal(unsure.extraction?.method, "rules");
  assert.match(unsure.extraction?.fallbackReason ?? "", /confidence 0.4 is below 0.8/u);
});

test("llm mode falls back when nothing the model said is grounded", async () => {
  const knowledge = await extractMeetingKnowledge(note, {
    mode: "llm",
    extractor: async () => reply({ decisions: [{ text: "Migrate billing to Kubernetes" }], actionItems: [] }),
  });
  assert.equal(knowledge.extraction?.method, "rules");
  assert.match(knowledge.extraction?.fallbackReason ?? "", /no grounded/u);
});

test("grounding tolerates inflection and owner matching rejects ambiguity", () => {
  assert.equal(isGrounded("Shipping the checklist", "We will ship the checklist"), true);
  assert.equal(isGrounded("Hire three engineers", "We will ship the checklist"), false);
  assert.equal(resolveOwner("ada lovelace", people), "Ada Lovelace");
  assert.equal(resolveOwner("Ada", [...people, "Ada Byron"]), undefined);
  assert.equal(resolveOwner("Zed", people), undefined);
});
