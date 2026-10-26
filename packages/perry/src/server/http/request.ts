// http/request — bounded body parsing and typed query-string access.
import type { IncomingMessage } from "node:http";
import { badRequest, httpError } from "./errors";

/** Upper bound on a JSON request body (PERRY_MAX_BODY_BYTES, default 2 MiB); larger bodies are rejected with 413. */
export const maxJsonBodyBytes = positiveInt(process.env.PERRY_MAX_BODY_BYTES, 2 * 1024 * 1024);

/** Hard ceiling for any numeric limit a client can request. */
const defaultMaxLimit = 10_000;
const maxPageLimit = 1000;

/**
 * Reads and parses the body; an empty body is `{}`. A Content-Length over the
 * limit is rejected before any byte is read, and streamed bytes are counted
 * too, so chunked or understated bodies cannot exceed it. Throws 413 past
 * maxJsonBodyBytes and 400 on an invalid Content-Length or invalid JSON.
 */
export async function readJson(req: IncomingMessage): Promise<unknown> {
  const length = req.headers["content-length"];
  if (length !== undefined) {
    if (!/^\d+$/u.test(length)) throw badRequest("Invalid Content-Length.");
    if (Number(length) > maxJsonBodyBytes) throw httpError(413, "Request body too large.");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  // destroyOnReturn: false keeps the socket open so the client receives the 413
  // (the error boundary then closes the connection) instead of a reset.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxJsonBodyBytes) throw httpError(413, "Request body too large.");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks, size).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest("Request body is not valid JSON.");
  }
}

/** Typed, clamped reads of URL query parameters. */
export class Query {
  constructor(private readonly params: URLSearchParams) {}

  string(name: string): string | undefined {
    return this.params.get(name) ?? undefined;
  }

  /** A non-blank string, or 400. */
  required(name: string): string {
    const value = this.params.get(name)?.trim();
    if (!value) throw badRequest(`Missing required ${name} parameter.`);
    return value;
  }

  /** An integer clamped to [min, max]; missing or non-numeric values use the fallback. */
  int(name: string, fallback: number, { min = 0, max = defaultMaxLimit }: { min?: number; max?: number } = {}): number {
    const raw = this.params.get(name);
    const value = raw === null || raw.trim() === "" ? fallback : Math.trunc(Number(raw));
    return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
  }

  optionalInt(name: string, options?: { min?: number; max?: number }): number | undefined {
    return this.params.has(name) ? this.int(name, Number.NaN, options) || undefined : undefined;
  }

  flag(name: string): boolean {
    return this.params.get(name) === "true";
  }

  /** true/false when present, undefined when absent. */
  optionalFlag(name: string): boolean | undefined {
    const raw = this.params.get(name);
    return raw === null ? undefined : raw === "true";
  }

  parse<T>(name: string, parser: (value: string | null) => T): T {
    return parser(this.params.get(name));
  }

  page(fallbackLimit = 100): { limit: number; offset: number } {
    return {
      limit: this.int("limit", fallbackLimit, { max: maxPageLimit }),
      offset: this.int("offset", 0, { max: Number.MAX_SAFE_INTEGER }),
    };
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Math.trunc(Number(raw));
  return raw?.trim() && Number.isFinite(value) && value > 0 ? value : fallback;
}
