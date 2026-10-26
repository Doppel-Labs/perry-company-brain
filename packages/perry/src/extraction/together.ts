// extraction/together — semantic extraction on Together.ai via the Vercel AI SDK.
import { generateText } from "ai";
import { createTogetherAI } from "@ai-sdk/togetherai";
import type { MeetingNote } from "@meetings";
import {
  buildExtractionPrompt,
  numberSetting,
  parseLocalSemanticExtraction,
  SEMANTIC_EXTRACTION_SYSTEM_PROMPT,
  type LocalSemanticExtraction,
} from "./semantic";

/** API key, model, and limits for a Together.ai extraction call. */
export interface TogetherExtractionConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxContextChars: number;
  temperature: number;
}

/**
 * Reads TOGETHER_API_KEY (or TOGETHER_AI_API_KEY) and PERRY_TOGETHER_EXTRACTION_*
 * env vars. Defaults: Llama-3.3-70B-Instruct-Turbo, 60s timeout (min 1s),
 * 24,000 context chars (min 2,000), temperature 0. A missing key yields ""
 * rather than throwing.
 */
export function getTogetherExtractionConfig(env: NodeJS.ProcessEnv = process.env): TogetherExtractionConfig {
  return {
    apiKey: env.TOGETHER_API_KEY ?? env.TOGETHER_AI_API_KEY ?? "",
    model: env.PERRY_TOGETHER_EXTRACTION_MODEL ?? "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    timeoutMs: numberSetting(env.PERRY_TOGETHER_EXTRACTION_TIMEOUT_MS, 60_000, 1_000),
    maxContextChars: numberSetting(env.PERRY_TOGETHER_EXTRACTION_CONTEXT_CHARS, 24_000, 2_000),
    temperature: numberSetting(env.PERRY_TOGETHER_EXTRACTION_TEMPERATURE, 0, 0),
  };
}

// Exact JSON shape we ask the model for. We use generateText + JSON-mode prompt
// rather than generateObject because Together's open-weight chat models (e.g.
// Llama 3.3) don't advertise json_schema structured outputs, so generateObject's
// responseFormat is silently dropped. The response is still validated against the
// shared zod schema via parseLocalSemanticExtraction — same contract, any model.
const JSON_OUTPUT_INSTRUCTION = [
  "Respond with a single JSON object and nothing else — no prose, no markdown code fences.",
  "It must match exactly this shape:",
  '{"decisions":[{"text":"..."}],',
  ' "actionItems":[{"text":"...","owner":"...(optional)","dueDate":"...(optional)"}],',
  ' "entities":[{"type":"person|project|repository|customer|policy|channel|data_source","name":"...","stableKey":"...(optional)"}],',
  ' "confidence":0.0}',
].join("\n");

/**
 * Extracts company-brain objects from a meeting note using Together.ai through
 * the Vercel AI SDK. The model is constrained to JSON via the prompt, then the
 * response is parsed + validated against the shared LocalSemanticExtraction schema.
 * Makes a network call to Together.ai, aborted after `timeoutMs`. Throws when
 * no API key is configured, on timeout or API errors, or when the reply fails
 * validation.
 */
export async function extractMeetingSemanticsWithTogether(
  note: MeetingNote,
  config: TogetherExtractionConfig = getTogetherExtractionConfig()
): Promise<LocalSemanticExtraction> {
  if (!config.apiKey) {
    throw new Error("Together extraction requires TOGETHER_API_KEY to be set");
  }
  const togetherai = createTogetherAI({ apiKey: config.apiKey });
  const { text } = await generateText({
    model: togetherai(config.model),
    system: `${SEMANTIC_EXTRACTION_SYSTEM_PROMPT}\n\n${JSON_OUTPUT_INSTRUCTION}`,
    prompt: buildExtractionPrompt(note, config.maxContextChars),
    temperature: config.temperature,
    abortSignal: AbortSignal.timeout(config.timeoutMs),
  });
  return parseLocalSemanticExtraction(text);
}
