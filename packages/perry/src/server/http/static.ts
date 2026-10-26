// http/static — serves the built admin SPA, confined to admin/dist.
import { existsSync, readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { securityHeaders, sendJson } from "./response";

/** Resolved from the working directory, so the server must be started from the package root. */
export const staticRoot = join(process.cwd(), "admin", "dist");

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Serves a file under staticRoot, falling back to index.html; 404 JSON if the SPA is not built. */
export function serveStatic(pathname: string, res: ServerResponse): void {
  if (!existsSync(staticRoot)) {
    sendJson(res, 404, { error: "Admin app has not been built yet. Run pnpm admin:build." });
    return;
  }

  const cleanPath = normalize(pathname === "/" ? "index.html" : pathname)
    .replace(/^[/\\]/u, "")
    .replace(/^(\.\.[/\\])+/u, "");
  const filePath = join(staticRoot, cleanPath);
  // SPA fallback for anything outside the root, missing, or a directory.
  const inside = filePath.startsWith(staticRoot + sep) && existsSync(filePath) && !statSync(filePath).isDirectory();
  serveFile(inside ? filePath : join(staticRoot, "index.html"), res);
}

function serveFile(path: string, res: ServerResponse): void {
  res.writeHead(200, {
    ...securityHeaders,
    "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
  });
  res.end(readFileSync(path));
}
