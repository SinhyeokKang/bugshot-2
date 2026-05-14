// Notion URL: https://www.notion.so/<workspace>/<title-slug>-<pageId>?v=...
// pageId는 32자 hex (대시 없는 형태) 또는 8-4-4-4-12 UUID.
// URL이 아니거나 매칭 안 되면 null.
export function extractNotionPageId(url: string | undefined): string | null {
  if (!url) return null;
  let last: string;
  try {
    const u = new URL(url);
    last = u.pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return null;
  }
  const m = last.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/);
  return m ? m[1] : null;
}
