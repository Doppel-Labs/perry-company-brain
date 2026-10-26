// hooks/useGranolaTestBench — the test bench editor text, webhook token, and last
// preview result. Calls `previewGranola` and `dryRunGranola`.
import { useState } from "react";
import { dryRunGranola, previewGranola } from "../api/granola";
import { errorMessage } from "../lib/errors";
import type { PreviewResult } from "../types";
import type { HookDeps } from "./types";

/**
 * Both actions report any failure via `setError`. Only the dry run refreshes the
 * operational data afterwards, because it goes through the real ingestion route.
 */
export function useGranolaTestBench({ setError, refresh }: HookDeps) {
  const [webhookToken, setWebhookToken] = useState("");
  const [samplePayload, setSamplePayload] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "posting">("idle");

  async function previewSample() {
    setPreviewStatus("loading");
    setError("");
    try {
      setPreview(await previewGranola(samplePayload));
    } catch (err) {
      setError(errorMessage(err, "Preview failed"));
    } finally {
      setPreviewStatus("idle");
    }
  }

  async function dryRunSample() {
    setPreviewStatus("posting");
    setError("");
    try {
      setPreview(await dryRunGranola(samplePayload, webhookToken));
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Dry run failed"));
    } finally {
      setPreviewStatus("idle");
    }
  }

  return {
    webhookToken,
    setWebhookToken,
    samplePayload,
    setSamplePayload,
    preview,
    previewStatus,
    previewSample,
    dryRunSample,
  };
}

export type GranolaTestBenchState = ReturnType<typeof useGranolaTestBench>;
