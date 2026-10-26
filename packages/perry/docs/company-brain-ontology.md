# Company Brain Ontology

The ontology is Perry's typed model of company state: what the company is trying to do, what stands in the way, what it is building, and the evidence behind each claim. This document describes the entity and relation types, how they are extracted, how to query them, and how to verify the index. Read it if you are building on the `/api/brain/ontology` or `/api/brain/tools` endpoints, the `/brain state` command, or the extraction code.

## Why typed objects

The graph should never become a raw transcript dump. Meetings, decisions, actions, documents, benchmarks, and tool output become typed objects with short, bounded evidence. Discord, the admin UI, and language models then work with those objects directly. A model asks for a project's state, an owner's load, a decision's history, or what changed since yesterday, instead of loading a pile of meeting text.

The rule for every consumer is the same: **typed object queries first, global search second.**

## Entity types

The core types capture meetings and the work that comes out of them:

| Type | Meaning |
|---|---|
| `meeting` | A Granola meeting Perry processed. |
| `person` | A creator, attendee, owner, assignee, or reviewer. |
| `project` | A routed project, or an inferred product or work area. |
| `decision` | A proposed or accepted decision from a meeting. |
| `action_item` | Follow-up work from a meeting. |
| `repository`, `customer`, `policy` | Operating objects the team mentions. |
| `channel`, `data_source`, `notion_page`, `discord_message`, `source_note` | Integration and provenance surfaces. |

The company-state types are what make Perry a company brain rather than a meeting archive:

| Type | Meaning |
|---|---|
| `goal` | A desired outcome, OKR, objective, or target. |
| `metric` | A KPI, SLO, latency percentile, quality measure, or scale target. |
| `risk` | A possible future bad state, or an accepted uncertainty. |
| `blocker` | A current dependency preventing progress. |
| `open_question` | An unresolved decision point. |
| `capability` | A durable workflow or power the company is building. |
| `feature` | A specific product or system behavior. |
| `artifact` | A document, config, dashboard, prompt, database, report, or other concrete work product. |
| `benchmark_report` | An empirical performance or evaluation result. |

## Relation types

| Group | Relations |
|---|---|
| Meeting and provenance | `CAPTURED_BY`, `ATTENDED_BY`, `DERIVED_FROM`, `ROUTED_TO_PROJECT`, `ROUTED_TO_CHANNEL`, `WRITES_TO_DATA_SOURCE`, `DOCUMENTED_IN`, `POSTED_TO` |
| Work and ownership | `HAS_DECISION`, `HAS_ACTION_ITEM`, `ASSIGNED_TO`, `ASSIGNED_OWNER`, `HAS_FALLBACK_REVIEWER` |
| Mentions | `MENTIONS_REPOSITORY`, `MENTIONS_CUSTOMER`, `REFERENCES_POLICY`, `MENTIONS_GOAL`, `MENTIONS_METRIC`, `MENTIONS_RISK`, `MENTIONS_BLOCKER`, `MENTIONS_OPEN_QUESTION`, `MENTIONS_CAPABILITY`, `MENTIONS_FEATURE`, `REFERENCES_ARTIFACT`, `REFERENCES_BENCHMARK_REPORT` |
| Company state | `SUPPORTS_GOAL` (project to goal), `HAS_RISK` (project to risk), `BLOCKED_BY` (project to blocker), `HAS_OPEN_QUESTION` (project to question), `IMPLEMENTS_CAPABILITY` (project or feature to capability), `VALIDATED_BY` (feature, metric, or artifact to benchmark report) |

## Extraction

Two sources feed the ontology. When `PERRY_EXTRACTION_MODE` is `llm` or `hybrid`, the model's grounded repository, customer, and policy entities become `MENTIONS_REPOSITORY`, `MENTIONS_CUSTOMER`, and `REFERENCES_POLICY` relations from the meeting, at confidence 0.7. They share stable keys with the pattern extractor below, so an entity found both ways is stored once. See [Extraction](architecture.md#extraction) for how model output is grounded.

The pattern extractor is deterministic and always runs. It recognizes explicit, labelled operating language in a meeting summary:

```text
Goal: reduce search p95 below 20 ms.
Metric: p95 search latency 15 ms.
Risk: Graphiti bridge outage during sync.
Blocker: missing Notion permissions.
Open question: should typed tools answer by default?
Capability: typed company brain queries.
Feature: adaptive search retries.
Artifact: reports/db/gemma-5000-fast.sqlite.
Benchmark report: Gemma 5000 Query Gauntlet.
```

This is deliberate. Perry prefers explicit labels over guessing from vague prose. Even a labelled value must name something specific to become an entity: a capital letter after its first character (a proper noun or acronym, not just sentence case), a digit, path or identifier punctuation (`/`, `_`, `#`, `-`), a technical unit such as `p95`, `ms`, or `sqlite`, or else at least three content words. "Feature: adaptive search retries" qualifies; "Goal: make it better" and "Goal: Improve things" do not.

Every stable key is built by `normalizeStableKey` in `@core` (lowercase, URL scheme dropped, other runs of characters collapsed to `-`, at most 160 characters). Project keys come from `projectStableKey`, so `Wallace` is always `project:wallace`, whether the graph builder, an ontology project filter, `/brain project`, or the Notion wiki sync builds it.

An LLM may later produce these labels as structured operations, but what enters the graph stays typed, validated, and backed by evidence.

## Where the ontology lives

Ontology objects travel inside [graph change sets](graphiti-integration.md#change-sets). When a valid change set is stored, Perry materializes it into an indexed SQLite read model, so queries never re-parse change-set JSON. Change sets that failed validation are kept only for review: they are never materialized, and neither the backfill below nor the query layer's fallback reads them. The read model has four tables:

| Table | Holds |
|---|---|
| `ontology_entities` | Stable key, type, name, aliases, properties, evidence IDs, source meetings, timestamps. |
| `ontology_relations` | Subject, relation, object, evidence, confidence, source meeting, timestamps. |
| `ontology_evidence` | Bounded proof records from meetings, decisions, actions, Notion, Discord, or Granola. |
| `ontology_entity_evidence` | The many-to-many link between entities and evidence. |

Change sets are only built when graph memory is enabled (`PERRY_GRAPHITI_ENABLED=true` with a bridge URL), so with graph memory off, the ontology stays empty. For a database that has change sets but no materialized rows, the query layer falls back to parsing the stored change sets, and `company-brain:ontology-backfill` rebuilds the index:

```sh
pnpm company-brain:ontology-backfill -- --limit 100000 --report reports/ontology/backfill.json --markdown reports/ontology/backfill.md
```

By default it clears and rebuilds the whole index. `--incremental true` keeps existing rows, `--changed-since <ISO timestamp>` replays only recently updated change sets, `--dry-run true` estimates impact without writing, and `--db <path>` targets another database.

## Querying the ontology

The query functions live in the `@brain` module (`getOntologyIndex`, `queryGoals`, `queryRisks`, and so on for each type, plus `queryEvidenceFor` and `queryOntologyChangedSince`). They are exposed three ways.

**Admin API.** The ontology endpoints return entities with their incoming and outgoing relations and evidence excerpts, shaped for the admin UI:

```text
GET /api/brain/ontology                                          # type counts and most-linked projects
GET /api/brain/ontology?type=risk&project=Wallace&limit=25
GET /api/brain/ontology?type=goal&q=latency
GET /api/brain/ontology/evidence?stableKey=goal:reduce-search-p95-below-20-ms
GET /api/brain/ontology/changed-since?since=2026-05-25T00:00:00.000Z
GET /api/brain/ontology/health?changeSetLimit=100
```

**Agent tool contracts.** The `/api/brain/tools/*` endpoints return compact, stable payloads meant for model tool calls: entity references, counts, relation references, and capped evidence excerpts, never UI-shaped payloads or raw meeting context.

```text
GET /api/brain/tools/project-state?project=Wallace&types=goal,risk,blocker
GET /api/brain/tools/changed-since?since=2026-05-25T00:00:00.000Z&project=Wallace
GET /api/brain/tools/evidence?stableKey=goal:reduce-search-p95-below-20-ms
```

**Discord.** The `/brain` command reads the same index. Replies are bounded and ephemeral:

```text
/brain state type:risk project:Wallace limit:5
/brain changed since:2026-05-25T00:00:00.000Z project:Wallace
/brain evidence entity:goal:reduce-search-p95-below-20-ms
```

The admin UI's Ontology Cockpit offers the same reads with type and project filters, a changed-since view, search, and an evidence drawer that mirrors `/brain evidence`.

## Verifying the ontology

All of these run against `dist/`, so run `pnpm build` first.

**Health report.** `GET /api/brain/ontology/health` checks a sample of change sets for parse errors, then reports entity, relation, and evidence coverage, missing evidence links, orphaned evidence, duplicate type-and-name groups, and project and meeting link coverage. Critical failures mean model and Discord answers should not be trusted; warnings are signals to repair or backfill.

**Ontology gauntlet.** Processes one synthetic meeting and proves project-scoped queries for goals, risks, blockers, open questions, capabilities, and evidence. It last passed in about 40 to 50 ms (2026-05-25).

```sh
pnpm company-brain:ontology-gauntlet -- --report reports/ontology/local-gauntlet.json --markdown reports/ontology/local-gauntlet.md
```

**Agent tool contract gauntlet.** Processes a synthetic meeting seeded with private-note and transcript markers, then calls the project-state, changed-since, evidence, and health contracts. It fails if a payload exceeds its byte budget, a call exceeds its latency budget, an evidence excerpt exceeds its cap, required relations or evidence are missing, or a private or transcript marker leaks into a tool payload.

```sh
pnpm agent-tools:gauntlet -- --report reports/agent-tools/contract-gauntlet.json --markdown reports/agent-tools/contract-gauntlet.md
```

**Persistent corpus gauntlet.** Builds a reusable on-disk corpus by ingesting meetings through the real workflow with direct change sets enabled, rebuilds the ontology index, and runs the tool contracts against it. It ingests when you pass `--reset true` or `--ingest true`, or when the database file does not exist yet; otherwise it reuses the existing database.

```sh
pnpm agent-tools:corpus-gauntlet -- --reset true --limit 250 --db reports/db/agent-tool-corpus.sqlite --report reports/agent-tools/corpus-gauntlet.json --markdown reports/agent-tools/corpus-gauntlet.md
```

**Repair.** Reports health, planned actions, and backfill counts. It is a dry run unless you pass `--apply true`, which rebuilds the index from change sets. Duplicate entity groups and unprojected entities are reported for review, never changed automatically.

```sh
pnpm ontology:repair -- --db reports/db/agent-tool-corpus.sqlite --report reports/ontology/repair-dry-run.json --markdown reports/ontology/repair-dry-run.md
```

**Performance.** Generates synthetic change sets and times materialized reads (entities, relations, summary, project queries, evidence) against the older parse-the-JSON path. `--budget-*` flags fail the run when a read exceeds its budget. This is the acceptance test for keeping Discord and model tool calls on indexed reads.

```sh
pnpm perf:ontology -- --count 1000 --budget-materialized-project-goals-ms 5 --budget-materialized-evidence-ms 2 --report reports/performance/ontology-perf-1000.json --markdown reports/performance/ontology-perf-1000.md
```
