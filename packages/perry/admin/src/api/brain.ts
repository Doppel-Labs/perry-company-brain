// api/brain — search over the company brain (meetings, decisions, action items).
import type { BrainSearchResult } from "../types";
import { getJson } from "./client";

/** Top 10 hits for `query`. Throws `ApiError` on a non-OK response. */
export async function searchBrain(query: string): Promise<BrainSearchResult[]> {
  const path = `/api/brain/search?q=${encodeURIComponent(query)}&limit=10`;
  return (await getJson<{ results: BrainSearchResult[] }>(path, "Brain search")).results;
}
