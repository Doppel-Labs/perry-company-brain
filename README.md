# Company Brain

Superintelligent Group's open-source Company Brain unifies what an organization knows: what was decided, what is being worked on, and what actually shipped. This README orients you in the repository and gets the workspace running. Each component's own documentation takes it from there.

> Made in collaboration with [The Augmentation Company](https://theaugmentation.co/).

## What is in this repository

The Company Brain is a protocol. This repository is one open-source implementation of it, built from two components that answer "what is the team doing?" from both sides: meetings and code.

| Component | Package | What it does |
|---|---|---|
| **Perry** | [`@perry/core`](packages/perry) | Meeting documentation across Granola, Notion, and Discord. Ingests meeting notes, extracts decisions and action items, publishes them after approval, and serves a searchable SQLite brain with an optional Graphiti temporal graph. |
| **Inky** | [`@inky/core`](inky/packages/core), `@inky/db` | GitHub-activity standups. Reads an org's GitHub activity each day and writes the standup automatically. |

Perry uses Inky as a library, not a copy. `@perry/core` depends on `@inky/core` through the workspace and runs Inky's standup pipeline on demand, so `GET /api/brain/activity-standup` puts GitHub activity next to meeting decisions in the same brain.

```text
company-brain/               @superintelligent/company-brain (pnpm workspace root)
├── packages/
│   └── perry/               @perry/core: the meeting-documentation brain
├── inky/                    Inky, vendored as a git subtree
│   └── packages/
│       ├── core/            @inky/core: the standup pipeline and CLI
│       └── db/              @inky/db: managed-tier persistence
├── scripts/bootstrap.mjs    creates local env/config files from the examples
└── pnpm-workspace.yaml
```

Inky lives under `inky/` as a [git subtree](https://www.atlassian.com/git/tutorials/git-subtree), so its upstream history is preserved. To pull upstream changes from `https://github.com/Doppel-Labs/inky.git` (configured as the `inky` remote):

```sh
git subtree pull --prefix=inky inky main
```

## Getting started

You need Node 24 and pnpm, which [corepack](https://nodejs.org/api/corepack.html) pins to the version in `package.json`. Run every command from the repository root; there is no need to `cd` into a package.

```sh
corepack enable
pnpm install
pnpm bootstrap      # create local env/config files from the examples, then build @inky/core
```

`pnpm bootstrap` is safe to re-run; it never overwrites a file you have edited. It creates:

| File | Holds |
|---|---|
| `packages/perry/.env` | Perry's secrets and switches: Discord, Notion, admin API, Graphiti, LLM keys. |
| `inky/.env` | Inky's secrets: GitHub token, LLM provider key. |
| `inky/inky.config.json` | Inky's org, repos, and schedule (not secret). |

Fill those in, then run a component:

```sh
pnpm dev            # Perry: Discord bot, scheduler, and admin server
pnpm standup        # Inky: one GitHub-activity standup
```

Perry's non-secret settings (Discord and Notion IDs, the standup schedule, the roster) are edited in its admin UI; values in `.env` are only defaults, and a value saved in the UI wins. Secrets stay in `.env`. Perry loads `packages/perry/.env` automatically in its dev and start scripts, and it can run without Discord while you explore the admin UI. The [Perry README](packages/perry/README.md#quick-start) covers both, along with every configuration option.

## Workspace commands

| Command | What it does |
|---|---|
| `pnpm bootstrap` | Creates local env and config files from the examples, then builds `@inky/core`. |
| `pnpm build` | Builds every package in dependency order (`@inky/core` first). |
| `pnpm typecheck` | Type-checks every package. |
| `pnpm test` | Runs every package's tests. |
| `pnpm dev` | Runs Perry in watch mode. |
| `pnpm standup` | Runs an Inky standup. |
| `pnpm perry <script>` | Runs any script in `@perry/core`, for example `pnpm perry dev:server`. |
| `pnpm inky <script>` | Runs any script in `@inky/core`. |

## Where to go next

- [Perry README](packages/perry/README.md): setup, configuration reference, and the admin API.
- [Perry architecture](packages/perry/docs/architecture.md): how the code is organized.
- [Perry security model](packages/perry/docs/security-privacy.md): how the admin API and Discord commands are protected.
- [Inky README](inky/README.md): the standup pipeline.

## License

MIT. See [`LICENSE`](LICENSE); the `inky/` subtree carries its own MIT license in `inky/LICENSE`.
