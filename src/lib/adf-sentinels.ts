export const IMAGE_PLACEHOLDER = "__BUGSHOT_IMAGE__";
export const VIDEO_PLACEHOLDER = "__BUGSHOT_VIDEO__";
export const INLINE_IMAGE_PREFIX = "__BUGSHOT_INLINE:";

export function inlineImagePlaceholder(refId: string): string {
  return `${INLINE_IMAGE_PREFIX}${refId}__`;
}

export function parseInlinePlaceholder(text: string): string | null {
  if (!text.startsWith(INLINE_IMAGE_PREFIX) || !text.endsWith("__")) return null;
  return text.slice(INLINE_IMAGE_PREFIX.length, -2);
}

// 2차 본문 갱신을 걸지 말지의 게이트. 업로드 결과가 하나도 없어도 본문에 placeholder가
// 남아 있으면 갱신을 돌려야 한다 — 안 그러면 리터럴이 이슈에 그대로 보인다.
// 스코프를 top-level content로 두는 건 치환 로직(buildJiraDescriptionContent)과 같은 자리만
// 보기 위해서다. 더 깊이 찾으면 치환할 수 없는 자리를 잡아 빈 PUT을 부른다.
export function adfHasSentinel(content: unknown[]): boolean {
  return content.some((node) => {
    const n = node as { type?: string; content?: { text?: string }[] };
    if (n.type !== "paragraph") return false;
    const text = n.content?.[0]?.text;
    if (!text) return false;
    return (
      text === IMAGE_PLACEHOLDER ||
      text === VIDEO_PLACEHOLDER ||
      parseInlinePlaceholder(text) !== null
    );
  });
}
