import { CC_PREFIX, CC_SEPARATOR } from "@/types/platform";
import { escapeAttr } from "./markdownToAsanaHtml";

// markdown-it 변환(markdownToAsanaHtml)을 원형 통과해야 하므로 마크다운 비활성 문자만 사용
// — 괄호 포함 sentinel은 사용자 본문의 참조 정의(`[label]: url`)에 먹혀 사라질 수 있다.
export const CC_SENTINEL = "BUGSHOT-CC-SENTINEL";

export interface CcAdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: CcAdfNode[];
  text?: string;
}

function escapeMarkdown(name: string): string {
  return name.replace(/[\\`*_[\]~<>]/g, (ch) => `\\${ch}`);
}

// escape:false는 username 기반 플랫폼(GitHub·GitLab)용 — 제한 charset이라 이스케이프가
// 불필요하고, `\_` 등이 멘션 링크 해석을 깰 수 있다. 임의 표시 이름(Linear)은 기본값 유지.
export function ccMarkdownLine(
  handles: string[],
  opts?: { escape?: boolean },
): string {
  if (handles.length === 0) return "";
  const escape = opts?.escape ?? true;
  return `${CC_PREFIX}${handles
    .map((h) => `@${escape ? escapeMarkdown(h) : h}`)
    .join(CC_SEPARATOR)}`;
}

export function ccAdfParagraph(
  users: { accountId: string; displayName: string }[],
): CcAdfNode | null {
  if (users.length === 0) return null;
  const content: CcAdfNode[] = [{ type: "text", text: CC_PREFIX }];
  users.forEach((u, i) => {
    if (i > 0) content.push({ type: "text", text: CC_SEPARATOR });
    content.push({
      type: "mention",
      attrs: { id: u.accountId, text: `@${u.displayName}` },
    });
  });
  return { type: "paragraph", content };
}

export function ccAsanaHtml(users: { gid: string }[]): string {
  return `${CC_PREFIX}${users
    .map((u) => `<a data-asana-gid="${escapeAttr(u.gid)}"/>`)
    .join(CC_SEPARATOR)}`;
}

export function injectAsanaCc(html: string, users: { gid: string }[]): string {
  // 사용자가 본문에 같은 문자열을 입력했을 수 있어 마지막(빌더가 푸터 직전에 넣은) sentinel만 치환.
  const idx = html.lastIndexOf(CC_SENTINEL);
  if (idx === -1) return html;
  const replacement = users.length > 0 ? ccAsanaHtml(users) : "";
  return html.slice(0, idx) + replacement + html.slice(idx + CC_SENTINEL.length);
}
