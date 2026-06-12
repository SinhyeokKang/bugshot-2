export const CC_SENTINEL = "[[bugshot:cc]]";

export interface CcAdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: CcAdfNode[];
  text?: string;
}

function escapeMarkdown(name: string): string {
  return name.replace(/[\\`*_[\]~]/g, (ch) => `\\${ch}`);
}

export function ccMarkdownLine(handles: string[]): string {
  if (handles.length === 0) return "";
  return `cc ${handles.map((h) => `@${escapeMarkdown(h)}`).join(", ")}`;
}

export function ccAdfParagraph(
  users: { accountId: string; displayName: string }[],
): CcAdfNode | null {
  if (users.length === 0) return null;
  const content: CcAdfNode[] = [{ type: "text", text: "cc " }];
  users.forEach((u, i) => {
    if (i > 0) content.push({ type: "text", text: ", " });
    content.push({
      type: "mention",
      attrs: { id: u.accountId, text: `@${u.displayName}` },
    });
  });
  return { type: "paragraph", content };
}

export function ccAsanaHtml(users: { gid: string }[]): string {
  return `cc ${users.map((u) => `<a data-asana-gid="${u.gid}"/>`).join(", ")}`;
}

export function injectAsanaCc(html: string, users: { gid: string }[]): string {
  // 사용자가 본문에 같은 문자열을 입력했을 수 있어 마지막(빌더가 푸터 직전에 넣은) sentinel만 치환.
  const idx = html.lastIndexOf(CC_SENTINEL);
  if (idx === -1) return html;
  const replacement = users.length > 0 ? ccAsanaHtml(users) : "";
  return html.slice(0, idx) + replacement + html.slice(idx + CC_SENTINEL.length);
}
