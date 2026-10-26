// api/granola — the Granola test bench: fetch a sample webhook payload, preview it, or dry-run it.
import type { PreviewResult } from "../types";
import { getJson, requestJson } from "./client";

/** A canned Zapier/Granola payload that seeds the test bench editor. */
export function fetchGranolaSample(label = "Sample load"): Promise<unknown> {
  return getJson<unknown>("/api/granola/sample", label);
}

/** The payload is sent verbatim: it is the raw text from the test bench editor. */
export function previewGranola(rawPayload: string): Promise<PreviewResult> {
  return requestJson("/api/granola/preview", "Preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawPayload,
  });
}

/**
 * POST to the real webhook route with `dryRun=true`. That route authenticates with the
 * Granola webhook token (`x-perry-webhook-token`), not the admin token, so it is sent
 * only when one was entered. The server rejects dry runs when webhooks run in queue mode.
 */
export function dryRunGranola(rawPayload: string, webhookToken: string): Promise<PreviewResult> {
  return requestJson("/api/granola/zapier?dryRun=true", "Dry run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(webhookToken ? { "x-perry-webhook-token": webhookToken } : {}),
    },
    body: rawPayload,
  });
}
