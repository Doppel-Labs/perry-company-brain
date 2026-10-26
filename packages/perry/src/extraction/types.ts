// extraction/types — shapes shared by the rules parser and the LLM pipeline.

export type ExtractionMode = "rules" | "llm" | "hybrid";

/** An entity the LLM named and that appears verbatim in the note. */
export interface ExtractedEntity {
  type: "person" | "project" | "repository" | "customer" | "policy" | "channel" | "data_source";
  name: string;
}

/** How a knowledge result was produced; stored with approvals and shown in the admin preview. */
export interface ExtractionProvenance {
  /** What actually produced the items. */
  method: ExtractionMode;
  /** What PERRY_EXTRACTION_MODE asked for; differs from `method` after a fallback. */
  requestedMode: ExtractionMode;
  backend?: string;
  model?: string;
  confidence?: number;
  durationMs?: number;
  /** Model items discarded because they were not grounded in the note. */
  droppedUngrounded?: number;
  /** Why the LLM result was not used, when requestedMode is not "rules" but method is. */
  fallbackReason?: string;
}
