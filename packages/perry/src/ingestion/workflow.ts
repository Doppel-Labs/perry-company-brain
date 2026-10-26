// ingestion/workflow — the meeting workflow: a Granola note in, a Notion page and a Discord post out.
//
// For each note: normalize it, resolve its route (project, channel, Notion data
// source, publish mode), skip it if already published, extract decisions and
// action items, then branch on the publish mode:
//
//   approval | draft ─► meeting `pending_approval` + knowledge + approval `pending`   (one transaction)
//                         │ approvePendingMeeting                 │ rejectPendingMeeting
//                         ▼                                       ▼
//                       approval `approved` ─► (auto path) ─► `posted`     `rejected`
//
//   auto ─► meeting `publishing` ─► Notion page ─► Discord post ─► meeting `processed`
//           + knowledge ─► graph-sync job enqueued (when graph memory is enabled)
//
// `approval` and `draft` behave the same here. Dedupe is by (source, sourceId),
// or by the content-derived meeting id for notes without one: a note already
// `processed` returns the stored result with `duplicate: true`; `force` skips
// that check and publishes afresh.
//
// Publishing is resumable. The meeting is stored as `publishing` before the
// first network call, and each finished step is saved at once: the Notion page
// id/url as soon as the page exists, the Discord message url once posted. A
// retry of any kind (a re-queued job, a re-sent note, a forced re-run, or a
// second approve) finds the `publishing` (or `failed`) record and skips the
// steps it already holds, so a failure never yields a second page or post. The
// one remaining gap is a crash between a network call succeeding and its
// result being saved. PERRY_NOTION_DRY_RUN and PERRY_DISCORD_DRY_RUN replace
// the two network calls with fake URLs.
import { loadAppSettings, type AppSettings } from "@core";
import { enqueueMeetingGraphSync } from "@graph";
import { sendToChannel, sendToMeetingChannel } from "@discord";
import { extractMeetingKnowledge, extractRulesKnowledge, getExtractionMode, type ExtractedKnowledge } from "@extraction";
import { formatMeetingAnnouncement, normalizeGranolaZapierPayload, type MeetingNote } from "@meetings";
import { createMeetingNotePage } from "@notion";
import {
  createApproval,
  findMeetingRecord,
  getApproval,
  getMeetingRecord,
  meetingIdForNote,
  meetingRecordFromNote,
  replaceMeetingKnowledge,
  type ApprovalRecord,
  type MeetingRecord,
  updateApprovalStatus,
  upsertMeetingRecord,
  withBrainTransaction,
} from "@store";
import { resolveMeetingRoute, type MeetingRoute } from "@meetings";


/**
 * Outcome of one note. `dryRun` is true only for previews, which write
 * nothing; a note held for approval has `dryRun: false` and `approval` set.
 * Notion/Discord fields are set only when the note was published (or was a
 * published duplicate).
 */
export interface MeetingWorkflowResult {
  duplicate: boolean;
  dryRun: boolean;
  announcement: string;
  record: MeetingRecord;
  knowledge?: ExtractedKnowledge;
  route?: MeetingRoute;
  approval?: ApprovalRecord;
  notionPageId?: string;
  notionUrl?: string;
  discordMessageUrl?: string;
}

/**
 * Runs the full workflow for one webhook payload (see the header). Options:
 * `dryRun` previews without writing; `force` skips the duplicate check;
 * `bypassApproval` publishes regardless of the route's publish mode;
 * `knowledge` publishes a previously extracted (and reviewed) result instead of
 * extracting again. Extraction follows PERRY_EXTRACTION_MODE (see
 * extractMeetingKnowledge) and never throws on a model failure. Throws on an
 * invalid payload or a Notion/Discord failure; the steps finished before the
 * failure are kept, and the next run resumes after them.
 */
export async function processGranolaZapierPayload(
  payload: unknown,
  options: { dryRun?: boolean; force?: boolean; bypassApproval?: boolean; knowledge?: ExtractedKnowledge } = {}
): Promise<MeetingWorkflowResult> {
  const note = normalizeGranolaZapierPayload(payload);
  const settings = loadAppSettings();
  const route = resolveMeetingRoute(note, settings);
  const duplicate = options.force ? undefined : findMeetingRecord(note);
  if (duplicate && duplicate.status === "processed") {
    return duplicateResult(note, route, duplicate);
  }

  if (options.dryRun) {
    const record = meetingRecordFromNote(note, "dry-run");
    const knowledge = options.knowledge ?? (await extractMeetingKnowledge(note));
    const announcement = formatMeetingAnnouncement(note);
    return {
      duplicate: false,
      dryRun: true,
      announcement,
      record,
      knowledge,
      route,
    };
  }

  const knowledge = options.knowledge ?? (await extractMeetingKnowledge(note));
  const publishMode = options.bypassApproval ? "auto" : route.publishMode;
  if (publishMode !== "auto") {
    return holdForApproval(payload, note, route, knowledge);
  }
  return publishMeeting(note, route, knowledge);
}

/**
 * The synchronous subset of processGranolaZapierPayload: handles a note only
 * if it would be held for approval (or is a published duplicate), touching
 * SQLite alone. Returns undefined when the note must be auto-published, or
 * when PERRY_EXTRACTION_MODE needs a model call, so the caller falls back to
 * the async workflow. Lets drains batch approval jobs into one transaction.
 */
export function tryProcessGranolaApprovalPayloadSync(
  payload: unknown,
  options: { force?: boolean; bypassApproval?: boolean; settings?: AppSettings } = {}
): MeetingWorkflowResult | undefined {
  if (options.bypassApproval || getExtractionMode() !== "rules") return undefined;

  const note = normalizeGranolaZapierPayload(payload);
  const settings = options.settings ?? loadAppSettings();
  const route = resolveMeetingRoute(note, settings);
  if (route.publishMode === "auto") return undefined;

  const duplicate = options.force ? undefined : findMeetingRecord(note);
  if (duplicate && duplicate.status === "processed") {
    return duplicateResult(note, route, duplicate);
  }
  return holdForApproval(payload, note, route, extractRulesKnowledge(note));
}

/**
 * Shows what the workflow would do with a payload, writing nothing. Runs the
 * configured extraction (a model call in llm/hybrid mode), so the preview shows
 * exactly what would be held or published. `duplicate` is true if the meeting
 * exists in any status.
 */
export async function previewGranolaZapierPayload(payload: unknown): Promise<MeetingWorkflowResult> {
  const note = normalizeGranolaZapierPayload(payload);
  const route = resolveMeetingRoute(note, loadAppSettings());
  const record = meetingRecordFromNote(note, "dry-run");
  const knowledge = await extractMeetingKnowledge(note);
  return {
    duplicate: Boolean(findMeetingRecord(note)),
    dryRun: true,
    announcement: formatMeetingAnnouncement(note),
    record,
    knowledge,
    route,
  };
}

function duplicateResult(note: MeetingNote, route: MeetingRoute, duplicate: MeetingRecord): MeetingWorkflowResult {
  return {
    duplicate: true,
    dryRun: false,
    announcement: formatMeetingAnnouncement(note, duplicate.notionUrl),
    record: duplicate,
    // Rules only: a duplicate publishes nothing, so it is not worth a model call.
    knowledge: extractRulesKnowledge(note),
    route,
    notionPageId: duplicate.notionPageId,
    notionUrl: duplicate.notionUrl,
    discordMessageUrl: duplicate.discordMessageUrl,
  };
}

/**
 * Stores the meeting as `pending_approval`, its knowledge, and the approval,
 * in one transaction. A meeting that is already published (reached only under
 * `force`) stays `processed`; one that is part-way through publishing keeps the
 * steps it finished, so approving it later resumes. A `rejected` or `posted`
 * approval keeps its status (see createApproval), and the result carries it.
 */
function holdForApproval(
  payload: unknown,
  note: MeetingNote,
  route: MeetingRoute,
  knowledge: ExtractedKnowledge
): MeetingWorkflowResult {
  return withBrainTransaction(() => {
    const fresh = meetingRecordFromNote(note, "pending_approval");
    const existing = getMeetingRecord(fresh.id);
    const held =
      existing?.status === "processed"
        ? { ...existing, title: fresh.title, updatedAt: fresh.updatedAt }
        : withPublishProgress(fresh, existing);
    const record = upsertMeetingRecord(held);
    replaceMeetingKnowledge(record.id, knowledge);
    const approval = createApproval({
      id: `approval:${record.id}`,
      meetingId: record.id,
      title: record.title,
      payloadJson: JSON.stringify(payload),
      announcement: formatMeetingAnnouncement(note),
      knowledgeJson: JSON.stringify(knowledge),
      routeJson: JSON.stringify(route),
      routeProject: route.project,
      routeReason: route.reason,
      publishMode: route.publishMode,
      decisionCount: knowledge.decisions.length,
      actionItemCount: knowledge.actionItems.length,
      status: "pending",
    });
    return {
      duplicate: false,
      dryRun: false,
      announcement: approval.announcement,
      record,
      knowledge,
      route,
      approval,
    };
  });
}

/**
 * The auto path, one resumable step at a time (see the header). A meeting that
 * is not yet `processed` resumes from its stored progress; a `processed` one
 * (reached only under `force`) is published afresh and left untouched until
 * its new Notion page exists.
 */
async function publishMeeting(
  note: MeetingNote,
  route: MeetingRoute,
  knowledge: ExtractedKnowledge
): Promise<MeetingWorkflowResult> {
  const existing = getMeetingRecord(meetingIdForNote(note));
  const fresh = meetingRecordFromNote(note, "publishing");
  let record: MeetingRecord = existing?.status === "processed" ? fresh : withPublishProgress(fresh, existing);
  if (existing?.status !== "processed") record = upsertMeetingRecord(record);

  if (!record.notionPageId) {
    const page = await createMeetingNotePage(note, { dataSourceId: route.notionDataSourceId });
    // No page (Notion not configured) leaves nothing to save or to duplicate.
    if (page) record = savePublishProgress({ ...record, notionPageId: page.id, notionUrl: page.url });
  }

  const announcement = formatMeetingAnnouncement(note, record.notionUrl);
  if (!record.discordMessageUrl) {
    const discordMessageUrl = route.discordChannelId
      ? await sendToChannel(route.discordChannelId, announcement)
      : await sendToMeetingChannel(announcement);
    record = savePublishProgress({ ...record, discordMessageUrl });
  }

  const published = record;
  const saved = withBrainTransaction(() => {
    const processed = upsertMeetingRecord({
      ...published,
      status: "processed",
      error: undefined,
      updatedAt: new Date().toISOString(),
    });
    replaceMeetingKnowledge(processed.id, knowledge);
    enqueueMeetingGraphSync({
      note,
      record: processed,
      knowledge,
      route,
      notionUrl: processed.notionUrl,
      discordMessageUrl: processed.discordMessageUrl,
    });
    return processed;
  });

  return {
    duplicate: false,
    dryRun: false,
    announcement,
    record: saved,
    knowledge,
    route,
    notionPageId: saved.notionPageId,
    notionUrl: saved.notionUrl,
    discordMessageUrl: saved.discordMessageUrl,
  };
}

// Carries the publish steps an unfinished meeting already completed onto a
// freshly built record (the error of a `failed` attempt is dropped).
function withPublishProgress(fresh: MeetingRecord, existing: MeetingRecord | undefined): MeetingRecord {
  if (!existing) return fresh;
  return {
    ...fresh,
    notionPageId: existing.notionPageId,
    notionUrl: existing.notionUrl,
    discordMessageUrl: existing.discordMessageUrl,
  };
}

function savePublishProgress(record: MeetingRecord): MeetingRecord {
  return upsertMeetingRecord({ ...record, status: "publishing", updatedAt: new Date().toISOString() });
}

/**
 * A rejected approve/reject request. `status` is surfaced to API clients by the
 * admin server's error boundary: 404 for an unknown id, 409 when the approval is
 * no longer pending.
 */
export class ApprovalActionError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string
  ) {
    super(message);
    this.name = "ApprovalActionError";
  }
}

/**
 * Publishes a pending approval: marks it `approved`, re-runs the stored
 * payload with `force` and `bypassApproval`, then marks it `posted`. It
 * publishes the knowledge stored with the approval, the result the reviewer
 * saw, rather than extracting again (a model could answer differently). Throws
 * ApprovalActionError if the approval is missing (404) or not pending (409).
 * If publishing throws, the approval returns to `pending` so it can be
 * retried; the meeting keeps the steps already finished, so approving again
 * resumes instead of creating a second Notion page or Discord post.
 */
export async function approvePendingMeeting(approvalId: string): Promise<MeetingWorkflowResult> {
  const approval = getApproval(approvalId);
  if (!approval) {
    throw new ApprovalActionError(404, `Approval ${approvalId} not found`);
  }
  if (approval.status !== "pending") {
    throw new ApprovalActionError(409, `Approval ${approvalId} is ${approval.status}`);
  }
  updateApprovalStatus(approvalId, "approved");
  let result: MeetingWorkflowResult;
  try {
    result = await processGranolaZapierPayload(JSON.parse(approval.payloadJson), {
      force: true,
      bypassApproval: true,
      knowledge: storedKnowledge(approval.knowledgeJson),
    });
  } catch (error) {
    updateApprovalStatus(approvalId, "pending");
    throw error;
  }
  updateApprovalStatus(approvalId, "posted");
  return result;
}

/** Marks an approval `rejected`, from any status; throws if it does not exist. The meeting record is left as is. */
export function rejectPendingMeeting(approvalId: string): ApprovalRecord {
  const updated = updateApprovalStatus(approvalId, "rejected");
  if (!updated) {
    throw new ApprovalActionError(404, `Approval ${approvalId} not found`);
  }
  return updated;
}

/** The approval's reviewed knowledge, or undefined (extract again) for rows that predate it or are unreadable. */
function storedKnowledge(json: string): ExtractedKnowledge | undefined {
  try {
    const parsed = JSON.parse(json) as Partial<ExtractedKnowledge> | null;
    return parsed && Array.isArray(parsed.decisions) && Array.isArray(parsed.actionItems) ? (parsed as ExtractedKnowledge) : undefined;
  } catch {
    return undefined;
  }
}
