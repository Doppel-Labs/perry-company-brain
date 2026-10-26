// components/GranolaTestBench — edit a Granola webhook payload and either Preview it
// (no side effects) or Dry Run it through the webhook route with the webhook token.
// The result shows what would be published: the announcement, the extracted
// decisions and action items, and how they were extracted (rules or a model,
// including any fallback), so a reviewer can judge the extraction itself.
import { FileText, Loader2, Send, Webhook } from "lucide-react";
import type { GranolaTestBenchState } from "../hooks/useGranolaTestBench";
import type { ExtractionProvenance, PreviewKnowledge } from "../types";
import { SectionTitle } from "./shared";

export function GranolaTestBench({ bench }: { bench: GranolaTestBenchState }) {
  const { preview, previewStatus } = bench;
  return (
    <div className="panel testbench-panel">
      <SectionTitle icon={<Send size={19} />} title="Granola Test Bench" />
      <input
        aria-label="Granola webhook token"
        placeholder="Webhook token"
        type="password"
        value={bench.webhookToken}
        onChange={(event) => bench.setWebhookToken(event.target.value)}
      />
      <textarea
        aria-label="Granola sample payload"
        value={bench.samplePayload}
        onChange={(event) => bench.setSamplePayload(event.target.value)}
      />
      <div className="button-row">
        <button className="secondary" onClick={bench.previewSample} disabled={previewStatus !== "idle"}>
          {previewStatus === "loading" ? <Loader2 className="spin" size={17} /> : <FileText size={17} />}
          <span>Preview</span>
        </button>
        <button className="secondary" onClick={bench.dryRunSample} disabled={previewStatus !== "idle"}>
          {previewStatus === "posting" ? <Loader2 className="spin" size={17} /> : <Webhook size={17} />}
          <span>Dry Run</span>
        </button>
      </div>
      {preview ? (
        <div className="preview">
          <div className="preview-meta">
            <span>{preview.duplicate ? "Duplicate" : "New note"}</span>
            <span>{preview.dryRun ? "Dry run" : "Live"}</span>
          </div>
          <pre>{preview.announcement}</pre>
          {preview.knowledge ? <ExtractedKnowledge knowledge={preview.knowledge} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function ExtractedKnowledge({ knowledge }: { knowledge: PreviewKnowledge }) {
  return (
    <div className="preview-knowledge">
      {knowledge.extraction ? <p className="preview-extraction">{describeExtraction(knowledge.extraction)}</p> : null}
      <strong>Decisions ({knowledge.decisions.length})</strong>
      <ul>
        {knowledge.decisions.map((decision, index) => (
          <li key={index}>{decision.text}</li>
        ))}
      </ul>
      <strong>Action items ({knowledge.actionItems.length})</strong>
      <ul>
        {knowledge.actionItems.map((action, index) => (
          <li key={index}>
            {action.owner ? `${action.owner}: ` : ""}
            {action.text}
            {action.dueDate ? ` (due ${action.dueDate})` : ""}
          </li>
        ))}
      </ul>
      {knowledge.entities?.length ? (
        <p className="preview-extraction">Entities: {knowledge.entities.map((entity) => `${entity.name} (${entity.type})`).join(", ")}</p>
      ) : null}
    </div>
  );
}

/** One line: "Hybrid via lmstudio (model), confidence 0.82, 1 ungrounded item dropped" or the fallback reason. */
function describeExtraction(extraction: ExtractionProvenance): string {
  if (extraction.fallbackReason) return `Rules fallback (${extraction.requestedMode} requested): ${extraction.fallbackReason}`;
  if (extraction.method === "rules") return "Rules-based extraction";
  const parts = [`${extraction.method === "llm" ? "LLM" : "Hybrid"} via ${extraction.backend ?? "model"}${extraction.model ? ` (${extraction.model})` : ""}`];
  if (extraction.confidence !== undefined) parts.push(`confidence ${extraction.confidence.toFixed(2)}`);
  if (extraction.droppedUngrounded) parts.push(`${extraction.droppedUngrounded} ungrounded item${extraction.droppedUngrounded === 1 ? "" : "s"} dropped`);
  return parts.join(", ");
}
