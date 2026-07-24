import type { ActionEntry, ActionNode } from "@/types/action";

export type TemplateToken =
  | { type: "text"; value: string }
  | { type: "slot"; name: string };

// 슬롯 명명 규칙은 locales 테스트(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)와 일치하나,
// String.split용이라 캡처 그룹이 중괄호를 포함해 토큰에 `{name}`이 남는다.
const SLOT_RE = /(\{[a-zA-Z_][a-zA-Z0-9_]*\})/;

// 액션 엔트리의 검색 대상 텍스트(소문자). 로그 탭 검색·타임라인 검색이 공유.
export function actionSearchText(e: ActionEntry): string {
  return [
    e.target, e.fieldLabel, e.value, e.toUrl,
    e.dragSource?.name, e.dragSource?.selector, e.dragTarget?.name, e.dragTarget?.selector,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function splitTemplate(template: string): TemplateToken[] {
  return template
    .split(SLOT_RE)
    .filter((part) => part !== "")
    .map((part) =>
      SLOT_RE.test(part)
        ? { type: "slot", name: part.slice(1, -1) }
        : { type: "text", value: part },
    );
}

export type ClickTargetView =
  | { mode: "name"; name: string }
  | { mode: "tag"; tagName: string; tagType?: string }
  | { mode: "empty" };

// name → tag(tagName/tagType) → selector(name 모드 폴백) → empty.
export function resolveActionNode(node: ActionNode): ClickTargetView {
  if (node.name?.trim()) return { mode: "name", name: node.name };
  if (node.tagName)
    return { mode: "tag", tagName: node.tagName, tagType: node.tagType };
  if (node.selector) return { mode: "name", name: node.selector };
  return { mode: "empty" };
}

export function resolveClickTarget(
  entry: Pick<ActionEntry, "target" | "selector" | "tagName" | "tagType">,
): ClickTargetView {
  return resolveActionNode({
    name: entry.target,
    selector: entry.selector,
    tagName: entry.tagName,
    tagType: entry.tagType,
  });
}
