// paging — reads a store listing page by page, up to an overall row limit.

/**
 * Calls `readPage(offset, pageSize)` until `limit` rows, an empty page, or a
 * page shorter than `pageSize` (the last one). `pageSize` must not exceed the
 * store listing's own cap, or every page looks short and reading stops early.
 */
export function paged<T>(readPage: (offset: number, pageSize: number) => T[], limit: number, pageSize: number): T[] {
  const out: T[] = [];
  let offset = 0;
  while (out.length < limit) {
    const page = readPage(offset, pageSize);
    if (page.length === 0) break;
    out.push(...page.slice(0, limit - out.length));
    offset += page.length;
    if (page.length < pageSize) break;
  }
  return out;
}
