import type { IncomingMessage } from "node:http";

// Meeting/webhook JSON is bounded before buffering, including chunked requests.
export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

function bodyError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const length = req.headers["content-length"];
  if (length !== undefined) {
    if (!/^\d+$/u.test(length)) throw bodyError(400, "Invalid Content-Length");
    if (Number(length) > MAX_JSON_BODY_BYTES) throw bodyError(413, "JSON body exceeds 2 MiB");
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  // Keep the socket alive long enough for the server to return an HTTP 413.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_JSON_BODY_BYTES) throw bodyError(413, "JSON body exceeds 2 MiB");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks, bytes).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw bodyError(400, "Invalid JSON body");
  }
}
