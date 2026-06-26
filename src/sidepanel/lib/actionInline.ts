import type { ActionEntry } from "@/types/action";

export type TemplateToken =
  | { type: "text"; value: string }
  | { type: "slot"; name: string };

// 슬롯 명명 규칙은 locales 테스트(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)와 일치하나,
// String.split용이라 캡처 그룹이 중괄호를 포함해 토큰에 `{name}`이 남는다.
const SLOT_RE = /(\{[a-zA-Z_][a-zA-Z0-9_]*\})/;

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

export function resolveClickTarget(
  entry: Pick<ActionEntry, "target" | "selector" | "tagName" | "tagType">,
): ClickTargetView {
  if (entry.target?.trim()) return { mode: "name", name: entry.target };
  if (entry.tagName)
    return { mode: "tag", tagName: entry.tagName, tagType: entry.tagType };
  if (entry.selector) return { mode: "name", name: entry.selector };
  return { mode: "empty" };
}

export function shouldRenderChip(
  value: string | undefined,
  masked: boolean,
): boolean {
  if (masked) return true;
  return !!value;
}
