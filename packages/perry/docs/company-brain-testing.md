# Company Brain Testing

This guide describes how Perry's company brain is tested, from unit tests to overnight scale runs, and records the most recent results. Read it when you change ingestion, extraction, search, the graph, or the query tools, and need to know which check proves your change.

## What the tests protect

The company brain has two reliability goals, and every check below serves one of them.

1. **The meeting workflow stays safe and fast.** Granola ingestion, deduplication, approval, Notion and Discord publishing, SQLite state, and the retry queues must be correct and quick, whatever else is happening.
2. **Semantic memory never makes the workflow fragile.** Graphiti, LM Studio, and Neo4j run asynchronously, can fail without affecting publishing, and must be diagnosable when they do.

## How the checks are organized

The checks form a ladder. Each rung needs more infrastructure and takes longer than the one before.

| Rung | Commands | Needs |
|---|---|---|
| Unit tests | `pnpm test` | Nothing. |
| Offline workflow checks | `company-brain:gauntlet -- --graph false`, `company-brain:evaluate`, `company-brain:synthetic`, `company-brain:arcs`, `company-brain:scale-matrix` | A build. All run against an in-memory database with dry-run Notion and Discord. |
| Query and analytics checks | `company-brain:query`, `company-brain:query-gauntlet`, `company-brain:analytics`, `company-brain:build-corpus-db` | A build, and a corpus. |
| Ontology checks | See [company-brain-ontology.md](company-brain-ontology.md#verifying-the-ontology). | A build. |
| Model-backed checks | `brain:scenarios:generate`, `lmstudio:evaluate` | LM Studio. |
| Graph-backed checks | Most of the above with `--graph true` | LM Studio, Neo4j, and the Graphiti bridge. |
| Live stack | `ops:local-brain-gauntlet`, `brain:acceptance` | Everything running. See [operations.md](operations.md). |

Commands are written as they run from `packages/perry`; from the repository root, use `pnpm perry <script>`. Everything except `pnpm test` runs against `dist/`, so run `pnpm build` first.

## Unit tests

```sh
pnpm typecheck
pnpm test
```

The suite in `tests/` covers:

- **Workflow.** Approval mode does not post; queued ingestion deduplicates and drains, including drains larger than one claim page; meetings, decisions, action items, and full-text rows are stored.
- **Admin API.** The access policy (`adminAuth.test.ts`) and the graph endpoints.
- **Graph.** Episode formatting; typed change-set construction, evidence validation, owner pivots, and exclusion of private notes and transcripts from evidence; change-set persistence and status updates; posting to a bridge, including the direct `/change-sets` mode; bounded graph reads; backfill; and retry after a failed sync, with the meeting still fully published.
- **Brain.** Fixture-corpus retrieval, insights, typed queries, ontology queries, health, analytics, synthetic company data and arcs, and multiplayer projection idempotency with human edits preserved.
- **Integrations.** Routing, Notion wiki sync contracts, Discord `/brain` access and formatting, and the LM Studio and Together.ai extraction adapters.
- **Privacy.** Discord announcements and graph episodes never carry private notes or transcripts by default.

## The meeting workflow gauntlet

`company-brain:gauntlet` runs one synthetic Granola meeting through the full workflow: it stores the meeting record, decisions, and action items, emits dry-run Notion and Discord URLs, drains one graph sync job, and runs a graph search.

```sh
pnpm company-brain:gauntlet
pnpm company-brain:gauntlet -- --graph false          # skip the graph steps
pnpm company-brain:gauntlet -- --force true            # reprocess an existing note
pnpm company-brain:gauntlet -- --note-id my-fixed-id   # use a stable note ID
```

It defaults to an in-memory database, `auto` publishing, dry-run Notion and Discord, and Graphiti enabled at `http://127.0.0.1:8791`. Set `PERRY_DB_PATH` to a file such as `data/company-brain-gauntlet.sqlite` to keep the results.

## Retrieval evaluation

`company-brain:evaluate` replays the redacted fixture corpus in `tests/fixtures/company-brain-corpus.json`. Each case is a Granola-like payload with the decisions, action items, and search hits it should produce. The evaluator ingests each case into an in-memory brain, flushes full-text search, and asserts the expectations.

```sh
pnpm company-brain:evaluate
pnpm company-brain:evaluate -- --graph true   # also drain to Graphiti and run a graph search per case
```

Comparing the two runs shows fast operational retrieval next to slower semantic retrieval.

## Synthetic company data

`company-brain:synthetic` generates a deterministic virtual company with meetings across projects such as Wallace, Perry, Notion Wiki, Discord Ops, and Graph Memory, and deliberately includes duplicate payloads, owner changes, long transcripts, private notes, missing summaries, and sparse attendee lists. It reports extraction and search pass rates, duplicate detection, privacy leak checks on Discord announcements, ownership and workload insights, multiplayer projection counts, and throughput.

```sh
pnpm company-brain:synthetic -- --count 1000 --search-sample 250
pnpm company-brain:synthetic -- --count 10000 --search-sample 1000                        # overnight-scale
pnpm company-brain:synthetic -- --count 100 --search-sample 50 --graph true --graph-sample 5
```

Graph sampling is opt-in because local LLM extraction is far slower than everything else. Keep the sample small unless you want a deliberate model soak.

## Temporal arcs

`company-brain:arcs` asks whether Perry understands how company state changes over time, not just whether a meeting was ingested. Each arc is a sequence of meetings about one project, with ownership handoffs along the way. It checks the final owner, the exact number of ownership changes, the evidence for each handoff, open actions per owner, search across the arc, Discord privacy, and the multiplayer projection.

```sh
pnpm company-brain:arcs -- --projects 4 --meetings-per-project 4 --graph false
pnpm company-brain:arcs -- --projects 4 --meetings-per-project 4 --graph true --graph-limit 4 --report reports/arcs/local-arcs-graph.json --markdown reports/arcs/local-arcs-graph.md
```

Two options stress operational reality. `--order reverse` or `--order shuffle` imports meetings out of order, proving that state follows each meeting's own timestamp rather than ingestion order. `--duplicate-replay <n>` replays already-processed notes to prove duplicates are harmless.

```sh
pnpm company-brain:arcs -- --projects 4 --meetings-per-project 4 --order shuffle --duplicate-replay 4 --graph true --graph-limit 4
```

## Scale matrix

`company-brain:scale-matrix` runs volume and arc tests at several sizes in one go. By default it runs 1,000 and 10,000 synthetic meetings, then `10x8` and `25x8` arcs in chronological and shuffled order with duplicate replay, all with Graphiti off so model latency does not dominate.

```sh
pnpm company-brain:scale-matrix
pnpm company-brain:scale-matrix -- --skip-volume --arcs 10x8 --orders shuffle --duplicate-replay 10 --graph true --graph-limit 4 --outDir reports/scale/graph-smoke
```

## Generated scenario corpus

For a larger and more varied corpus than the deterministic generator produces, `brain:scenarios:generate` has a local model (Gemma through LM Studio) write synthetic company history. In the default `lmstudio-tools` mode, the model emits ordered operations against a constrained company object (`create_meeting`, `add_decision`, `add_action`, `add_private_note`, `add_transcript_excerpt`, `add_search_check`), which Perry applies and validates. This works like a tool loop rather than one large free-form JSON response. When the model under-produces, reuses IDs, or contradicts its own summary, the generator normalizes the scenario and fills short batches with deterministic ones. `--mode lmstudio` uses the older direct-JSON generator, and `--mode deterministic` needs no model.

```sh
pnpm brain:scenarios:generate -- --count 100 --batch 5 --out tests/fixtures/generated-company-scenarios.json --model gemma-4-e4b-claude-abliterated
pnpm brain:scenarios:evaluate -- --corpus tests/fixtures/generated-company-scenarios.json
pnpm brain:scenarios:evaluate -- --corpus tests/fixtures/generated-company-scenarios.json --graph true --graph-limit 10
pnpm brain:scenarios:soak -- --count 30 --batch 5 --graph-limit 8   # generate and evaluate, with reports
```

The evaluator also prints brain health ("what is broken or risky?") and analytics ("what shape does this corpus have?"). For large generated corpora, use `--search-limit 100`: model-written claims collide often, so top-10 is the user-facing metric while depth-100 proves everything is retrievable.

## Query tools and analytics

The typed query tools answer operational questions over company objects. They live in the `@brain` module and are shaped like the tools a model, the admin UI, or Discord will call, so nothing needs to load raw meeting text.

```sh
pnpm company-brain:query -- project-state --project Atlas
pnpm company-brain:query -- owner-load --owner Ada
pnpm company-brain:query -- decision-history --subject "Atlas retrieval"
pnpm company-brain:query -- stale-actions --stale-action-days 14 --owner Ada
pnpm company-brain:query -- conflicts --duplicate-theme-threshold 10
pnpm company-brain:query -- changed-since --since 2026-05-01T00:00:00.000Z --project Atlas
```

`company-brain:query-gauntlet` ingests a corpus and proves that these queries return evidence-bearing answers. `company-brain:analytics` summarizes the current database.

```sh
pnpm company-brain:query-gauntlet -- --corpus <corpus.json> --report reports/query-gauntlet/run.json --markdown reports/query-gauntlet/run.md --duplicate-theme-threshold 10 --search-limit 25
pnpm company-brain:analytics -- --report reports/analytics/local.json --markdown reports/analytics/local.md --search-probes 12 --search-limit 25
```

### Reusable corpus databases

For repeated performance work, build a corpus database once instead of re-ingesting the same JSON on every run. The builder uses the fast batch backfill path, not the full workflow, so later runs measure query behavior rather than ingest cost.

```sh
pnpm company-brain:build-corpus-db -- --corpus <corpus.json> --db reports/db/corpus.sqlite --reset true --report reports/db/build.json --markdown reports/db/build.md
```

Then point `PERRY_DB_PATH` at it and pass `--skip-ingest true` to `brain:scenarios:evaluate` or `company-brain:query-gauntlet`.

## Recorded results

These are the most recent recorded local runs. Re-run the relevant command before relying on a number; the report artifacts under `reports/` are local and not committed.

| Date | Check | Result |
|---|---|---|
| 2026-05-23 | `synthetic --count 500 --search-sample 150` | Passed in 343 ms, about 1,457 meetings/s. |
| 2026-05-23 | `synthetic --count 10000 --search-sample 1000` | Passed in 8.6 s, about 1,167 meetings/s, with 909 owner changes, 527 duplicates, and 2,000 private-note cases. |
| 2026-05-23 | `synthetic --count 12 --graph true --graph-sample 1` | Passed in 7.4 s; one live Graphiti sample drained. |
| 2026-05-25 | `brain:acceptance` | Passed in about 18 s; replay checked 10 entities, 9 relations, and 7 evidence records with nothing missing. |
| 2026-05-25 | `brain:scenarios:soak` (30 scenarios) | Generated in 48.5 s with no fallbacks. All pass rates 1.0, including graph replay and search on 8 samples. Ingest p50 0.93 ms, search p50 0.09 ms. |
| 2026-05-25 | 5,000 generated scenarios | 3 malformed model batches fell back to deterministic ones. Offline evaluation at `--search-limit 100` passed with all pass rates 1.0. |
| 2026-05-25 | `company-brain:query-gauntlet` on the 5,000-scenario corpus | 15 query cases over 10,519 decisions and 10,001 actions passed (rate 1.0). |
| 2026-05-25 | `company-brain:arcs` (4 projects by 4 meetings) | All pass rates 1.0; 4 of 4 ownership changes detected; reverse and shuffled order with duplicate replay passed. Shuffled graph run: ingest p50 1.23 ms, search p50 0.09 ms, graph search p50 32.8 ms. |
| 2026-05-25 | `company-brain:scale-matrix` (default) | Passed in 62.7 s. 10,000-meeting volume run at 1,021 meetings/s; `25x8` shuffled arcs with ingest p50 0.6 ms and search p50 0.2 ms. Graph smoke (`10x8` shuffled) drained in 934 ms, graph search p50 51.8 ms. |
| 2026-05-25 | `company-brain:build-corpus-db` (5,000 meetings) | Built in 5.2 s, plus 1.8 s to flush 25,520 search rows; about 28.7 MB. |
| 2026-05-25 | Scenario evaluation on that database, `--skip-ingest` | Passed in 88.4 s. 10,000 global search probes: p50 8.2 ms, p95 15.5 ms. |
| 2026-05-25 | Query gauntlet on that database, `--skip-ingest` | 15 cases passed in 823 ms. |

The last two rows carry the main lesson. Ingestion is no longer the bottleneck; broad full-text search is, at roughly 8 ms per global probe on a 5,000-meeting database, while the whole typed query gauntlet finished in under a second. Discord, admin, and model answers should therefore use bounded object queries first and fall back to global search only when the user is exploring.

The 5,000-scenario analytics run also showed a weakness in the generator: a repeated action-theme rate of 0.86, meaning the model overuses templated action wording. That is useful stress for search and workload analytics, but it means the corpus is less varied than real meetings.

## Open testing work

In rough order of value:

1. **Real Granola notes.** Grow the fixture corpus from real, redacted exports, asserting decisions, actions, owners, projects, and graph queries.
2. **Question-and-answer retrieval checks.** 25 to 100 questions such as "who owns Wallace onboarding?" or "which decisions conflict?", comparing full-text, Graphiti, and hybrid answers.
3. **Change-set quality scoring.** Every relation has evidence, owner pivots retire the previous owner, aliases deduplicate, and unresolved-entity warnings stay rare.
4. **Graph reads over realistic history.** Multi-meeting ownership changes, conflicting decisions, and duplicate aliases in the direct graph objects.
5. **Long-running worker soak.** Ingestion, full-text, and graph workers together for hours, watching for stuck `processing` rows, duplicate posts, retry timing, and memory growth.
6. **Real Notion and Discord sandboxes.** Page properties, content blocks, formatting, links, permissions, and duplicate behavior against a private channel and test data source.
7. **Process lifecycle.** Kill and restart LM Studio, Neo4j, and the bridge with jobs queued; publishing state must survive and graph sync must catch up.
8. **Change-set review UX.** Comparing a change set against existing facts, and drilling into replay diffs.
9. **Operator visibility.** Each dependency's health, recent graph sync errors, retry timing, and links from a meeting to its Notion page, Discord post, and graph facts.
