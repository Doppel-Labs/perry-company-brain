# Security and Privacy

Perry holds meeting-derived company memory, so it is built to fail closed and to move structured, bounded objects between tools rather than raw transcripts. This document is the reference for how Perry's admin API and Discord commands are protected and how meeting data should be handled. Read it before exposing Perry beyond your own machine.

## Admin API

The admin server fails closed, and its whole policy lives in one file, `src/server/auth.ts`.

### Who can call what

Every route in `src/server/controllers/*` declares an access level. A route that does not declare one is `admin`, so a newly added route is protected unless its author deliberately opens it.

| Access | Routes | Requirement |
|---|---|---|
| `public` | `GET /api/ping` | None. |
| `webhook` | `POST /api/granola/zapier` | `GRANOLA_WEBHOOK_TOKEN` in the `x-perry-webhook-token` header. |
| `admin` | Every other `/api/*` route, reads included, and any unknown `/api` path | `ADMIN_API_TOKEN` as `Authorization: Bearer <token>` or `x-admin-token: <token>`. |

The two tokens are not interchangeable. The admin token is not accepted on the webhook, and the webhook token is not accepted anywhere else. Unknown `/api` paths return `401` to anonymous callers rather than `404`, so the route table cannot be mapped from outside. Tokens are compared in constant time.

### Running without a token

An unset token disables what it protects; it never disables authentication. Without `ADMIN_API_TOKEN`, every admin route answers `503 Admin authentication is not configured`, local requests included. Without `GRANOLA_WEBHOOK_TOKEN`, the webhook answers `503`. Only `GET /api/ping` keeps working. A blank value counts as unset.

For local development, `pnpm bootstrap` writes a random value for both tokens into `packages/perry/.env` whenever they are blank. It never replaces an existing value and never prints the secrets. Paste the admin token into the admin UI's Connect screen.

### Binding and transport

`ADMIN_HOST` defaults to `127.0.0.1`. Set `ADMIN_HOST=0.0.0.0` only when you are deliberately exposing Perry behind HTTPS and appropriate network controls. A non-loopback bind refuses to start unless `ADMIN_API_TOKEN` is set, so a misconfigured deployment fails at startup instead of serving `503`s, and it warns if `GRANOLA_WEBHOOK_TOKEN` is missing. Perry speaks plain HTTP; any exposed deployment must terminate HTTPS in front of it.

Generate tokens with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Request and response hardening

- **Bounded input.** JSON bodies, webhooks included, are limited to `PERRY_MAX_BODY_BYTES` (default 2 MiB). An announced `Content-Length` over the limit is rejected before any byte is read, and streamed bytes are counted too, so chunked or understated bodies cannot exceed it. Oversized requests get `413` and the connection is closed; an invalid `Content-Length` or invalid JSON is a `400`. Page sizes are clamped to 1000 rows, and every numeric query parameter has a ceiling.
- **Slow clients.** A request must arrive within 30 seconds and its headers within 10 seconds. Edge rate limits and distributed quotas remain hosting controls.
- **Validated input.** Request bodies are parsed with zod schemas in `src/server/validation.ts`. Bad input is a `400` that lists each problem, never a `500`.
- **Opaque failures.** Only deliberate errors (4xx, and the `503` for an unconfigured token) reach the client. Any other error is logged on the server and returned as `500 {"error":"Internal server error"}`.
- **Security headers.** Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Cross-Origin-Resource-Policy: same-origin`. API responses are also `Cache-Control: no-store`.
- **Secrets stay server-side.** `GET /api/config` reports only whether each secret is set, never its value.
- **Static files are confined** to `admin/dist`.

### The admin UI

The admin UI asks for the token on a Connect screen. It keeps the token in memory for the current page only and never writes it to browser storage, so reloading the page asks for it again. The UI sends it in the `Authorization` header on every API request. If the server has no token configured, the Connect screen says so rather than asking for one.

### Operational clients

- `pnpm perf:http` requires both `ADMIN_API_TOKEN` and `GRANOLA_WEBHOOK_TOKEN`. Admin requests carry only the admin token, and `/api/granola/zapier` carries only the webhook token.
- `pnpm ops:local-brain-gauntlet --strict` authenticates its admin checks. Admin credentials are never attached to Graphiti or LM Studio checks.
- These clients refuse redirects, so a misconfigured or hostile endpoint cannot have a credential forwarded to another host.

## Discord

`/brain` commands fail closed. Until `DISCORD_ADMIN_ROLE_IDS` (or the admin role list in the settings file) names at least one role, nobody can run them, and Discord shows a message saying they are disabled. Only members holding one of those roles can query company knowledge.

Brain replies are ephemeral, so only the person who asked sees them. Meeting announcements posted to channels contain the public summary only: title, date, attendees, Notion and Granola links, and the summary. They never include Granola private notes or transcript text. Route announcements to project channels and keep raw source material out of Discord.

## Notion

- Use `PERRY_NOTION_DRY_RUN=true` when testing schemas and write contracts.
- Keep meeting notes, decisions, action items, and projects in separate data sources so their permissions and views can differ.
- Do not write transcript bodies to Notion. Meeting pages should carry bounded summaries and link to the source.

## Graph memory

- Graph episodes exclude Granola private notes and transcripts by default. Turn on `PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES` or `PERRY_GRAPHITI_INCLUDE_TRANSCRIPT` only when your policy allows the graph to store that material.
- Graph change sets should contain stable keys, relation assertions, retirements, and short evidence excerpts, not raw context.
- The replay readback diff is the trust check: after a write, every posted entity, relation, retirement, and piece of evidence must be readable.
- A Graphiti group ID is a data boundary. Never reuse one group ID across unrelated companies.

## Language models

- Extraction makes no model calls unless you opt in with `PERRY_EXTRACTION_MODE=llm` or `hybrid`. With LM Studio, meeting summaries stay on your network; with `PERRY_EXTRACTION_BACKEND=together`, they are sent to Together.ai. Private notes and transcripts are never part of the prompt.
- Model output is untrusted. Items must be grounded in the note, owners must be known people, and approving a meeting publishes the reviewed result rather than asking the model again. See [Extraction](architecture.md#extraction).
- Prefer deterministic settings for automation: temperature `0`, an explicit JSON response format, and a bounded prompt length.
- Evaluate a model on the fixed fixtures (`pnpm perry extraction:evaluate`, or `lmstudio:evaluate` to compare raw models) before trusting it in automation.
- Let the model propose structured objects; keep final writes behind schema validation and readback checks.

## Runtime

Run patched Node.js 24.22.1 or a newer security-patched Node 24 release. The repository's `.node-version` and `.nvmrc` pin 24.22.1. A source pin does not update a host that is already running, so rebuild and restart existing deployments and confirm the running version with `node --version`.

## Secrets

Secrets belong in environment variables, never in committed files or the settings file. Perry reads them only from the environment: unlike the other settings, where a value saved in the admin UI overrides its environment default, secrets cannot be set or overridden through the admin UI. In a production-like deployment that means at least `DISCORD_TOKEN`, `NOTION_TOKEN`, `ADMIN_API_TOKEN`, and `GRANOLA_WEBHOOK_TOKEN`, plus `TOGETHER_API_KEY`, `LMSTUDIO_API_KEY`, `NEO4J_PASSWORD`, or `GITHUB_TOKEN` if you use those integrations.

Rotate any token that may have appeared in shared logs, screenshots, or config files.
