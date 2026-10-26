import assert from "node:assert/strict";
import test from "node:test";
import {
  extractJsonObject,
  extractMeetingSemantics,
  extractMeetingSemanticsWithTogether,
  getTogetherExtractionConfig,
  parseLocalSemanticExtraction,
} from "@extraction";
import { normalizeGranolaZapierPayload, sampleGranolaZapierPayload } from "@meetings";

const note = normalizeGranolaZapierPayload(sampleGranolaZapierPayload);

test("extractJsonObject skips braces in surrounding prose", () => {
  const object = '{"decisions":[{"text":"Ship it"}],"actionItems":[],"entities":[],"confidence":0.9}';
  assert.equal(extractJsonObject(`Here is the {result} you asked for:\n${object}\nHope that {helps}!`), object);
  assert.equal(extractJsonObject(`  ${object}  `), object);
  assert.equal(parseLocalSemanticExtraction(`Sure {ok}. ${object} (done)`).decisions[0].text, "Ship it");
});

test("extractJsonObject ignores braces and escaped quotes inside strings", () => {
  const object = String.raw`{"decisions":[{"text":"Use {curly} \"quoted\" braces } here"}],"confidence":0.4}`;
  assert.equal(extractJsonObject(`Result: ${object} trailing } brace`), object);
  assert.equal(parseLocalSemanticExtraction(object).decisions[0].text, 'Use {curly} "quoted" braces } here');
});

test("extractJsonObject picks the first parseable object and rejects responses without one", () => {
  assert.equal(extractJsonObject('{not json} then {"confidence":0.1} then {"confidence":0.2}'), '{"confidence":0.1}');
  assert.throws(() => extractJsonObject("no json here {unbalanced"), /did not contain a JSON object/u);
  assert.throws(() => extractJsonObject("{just prose}"), /did not contain a JSON object/u);
});

test("extractMeetingSemantics reads backend settings from the env it is given", async () => {
  const previousBaseUrl = process.env.LMSTUDIO_BASE_URL;
  const previousFetch = globalThis.fetch;
  process.env.LMSTUDIO_BASE_URL = "http://process-env.invalid/v1";
  const calls: Array<{ url: string; body: { model: string } }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const content = JSON.stringify({ decisions: [], actionItems: [], entities: [], confidence: 0.5 });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    await extractMeetingSemantics(note, {
      PERRY_EXTRACTION_BACKEND: "lmstudio",
      LMSTUDIO_BASE_URL: "http://threaded-env.test/v1",
      PERRY_LMSTUDIO_EXTRACTION_MODEL: "threaded-model",
    } as NodeJS.ProcessEnv);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://threaded-env.test/v1/chat/completions");
    assert.equal(calls[0].body.model, "threaded-model");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBaseUrl === undefined) delete process.env.LMSTUDIO_BASE_URL;
    else process.env.LMSTUDIO_BASE_URL = previousBaseUrl;
  }
});

test("extractMeetingSemantics does not fall back to process.env for the Together key", async () => {
  const previousKey = process.env.TOGETHER_API_KEY;
  process.env.TOGETHER_API_KEY = "process-env-key";
  try {
    await assert.rejects(
      () => extractMeetingSemantics(note, { PERRY_EXTRACTION_BACKEND: "together" } as NodeJS.ProcessEnv),
      /TOGETHER_API_KEY/u
    );
  } finally {
    if (previousKey === undefined) delete process.env.TOGETHER_API_KEY;
    else process.env.TOGETHER_API_KEY = previousKey;
  }
});

test("Together extraction timeout comes from PERRY_TOGETHER_EXTRACTION_TIMEOUT_MS", () => {
  assert.equal(getTogetherExtractionConfig({} as NodeJS.ProcessEnv).timeoutMs, 60_000);
  assert.equal(getTogetherExtractionConfig({ PERRY_TOGETHER_EXTRACTION_TIMEOUT_MS: "5000" } as NodeJS.ProcessEnv).timeoutMs, 5_000);
  assert.equal(getTogetherExtractionConfig({ PERRY_TOGETHER_EXTRACTION_TIMEOUT_MS: "10" } as NodeJS.ProcessEnv).timeoutMs, 1_000);
  assert.equal(getTogetherExtractionConfig({ PERRY_TOGETHER_EXTRACTION_TIMEOUT_MS: "soon" } as NodeJS.ProcessEnv).timeoutMs, 60_000);
});

test("Together extraction aborts a request that outlives the timeout", async () => {
  const previousFetch = globalThis.fetch;
  let sawSignal = false;
  // Never answers; only settles when the request is aborted.
  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      sawSignal = Boolean(init?.signal);
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
    })) as typeof fetch;
  const started = Date.now();
  try {
    await assert.rejects(() =>
      extractMeetingSemanticsWithTogether(note, {
        apiKey: "test-key",
        model: "test-model",
        timeoutMs: 1_000,
        maxContextChars: 24_000,
        temperature: 0,
      })
    );
    assert.equal(sawSignal, true);
    assert.ok(Date.now() - started < 10_000, "the request should be aborted near the timeout");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
