import assert from "node:assert/strict";
import test from "node:test";
import { buildGraphChangeSet, graphPrivacySourcesFor, validateGraphChangeSet } from "@graph";
import { buildGraphitiMeetingEpisode, type GraphMemorySyncInput } from "@graph";

test("builds a typed graph change set with bounded evidence instead of raw transcript context", () => {
  const changeSet = buildGraphChangeSet(sampleInput());
  const validation = validateGraphChangeSet(changeSet);

  assert.equal(validation.valid, true);
  assert.equal(changeSet.sourceMeetingId, "granola:graph-object-1");
  assert.equal(changeSet.entities.some((entity) => entity.stableKey === "project:wallace"), true);
  assert.equal(changeSet.entities.some((entity) => entity.stableKey === "person:ada-doppel-example"), true);
  assert.equal(
    changeSet.relations.some(
      (relation) =>
        relation.subjectKey === "meeting:granola:graph-object-1" &&
        relation.relation === "ROUTED_TO_PROJECT" &&
        relation.objectKey === "project:wallace"
    ),
    true
  );

  const serializedEvidence = JSON.stringify(changeSet.evidence);
  assert.equal(serializedEvidence.includes("Operator-only private context"), false);
  assert.equal(serializedEvidence.includes("Full transcript should stay outside graph ops"), false);
});

test("represents ownership pivots as explicit relation assertions and retirements", () => {
  const changeSet = buildGraphChangeSet(
    sampleInput({
      decisions: [{ text: "Ada now owns Wallace onboarding, taking over from Ben; Cy is the fallback reviewer." }],
      actionItems: [],
    })
  );
  const validation = validateGraphChangeSet(changeSet);

  assert.equal(validation.valid, true);
  assert.equal(
    changeSet.relations.some(
      (relation) =>
        relation.subjectKey === "project:wallace" &&
        relation.relation === "ASSIGNED_OWNER" &&
        relation.objectKey === "person:ada"
    ),
    true
  );
  assert.equal(
    changeSet.relations.some(
      (relation) =>
        relation.subjectKey === "project:wallace" &&
        relation.relation === "HAS_FALLBACK_REVIEWER" &&
        relation.objectKey === "person:cy"
    ),
    true
  );
  assert.equal(
    changeSet.retirements.some(
      (retirement) =>
        retirement.subjectKey === "project:wallace" &&
        retirement.relation === "ASSIGNED_OWNER" &&
        retirement.objectKey === "person:ben"
    ),
    true
  );
});

test("a plain fallback reviewer is not a previous owner, so nothing is retired", () => {
  const changeSet = buildGraphChangeSet(
    sampleInput({
      decisions: [{ text: "Ada now owns Wallace onboarding; Ben is the fallback reviewer." }],
      actionItems: [],
    })
  );

  assert.equal(validateGraphChangeSet(changeSet).valid, true);
  assert.equal(
    changeSet.relations.some(
      (relation) =>
        relation.subjectKey === "project:wallace" && relation.relation === "HAS_FALLBACK_REVIEWER" && relation.objectKey === "person:ben"
    ),
    true
  );
  assert.deepEqual(changeSet.retirements, []);
});

test("deduplicates entities while preserving multiple evidence-backed relations", () => {
  const changeSet = buildGraphChangeSet(
    sampleInput({
      creatorName: "Ada",
      creatorEmail: "ada@doppel.example",
      attendees: [{ name: "Ada", email: "ada@doppel.example" }],
      decisions: [{ text: "Ada owns Wallace onboarding until next planning review." }],
      actionItems: [{ owner: "Ada", text: "Ship Wallace checklist." }],
    })
  );
  const adaEntities = changeSet.entities.filter((entity) => entity.stableKey === "person:ada-doppel-example");

  assert.equal(adaEntities.length, 1);
  assert.equal(
    changeSet.relations.filter((relation) => relation.objectKey === "person:ada-doppel-example").length >= 2,
    true
  );
  assert.equal(validateGraphChangeSet(changeSet).valid, true);
});

test("extracts operating ontology entities from routes and meeting text", () => {
  const changeSet = buildGraphChangeSet(
    sampleInput({
      summaryMarkdown:
        "Customer Acme. Repository doppel-labs/wallace-webapp should follow policy SOC2 Evidence Retention.",
    })
  );

  assert.equal(validateGraphChangeSet(changeSet).valid, true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "repository" && entity.stableKey === "repository:doppel-labs-wallace-webapp"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "customer" && entity.stableKey === "customer:acme"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "policy" && entity.stableKey === "policy:soc2-evidence-retention"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "channel" && entity.stableKey === "channel:discord:wallace-channel"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "data_source" && entity.stableKey === "data_source:notion:wallace-data-source"), true);
  assert.equal(changeSet.relations.some((relation) => relation.relation === "MENTIONS_REPOSITORY"), true);
  assert.equal(changeSet.relations.some((relation) => relation.relation === "ROUTED_TO_CHANNEL"), true);
  assert.equal(changeSet.relations.some((relation) => relation.relation === "WRITES_TO_DATA_SOURCE"), true);
});
test("extracts richer company-state ontology from operating language", () => {
  const changeSet = buildGraphChangeSet(
    sampleInput({
      summaryMarkdown:
        "Goal: reduce search p95 below 20 ms. Metric: p95 search latency 15 ms. " +
        "Risk: Graphiti bridge outage during sync. Blocker: missing Notion permissions. " +
        "Open question: should typed tools answer by default? Capability: typed company brain queries. " +
        "Feature: adaptive search retries. Artifact: reports/db/gemma-5000-fast.sqlite. " +
        "Benchmark report: Gemma 5000 Query Gauntlet.",
    })
  );

  assert.equal(validateGraphChangeSet(changeSet).valid, true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "goal" && entity.stableKey === "goal:reduce-search-p95-below-20-ms"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "metric" && entity.stableKey === "metric:p95-search-latency-15-ms"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "risk" && entity.stableKey === "risk:graphiti-bridge-outage-during-sync"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "blocker" && entity.stableKey === "blocker:missing-notion-permissions"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "open_question" && entity.stableKey === "open-question:should-typed-tools-answer-by-default"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "capability" && entity.stableKey === "capability:typed-company-brain-queries"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "feature" && entity.stableKey === "feature:adaptive-search-retries"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "artifact" && entity.stableKey === "artifact:reports-db-gemma-5000-fast-sqlite"), true);
  assert.equal(changeSet.entities.some((entity) => entity.type === "benchmark_report" && entity.stableKey === "benchmark-report:gemma-5000-query-gauntlet"), true);
  assert.equal(changeSet.relations.some((relation) => relation.subjectKey === "project:wallace" && relation.relation === "SUPPORTS_GOAL"), true);
  assert.equal(changeSet.relations.some((relation) => relation.subjectKey === "project:wallace" && relation.relation === "BLOCKED_BY"), true);
  assert.equal(changeSet.relations.some((relation) => relation.relation === "VALIDATED_BY"), true);
});
test("avoids turning generic lowercase operating phrases into graph entities", () => {
  const changeSet = buildGraphChangeSet(
    sampleInput({
      summaryMarkdown:
        "The customer support process reviewed repository hygiene and policy cleanup as generic team vocabulary.",
      decisions: [],
      actionItems: [],
    })
  );

  assert.equal(validateGraphChangeSet(changeSet).valid, true);
  assert.equal(changeSet.entities.some((entity) => entity.stableKey === "customer:support"), false);
  assert.equal(changeSet.entities.some((entity) => entity.stableKey === "repository:hygiene"), false);
  assert.equal(changeSet.entities.some((entity) => entity.stableKey === "policy:cleanup"), false);
});
test("Graphiti meeting episodes carry graph operations and validation metadata", () => {
  const previousPrivate = process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES;
  const previousTranscript = process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT;
  delete process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES;
  delete process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT;

  try {
    const episode = buildGraphitiMeetingEpisode(sampleInput(), "doppel-test");
    const body = JSON.parse(episode.body) as {
      graphChangeSet?: { entities: unknown[]; relations: unknown[]; evidence: unknown[] };
      graphValidation?: { valid: boolean; errors: string[] };
      privateNotes?: string;
      transcript?: string;
    };

    assert.equal(body.graphValidation?.valid, true);
    assert.equal(body.graphValidation?.errors.length, 0);
    assert.equal(Array.isArray(body.graphChangeSet?.entities), true);
    assert.equal(Array.isArray(body.graphChangeSet?.relations), true);
    assert.equal(Array.isArray(body.graphChangeSet?.evidence), true);
    assert.equal(body.privateNotes, undefined);
    assert.equal(body.transcript, undefined);
  } finally {
    if (previousPrivate === undefined) delete process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES;
    else process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES = previousPrivate;
    if (previousTranscript === undefined) delete process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT;
    else process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT = previousTranscript;
  }
});

test("keeps only specific operating mentions: names, numbers, identifiers, or three content words", () => {
  const changeSet = buildGraphChangeSet(
    sampleInput({
      summaryMarkdown: [
        "Goal: make it better.",
        "Goal: Improve things.",
        "Risk: things slip.",
        "Blocker: follow-up.",
        "Our goal is to ship it soon.",
        "Goal: reduce search p95 below 20 ms.",
        "Risk: Graphiti bridge outage during sync.",
        "Blocker: missing Notion permissions.",
        "Feature: adaptive search retries.",
        "Capability: SOC2 evidence export.",
      ].join("\n"),
      decisions: [],
      actionItems: [],
    })
  );
  const keys = changeSet.entities.map((entity) => entity.stableKey);

  for (const vague of ["goal:make-it-better", "goal:improve-things", "risk:things-slip", "blocker:follow-up", "goal:ship-it-soon"]) {
    assert.equal(keys.includes(vague), false, `${vague} should not become an entity`);
  }
  for (const specific of [
    "goal:reduce-search-p95-below-20-ms",
    "risk:graphiti-bridge-outage-during-sync",
    "blocker:missing-notion-permissions",
    "feature:adaptive-search-retries",
    "capability:soc2-evidence-export",
  ]) {
    assert.equal(keys.includes(specific), true, `${specific} should become an entity`);
  }
});

test("a decision that merely mentions the transcript is not a privacy violation", () => {
  const input = sampleInput({
    decisions: [{ text: "Keep the Granola transcript out of Notion; private notes stay with the operator." }],
    actionItems: [{ owner: "Ada", text: "Delete the transcript export once the summary is approved." }],
  });
  const episode = buildGraphitiMeetingEpisode(input, "doppel-test");
  const body = JSON.parse(episode.body) as { graphValidation: { valid: boolean; errors: string[] } };

  assert.deepEqual(body.graphValidation.errors, []);
  assert.equal(body.graphValidation.valid, true);
});

test("evidence quoting the private transcript or notes invalidates the change set", () => {
  const input = sampleInput({
    transcript: "Ben said the Acme renewal is at risk because their CFO is leaving in March, keep this quiet.",
    privateNotes: "Ada thinks Wallace pricing should double next quarter without telling the team",
  });
  const privacy = graphPrivacySourcesFor(input);
  const changeSet = buildGraphChangeSet(input);
  assert.equal(validateGraphChangeSet(changeSet, privacy).valid, true);

  const leaked = {
    ...changeSet,
    evidence: changeSet.evidence.map((item) =>
      item.evidenceId === "evidence:meeting:granola:graph-object-1"
        ? { ...item, excerpt: `${item.excerpt} Note: the Acme renewal is at risk because their CFO is leaving in March.` }
        : item.evidenceId === "evidence:decision:granola:graph-object-1:1"
          ? { ...item, excerpt: "Ada thinks Wallace pricing should double next quarter." }
          : item
    ),
  };
  const validation = validateGraphChangeSet(leaked, privacy);

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors, [
    "Graph evidence contains private notes or transcript content: evidence:meeting:granola:graph-object-1, evidence:decision:granola:graph-object-1:1",
  ]);
});

test("private-note text that extraction published as a decision is not a leak", () => {
  // Extraction reads private notes, so a decision can repeat them verbatim; that text is published anyway.
  const input = sampleInput({
    privateNotes: "Decision: Ada now owns Wallace onboarding and Ben reviews the launch checklist.",
    decisions: [{ text: "Ada now owns Wallace onboarding and Ben reviews the launch checklist." }],
  });
  const validation = validateGraphChangeSet(buildGraphChangeSet(input), graphPrivacySourcesFor(input));

  assert.deepEqual(validation.errors, []);
});

test("model-extracted repositories, customers, and policies become meeting mentions", () => {
  const input = sampleInput({
    summaryMarkdown: "Northwind wants the doppel-labs/perry-discord-bot repo fixed. Decisions:\n- Ada now owns Wallace onboarding.",
  });
  input.knowledge.entities = [
    { type: "customer", name: "Northwind" },
    { type: "repository", name: "doppel-labs/perry-discord-bot" },
    { type: "project", name: "Wallace" },
  ];
  const changeSet = buildGraphChangeSet(input);
  const meetingKey = "meeting:granola:graph-object-1";
  const mentions = (relation: string, objectKey: string) =>
    changeSet.relations.filter((item) => item.subjectKey === meetingKey && item.relation === relation && item.objectKey === objectKey);

  assert.equal(validateGraphChangeSet(changeSet).valid, true);
  assert.equal(mentions("MENTIONS_CUSTOMER", "customer:northwind").length, 1);
  // The regex extractor also finds owner/repo; both paths merge into one entity and one relation.
  assert.equal(changeSet.entities.filter((entity) => entity.stableKey === "repository:doppel-labs-perry-discord-bot").length, 1);
  assert.equal(mentions("MENTIONS_REPOSITORY", "repository:doppel-labs-perry-discord-bot").length, 1);
  // Projects come from routing, not from model mentions.
  assert.equal(changeSet.relations.some((item) => item.relation === "MENTIONS_CUSTOMER" && item.objectKey.startsWith("project:")), false);
});

function sampleInput(overrides: Partial<GraphMemorySyncInput["note"] & GraphMemorySyncInput["knowledge"]> = {}): GraphMemorySyncInput {
  const noteOverrides = overrides as Partial<GraphMemorySyncInput["note"]>;
  const knowledgeOverrides = overrides as Partial<GraphMemorySyncInput["knowledge"]>;
  return {
    note: {
      source: "granola",
      sourceId: "graph-object-1",
      title: "Wallace Graph Object Review",
      creatorName: noteOverrides.creatorName ?? "Ada",
      creatorEmail: noteOverrides.creatorEmail ?? "ada@doppel.example",
      attendees: noteOverrides.attendees ?? [
        { name: "Ben", email: "ben@doppel.example" },
        { name: "Ada", email: "ada@doppel.example" },
      ],
      calendarTitle: "Wallace planning",
      folderName: "Wallace",
      startedAt: "2026-05-23T15:00:00.000Z",
      summaryMarkdown:
        "Decisions:\n- Ada now owns Wallace onboarding; Ben is the fallback reviewer.\n\nAction items:\n- Ada: Ship Wallace checklist.",
      privateNotes: "Operator-only private context",
      transcript: "Full transcript should stay outside graph ops.",
      sourceUrl: "https://granola.example/graph-object-1",
      ...noteOverrides,
    },
    record: {
      id: "granola:graph-object-1",
      source: "granola",
      sourceId: "graph-object-1",
      title: "Wallace Graph Object Review",
      createdAt: "2026-05-23T15:00:00.000Z",
      updatedAt: "2026-05-23T15:01:00.000Z",
      notionUrl: "https://notion.example/wallace-graph-object-review",
      discordMessageUrl: "https://discord.example/channels/1/2/3",
      status: "processed",
    },
    knowledge: {
      decisions: knowledgeOverrides.decisions ?? [
        { text: "Ada now owns Wallace onboarding; Ben is the fallback reviewer." },
      ],
      actionItems: knowledgeOverrides.actionItems ?? [{ owner: "Ada", text: "Ship Wallace checklist." }],
    },
    route: {
      project: "Wallace",
      publishMode: "approval",
      reason: "Matched Wallace routing",
      discordChannelId: "wallace-channel",
      notionDataSourceId: "wallace-data-source",
    },
  };
}



