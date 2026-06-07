# Company Brain

**Superintelligent Group's open-source Company Brain** — a protocol and reference
implementation for unifying an organization's knowledge: what was decided, what's
being worked on, and what actually shipped.

> Made in collaboration with [The Augmentation Company](https://theaugmentation.co/).

The Company Brain is a *protocol*; this repository is one open-source
implementation of it, assembled from two composable components:

| Component | Package | What it does |
|---|---|---|
| **Perry** | [`@perry/core`](packages/perry) | Meeting documentation — Discord + Notion + Granola. Ingests meeting notes, extracts decisions/action items, and serves a searchable SQLite "brain" with an optional Graphiti temporal graph. |
| **Inky** | [`@inky/core`](inky/packages/core), `@inky/db` | GitHub-activity standups — reads an org's GitHub activity each day and writes the standup automatically (collect → reconcile → summarize → render). |

Together they answer *"what is the team doing?"* from both sides: meetings
(Perry) **and** code (Inky).

## Layout

```
company-brain/                 @superintelligent/company-brain (pnpm workspace root)
├── packages/
│   └── perry/                 @perry/core — the meeting-documentation brain
├── inky/                      vendored via git subtree (full history preserved)
│   └── packages/
│       ├── core/              @inky/core — the standup pipeline + CLI
│       └── db/                @inky/db   — managed-tier persistence
└── pnpm-workspace.yaml
```

Inky lives under `inky/` as a [git subtree](https://www.atlassian.com/git/tutorials/git-subtree)
so its upstream history is preserved and it can be synced from
`https://github.com/Doppel-Labs/inky.git`:

```sh
git subtree pull --prefix=inky inky main   # 'inky' remote -> the canonical repo
```

## How they integrate

Perry consumes Inky as a proper library (not a copy): `@perry/core` depends on
`@inky/core` (`workspace:*`), imports Inky's config loader + domain types, and
runs its standup pipeline (lazy-loaded from `@inky/core/standup`). The result is
surfaced through Perry's admin API:

```
GET /api/brain/activity-standup   # runs Inky's GitHub-activity standup
```

so GitHub activity becomes first-class Company-Brain knowledge alongside meeting
decisions and action items.

## Quickstart

One toolchain, one install, one set of commands — all from the **repo root**
(the [pnpm](https://pnpm.io) workspace). Requires **Node 24** and pnpm via
[corepack](https://nodejs.org/api/corepack.html).

```sh
corepack enable          # pin pnpm to the version in package.json
pnpm install             # install the whole workspace
pnpm bootstrap               # create local .env/config from examples + build @inky/core
#   → fill in packages/perry/.env, inky/.env, and inky/inky.config.json
pnpm dev                 # run Perry (bot + admin server)
pnpm standup             # run an Inky GitHub-activity standup
```

That's the canonical path. Every command runs from the root — never `cd` into a
package or into `inky/`:

| Command | What it does |
|---|---|
| `pnpm bootstrap` | create local env/config from examples (idempotent) + build `@inky/core` |
| `pnpm build` | build every package, in dependency order (`@inky/core` first) |
| `pnpm typecheck` / `pnpm test` | across every package |
| `pnpm dev` | run Perry (`@perry/core`) |
| `pnpm standup` | run an Inky standup (`@inky/core`) |
| `pnpm perry <script>` · `pnpm inky <script>` | run any script in a package |

### Environment

`pnpm bootstrap` copies the checked-in examples to local files (never overwriting):

| File | Holds |
|---|---|
| `packages/perry/.env` | Perry secrets — Discord, Notion, Together.ai |
| `inky/.env` | Inky secrets — GitHub token, LLM provider key |
| `inky/inky.config.json` | Inky's org / repos / schedule (non-secret) |

To drive Inky **through Perry** (`GET /api/brain/activity-standup`), Perry's
process also needs `GITHUB_TOKEN` and an `inky.config.json` (point at it with
`INKY_CONFIG_PATH`).

Component-specific detail lives in
[`packages/perry/README.md`](packages/perry/README.md) and
[`inky/README.md`](inky/README.md).

## License

The `inky/` subtree is MIT (see `inky/LICENSE`). See `LICENSE` for the rest.
