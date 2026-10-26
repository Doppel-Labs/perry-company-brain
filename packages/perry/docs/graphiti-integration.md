# Graphiti Integration

Perry can feed an optional temporal knowledge graph, built on [Graphiti](https://github.com/getzep/graphiti) and Neo4j, that remembers how people, projects, and decisions relate and how those relationships change over time. This document explains where the graph fits, how to run it locally, and the data contract between Perry and the graph. Read it if you are enabling graph memory or working on `src/graph`.

## Where the graph fits

SQLite stays Perry's operational store. It handles idempotency, approvals, queues, and fast admin and API reads, all in milliseconds. The graph is a second, slower layer that answers different questions: how a project changed over time, who owns the moving parts now, which past decisions conflict, and which facts are current versus superseded.

Graphiti uses LLM extraction and an external graph database, so it sits behind a sidecar boundary with a timeout. Webhook acknowledgement, approval review, and Notion and Discord posting never wait on it. A meeting is handed to the graph only after it has been published, through a durable queue, so the graph is eventually consistent: if the bridge, the model, or Neo4j is down, Perry still publishes and retries the graph sync later.

```text
Granola -> Perry webhook -> approval / publish workflow -> Notion page + Discord post
                                                              │
                                    graph change set + ontology index (SQLite)
                                                              │
                                              graph sync queue (SQLite, retried)
                                                              │
                                          Graphiti bridge (Python, port 8791)
                                                              │
                                                     Neo4j temporal graph
```

Each layer answers its own question:

- **SQLite:** what did we ingest, what is pending, what did this meeting decide, and what should Discord post?
- **Perry's graph change sets:** which typed objects and relations should exist because of this meeting, and what evidence proves each one?
- **Perry's graph read endpoints:** what bounded context should a UI, a Discord command, or a model receive about one entity?
- **Graphiti:** how has this changed over time, and what is true now?

Perry owns workflow correctness and latency. Perry's typed change sets keep the graph's inputs rational. Graphiti owns temporal meaning.

## The pieces

- **`src/graph`** (`@graph`) builds and validates graph change sets, formats Graphiti episodes, runs the graph sync queue and worker, implements replay and backfill, and contains the HTTP client for the bridge.
- **`integrations/graphiti/graphiti_bridge.py`** is a small HTTP service wrapping `graphiti-core`. It exposes `GET /health`, `GET /llm/health`, `POST /episodes`, `POST /change-sets`, `POST /search`, and bounded reads at `GET /entities`, `/facts`, `/evidence`, `/entity-context`, and `/timeline`.
- **The admin API** exposes the graph sync queue, change-set review and replay, and graph reads under `/api/graph-sync/*` and `/api/brain/graph/*`. See the [endpoint reference](../README.md#admin-api-reference).
- **The admin UI** has panels for graph sync status, change-set review and replay, and graph exploration. The readiness checklist includes a Graphiti item.

## Running it locally

You need Python 3.10 or later with [uv](https://docs.astral.sh/uv/), Docker for Neo4j, and an OpenAI-compatible model endpoint. The examples use LM Studio on a desktop GPU. Commands below run from `packages/perry`; from the repository root, use `pnpm perry <script>`.

### 1. Start Neo4j

```powershell
docker run --name perry-neo4j -d `
  -p 7474:7474 -p 7687:7687 `
  -e NEO4J_AUTH=neo4j/perry-local-dev-password `
  -e NEO4J_server_memory_heap_initial__size=512m `
  -e NEO4J_server_memory_heap_max__size=2G `
  -e NEO4J_server_memory_pagecache_size=1G `
  -v perry-neo4j-data:/data `
  -v perry-neo4j-logs:/logs `
  neo4j:5.26-community

docker exec perry-neo4j cypher-shell -u neo4j -p perry-local-dev-password "RETURN 1 AS ok"
```

The Neo4j Browser is then at `http://localhost:7474`, and Bolt at `bolt://127.0.0.1:7687`.

### 2. Start a model server

In LM Studio's Developer tab, start the local server on `http://127.0.0.1:1234/v1` and load a chat model and an embedding model. This setup has been tested with chat model `qwen_qwen3-4b-instruct-2507` and embedding model `text-embedding-nomic-embed-text-v1.5` (768 dimensions). Check that both respond:

```powershell
$env:GRAPHITI_LLM_MODEL = "qwen_qwen3-4b-instruct-2507"
$env:GRAPHITI_EMBEDDING_MODEL = "text-embedding-nomic-embed-text-v1.5"
pnpm lmstudio:smoke
```

### 3. Start the bridge

```powershell
uv sync --directory integrations/graphiti

$env:GRAPHITI_LLM_PROVIDER = "lmstudio"
$env:GRAPHITI_OPENAI_BASE_URL = "http://127.0.0.1:1234/v1"
$env:GRAPHITI_OPENAI_API_KEY = "lm-studio"
$env:GRAPHITI_LLM_MODEL = "qwen_qwen3-4b-instruct-2507"
$env:GRAPHITI_SMALL_LLM_MODEL = "qwen_qwen3-4b-instruct-2507"
$env:GRAPHITI_EMBEDDING_MODEL = "text-embedding-nomic-embed-text-v1.5"
$env:GRAPHITI_EMBEDDING_DIM = "768"
$env:NEO4J_URI = "bolt://127.0.0.1:7687"
$env:NEO4J_USER = "neo4j"
$env:NEO4J_PASSWORD = "perry-local-dev-password"
pnpm graphiti:bridge
```

The bridge listens on `127.0.0.1:8791` by default (`GRAPHITI_BRIDGE_HOST`, `GRAPHITI_BRIDGE_PORT`). `GET /llm/health` confirms the configured chat and embedding models are visible before you attempt a write.

### 4. Point Perry at it

```powershell
$env:PERRY_GRAPHITI_ENABLED = "true"
$env:PERRY_GRAPHITI_BRIDGE_URL = "http://127.0.0.1:8791"
$env:PERRY_GRAPHITI_GROUP_ID = "doppel-labs"
$env:PERRY_GRAPHITI_TIMEOUT_MS = "120000"
$env:PERRY_GRAPHITI_DIRECT_CHANGESETS = "true"
$env:PERRY_GRAPH_SYNC_WORKER = "true"
pnpm dev:server
```

Raise `PERRY_GRAPHITI_TIMEOUT_MS` well above its 3-second default whenever Graphiti does LLM extraction: an episode write on a local GPU can take tens of seconds. Without `PERRY_GRAPH_SYNC_WORKER=true`, queued jobs wait until you call `POST /api/graph-sync/drain`. Every graph variable is listed in the [configuration reference](../README.md#configuration).

### Checking it

```powershell
Invoke-RestMethod http://127.0.0.1:8791/health
Invoke-RestMethod http://127.0.0.1:8791/llm/health
Invoke-RestMethod "http://127.0.0.1:8787/api/graph-sync/change-sets?detail=true" -Headers @{ Authorization = "Bearer $env:ADMIN_API_TOKEN" }
Invoke-RestMethod "http://127.0.0.1:8791/entities?groupId=doppel-labs&q=wallace"
Invoke-RestMethod "http://127.0.0.1:8791/facts?groupId=doppel-labs&subject=project:wallace&active=true"
docker exec perry-neo4j cypher-shell -u neo4j -p perry-local-dev-password "MATCH (n) RETURN labels(n) AS labels, count(n) AS count ORDER BY count DESC"
```

## Backfilling history

To queue meetings that were processed before graph memory was enabled:

```sh
pnpm graphiti:backfill -- --batch 500               # queue only
pnpm graphiti:backfill -- --batch 500 --drain true  # queue and drain
```

The backfill uses Perry's stored meeting records plus their extracted decisions and action items. Perry does not store a meeting's original Granola link, so backfilled change sets have no Granola source note; the meeting's Notion page is still linked through `DOCUMENTED_IN`. If you have original Granola exports, import them first with `pnpm backfill:meetings -- --input granola-export.jsonl` for a richer SQLite brain, then backfill the graph.

## The data contract

### Change sets

For every published meeting, Perry builds a `graphChangeSet`: a set of typed, bounded operations derived from the meeting, so that the graph is never asked to infer the whole company from a growing prose blob.

- **`entities`**: stable upserts for meetings, people, projects, decisions, action items, Notion pages, Discord messages, Granola source notes, and the richer [ontology](company-brain-ontology.md) types.
- **`relations`**: explicit assertions such as `HAS_DECISION`, `ASSIGNED_TO`, `ASSIGNED_OWNER`, `DOCUMENTED_IN`, and `POSTED_TO`.
- **`retirements`**: relations that end, for example the previous owner relationship when a new owner is assigned.
- **`evidence`**: short, source-backed excerpts and URLs. Every entity and relation must point to evidence.
- **`warnings`**: non-blocking gaps, such as an ownership decision whose project could not be resolved.

Perry validates each change set and stores it in the `graph_change_sets` table, along with its validation status (`valid` or `invalid`), the validation errors and warnings, its apply status, when it was applied, and the last error. At the same moment, Perry materializes a valid change set into the SQLite ontology index that powers the ontology endpoints and `/brain state`. All of this happens only when graph memory is enabled.

The apply status is one of:

| Status | Meaning |
|---|---|
| `queued` | Waiting in the graph sync queue, or being retried after a failed post. |
| `applied` | The bridge accepted it (and, after a replay, the readback confirmed it). |
| `unverified` | A replay write was accepted, but the readback found gaps or could not be completed. The last error summarizes them. |
| `failed` | The post failed for good, or the change set is invalid and was never posted. |

An **invalid** change set is kept for review and nothing else. It is never materialized into the ontology (an index rebuild skips it too), its graph sync job is written as `failed` with the reason (`Not posted: graph change set failed validation: ...`) instead of being queued, and replay refuses it. This holds in both write modes, since an episode carries its change set. Jobs that were queued with an invalid change set before this rule existed are skipped when the queue drains, and `drainGraphSyncJobs` reports them as `skipped`.

### Two ways to write

The change set is wrapped in a JSON episode and queued in `graph_sync_jobs`. When the job is drained, it goes to the bridge in one of two ways:

- **Direct change sets** (`PERRY_GRAPHITI_DIRECT_CHANGESETS=true`, recommended). Perry posts the typed change set to the bridge's `/change-sets` endpoint, which writes `PerryGraphEntity`, `PerryGraphFact`, `PerryGraphEvidence`, and `PerryGraphRetirement` nodes to Neo4j with no LLM call. This is fast, deterministic, and works with no model loaded.
- **Episodes** (the default). Perry posts the episode to `/episodes`, and Graphiti runs `add_episode`, using the LLM to extract its own entities and facts. Use this when you want Graphiti's additional extraction on top of Perry's.

An episode looks like this:

```json
{
  "name": "perry-meeting-granola:abc123",
  "source": "json",
  "sourceDescription": "Perry Granola meeting note",
  "referenceTime": "2026-05-23T15:00:00.000Z",
  "groupId": "doppel-labs",
  "body": "{...summary, route, decisions, actionItems, graphChangeSet, graphValidation...}"
}
```

Search goes through `graphiti.search` scoped to the group ID. If Graphiti has not yet produced edge facts for a small episode, the bridge falls back to a plain Neo4j search over `Entity` and `Episodic` nodes.

### Privacy

Episodes exclude Granola private notes and transcripts unless you opt in with `PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES=true` or `PERRY_GRAPHITI_INCLUDE_TRANSCRIPT=true`. Do that only when your policy allows the graph to hold that material. The group ID is a data boundary; see [security-privacy.md](security-privacy.md#graph-memory).

Validation also checks the change set's evidence for leaked private content. It looks for passages, not words: a decision that says "keep the transcript out of Notion" is fine. The check fails the change set when an evidence title or excerpt contains a run of eight consecutive words from the note's private notes or transcript (or a whole private text of four to seven words) that does not also appear in text Perry publishes anyway: the title, the summary without its labelled private sections, and the extracted decisions and action items. Extraction reads private notes, so a decision may repeat them word for word; that decision is posted to Notion and Discord regardless, so it is not a leak. The check needs the source note, so it runs when the change set is built, and a replay relies on the stored verdict.

## Replay

Any stored change set can be replayed from the admin UI or the API. Replay is the operator's tool for repair and debugging, separate from normal queue draining:

1. Inspect the change set with `GET /api/graph-sync/change-sets/:id`.
2. Replay it with `POST /api/graph-sync/change-sets/:id/replay`.
3. Perry refuses a change set stored as invalid, re-validates the rest, and posts it to the bridge's `/change-sets` endpoint under its original group ID.
4. Perry reads back the entities, facts, retirements, and evidence it just wrote and reports anything missing.
5. Perry records the outcome on the change set and in the audit log, and returns it as the replay's `status`.

A successful write is not treated as proof on its own; only a clean readback diff is. A replay whose diff passes is recorded as `applied`; one whose write succeeded but whose diff did not pass is recorded as `unverified`, with the gaps in its last error and the full diff in the response and the `graph_change_set.replay_unverified` audit entry.

The bridge returns at most 100 rows per read. Facts and retirements are first looked up in their subject's entity context; when that page is full and lacks the row, the readback asks for the fact by its exact subject, relation, and object, or looks for the retirement in its object's context. A row is reported missing only when a complete read lacks it. If even the narrowed read is full, the row is reported in `errors` as unverifiable, which also fails the diff.

Replay is how you restore the graph after a bridge or Neo4j reset, and it is part of the [release gates](operations.md#release-gates).

## Verified configurations

On 2026-05-23, the episode path was verified with `neo4j:5.26-community`, the bridge on port 8791, LM Studio with `qwen_qwen3-4b-instruct-2507` and `text-embedding-nomic-embed-text-v1.5`. A drained Perry job produced `Episodic` and `Entity` nodes with extracted facts. The direct change-set path was verified the same day with no model loaded: a smoke change set produced three entities, one evidence record, one fact, and an active `ASSIGNED_OWNER` relation from `project:wallace` to `person:ada`.

Model choices for Graphiti extraction are compared in the [model routing benchmark](performance/2026-05-23-local-llm-graphiti-model-routing-benchmark.md).

## Next steps

1. A drill-down UI for the exact relations and evidence a replay diff reports missing.
2. Better extraction for the ontology types `customer`, `repository`, `policy`, `channel`, and `data_source`.
3. Measuring sidecar latency separately from Perry's HTTP latency, since Graphiti extraction is intentionally heavier than SQLite search.
