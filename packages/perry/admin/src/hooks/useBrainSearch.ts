// hooks/useBrainSearch — query and results for Brain Search.
import { useState } from "react";
import { searchBrain as searchBrainApi } from "../api/brain";
import { orReportError } from "../api/client";
import { reportErrors } from "../lib/errors";
import type { BrainSearchResult } from "../types";
import type { HookDeps } from "./types";

/** A blank query clears results without a request; any failure is reported via `setError`, never rejected. */
export function useBrainSearch({ setError }: Pick<HookDeps, "setError">) {
  const [brainQuery, setBrainQuery] = useState("");
  const [brainResults, setBrainResults] = useState<BrainSearchResult[]>([]);

  function searchBrain() {
    return reportErrors(
      async () => {
        if (!brainQuery.trim()) {
          setBrainResults([]);
          return;
        }
        const results = await orReportError(searchBrainApi(brainQuery), setError);
        if (results) setBrainResults(results);
      },
      setError,
      "Brain search failed"
    );
  }

  return { brainQuery, setBrainQuery, brainResults, searchBrain };
}

export type BrainSearchState = ReturnType<typeof useBrainSearch>;
