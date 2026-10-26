# Perry Operations Runbook

This runbook is for whoever keeps Perry healthy: the checks to run before trusting a build, how to verify the full local stack, how to back up and restore state, and what a release candidate must pass. It assumes Perry is configured as described in the [package README](../README.md).

Commands are written as they run from `packages/perry` (`pnpm <script>`). From the repository root, use `pnpm perry <script>` instead. Examples set environment variables PowerShell-style; in bash, use `export NAME=value`. Most scripts load the compiled code, so run `pnpm build` first.

## Daily smoke check

Run these before trusting a local admin or Graphiti session:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm ops:local-brain-gauntlet
```

The local brain gauntlet calls the admin API (ping, health, diagnostics, agent status, graph change sets, graph entities), the Graphiti bridge if `PERRY_GRAPHITI_BRIDGE_URL` is set, and LM Studio's `/models` endpoint. By default it only reports problems. Add `--strict` to make any failure fail the run, which is what you want when the whole stack is supposed to be online:

```powershell
$env:PERRY_ADMIN_URL = "http://127.0.0.1:8787"
$env:PERRY_GRAPHITI_BRIDGE_URL = "http://127.0.0.1:8791"
$env:LMSTUDIO_BASE_URL = "http://127.0.0.1:1234/v1"
pnpm ops:local-brain-gauntlet -- --strict
```

To include a graph replay readback in the proof, name a known change set:

```powershell
$env:PERRY_GAUNTLET_REPLAY_CHANGE_SET_ID = "graph-change-set:meeting:..."
pnpm ops:local-brain-gauntlet -- --strict
```

Every admin check sends `ADMIN_API_TOKEN` when it is set, so export the same token the server uses.

## Full local acceptance

Once Neo4j, LM Studio, the Graphiti bridge, and the Perry admin server are all running, `brain:acceptance` is the end-to-end proof. It checks bridge and model health, runs the LM Studio extraction fixtures, pushes a synthetic Granola meeting through dry-run Notion and Discord sinks, drains a graph sync job into Graphiti, replays the change set and verifies the readback diff, and finishes with the strict local gauntlet.

```powershell
$env:PERRY_ADMIN_URL = "http://127.0.0.1:8787"   # optional; this is the default
$env:PERRY_GRAPHITI_BRIDGE_URL = "http://127.0.0.1:8791"
$env:PERRY_GRAPHITI_GROUP_ID = "doppel-labs"
$env:PERRY_GRAPHITI_DIRECT_CHANGESETS = "true"
$env:PERRY_LMSTUDIO_EVAL_MODELS = "gemma-4-e4b-claude-abliterated"
pnpm brain:acceptance
```

The script supplies safe defaults for anything you leave unset: an in-memory database, `auto` publish mode, and dry-run Notion and Discord. `PERRY_ADMIN_URL` defaults to `http://127.0.0.1:8787`, the admin server's default port.

The stack last verified end to end (2026-05-25) was Neo4j `bolt://127.0.0.1:7687` in the Docker container `perry-neo4j`, the Graphiti bridge on port 8791, LM Studio at `http://127.0.0.1:1234/v1` with chat model `gemma-4-e4b-claude-abliterated` and embedding model `text-embedding-nomic-embed-text-v1.5`. Setting up that stack is covered in [graphiti-integration.md](graphiti-integration.md).

## Evaluating a local model

Compare local models and settings on fixed company-brain extraction cases:

```powershell
$env:LMSTUDIO_BASE_URL = "http://127.0.0.1:1234/v1"
$env:PERRY_LMSTUDIO_EVAL_MODELS = "gemma-4-local,other-local-model"
$env:PERRY_LMSTUDIO_EXTRACTION_TEMPERATURE = "0"
pnpm lmstudio:evaluate
pnpm lmstudio:evaluate -- --strict   # fail on low extraction scores
```

To decide which `PERRY_EXTRACTION_MODE` to run in production, compare the modes end to end. This goes through the same pipeline ingestion uses, with grounding, owner matching, and fallback, against whichever backend is configured:

```powershell
pnpm build
pnpm perry extraction:evaluate                          # rules, llm, and hybrid
pnpm perry extraction:evaluate -- --modes=hybrid --strict  # fail on low scores or any fallback
```

Each line shows the score, how many items were kept and dropped as ungrounded, latency, and any fallback reason. The prose fixture is the one to watch: the rules parser scores 0 there, so it shows what a model adds.

The fixtures live in `tests/fixtures/lmstudio-extraction-eval.json`. When a real meeting exposes a new failure mode, such as messy owner names, pivots, vague customer mentions, routing, Notion targets, or repository references, add it as a case.

Two quicker checks exist. `pnpm lmstudio:smoke` lists the models an OpenAI-compatible endpoint serves and makes one chat and one embedding call; it reads the `GRAPHITI_*` model settings first, so it doubles as a pre-flight for the Graphiti bridge. `pnpm together:smoke` runs one real Together.ai extraction over the sample Granola payload; it is the one script that loads `.env` itself.

## Notion and Discord sandbox checks

`sandbox:integrations` verifies Perry's integration contracts without touching production. With no flags, everything is dry-run: the Discord slash command JSON for `/standup` and `/brain`, the Notion wiki write contracts, Notion meeting page creation, and Discord post formatting.

```sh
pnpm sandbox:integrations
```

Real writes are opt-in. For Notion, point the data source variables at sandbox data sources first; Perry will create real pages there:

```powershell
$env:NOTION_TOKEN = "..."
$env:NOTION_MEETING_NOTES_DATA_SOURCE_ID = "..."
$env:NOTION_DECISIONS_DATA_SOURCE_ID = "..."
$env:NOTION_ACTION_ITEMS_DATA_SOURCE_ID = "..."
$env:NOTION_PROJECTS_DATA_SOURCE_ID = "..."
pnpm sandbox:integrations -- --real-notion --strict
```

For Discord, start with bot identity and command registration, and add posting only once the sandbox channel is confirmed. These flags call Discord's REST API directly, so the long-running bot does not need to be started.

```powershell
$env:DISCORD_TOKEN = "..."
$env:DISCORD_CLIENT_ID = "..."
$env:DISCORD_GUILD_ID = "..."
pnpm sandbox:integrations -- --real-discord --register-discord --strict

$env:DISCORD_SANDBOX_CHANNEL_ID = "..."
pnpm sandbox:integrations -- --real-discord --post-discord --strict
```

## Discord command gauntlet

Validates the local slash command definitions, including `/brain state`, `/brain changed`, and `/brain evidence`:

```sh
pnpm discord:commands:gauntlet -- --report reports/discord/commands-local.json --markdown reports/discord/commands-local.md
```

With `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID` set, `--live true` compares against the commands registered in the guild, and `--register true` registers the local definitions.

## Agent tool checks

Run these when you change the company-brain tool contracts, ontology materialization, or evidence handling. Both are described in more detail in [company-brain-ontology.md](company-brain-ontology.md#verifying-the-ontology).

```sh
pnpm agent-tools:gauntlet -- --report reports/agent-tools/contract-gauntlet.json --markdown reports/agent-tools/contract-gauntlet.md
pnpm agent-tools:corpus-gauntlet -- --reset true --limit 250 --db reports/db/agent-tool-corpus.sqlite --report reports/agent-tools/corpus-gauntlet.json --markdown reports/agent-tools/corpus-gauntlet.md
pnpm ontology:repair -- --db reports/db/agent-tool-corpus.sqlite --report reports/ontology/repair-dry-run.json --markdown reports/ontology/repair-dry-run.md
```

`ontology:repair` is a dry run unless you pass `--apply true`.

## Backups

Perry's durable state is split between SQLite and, when graph memory is enabled, Neo4j.

**SQLite.** Stop Perry, or at least its workers, then copy the database file (see `PERRY_DB_PATH` in the [configuration reference](../README.md#configuration) for its location) along with the settings file, `data/perry.config.json`. Keep backups timestamped, for example `perry-2026-05-23.sqlite`. To restore, replace the file while Perry is stopped, start it, and run `pnpm ops:local-brain-gauntlet`.

**Neo4j.** Back up the database with Neo4j's tooling or by snapshotting the container's data volume. Record the `PERRY_GRAPHITI_GROUP_ID` alongside the backup, because the group ID is part of the dataset's identity. To restore, restore Neo4j first, then start the Graphiti bridge, then run the strict gauntlet. If the graph is lost entirely, it can be rebuilt from SQLite with `pnpm graphiti:backfill` (see [graphiti-integration.md](graphiti-integration.md#backfilling-history)).

## Release gates

A release candidate should have:

- typecheck, tests, build, and the local brain gauntlet passing;
- a passing replay readback diff for at least one known change set, when Graphiti is in use;
- a passing LM Studio evaluation for the chosen model and settings;
- Notion writes exercised in dry-run before any real writes;
- `DISCORD_ADMIN_ROLE_IDS` configured before `/brain` is used in a real guild;
- `ADMIN_API_TOKEN` and `GRANOLA_WEBHOOK_TOKEN` set, and HTTPS in front, for any deployment reachable from another machine;
- a fresh backup before any migration or backfill that touches production-like data.

## Troubleshooting

**`disk I/O error` from SQLite on Windows.** File-backed Node SQLite on Windows has failed with `DELETE` and `WAL` journal modes in local testing. Perry defaults to `MEMORY` on Windows; if you have set `PERRY_SQLITE_JOURNAL_MODE`, set it back to `MEMORY`.

**Perry refuses to start with "Refusing to bind the admin server".** `ADMIN_HOST` is a non-loopback address and `ADMIN_API_TOKEN` is not set. Set the token, or bind to `127.0.0.1`.

**Every API call returns `401`.** The client is not sending `ADMIN_API_TOKEN`, or is sending a different value from the server's. Check for whitespace or a stale token in the admin UI; it asks again after a page reload.

**Every API call returns `503`.** The server has no `ADMIN_API_TOKEN` (or `GRANOLA_WEBHOOK_TOKEN`, for the webhook). Run `pnpm bootstrap` to generate them, or set them in the host's environment, then restart Perry.

**The browser shows `Admin app has not been built yet`.** The server serves the UI from `admin/dist`. Run `pnpm build` (or `pnpm admin:build`), or use `pnpm admin:dev` during development.

**`/brain` says commands are disabled.** No admin roles are configured. Set `DISCORD_ADMIN_ROLE_IDS`, or add role IDs in the admin UI's settings.

**A setting saved in the admin UI has no effect.** Saved settings always win over environment variables, which are only defaults. If a saved value seems ignored, check that it was saved non-blank (a blank field falls back to the environment variable), and that `PERRY_CONFIG_PATH` points the bot and the admin server at the same file. Standup times, timezone, and the enabled switch are read when the bot starts, so restart it after changing them.

**A value from `.env` is ignored.** A saved setting overrides it. Change the value in the admin UI, or clear the field there to fall back to the environment variable. Secrets (`DISCORD_TOKEN`, `NOTION_TOKEN`, API tokens and keys) are always read from the environment.

**No standup reminders or summaries are posted.** Standups are disabled (`STANDUP_ENABLED=false`, or unchecked in the admin UI); the bot logs "Standups are disabled" at startup. With `PERRY_DISCORD_DRY_RUN=true`, posts are also skipped.

**Readiness says "Needs setup".** At least one check is `missing`, which means something required is absent (a token, a Discord or Notion ID, a writable database path, or a Graphiti bridge URL while Graphiti is enabled). `warning` checks, such as Graphiti disabled or Granola in manual mode, do not block readiness.

**Granola notes are never pulled automatically in `api-poll` mode.** The API poller is not implemented; `api-poll`, `GRANOLA_FOLDER_NAME`, `GRANOLA_POLL_INTERVAL_MINUTES`, and `GRANOLA_API_KEY` have no effect. Use `zapier-webhook` and send notes to `/api/granola/zapier`.

**A queue job sits in `processing`.** A claim holds a job for `PERRY_JOB_LEASE_MS` (default 600000, ten minutes). If the worker that claimed it crashed or stalled, the next claim on that queue (a worker tick, or `POST /api/ingestion/drain`) reclaims it: the lost run counts as one attempt, so the job either runs again at once or, if it was on its last attempt, becomes `failed` with `last_error` starting `Lease expired`. Raise the lease if a legitimate job (a slow Notion or Graphiti call) can run longer than that, because a reclaimed job may run twice.

**A meeting is stuck in `publishing` or `failed`.** `publishing` means an auto-publish or an approval started and did not finish; `failed` means its ingestion job ran out of attempts part-way, with the last error in the meeting's `error`. Either way the meeting keeps the Notion page and Discord message it already has. Fix the cause (usually a missing Discord channel or a Notion permission), then retry: approve the pending approval again, re-send the note, or re-run it with `force=true`. Perry skips the steps it already finished, so no second page or post is created.
