# Perry

Perry is the meeting-documentation half of the Company Brain. It takes meeting notes from Granola, extracts decisions and action items, publishes them to Notion and Discord once a person approves, and keeps everything searchable in a local SQLite "brain". It also runs the team's Discord standup reminders. This README covers setup, configuration, and the API reference; the [architecture guide](docs/architecture.md) explains how the code fits together.

## What Perry does

Granola captures the meeting. Perry turns the note into something the team can act on: a structured Notion page as the durable record, a short Discord announcement to start the discussion, and typed decisions and action items you can query later. By default nothing is posted until an admin approves it in the admin UI.

Around that core, Perry provides:

- **Routing.** Rules match a note by Granola folder, title keyword, or attendee email and choose its project, Discord channel, Notion data source, and publish mode.
- **Durable, idempotent ingestion.** Replayed webhooks do not post twice, and an optional queue lets the webhook acknowledge immediately.
- **Search and company-brain queries.** Full-text search over meetings, decisions, and action items, plus typed queries for project state, ownership, and what changed.
- **Optional graph memory.** A [Graphiti](docs/graphiti-integration.md) sidecar stores a temporal graph of entities and facts. Perry feeds it asynchronously and never waits on it.
- **Discord commands.** `/standup` for the daily standup and `/brain` for role-gated, ephemeral company-brain lookups.
- **An admin UI.** A React app for readiness checks, settings, previews, approvals, history, search, and graph inspection.
- **GitHub activity.** Through [Inky](../../inky/README.md), Perry can produce a standup from the org's GitHub activity.

## Quick start

All commands run from the **repository root**. See the [root README](../../README.md) for the workspace layout and toolchain.

```sh
corepack enable
pnpm install
pnpm bootstrap          # creates packages/perry/.env from .env.example (never overwrites)
```

Edit `packages/perry/.env`. To try the admin UI and API locally you need no secrets at all. To run the Discord bot you need at least `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DISCORD_STANDUP_CHANNEL_ID`, `NOTION_TOKEN`, and `NOTION_STANDUP_DATA_SOURCE_ID`; without them the bot process exits at startup. Lines you leave blank are ignored (see [Loading the environment](#loading-the-environment)).

Then start Perry:

```sh
pnpm dev                      # Discord bot + scheduler + admin server
pnpm perry dev:server         # admin server only, no Discord
pnpm perry admin:dev          # admin UI with hot reload at http://127.0.0.1:5177
```

The admin server listens on `http://127.0.0.1:8787`. With `pnpm perry admin:dev`, Vite serves the UI on port 5177 and proxies `/api` to port 8787, so run it next to `dev` or `dev:server`. For a production-style run, build once and start the compiled output; the server then also serves the built UI at `http://127.0.0.1:8787`:

```sh
pnpm build
pnpm perry start              # or: pnpm perry start:server
```

When the admin UI opens, it shows a Connect screen. Paste your `ADMIN_API_TOKEN` there. The UI keeps it in `sessionStorage` for that tab only. If you have not set a token, the API only answers requests from the same machine; see [Security](#security).

### Loading the environment

`pnpm dev`, `dev:server`, `start`, and `start:server` load `packages/perry/.env` automatically (Node's `--env-file-if-exists`), so there is nothing to source by hand. Variables already set in your shell or by your host take precedence over the file, which is how you override a value for a single run. In production, set real environment variables or secrets instead of shipping a `.env` file.

Blank lines are harmless: an empty value such as `DISCORD_MEETING_CHANNEL_ID=` counts as unset, so the value saved in the admin UI still applies.

## Scripts

Run package scripts from the root as `pnpm perry <script>`. The most common ones also have root shortcuts (`pnpm dev`, `pnpm build`, `pnpm test`, `pnpm typecheck`).

| Script | What it does |
|---|---|
| `dev` | Bot, scheduler, and admin server, restarting on change. |
| `dev:server` | Admin server only, restarting on change. |
| `admin:dev` | Vite dev server for the admin UI on port 5177. |
| `build` | Compiles the server to `dist/` and builds the admin UI to `admin/dist/`. |
| `start` / `start:server` | Runs the compiled bot or admin server. |
| `typecheck` | Type-checks the server and the admin UI. |
| `test` | Runs the unit tests in `tests/`. |

Benchmarks, gauntlets, backfills, and evaluation scripts are described where they are used: [operations.md](docs/operations.md), [company-brain-testing.md](docs/company-brain-testing.md), [graphiti-integration.md](docs/graphiti-integration.md), and [performance/](docs/performance/README.md). Most of them run against `dist/`, so run `pnpm build` first.

## Configuration

Perry has two layers of configuration.

**Environment variables** carry secrets and runtime switches. They are listed below and, with comments, in [`.env.example`](.env.example).

**The settings file**, `data/perry.config.json` (or the path in `PERRY_CONFIG_PATH`), holds non-secret operational settings: Discord and Notion IDs, the standup schedule, the roster, routing rules, admin role IDs, and the default publish mode. You edit it in the admin UI, which saves through `PUT /api/config`.

Precedence is the same for every editable setting: **environment variables are defaults, and a value saved in the settings file wins.** That covers Discord IDs, the Notion data sources, the standup schedule and timezone, Granola mode, admin roles, and publish mode; the roster and routing rules come from the file whenever it has them. A field saved blank counts as unset and falls back to its environment variable. Secrets (`DISCORD_TOKEN`, `NOTION_TOKEN`, and the API tokens and keys) are environment-only and never stored in the file. The file is re-read on every use, so most edits apply without a restart; the standup schedule (times, timezone, enabled) is read once when the bot starts.

### Environment variable reference

**Discord**

| Variable | Default | Purpose |
|---|---|---|
| `DISCORD_TOKEN` | none | Bot token. Required to run the bot. |
| `DISCORD_CLIENT_ID` | none | Application ID, used to register slash commands. Required for the bot (env or settings). |
| `DISCORD_GUILD_ID` | none | Server where slash commands are registered. Required for the bot (env or settings). |
| `DISCORD_STANDUP_CHANNEL_ID` | none | Channel for standup reminders and summaries. Required for the bot (env or settings). Also the fallback for meeting posts. |
| `DISCORD_MEETING_CHANNEL_ID` | none | Default channel for meeting announcements. Routing rules can override it. |
| `DISCORD_ADMIN_ROLE_IDS` | empty | Comma-separated role IDs allowed to use `/brain`. Empty disables `/brain` for everyone. |
| `DISCORD_SANDBOX_CHANNEL_ID` | none | Only used by `sandbox:integrations --post-discord`. |
| `PERRY_DISCORD_DRY_RUN` | `false` | `true` returns fake message URLs instead of posting, for standup, meeting, and routed-channel posts alike. |

**Notion**

| Variable | Default | Purpose |
|---|---|---|
| `NOTION_TOKEN` | none | Integration token. Required for the bot and for real Notion writes. |
| `NOTION_STANDUP_DATA_SOURCE_ID` | none | Data source (not database) ID holding standup entries. Required for the bot (env or settings). Prefer this name; the legacy `NOTION_DATABASE_ID` is still read as a fallback, and is used as a data source ID too. |
| `NOTION_MEETING_NOTES_DATA_SOURCE_ID` | none | Data source for meeting pages. Without it, Perry skips the Notion page. |
| `NOTION_MEETING_NOTES_DATABASE_URL` | none | Stored in settings for reference; not used by the workflow yet. |
| `NOTION_DECISIONS_DATA_SOURCE_ID`, `NOTION_ACTION_ITEMS_DATA_SOURCE_ID`, `NOTION_PROJECTS_DATA_SOURCE_ID` | none | Targets for the [Notion wiki](docs/notion-wiki-schema.md) sync helpers, currently exercised by `sandbox:integrations`. |
| `PERRY_NOTION_DRY_RUN` | `false` | `true` returns fake page URLs instead of writing to Notion. |

**Standups**

| Variable | Default | Purpose |
|---|---|---|
| `REMINDER_TIME` | `09:30` | First reminder listing who has not submitted (24-hour `HH:MM`). |
| `PRE_STANDUP_REMINDER_TIME` | `11:15` | Second reminder. |
| `STANDUP_TIME` | `11:45` | Time the daily summary is posted. |
| `TIMEZONE` | `America/New_York` | Timezone for the schedule, standup date filtering, and meeting dates in Discord announcements. |
| `STANDUP_FORM_URL` | none | Link returned by `/standup link`. |
| `STANDUP_ENABLED` | `true` | `false` (or unchecking it in the admin UI) schedules no reminders or summaries at startup. `/standup` commands still work. |

**Admin server**

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Admin server port. |
| `ADMIN_HOST` | `127.0.0.1` | Bind address. A non-loopback address refuses to start without `ADMIN_API_TOKEN`. |
| `ADMIN_API_TOKEN` | none | Required on every `/api` route except `/api/ping` and the Granola webhook. Unset means same-machine requests only. |
| `PERRY_MAX_BODY_BYTES` | `2097152` (2 MiB) | Largest accepted JSON request body. |
| `PERRY_ADMIN_SERVER` | on | `false` runs the bot without the admin server (and without the background workers). |
| `PERRY_CONFIG_PATH` | `data/perry.config.json` | Settings file location. |

**Granola ingestion**

| Variable | Default | Purpose |
|---|---|---|
| `GRANOLA_WEBHOOK_TOKEN` | none | Shared secret Zapier sends in `x-perry-webhook-token`. Unset means the webhook accepts same-machine requests only. |
| `PERRY_WEBHOOK_MODE` | `inline` | `queue` makes every webhook call enqueue a job and return immediately. |
| `PERRY_INGESTION_WORKER` | `false` | `true` drains the ingestion queue continuously. |
| `PERRY_INGESTION_INTERVAL_MS` | `1000` | Ingestion worker polling interval. |
| `PERRY_JOB_LEASE_MS` | `600000` | How long a claimed ingestion or graph-sync job may stay `processing` before another claim reclaims it (counted as a failed attempt). |
| `PERRY_DEFAULT_PUBLISH_MODE` | `approval` | Publish mode when no routing rule matches: `approval`, `auto`, or `draft`. |
| `GRANOLA_MODE` | `manual` | `manual` or `zapier-webhook`. Informational: it changes only the readiness diagnostics, and the webhook works in either mode. `api-poll` is **not implemented** (nothing polls Granola); diagnostics warns if it is selected. Use `zapier-webhook`. |
| `GRANOLA_FOLDER_NAME` | none | Reserved for the unimplemented API poller; has no effect. To route by Granola folder, set a folder on a routing rule. |
| `GRANOLA_POLL_INTERVAL_MINUTES` | `15` | Reserved for the unimplemented API poller; has no effect. |
| `GRANOLA_API_KEY` | none | Reserved for the unimplemented API poller; has no effect. The UI only shows whether it is set. |

**Storage and search**

| Variable | Default | Purpose |
|---|---|---|
| `PERRY_DB_PATH` | `%LOCALAPPDATA%\Perry\perry.sqlite` on Windows, `data/perry.sqlite` elsewhere | SQLite database path. `:memory:` for a throwaway database. |
| `PERRY_SQLITE_JOURNAL_MODE` | `MEMORY` on Windows, `DELETE` elsewhere | SQLite journal mode: `DELETE`, `MEMORY`, `OFF`, or `WAL`. Keep `MEMORY` on Windows; see [operations.md](docs/operations.md#troubleshooting). |
| `PERRY_FTS_WORKER` | `true` | Background full-text index flushing. |
| `PERRY_FTS_INTERVAL_MS` | `1000` | FTS worker interval. |
| `PERRY_FTS_BATCH_SIZE` | `1000` | Rows flushed per FTS tick. |
| `PERRY_AUDIT_MODE` | on | `off` suppresses audit-log writes. Benchmarks such as `perf:ontology` set it. |

**Graph memory (Perry side)**

| Variable | Default | Purpose |
|---|---|---|
| `PERRY_GRAPHITI_ENABLED` | `false` | Enables graph change sets, the ontology index, and graph sync. Also needs a bridge URL. |
| `PERRY_GRAPHITI_BRIDGE_URL` | none (`.env.example`: `http://127.0.0.1:8791`) | Graphiti bridge base URL. |
| `PERRY_GRAPHITI_GROUP_ID` | `doppel-labs` | Graph namespace. Treat it as a data boundary. |
| `PERRY_GRAPHITI_TIMEOUT_MS` | `3000` (`.env.example`: `120000`) | Bridge request timeout. LLM-backed episode writes need the larger value. |
| `PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES` | `false` | Include Granola private notes in graph episodes. |
| `PERRY_GRAPHITI_INCLUDE_TRANSCRIPT` | `false` | Include transcripts in graph episodes. |
| `PERRY_GRAPHITI_DIRECT_CHANGESETS` | `false` | Send typed change sets to the bridge's `/change-sets` endpoint instead of asking Graphiti to re-extract from the episode. |
| `PERRY_GRAPH_SYNC_WORKER` | `false` | Drain the graph sync queue continuously. |
| `PERRY_GRAPH_SYNC_INTERVAL_MS` | `3000` | Graph sync worker interval. |
| `PERRY_GRAPH_SYNC_BATCH_SIZE` | `10` | Jobs per graph sync tick. |

**Graphiti bridge (Python sidecar)**

These are read by `integrations/graphiti/graphiti_bridge.py` when you run `pnpm perry graphiti:bridge`. See [graphiti-integration.md](docs/graphiti-integration.md).

| Variable | Default | Purpose |
|---|---|---|
| `GRAPHITI_BRIDGE_HOST` | `127.0.0.1` | Bridge bind address. |
| `GRAPHITI_BRIDGE_PORT` | `8791` | Bridge port. |
| `GRAPHITI_GROUP_ID` | `doppel-labs` | Default group when a request names none. |
| `GRAPHITI_LLM_PROVIDER` | `openai` (`.env.example`: `lmstudio`) | Model provider for Graphiti. |
| `GRAPHITI_OPENAI_BASE_URL` | `http://127.0.0.1:1234/v1` | OpenAI-compatible endpoint. |
| `GRAPHITI_OPENAI_API_KEY` | `lm-studio` | Key for that endpoint. |
| `GRAPHITI_LLM_MODEL` | `qwen/qwen3-coder-30b` | Main extraction model. |
| `GRAPHITI_SMALL_LLM_MODEL` | same as the main model | Small model. |
| `GRAPHITI_EMBEDDING_MODEL` | `text-embedding-nomic-embed-text-v1.5` | Embedding model. |
| `GRAPHITI_EMBEDDING_DIM` | `768` | Embedding dimension. |
| `GRAPHITI_TELEMETRY_ENABLED` | `false` in `.env.example` | Read by `graphiti-core` itself. |
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j connection. |
| `NEO4J_USER` | `neo4j` | Neo4j user. |
| `NEO4J_PASSWORD` | none | Neo4j password. |

**Extraction**

How decisions, action items, and entities are pulled out of each meeting. See [Extraction](docs/architecture.md#extraction) for how the modes, grounding, and fallback work.

| Variable | Default | Purpose |
|---|---|---|
| `PERRY_EXTRACTION_MODE` | `rules` | `rules` (deterministic parser, no model calls), `llm` (model only, rules on failure), or `hybrid` (model plus any rule-found items it missed). With `together`, `llm` and `hybrid` send meeting summaries to Together.ai. |
| `PERRY_EXTRACTION_MIN_CONFIDENCE` | `0.5` | Model replies below this self-reported confidence fall back to rules. |
| `PERRY_EXTRACTION_BACKEND` | `lmstudio` | `lmstudio` or `together`. |
| `LMSTUDIO_BASE_URL` | `GRAPHITI_OPENAI_BASE_URL`, else `http://127.0.0.1:1234/v1` | LM Studio endpoint. |
| `LMSTUDIO_API_KEY` | `GRAPHITI_OPENAI_API_KEY`, else `lm-studio` | LM Studio key. |
| `PERRY_LMSTUDIO_EXTRACTION_MODEL` | `GRAPHITI_LLM_MODEL`, else `local-model` | Model for LM Studio extraction. |
| `PERRY_LMSTUDIO_EXTRACTION_TIMEOUT_MS` | `30000` | Request timeout. |
| `PERRY_LMSTUDIO_EXTRACTION_CONTEXT_CHARS` | `24000` | Prompt size cap. |
| `PERRY_LMSTUDIO_EXTRACTION_TEMPERATURE` | `0` | Sampling temperature. |
| `TOGETHER_API_KEY` | none | Together.ai key (`TOGETHER_AI_API_KEY` also accepted). |
| `PERRY_TOGETHER_EXTRACTION_MODEL` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | Together.ai model. |
| `PERRY_TOGETHER_EXTRACTION_TIMEOUT_MS` | `60000` | Request timeout (minimum 1000). |
| `PERRY_TOGETHER_EXTRACTION_CONTEXT_CHARS` | `24000` | Prompt size cap. |
| `PERRY_TOGETHER_EXTRACTION_TEMPERATURE` | `0` | Sampling temperature. |

**GitHub-activity standups (Inky)**

`GET /api/brain/activity-standup` runs Inky inside Perry's process, so Perry's environment needs what Inky needs: a GitHub credential (`GITHUB_TOKEN`, or a GitHub App via `GITHUB_APP_ID` and its private key) and, optionally, an LLM key (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, or `OPENAI_API_KEY`) for the written summary. Without an LLM key, Inky falls back to a deterministic summary. See the [Inky README](../../inky/README.md) for details.

| Variable | Default | Purpose |
|---|---|---|
| `INKY_CONFIG_PATH` | `inky.config.json` in the working directory | Path to Inky's org and repo config. When Perry runs through `pnpm dev`, the working directory is `packages/perry`, so set this to `../../inky/inky.config.json`. |

## Connecting Granola

1. In Granola, create a folder for notes the team should document.
2. In Zapier, create a Zap with Granola's "Note Added to Granola Folder" trigger.
3. Add a webhook action that POSTs the payload as JSON to `https://<your-perry-host>/api/granola/zapier` with the header `x-perry-webhook-token: <GRANOLA_WEBHOOK_TOKEN>`.
4. Before going live, paste a sample payload into the admin UI's test bench, or call `POST /api/granola/preview`, to see exactly what Perry would post.

Perry must be reachable from Zapier, which means binding to a non-loopback `ADMIN_HOST`, setting `ADMIN_API_TOKEN` and `GRANOLA_WEBHOOK_TOKEN`, and putting HTTPS in front of it. See [security-privacy.md](docs/security-privacy.md).

The webhook accepts three query flags: `dryRun=true` previews without writing, `force=true` reprocesses a note that was already processed, and `enqueue=true` queues the note and returns at once. Queued ingestion does not support `dryRun`; use `/api/granola/preview` instead.

### Publish modes

Each routing rule, and the default, chooses a publish mode:

| Mode | Behavior |
|---|---|
| `approval` (default) | Stores the meeting and creates a pending approval. Nothing is posted until an admin approves it. |
| `draft` | Same as `approval`; the approval is labelled as a draft. |
| `auto` | Creates the Notion page and posts to Discord immediately. |

## Notion setup

Create a Notion internal integration and share the relevant data sources with it.

The **standup** data source needs these properties: `Date` (date), `Person` (person or text), `Yesterday`, `Today`, `Blockers` (text), `Status` (select or status), and `Discord` (text holding the user ID or handle).

The **meeting notes** data source needs `Title` (title), `Source` (select), `Source ID` (text), `Date` (date), `Granola Link` (URL), and `Attendees` (text). Perry writes the meeting body as page content.

The broader wiki model for decisions, action items, and projects is in [notion-wiki-schema.md](docs/notion-wiki-schema.md).

## Discord setup

Create a Discord application with a bot user, and install it with the `bot` and `applications.commands` scopes. Perry registers its commands in `DISCORD_GUILD_ID` each time the bot starts.

| Command | What it does |
|---|---|
| `/standup missing` | Lists people who have not submitted today (only you see it). |
| `/standup summary` | Posts today's standup summary. |
| `/standup remind` | Posts a reminder to the standup channel. |
| `/standup link` | Returns `STANDUP_FORM_URL`. |
| `/brain project name:` | Graph context for a project. |
| `/brain owner name:` | Graph context for a person. |
| `/brain state type: [project:] [q:] [limit:]` | Typed ontology objects such as risks, goals, or blockers. |
| `/brain changed since: [project:] [limit:]` | Ontology changes since an ISO timestamp. |
| `/brain evidence entity:` | Evidence behind an ontology entity. |
| `/brain my-actions` | Your open action items: owners matching your roster name or Notion name exactly (case-insensitive), or your Discord name if you are not on the roster. |
| `/brain recent-pivots` | Recent ownership changes. |
| `/brain why entity:` | Explains a graph entity by stable key. |

`/brain` replies are always ephemeral, and the command is disabled until `DISCORD_ADMIN_ROLE_IDS` (or the admin role list in settings) contains at least one role.

## Security

The admin server fails closed. Every `/api` route requires `ADMIN_API_TOKEN`, sent as `Authorization: Bearer <token>` or `x-admin-token: <token>`, with two exceptions: `GET /api/ping` is public, and the Granola webhook requires `GRANOLA_WEBHOOK_TOKEN` instead. Without a token, Perry only answers genuine same-machine requests, and it refuses to bind to a non-loopback address. The full policy, and guidance for Discord, Notion, and graph data, is in [security-privacy.md](docs/security-privacy.md).

## Admin API reference

Access levels: **admin** requires `ADMIN_API_TOKEN` (or a same-machine request when no token is set), **public** requires nothing, and **webhook** requires `GRANOLA_WEBHOOK_TOKEN`. List endpoints accept `limit` (capped at 1000) and `offset` unless noted. The source of truth is `src/server/controllers/`.

**System** (`controllers/system.ts`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/ping` | public | Liveness check. Returns `{"ok":true}`. |
| GET | `/api/health` | admin | Config path, whether the UI is built, and diagnostics. |
| GET | `/api/counts` | admin | Approval, meeting, and queue counts. `status` filters approvals. |
| GET | `/api/agent/status` | admin | Pending work and graph memory status at a glance. |
| GET | `/api/diagnostics` | admin | The readiness checklist shown in the UI. `ready` is true when no check is `missing`; `warning` checks (optional features left off) do not block it. |
| GET | `/api/config` | admin | Current settings, plus which secrets are set (never their values). |
| PUT | `/api/config` | admin | Saves settings. Body is the settings object, or `{ "settings": ... }`. |

**Ingestion** (`controllers/ingestion.ts`)

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/granola/zapier` | webhook | Granola webhook. Flags: `dryRun`, `force`, `enqueue`. |
| POST | `/api/granola/preview` | admin | Dry-run a payload: route, extracted knowledge, and announcement. |
| GET | `/api/granola/sample` | admin | A sample Zapier payload. |
| GET | `/api/meetings/history` | admin | Processed meeting records. |
| GET | `/api/ingestion/jobs` | admin | Ingestion queue snapshot. `detail=true` includes payloads. |
| POST | `/api/ingestion/drain` | admin | Processes up to `limit` queued jobs (default 10). |

**Approvals** (`controllers/approvals.ts`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/approvals` | admin | `status` is `pending`, `approved`, `rejected`, or `posted`. `detail=true` returns full records. |
| POST | `/api/approvals/:id/approve` | admin | Publishes the meeting to Notion and Discord. |
| POST | `/api/approvals/:id/reject` | admin | Rejects without publishing. |

**Issues and people** (`controllers/issues.ts`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/issues` | admin | Filters: `owner`, `project`, `status`. |
| POST | `/api/issues` | admin | Creates an issue. `title` is required. |
| PATCH, PUT | `/api/issues/:id` | admin | Updates fields or appends a `comment`. Every change writes an issue event. |
| GET | `/api/issues/:id/events` | admin | An issue's history. |
| GET | `/api/users` | admin | People known to the brain. |
| GET | `/api/pivots` | admin | Ownership changes. |

**Knowledge** (`controllers/knowledge.ts`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/brain/search` | admin | Full-text search. `q`, `limit` (max 200), `types` (`meeting`, `decision`, `action`). |
| GET | `/api/brain/decisions` | admin | Extracted decisions. |
| GET | `/api/brain/actions` | admin | Extracted action items. |
| GET | `/api/brain/insights` | admin | Ownership, ownership changes, and open actions by owner. |
| GET | `/api/brain/activity-standup` | admin | Runs Inky's GitHub-activity standup. `windowHours`, `mechanical=true`. |
| POST | `/api/brain/fts/flush` | admin | Flushes pending full-text rows now. |

**Graph memory** (`controllers/graph-memory.ts`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/brain/graph/search` | admin | Graphiti search. `q`, `limit`. |
| GET | `/api/brain/graph/entities` | admin | Entity lookup. `q`, `type`, `limit`. |
| GET | `/api/brain/graph/entities/:stableKey/context` | admin | Bounded context around one entity. |
| GET | `/api/brain/graph/facts` | admin | Facts. `subject`, `object`, `relation`, `active`, `limit`. |
| GET | `/api/brain/graph/evidence` | admin | One evidence record. `evidenceId`. |
| GET | `/api/brain/graph/timeline` | admin | An entity's timeline. `stableKey`. |
| POST | `/api/brain/project-multiplayer` | admin | Projects meeting knowledge into users, issues, and pivots. |

**Ontology and agent tools** (`controllers/ontology.ts`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/brain/ontology` | admin | Summary, or typed entities with `type`, `project`, `q`, `limit`. |
| GET | `/api/brain/ontology/changed-since` | admin | `since` (ISO timestamp) is required. |
| GET | `/api/brain/ontology/evidence` | admin | Evidence and relations for `stableKey`. |
| GET | `/api/brain/ontology/health` | admin | Materialization drift report. |
| GET | `/api/brain/tools/project-state` | admin | Compact tool contract. `project`, `q`, `types`, `limit`. |
| GET | `/api/brain/tools/changed-since` | admin | Compact tool contract. `since` is required. |
| GET | `/api/brain/tools/evidence` | admin | Compact tool contract. `stableKey` is required. |

**Graph sync** (`controllers/graph-sync.ts`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/graph-sync/jobs` | admin | Graph sync queue snapshot. `detail=true` includes payloads. |
| GET | `/api/graph-sync/change-sets` | admin | Change-set summaries. `status` is `queued`, `applied`, or `failed`; `detail=true` returns full records. |
| GET | `/api/graph-sync/change-sets/:id` | admin | One full change set. |
| POST | `/api/graph-sync/change-sets/:id/replay` | admin | Re-applies a change set and returns a readback diff. |
| POST | `/api/graph-sync/drain` | admin | Processes up to `limit` graph sync jobs (default 10). |
| POST | `/api/graph-sync/backfill` | admin | Queues processed meetings for graph sync. `limit`, `offset`. |

Example:

```sh
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" "http://127.0.0.1:8787/api/brain/search?q=onboarding&limit=5"
```

## Further reading

| Document | Read it for |
|---|---|
| [docs/architecture.md](docs/architecture.md) | How the code is organized, and how to add a route. |
| [docs/security-privacy.md](docs/security-privacy.md) | The access policy and data-handling rules. |
| [docs/operations.md](docs/operations.md) | Smoke checks, backups, release gates, and sandbox verification. |
| [docs/graphiti-integration.md](docs/graphiti-integration.md) | Running the optional temporal graph. |
| [docs/company-brain-ontology.md](docs/company-brain-ontology.md) | The typed company model and how to query it. |
| [docs/company-brain-testing.md](docs/company-brain-testing.md) | Gauntlets, evaluators, and scale tests. |
| [docs/notion-wiki-schema.md](docs/notion-wiki-schema.md) | The Notion wiki model. |
| [docs/granola-study.md](docs/granola-study.md) | Product direction relative to Granola. |
| [docs/performance/](docs/performance/README.md) | Benchmarks and the performance model. |
