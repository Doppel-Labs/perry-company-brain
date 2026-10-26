# Notion Wiki Schema

Perry treats Notion as a durable, structured wiki rather than a place to dump notes. This document lists the properties Perry expects in each Notion data source. Read it when you set up the Notion workspace or change what Perry writes. The property names are defined in code in `src/notion/wiki-schema.ts`; keep the two in sync.

## Status

Today, the live meeting workflow writes **meeting note** pages, filling in `Title`, `Source`, `Source ID`, `Date`, `Granola Link`, and `Attendees`, with the meeting summary as page content.

Sync helpers for **decisions**, **action items**, and **projects** exist in the `@notion` module and are covered by tests and the `sandbox:integrations` check, but the workflow does not call them yet. They are idempotent: each sync looks up the page by its key property (`Source Decision ID`, `Source Action ID`, or `Graph Entity` for projects) and updates it, creating a page only when none exists, so re-running a sync never duplicates pages. Wiring them in, while preserving source links and graph keys, is the next step. Each one is skipped unless its data source ID is set (`NOTION_DECISIONS_DATA_SOURCE_ID`, `NOTION_ACTION_ITEMS_DATA_SOURCE_ID`, `NOTION_PROJECTS_DATA_SOURCE_ID`). The separate standup data source is described in the [package README](../README.md#notion-setup).

Keep each kind of record in its own data source so permissions and views can differ (see [security-privacy.md](security-privacy.md#notion)).

## Meeting notes

| Property | Holds |
|---|---|
| `Title` | Meeting title. |
| `Source` | Capture source: Granola, Discord, manual, or a future source. |
| `Source ID` | Source identifier, used for idempotency. |
| `Date` | Meeting start time. |
| `Granola Link` | Link to the original note, when there is one. |
| `Attendees` | Compact attendee list. |
| `Project` | Routed project. |
| `Discord Message` | URL of the posted announcement. |
| `Graph Entity` | Stable graph key, usually `meeting:<meetingId>`. |

## Decisions

| Property | Holds |
|---|---|
| `Decision` | Decision text. |
| `Meeting` | Relation back to the meeting note. |
| `Project` | Routed or inferred project. |
| `Status` | `proposed`, `accepted`, or `rejected`. |
| `Owner` | Responsible person, when it can be extracted. |
| `Evidence` | Source excerpt or link. |
| `Graph Fact` | Stable fact key, once projected into graph memory. |
| `Source Decision ID` | Perry's decision ID; the key sync uses to find and update the page. |

## Action items

| Property | Holds |
|---|---|
| `Action` | Action text. |
| `Meeting` | Relation back to the meeting note. |
| `Owner` | Responsible person. |
| `Due Date` | Due date, if extracted. |
| `Status` | `open`, `done`, or `wont-do`. |
| `Project` | Routed or inferred project. |
| `Source Action ID` | Perry's action ID; the key sync uses to find and update the page. |
| `Graph Entity` | Stable graph key. |

## Projects

| Property | Holds |
|---|---|
| `Project` | Project name. |
| `Owner` | Current owner. |
| `Status` | `active`, `paused`, or `archived`. |
| `Discord Channel` | Channel ID or URL. |
| `Repository` | Primary repository. |
| `Graph Entity` | Stable graph key, usually `project:<slug>`. |
