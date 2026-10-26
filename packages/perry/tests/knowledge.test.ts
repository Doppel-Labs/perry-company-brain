import assert from "node:assert/strict";
import test from "node:test";
import { extractKnowledge } from "@extraction";

test("extracts decisions and action items from structured meeting text", () => {
  const knowledge = extractKnowledge({
    source: "granola",
    sourceId: "note-1",
    title: "Brain Review",
    attendees: [],
    summaryMarkdown:
      "Decisions:\n- Use Notion as the durable source.\n\nAction items:\n- Ada: Create the Discord route by tomorrow\n- Review schema next week",
  });

  assert.deepEqual(knowledge.decisions, [{ text: "Use Notion as the durable source." }]);
  assert.equal(knowledge.actionItems.length, 2);
  assert.equal(knowledge.actionItems[0].owner, "Ada");
  assert.equal(knowledge.actionItems[0].dueDate, "tomorrow");
});

test("inline markers ignore hyphenated words and need a colon after bare nouns", () => {
  const knowledge = extractKnowledge({
    source: "granola",
    sourceId: "note-2",
    title: "Retro",
    attendees: [],
    summaryMarkdown: [
      "Decision-making was slow this sprint.",
      "Action-oriented folks kept us moving.",
      "We agreed to ship weekly.",
      "Decision: keep the Friday demo.",
      "Action item: Ada: draft the release notes",
    ].join("\n"),
  });

  assert.deepEqual(
    knowledge.decisions.map((decision) => decision.text),
    ["to ship weekly.", "keep the Friday demo."]
  );
  assert.deepEqual(knowledge.actionItems, [{ text: "draft the release notes", owner: "Ada", dueDate: undefined }]);
});

test("action owners split on a colon or spaced dash, not inside hyphenated words", () => {
  const knowledge = extractKnowledge({
    source: "granola",
    sourceId: "note-3",
    title: "Planning",
    attendees: [],
    summaryMarkdown: "Action items:\n- Alex - fix the follow-up flow\n- Mary-Jane: ship the importer\n- Review the backlog - all hands",
  });

  assert.deepEqual(
    knowledge.actionItems.map(({ owner, text }) => ({ owner, text })),
    [
      { owner: "Alex", text: "fix the follow-up flow" },
      { owner: "Mary-Jane", text: "ship the importer" },
      { owner: "Review the backlog", text: "all hands" },
    ]
  );
});
