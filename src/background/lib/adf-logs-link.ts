// buildIssueAdf의 로그 안내 문단은 "logs.html"을 별도 em text 노드로 분리해둔다.
// 제출 시점엔 첨부 URL을 모르므로, 업로드 후 이 후처리가 그 노드에 link mark를
// 추가해 본문에서 바로 첨부로 점프하게 한다. 매칭 노드가 없거나 URL을 못 구하면
// 평문 그대로 둔다(graceful).
export const LOGS_LINK_LABEL = "logs.html";

interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}
interface AdfTextNode {
  type?: string;
  text?: string;
  marks?: AdfMark[];
}
interface AdfParaNode {
  type?: string;
  content?: AdfTextNode[];
}

export function injectLogsLink(content: unknown[], url: string): boolean {
  let linked = false;
  for (const node of content) {
    const para = node as AdfParaNode;
    if (para.type !== "paragraph" || !Array.isArray(para.content)) continue;
    for (const child of para.content) {
      if (child.type !== "text" || child.text !== LOGS_LINK_LABEL) continue;
      const marks = child.marks ?? [];
      if (marks.some((m) => m.type === "link")) continue;
      child.marks = [...marks, { type: "link", attrs: { href: url } }];
      linked = true;
    }
  }
  return linked;
}
