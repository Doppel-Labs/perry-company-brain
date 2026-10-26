// api/config — read and save the Perry settings file, and read the readiness diagnostics.
import type { AppSettings, ConfigResponse, Diagnostics } from "../types";
import { getJson, sendJson } from "./client";

/** Settings plus which secrets are set (booleans only), graph-memory status, and the config file path. */
export function fetchConfig(label = "Config load"): Promise<ConfigResponse> {
  return getJson<ConfigResponse>("/api/config", label);
}

/** Server write: validates and replaces the saved settings, returning what was saved. Throws `ApiError`. */
export function saveConfig(settings: AppSettings): Promise<Pick<ConfigResponse, "settings" | "configPath">> {
  return sendJson("/api/config", "PUT", "Save", { settings });
}

/** The readiness checklist shown in the Readiness panel. Throws `ApiError`. */
export function fetchDiagnostics(label = "Diagnostics load"): Promise<Diagnostics> {
  return getJson<Diagnostics>("/api/diagnostics", label);
}
