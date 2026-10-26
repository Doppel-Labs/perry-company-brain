import assert from "node:assert/strict";
import test from "node:test";
import { projectStableKey } from "@core";
import { buildGraphChangeSet } from "@graph";
import { syncActionItemRecordToNotion, syncDecisionRecordToNotion, syncProjectRecordToNotion, type NotionWikiClient } from "@notion";

test("notion wiki sync exposes dry-run records for decisions actions and projects", async () => {
  const previous = process.env.PERRY_NOTION_DRY_RUN;
  process.env.PERRY_NOTION_DRY_RUN = "true";
  try {
    const decision = await syncDecisionRecordToNotion({
      id: "decision:1",
      meetingId: "meeting:1",
      text: "Use graph replay diff as trust proof.",
      status: "accepted",
      createdAt: "2026-05-23T10:00:00.000Z",
    });
    const action = await syncActionItemRecordToNotion({
      id: "action:1",
      meetingId: "meeting:1",
      text: "Wire Notion wiki sync.",
      owner: "Ada",
      status: "open",
      createdAt: "2026-05-23T10:00:00.000Z",
    });
    const project = await syncProjectRecordToNotion({ project: "Wallace", owner: "Ada", status: "open" });

    assert.equal(decision?.kind, "decision");
    assert.equal(action?.kind, "action_item");
    assert.equal(project?.id, "dry-run-project-wallace");
  } finally {
    if (previous === undefined) delete process.env.PERRY_NOTION_DRY_RUN;
    else process.env.PERRY_NOTION_DRY_RUN = previous;
  }
});

test("notion wiki sync updates the page found by its key instead of creating a duplicate", async () => {
  const keys = ["PERRY_NOTION_DRY_RUN", "NOTION_DECISIONS_DATA_SOURCE_ID", "NOTION_ACTION_ITEMS_DATA_SOURCE_ID", "NOTION_PROJECTS_DATA_SOURCE_ID"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  delete process.env.PERRY_NOTION_DRY_RUN;
  process.env.NOTION_DECISIONS_DATA_SOURCE_ID = "ds-decisions";
  process.env.NOTION_ACTION_ITEMS_DATA_SOURCE_ID = "ds-actions";
  process.env.NOTION_PROJECTS_DATA_SOURCE_ID = "ds-projects";
  const notion = fakeNotion();
  const options = { client: notion.client };

  try {
    const decision = { id: "decision:1", meetingId: "meeting:1", text: "Use replay diffs as proof.", status: "accepted" as const, createdAt: "2026-05-23T10:00:00.000Z" };
    const action = { id: "action:1", meetingId: "meeting:1", text: "Wire wiki sync.", owner: "Ada", status: "open" as const, createdAt: "2026-05-23T10:00:00.000Z" };

    const first = [
      await syncDecisionRecordToNotion(decision, options),
      await syncActionItemRecordToNotion(action, options),
      await syncProjectRecordToNotion({ project: "Notion Wiki", owner: "Ada", status: "open" }, options),
    ];
    const second = [
      await syncDecisionRecordToNotion({ ...decision, status: "rejected" }, options),
      await syncActionItemRecordToNotion({ ...action, status: "done" }, options),
      await syncProjectRecordToNotion({ project: "Notion Wiki", owner: "Ben", status: "done" }, options),
    ];

    assert.deepEqual(first.map((record) => record?.operation), ["created", "created", "created"]);
    assert.deepEqual(second.map((record) => record?.operation), ["updated", "updated", "updated"]);
    assert.deepEqual(second.map((record) => record?.id), first.map((record) => record?.id));
    assert.equal(notion.pages.size, 3);
    assert.deepEqual(notion.queries, [
      "ds-decisions Source Decision ID=decision:1",
      "ds-actions Source Action ID=action:1",
      "ds-projects Graph Entity=project:notion-wiki",
      "ds-decisions Source Decision ID=decision:1",
      "ds-actions Source Action ID=action:1",
      "ds-projects Graph Entity=project:notion-wiki",
    ]);
    const actionPage = notion.pages.get(String(first[1]?.id))?.properties as Record<string, { select?: { name: string } }>;
    assert.equal(actionPage.Status.select?.name, "done");
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("project keys are the graph's canonical stable keys everywhere they are built", async () => {
  // The change-set builder is the source of truth: its keys are what the graph stores.
  const name = "Café Ops: https://example.com/Q3 Launch Plan";
  const changeSet = buildGraphChangeSet({
    note: { source: "granola", sourceId: "key-1", title: "Key Review", attendees: [], summaryMarkdown: "Review." },
    record: {
      id: "granola:key-1",
      source: "granola",
      sourceId: "key-1",
      title: "Key Review",
      createdAt: "2026-05-23T10:00:00.000Z",
      updatedAt: "2026-05-23T10:00:00.000Z",
      status: "processed",
    },
    knowledge: { decisions: [], actionItems: [] },
    route: { project: name, publishMode: "approval", reason: "test" },
  });
  const stored = changeSet.entities.find((entity) => entity.type === "project")?.stableKey;

  assert.equal(stored, "project:caf-ops-example-com-q3-launch-plan");
  assert.equal(projectStableKey(name), stored);

  // The Notion project page records (and is looked up by) that same key.
  const keys = ["PERRY_NOTION_DRY_RUN", "NOTION_PROJECTS_DATA_SOURCE_ID"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  delete process.env.PERRY_NOTION_DRY_RUN;
  process.env.NOTION_PROJECTS_DATA_SOURCE_ID = "ds-projects";
  try {
    const notion = fakeNotion();
    const synced = await syncProjectRecordToNotion({ project: name, status: "open" }, { client: notion.client });
    const graphEntity = notion.pages.get(String(synced?.id))?.properties["Graph Entity"] as { rich_text: Array<{ text: { content: string } }> };
    assert.equal(graphEntity.rich_text[0].text.content, stored);
    assert.deepEqual(notion.queries, [`ds-projects Graph Entity=${stored}`]);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// An in-memory stand-in for the Notion client: pages keyed by id, found by a rich-text equals filter.
function fakeNotion() {
  const pages = new Map<string, { parent: string; properties: Record<string, unknown> }>();
  const queries: string[] = [];
  const text = (value: unknown) => (value as { rich_text?: Array<{ text: { content: string } }> } | undefined)?.rich_text?.[0]?.text.content;
  const client: NotionWikiClient = {
    dataSources: {
      async query(args) {
        const { data_source_id, filter } = args as { data_source_id: string; filter: { property: string; rich_text: { equals: string } } };
        queries.push(`${data_source_id} ${filter.property}=${filter.rich_text.equals}`);
        const results = [...pages.entries()]
          .filter(([, page]) => page.parent === data_source_id && text(page.properties[filter.property]) === filter.rich_text.equals)
          .map(([id]) => ({ id }));
        return { results };
      },
    },
    pages: {
      async create(args) {
        const { parent, properties } = args as { parent: { data_source_id: string }; properties: Record<string, unknown> };
        const id = `page-${pages.size + 1}`;
        pages.set(id, { parent: parent.data_source_id, properties });
        return { id, url: `https://notion.example/${id}` };
      },
      async update(args) {
        const { page_id, properties } = args as { page_id: string; properties: Record<string, unknown> };
        const page = pages.get(page_id);
        assert(page, `update of unknown page ${page_id}`);
        page.properties = { ...page.properties, ...properties };
        return { id: page_id, url: `https://notion.example/${page_id}` };
      },
    },
  };
  return { client, pages, queries };
}
