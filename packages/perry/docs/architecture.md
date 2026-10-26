# Perry Architecture

This document explains how Perry is put together: the processes it runs, how a meeting note moves through the system, how the source tree is organized, and how the admin HTTP server is layered. Read it before changing code. For setup and configuration, see the [package README](../README.md).

## The shape of the system

Perry is one Node.js process with three jobs:

- A **Discord bot** that registers the `/standup` and `/brain` slash commands and answers them.
- A **scheduler** that posts standup reminders and summaries on a cron schedule.
- An **admin server** that serves the JSON API under `/api/*`, the built admin UI, and the Granola webhook. It also starts Perry's background workers.

`src/index.ts` starts all three. Set `PERRY_ADMIN_SERVER=false` to run the bot without the admin server. `src/server/admin-server.ts` starts only the admin server, which is what `pnpm dev:server` and `pnpm start:server` run; use it when you are working on the API or UI and do not want to talk to Discord.

All operational state lives in a single local SQLite database (Node's built-in `node:sqlite`). Notion is the durable, human-facing record. Discord is the notification and discussion layer. Granola is the capture source. Graphiti, a Python sidecar backed by Neo4j, is an optional temporal graph that Perry feeds asynchronously and never blocks on.

```text
Granola ──(Zapier webhook)──> /api/granola/zapier
                                   │
                    inline, or via the durable ingestion queue
                                   │
                                   v
                     normalize -> route -> dedupe -> extract
                                   │
                ┌──────────────────┴──────────────────┐
         publish mode "approval"/"draft"        publish mode "auto"
                │                                     │
         pending approval  ──(admin approves)──>  Notion page + Discord post
                                                      │
                                                SQLite meeting record,
                                                decisions, action items, FTS
                                                      │
                                     (when Graphiti is enabled)
                                                      v
                                 graph change set + ontology index (SQLite)
                                                      │
                                       graph sync queue (async, retried)
                                                      v
                                         Graphiti bridge -> Neo4j
```

## How a meeting note is processed

The workflow lives in `src/ingestion/workflow.ts`.

1. **Normalize.** The Zapier payload becomes a `MeetingNote` (`@meetings`).
2. **Route.** Routing rules from the settings file are scored against the note's Granola folder, title keywords, and attendee emails. The best match decides the project, the Discord channel, the Notion data source, and the publish mode. With no match, Perry uses the default meeting channel, the default Notion data source, and the default publish mode (seeded from `PERRY_DEFAULT_PUBLISH_MODE`, which defaults to `approval`).
3. **Deduplicate.** A note that has already been published returns the existing record instead of posting again, unless the request passes `force=true`. Notes are matched by Granola source ID; a note without one gets a stable ID hashed from its title, start time, and creator (and its summary when it has no start time), so a re-sent copy still matches.
4. **Extract.** Decisions, action items, and entities are pulled out by `extractMeetingKnowledge` in `@extraction`, using the strategy chosen by `PERRY_EXTRACTION_MODE`. See [Extraction](#extraction).
5. **Publish or hold.**
   - In `approval` or `draft` mode, Perry stores the meeting as `pending_approval`, its knowledge, and a pending approval, in one transaction. Nothing is posted until an admin approves it through `POST /api/approvals/:id/approve`. A re-sent note refreshes a pending approval but never reopens a `rejected` or `posted` one.
   - In `auto` mode, Perry marks the meeting `publishing`, creates the Notion meeting page, posts the announcement to Discord, and saves the record as `processed` with its knowledge.
6. **Remember.** Stored meetings, decisions, and action items are indexed for full-text search. After a meeting is published, and only when Graphiti is enabled, Perry also builds a typed *graph change set*, stores it, materializes it into the SQLite ontology index, and queues it for the Graphiti sidecar.

Publishing is resumable. The Notion page ID and URL are saved the moment the page exists, and the Discord message URL the moment it is posted. If a later step fails, the meeting stays `publishing`, and any retry (a re-queued job, approving again, re-sending the note, or `force=true`) skips the steps already done, so a failure never produces a second page or post. When a queued job runs out of attempts mid-publish, the meeting becomes `failed`, with the error stored on it, and it still resumes on the next retry.

Dry runs (`POST /api/granola/preview`, or `?dryRun=true` on the webhook) run steps 1 to 4 and return what would happen without writing anything. Only these return `dryRun: true`; a note held for approval is stored and returns `dryRun: false` with its `approval`.

The webhook can run **inline**, processing the note during the request, or **queued**, writing an idempotent job and returning `202` at once. Queue mode is enabled per request with `?enqueue=true` or globally with `PERRY_WEBHOOK_MODE=queue`. A replayed webhook returns the existing job; the same note queued with different options (`force`, or bypassing approval) gets a job of its own. Queued jobs are drained by the ingestion worker (`PERRY_INGESTION_WORKER=true`) or on demand with `POST /api/ingestion/drain`. A drain handles approval-mode jobs in one transaction with a savepoint per job, so a job that fails leaves none of its writes behind.

## Extraction

`extractMeetingKnowledge` (`src/extraction/pipeline.ts`) is the only way ingestion turns a note into knowledge. `PERRY_EXTRACTION_MODE` selects one of three strategies:

| Mode | What runs | When the model fails |
|---|---|---|
| `rules` (default) | The deterministic parser: bullets under headings such as "Decisions:" and "Action items:", plus inline cues like "we decided" or "todo:". No network calls. | Not applicable. |
| `llm` | The configured model (`PERRY_EXTRACTION_BACKEND`: LM Studio or Together.ai). | Falls back to rules. |
| `hybrid` | The model, then any rule-found item the model missed. Model items borrow the owner and due date of the rule item that covers them. | Falls back to rules. |

Rules are the default because the other modes send the meeting summary to a model, which is a third party when the backend is Together.ai. Private notes and transcripts are never sent. The rules parser handles well-structured Granola summaries; a model earns its keep on prose summaries without headings, which the rules parser cannot read at all. `pnpm perry extraction:evaluate` measures this on fixtures for your own model.

Model output is treated as untrusted input:

- **Grounding.** A decision or action item is kept only if at least 60% of its content words (lightly stemmed) appear in the text the model was shown. Paraphrase passes; invented facts do not.
- **Owners** must match an attendee, the note's creator, or a roster member, by full name or by an unambiguous first name. Otherwise the action is kept without an owner.
- **Due dates** must be supported by the note. An ISO date is kept only if the note states it, or contains a phrase that resolves to exactly that date from the meeting's date: "today", "tomorrow", "next week", a weekday ("by Friday", "next Fri"), "end of week", a month and day ("Nov 2", "2 November", "11/2"), or a full date with a year. "Tomorrow" is read in both UTC and the configured timezone. Without a meeting date, only fully written dates can be confirmed. Any other due phrase must appear verbatim (`src/extraction/due-dates.ts`). **Entities** must appear in the note verbatim.
- **Confidence.** A reply below `PERRY_EXTRACTION_MIN_CONFIDENCE` (default 0.5) is discarded. So is an `llm`-mode reply with nothing grounded while the rules found something.

Every result carries `extraction` provenance: the method actually used, the requested mode, the backend and model, confidence, latency, how many ungrounded items were dropped, and why a fallback happened. Provenance is stored with each approval and shown in the admin UI's Granola preview, so a reviewer judges the extraction, not just the announcement.

Two rules keep a non-deterministic model from changing what gets published:

- **Approving publishes the reviewed result.** The knowledge stored with an approval is what gets published; approving never calls the model again.
- **Batched drains stay synchronous only in rules mode.** In `llm` and `hybrid` mode, queued approval jobs go through the async workflow so the model can be called.

Diagnostics report the configured mode without calling the model, and they flag a Together.ai backend without an API key as missing. Reachability is effectively checked on every meeting: a failed call is a recorded fallback, never a lost meeting.

## Derived views

Two read-side views are built from stored meeting knowledge rather than from a model, so they make a trustworthy baseline before any LLM synthesis.

**Insights** (`GET /api/brain/insights`) parse accepted decisions to report current ownership, ownership history and changes, open action items by owner, and unowned open actions.

**The multiplayer projection** (`POST /api/brain/project-multiplayer`) turns extracted knowledge into shared, editable work objects: `users` from action owners and ownership decisions, `issues` from action items, `issue_events` recording every creation and change, and `pivots` from decisions that change ownership. Projection is idempotent, and it keeps the owner, status, and priority of issues that already exist, so a re-run never clobbers someone's current work state. One exception closes the loop: when the source action is marked done (or won't do), the projection closes its issue, unless someone has set the issue's status by hand. It never reopens an issue. People then manage issues through `/api/issues`, and every change appends an immutable issue event.

## Background workers

The admin server starts three polling workers. Each is a thin loop over a durable SQLite job queue, so stopping Perry never loses work.

| Worker | Module | Enabled by | What it does |
|---|---|---|---|
| FTS indexer | `@brain` | on unless `PERRY_FTS_WORKER=false` | Flushes queued full-text-search rows into the search index. |
| Ingestion | `@ingestion` | `PERRY_INGESTION_WORKER=true` | Processes queued Granola webhook jobs. |
| Graph sync | `@graph` | `PERRY_GRAPH_SYNC_WORKER=true` | Sends queued graph change sets or episodes to the Graphiti bridge, with retry and backoff. |

Because the workers belong to the admin server, running the bot with `PERRY_ADMIN_SERVER=false` also means no workers run. The queues can always be drained by hand through the API.

The ingestion and graph sync queues share one engine (`src/store/job-queue.ts`). A failed job is retried with exponential backoff until it runs out of attempts.

Each claim stamps its job with a unique lease token and holds it for `PERRY_JOB_LEASE_MS` (default ten minutes) from its last renewal. A job still `processing` after that is presumed abandoned by a crashed worker, and the next claim reclaims it, counting the lost run as an attempt. Healthy work never loses its lease:

- **Claimed as started.** Drains claim network jobs (model, Notion, Discord, Graphiti) one at a time, just before running them, so none waits in a claimed batch while its lease runs down. The ingestion drain still batches approval-only jobs, which touch only SQLite and finish inside one transaction, and hands any network job it claimed back with `release`, which does not count an attempt.
- **Heartbeat.** While a job runs, its lease is renewed every third of the lease period, so a slow call is never mistaken for a crash.
- **Fencing.** `complete` and `fail` succeed only for the current lease holder. A worker whose job was reclaimed cannot record an outcome over the new holder's; the attempt is logged as a `stale_result` audit event instead.

## Source layout

Code lives in `src/`, split into modules. Each module is a directory with a barrel `index.ts` that defines its public surface, and each has a path alias defined in `tsconfig.json`. Import across modules through the alias (`import { searchBrain } from "@store"`), never by reaching into another module's files.

| Alias | Directory | Responsibility |
|---|---|---|
| `@core` | `src/core` | Configuration: environment loading, the settings file schema (`AppSettingsSchema`), the roster, and shared ontology types. |
| `@meetings` | `src/meetings` | The `MeetingNote` model, Granola payload normalization, routing rules, announcement formatting, and sample payloads. |
| `@extraction` | `src/extraction` | Turning a meeting into decisions, action items, and entities: the extraction pipeline (rules, llm, hybrid), the rules parser, and the LM Studio and Together.ai backends. |
| `@store` | `src/store` | Everything SQLite: connection and schema, meetings, approvals, issues and users, search and FTS, the job queues, graph change sets, and the ontology read model. |
| `@ingestion` | `src/ingestion` | The meeting workflow, approvals, the ingestion queue, and its worker. |
| `@graph` | `src/graph` | Graph change-set construction and validation, the Graphiti bridge client, the graph sync queue and worker, replay, backfill, and the multiplayer projection (users, issues, pivots). |
| `@brain` | `src/brain` | Read-side intelligence: insights, typed company-brain queries, ontology queries and health, agent-facing tool contracts, analytics, the FTS worker, and the Inky GitHub-activity standup. |
| `@notion` | `src/notion` | The Notion client, standup reads, meeting page creation, and the wiki schema and sync helpers. |
| `@discord` | `src/discord` | The bot, slash commands, standup jobs, and message formatting. |
| `@server` | `src/server` | The admin HTTP server. |

The store and graph modules are being split into smaller files, so this document deliberately stops at the directory level. Browse the barrel `index.ts` to see what a module exports.

The admin UI is a separate React and Vite app in `admin/`. It talks only to `/api/*`. In development, Vite proxies `/api` to the admin server; in production, the admin server serves the built files from `admin/dist`.

## The admin server

The server uses no web framework. It is a small MVC-style stack on top of `node:http`, and every layer has one job.

| Layer | File | Role |
|---|---|---|
| Composition root | `src/server/http.ts` | Starts the workers, builds the router from the route table, sends `/api/*` to the router and everything else to the static handler, and turns any thrown error into a safe JSON response. |
| Routing | `src/server/router.ts` | A declarative route table. Each route is `{ method, path, access, handle }`. The router matches the path, checks access, then calls the handler. |
| Access policy | `src/server/auth.ts` | The single security policy: who may call a route of each access level, plus the bind-address check. |
| Controllers | `src/server/controllers/*.ts` | One file per resource, each exporting an array of route definitions. `controllers/index.ts` concatenates them into `apiRoutes`. |
| Request input | `src/server/http/request.ts` | `readJson` reads a bounded request body. `Query` gives typed, clamped access to query parameters. |
| Input validation | `src/server/validation.ts` | zod schemas for request bodies and small parsers for enumerated query values. |
| Response view | `src/server/http/response.ts` | `sendJson` writes every response with security headers. A handler's return value is sent as `200`; return a `Reply` (via `reply(status, body)`) for any other status. |
| Projections | `src/server/views/*.ts` | Functions that shape a stored record into a response, such as the summary form of a graph change set. |
| Errors | `src/server/http/errors.ts` | `HttpError` and helpers (`badRequest`, `notFound`, `httpError`). Only these messages reach clients. |
| Static files | `src/server/http/static.ts` | Serves the admin UI from `admin/dist` with an SPA fallback, confined to that directory. |

### Life of a request

1. `http.ts` parses the URL against a fixed base, so the client's `Host` header never affects routing.
2. For `/api/*`, the router finds the first route whose method and path match.
3. `authorize` runs before the handler and before any body is read. A route's `access` is `admin` unless it says otherwise. Unknown `/api` paths are also admin-gated, so anonymous callers cannot discover which routes exist.
4. The handler receives a `RouteContext`: `req`, `res`, `url`, decoded `params` from `:name` path segments, and a `Query` wrapper.
5. The handler reads its body with `readJson`, validates it with `parseBody(schema, body)`, calls into the domain modules, and returns a result.
6. The result goes out through `sendResult`. If the handler throws, an `HttpError` (or any error carrying a 4xx `status`) becomes that status and message; anything else is logged and returned as an opaque `500 {"error":"Internal server error"}`.

The access levels and their rules are described in [security-privacy.md](security-privacy.md#admin-api).

### Adding a route

Suppose you want `GET /api/brain/decisions/:id`.

1. **Pick the controller.** Decisions belong to `controllers/knowledge.ts`. A new resource gets a new controller file, added to the array in `controllers/index.ts`.
2. **Declare the route.** Leave `access` out unless the route must be reachable without the admin token. The default is the safe one.

   ```ts
   {
     method: "GET",
     path: "/api/brain/decisions/:id",
     handle: ({ params }) => {
       const decision = getDecision(params.id);
       if (!decision) throw notFound("Decision not found.");
       return { decision };
     },
   },
   ```

3. **Validate input.** Read query values through `query` (`query.int("limit", 25, { max: 500 })`, `query.required("since")`, `query.parse("status", parseX)`), so limits are always clamped. For a body, add a zod schema to `validation.ts` and call `parseBody(MySchema, await readJson(req), "decision")`. Invalid input becomes a `400` listing each problem, never a `500`.
4. **Shape the output.** Return plain data. If the stored record is large or holds fields the client should not see, add a projection under `views/` and return that instead.
5. **Signal errors deliberately.** Throw `badRequest`, `notFound`, or `httpError(status, message)` for anything the caller should see. Do not put internal details in those messages.
6. **Test it.** `tests/adminAuth.test.ts` and `tests/adminGraphApi.test.ts` show how to build a server with `createAdminHttpServer()` and call it. Add a test for the happy path, for bad input, and, if you changed `access`, for an unauthenticated request.
7. **Document it.** Add the route to the [endpoint reference](../README.md#admin-api-reference).

## The Discord module

`src/discord` is split by responsibility:

| File | Role |
|---|---|
| `commands.ts` | Slash command definitions (`/standup`, `/brain`) and `registerSlashCommands`, which registers them in the configured guild at startup. |
| `client.ts` | The `discord.js` client and channel helpers. Honors `PERRY_DISCORD_DRY_RUN`. |
| `bot.ts` | Logs in and dispatches each interaction to the right handler. |
| `access.ts` | The `/brain` access check. It fails closed: with no admin role IDs configured, nobody may run `/brain`. |
| `brain-commands.ts` | Handlers for `/brain` subcommands. All replies are ephemeral. |
| `standup-commands.ts` | Handlers for `/standup` subcommands. |
| `jobs.ts` | The cron jobs for standup reminders and the daily summary. |
| `format.ts` | Message formatting for standup output. |

To add a subcommand, define it in `commands.ts`, then handle it in `brain-commands.ts` or `standup-commands.ts`. A new top-level command also needs a branch in `bot.ts`.

## Configuration and state

Perry reads two sources of configuration:

- **Environment variables** hold secrets and runtime switches. See the [configuration reference](../README.md#configuration).
- **The settings file** (`data/perry.config.json`, or `PERRY_CONFIG_PATH`) holds non-secret operational settings: Discord and Notion IDs, the standup schedule, the roster, routing rules, and the default publish mode. The admin UI edits it through `PUT /api/config`. Environment variables seed its defaults.

The SQLite database lives at `PERRY_DB_PATH`, or by default at `%LOCALAPPDATA%\Perry\perry.sqlite` on Windows and `data/perry.sqlite` elsewhere. Set `PERRY_DB_PATH=:memory:` for throwaway runs; most test and benchmark scripts do this for you.

## Integration with Inky

`@perry/core` depends on `@inky/core` from the same workspace. `src/brain/github-activity.ts` loads Inky's config and secrets and lazily imports Inky's standup pipeline (`@inky/core/standup`) only when a GitHub-activity standup is requested through `GET /api/brain/activity-standup`. That keeps Inky's heavier dependencies out of Perry's startup path.
