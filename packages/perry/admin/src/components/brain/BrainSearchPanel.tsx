// components/brain/BrainSearchPanel — keyword search over meetings, decisions, and
// action items; runs on Enter or the Search button.
import { FileText, RefreshCw } from "lucide-react";
import type { BrainSearchState } from "../../hooks/useBrainSearch";
import { SectionTitle } from "../shared";

export function BrainSearchPanel({ brain }: { brain: BrainSearchState }) {
  const { brainResults } = brain;
  return (
    <div className="panel">
      <div className="panel-head">
        <SectionTitle icon={<FileText size={19} />} title="Brain Search" />
      </div>
      <div className="search-row">
        <input
          aria-label="Search company brain"
          placeholder="Search decisions, action items, or meetings"
          value={brain.brainQuery}
          onChange={(event) => brain.setBrainQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void brain.searchBrain();
          }}
        />
        <button className="secondary" onClick={brain.searchBrain}>
          <RefreshCw size={17} />
          <span>Search</span>
        </button>
      </div>
      <div className="brain-results">
        {brainResults.length === 0 ? (
          <div className="empty">Search results will appear here.</div>
        ) : (
          brainResults.map((result) => (
            <div className="brain-result" key={`${result.type}-${result.id}`}>
              <span className={`pill ${result.type}`}>{result.type}</span>
              <div>
                <strong>{result.title}</strong>
                <p>{result.snippet}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
