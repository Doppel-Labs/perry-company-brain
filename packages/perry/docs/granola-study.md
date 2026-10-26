# Granola and Perry's Product Direction

This note records what Granola does well, where Perry should begin instead of copying it, and the bar Perry is held to. Read it before proposing product changes. It was written on 2026-05-23; Granola's feature set may have moved since.

## What Granola is good at

Granola is excellent at low-friction personal capture. It is not a meeting bot: it runs on the user's device and records system audio and microphone audio, starting only when the user acts or when an open scheduled note reaches its meeting time. It produces AI-enhanced notes from the transcript, the user's own notes, and calendar context, and it offers templates, folders and spaces, search, and integrations with Slack, Notion, Zapier, CRMs, MCP, and (on higher plans) an API.

Two gaps matter for a company brain. Desktop real-time transcription does not yet provide full live speaker diarization, and Granola's native Notion sharing is useful for people but not enough to automate a company's memory on its own.

## Where Perry begins

Perry starts where Granola's note-taking ends. Granola stays the capture layer; Perry becomes the company's operating memory. That means Perry should:

1. Capture from Granola, Discord, Notion, manual notes, and future audio or transcript sources.
2. Normalize every source into one company-brain object model.
3. Extract decisions, action items, owners, projects, open questions, source links, and follow-ups.
4. Let people preview and approve before anything noisy is posted.
5. Route the right summary to the right Discord channel or thread.
6. Write durable, structured records to Notion.
7. Keep everything source-cited and retrievable later.

## Timely without being annoying

Perry should disclose progressively:

- During a meeting, stay silent unless explicitly invited.
- Right after a meeting, create a draft and a quiet preview.
- When confidence is high, post a concise Discord summary with links.
- When confidence is low, ask for approval.
- For follow-up, ping owners of clear action items, not every attendee.
- For backfills and replays, never post duplicates.

## The product bar

Perry should be judged on idempotent ingestion, source preservation, structured extraction, human approval controls, a cross-tool identity graph, search with citations, project and channel routing, action-item ownership, an audit log, admin diagnostics, and backfill and retry.

## Still to build

- Granola API polling, if Zapier is not the long-term ingestion path. The `api-poll` mode, `GRANOLA_API_KEY`, and `GRANOLA_POLL_INTERVAL_MINUTES` settings are reserved for it.
- Source-cited question answering over the brain, beyond today's typed `/brain` lookups.
- Promoting the roster's cross-tool identity fields (Discord, Notion, Granola email, GitHub) into a dedicated people graph as the team grows.
- Publishing decisions, action items, and projects to Notion as part of the live workflow (see [notion-wiki-schema.md](notion-wiki-schema.md)).
