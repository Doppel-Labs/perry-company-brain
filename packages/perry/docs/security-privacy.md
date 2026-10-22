# Security And Privacy Notes

Perry handles meeting-derived operational memory. The safe default is to move structured, bounded objects across tools, not raw transcript context.

## Discord

- `/brain` commands deny access when no Discord admin roles are configured. Only members with an explicitly configured role can query company knowledge.
- Configure `DISCORD_ADMIN_ROLE_IDS` or admin role ids in `data/perry.config.json` before using `/brain` in a real guild.
- Brain replies are ephemeral to reduce channel noise and accidental broad disclosure.
- Route public summaries to project channels; keep raw source notes and private notes outside Discord posts.

## Notion

- Use `PERRY_NOTION_DRY_RUN=true` for schema and write-contract testing.
- Keep decisions, action items, projects, and meeting notes in separate data sources so permissions and views can differ.
- Do not write transcript bodies by default. Meeting pages should link to source evidence and bounded summaries.

## Graph Memory

- Graph change sets should contain stable keys, relation assertions, retirements, and bounded evidence excerpts.
- Replay diff is the production trust check: posted entities, relations, retirements, and evidence must be readable after write.
- Graphiti group ids are tenant/data-boundary controls. Do not reuse one group id across unrelated companies.

## LM Studio

- Prefer deterministic extraction settings for automation: temperature `0`, explicit JSON response format, bounded prompt length.
- Evaluate models on fixed fixtures before trusting a new local model for automation.
- Use the model to propose structured objects; keep final writes behind schema validation and replay/readback checks.

## Secrets

Required production-like secrets are environment variables, not committed files:

- `DISCORD_TOKEN`
- `NOTION_TOKEN`
- `ADMIN_API_TOKEN`
- `GRANOLA_WEBHOOK_TOKEN`
- `LMSTUDIO_API_KEY` if your local server requires it

Rotate a token after sharing logs, screenshots, or config files that may have included it.


## Admin HTTP access

- Set `ADMIN_API_TOKEN` before running the admin server. Every company-data API read and mutation requires this token; a missing token returns 503 rather than disabling authentication.
- Enter the token on the admin panel's Connect form. It stays in React memory for the current page and is sent in the Authorization header; it is not written to browser storage.
- The server binds to `127.0.0.1` by default. Set `ADMIN_HOST=0.0.0.0` only when intentionally exposing it behind HTTPS and appropriate network controls.
- The Granola Zapier endpoint requires `GRANOLA_WEBHOOK_TOKEN`, independently of the admin token. A missing webhook token disables that endpoint.
- `/api/ping` remains a public health probe and contains no company data. Configuration, diagnostics, meeting history, search, and graph endpoints require authentication.

## Request limits and operational clients

- JSON bodies, including Granola webhooks, are limited to 2 MiB of streamed bytes; oversized requests return 413 and close the connection. Invalid JSON returns 400.
- The admin server limits complete request receipt to 30 seconds and headers to 10 seconds. Edge rate limits and distributed quotas remain hosting controls.
- `pnpm perf:http` requires both `ADMIN_API_TOKEN` and `GRANOLA_WEBHOOK_TOKEN`. Admin requests use the admin bearer token, while `/api/granola/zapier` uses only the webhook token.
- `pnpm ops:local-brain-gauntlet --strict` authenticates company-data reads. Admin credentials are not attached to Graphiti or LM Studio checks. Operational HTTP clients reject redirects rather than forwarding credentials.
