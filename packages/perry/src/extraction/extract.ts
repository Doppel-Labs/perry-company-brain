// extraction/extract — selects the LLM backend for semantic extraction.
//
// There is no fallback between backends: whichever is selected either returns
// a validated extraction or throws. The deterministic extractKnowledge parser
// (knowledge.ts) is separate and does not depend on any LLM.
import type { MeetingNote } from "@meetings";
import { extractMeetingSemanticsWithLmStudio, getLmStudioExtractionConfig } from "./lm-studio";
import { extractMeetingSemanticsWithTogether, getTogetherExtractionConfig } from "./together";
import type { LocalSemanticExtraction } from "./semantic";

export type ExtractionBackend = "lmstudio" | "together";

/** Reads PERRY_EXTRACTION_BACKEND: "together" (case-insensitive) selects Together.ai; anything else, or unset, selects LM Studio. */
export function getExtractionBackend(env: NodeJS.ProcessEnv = process.env): ExtractionBackend {
  return (env.PERRY_EXTRACTION_BACKEND ?? "lmstudio").trim().toLowerCase() === "together"
    ? "together"
    : "lmstudio";
}

/**
 * Backend-agnostic semantic extraction. Routes to Together.ai (via the AI SDK)
 * or a local LM Studio / OpenAI-compatible endpoint based on
 * PERRY_EXTRACTION_BACKEND, so callers never hard-code a provider. `env` both
 * chooses the backend and supplies that backend's settings (keys, model,
 * limits). Throws whatever the chosen backend throws.
 */
export async function extractMeetingSemantics(
  note: MeetingNote,
  env: NodeJS.ProcessEnv = process.env
): Promise<LocalSemanticExtraction> {
  return getExtractionBackend(env) === "together"
    ? extractMeetingSemanticsWithTogether(note, getTogetherExtractionConfig(env))
    : extractMeetingSemanticsWithLmStudio(note, getLmStudioExtractionConfig(env));
}
