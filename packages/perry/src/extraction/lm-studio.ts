// extraction/lm-studio — semantic extraction against a local LM Studio (or any
// OpenAI-compatible) chat-completions endpoint.
//
// The request carries a json_schema response_format mirroring
// LocalSemanticExtractionSchema so servers that support structured output
// constrain the model; the reply is still validated by the shared zod schema.
// Connection settings fall back to the GRAPHITI_OPENAI_* / GRAPHITI_LLM_MODEL
// vars so one local model can serve both Graphiti and extraction.
import type { MeetingNote } from "@meetings";
import {
  buildExtractionPrompt,
  numberSetting,
  parseLocalSemanticExtraction,
  SEMANTIC_EXTRACTION_SYSTEM_PROMPT,
  type LocalSemanticExtraction,
} from "./semantic";

function localSemanticExtractionResponseFormat(): object {
  return {
    type: "json_schema",
    json_schema: {
      name: "perry_local_semantic_extraction",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          decisions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
          actionItems: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                owner: { type: "string" },
                dueDate: { type: "string" },
              },
              required: ["text"],
            },
          },
          entities: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string", enum: ["person", "project", "repository", "customer", "policy", "channel", "data_source"] },
                name: { type: "string" },
                stableKey: { type: "string" },
              },
              required: ["type", "name"],
            },
          },
          confidence: { type: "number" },
        },
        required: ["decisions", "actionItems", "entities", "confidence"],
      },
    },
  };
}

/** Endpoint, model, and limits for an LM Studio extraction call. */
export interface LmStudioExtractionConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxContextChars: number;
  temperature: number;
}

/**
 * Reads LMSTUDIO_* / PERRY_LMSTUDIO_EXTRACTION_* env vars. Defaults: base URL
 * http://127.0.0.1:1234/v1, model "local-model", 30s timeout (min 1s), 24,000
 * context chars (min 2,000), temperature 0.
 */
export function getLmStudioExtractionConfig(env: NodeJS.ProcessEnv = process.env): LmStudioExtractionConfig {
  return {
    baseUrl: (env.LMSTUDIO_BASE_URL ?? env.GRAPHITI_OPENAI_BASE_URL ?? "http://127.0.0.1:1234/v1").replace(/\/+$/u, ""),
    apiKey: env.LMSTUDIO_API_KEY ?? env.GRAPHITI_OPENAI_API_KEY ?? "lm-studio",
    model: env.PERRY_LMSTUDIO_EXTRACTION_MODEL ?? env.GRAPHITI_LLM_MODEL ?? "local-model",
    timeoutMs: numberSetting(env.PERRY_LMSTUDIO_EXTRACTION_TIMEOUT_MS, 30_000, 1_000),
    maxContextChars: numberSetting(env.PERRY_LMSTUDIO_EXTRACTION_CONTEXT_CHARS, 24_000, 2_000),
    temperature: numberSetting(env.PERRY_LMSTUDIO_EXTRACTION_TEMPERATURE, 0, 0),
  };
}

/**
 * POSTs the note to `{baseUrl}/chat/completions` and returns the validated
 * extraction. Throws on timeout (aborted fetch), a non-2xx status, an empty
 * reply, unparseable JSON, or a schema violation.
 */
export async function extractMeetingSemanticsWithLmStudio(
  note: MeetingNote,
  config: LmStudioExtractionConfig = getLmStudioExtractionConfig()
): Promise<LocalSemanticExtraction> {
  const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, config.timeoutMs, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      response_format: localSemanticExtractionResponseFormat(),
      messages: [
        { role: "system", content: SEMANTIC_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: buildExtractionPrompt(note, config.maxContextChars) },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`LM Studio extraction failed: ${response.status} ${text}`);
  const payload = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("LM Studio extraction failed: empty response content");
  return parseLocalSemanticExtraction(content);
}

// Network failures name the endpoint and timeout: fetch's own "fetch failed" or
// "This operation was aborted" ends up in the extraction fallback reason, where
// an operator needs to know which server to check.
async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const reason = controller.signal.aborted ? `timed out after ${timeoutMs}ms` : error instanceof Error ? error.message : String(error);
    throw new Error(`LM Studio unreachable at ${url}: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}
