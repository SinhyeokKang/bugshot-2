import type { ActionEntry, ActionNode } from "@/types/action";
// 반드시 `import type` — 이 파일은 log-viewer가 끌어가는 공유 모듈이고, 그 빌드의 `@/i18n`
// alias는 prefix 매칭이라 값 import면 접힌 경로로 빌드가 깨진다(`@/i18n/locales`와 동일 함정).
// 경로도 저장소 관례인 `@/i18n/ko`를 따른다 — 같은 제약을 이미 푼 NetworkLogContent 선례.
import type { TranslationKey } from "@/i18n/ko";

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

// navigation 항목의 i18n 동사 키. 액션 로그 목록과 log-viewer 타임라인이 이걸 공유해야 문구가
// 갈라지지 않는다(POSTMORTEM 2026-07-03). 구 값·미상은 기존 키로 폴백 — 구 로그가 raw 키로 뜨면 안 된다.
export function navVerbKey(navType: ActionEntry["navType"]): TranslationKey {
  switch (navType) {
    case "back": return "actionLog.verb.navigateBack";
    case "forward": return "actionLog.verb.navigateForward";
    case "reload": return "actionLog.verb.navigateReload";
    case "traverse": return "actionLog.verb.navigateTraverse";
    default: return "actionLog.verb.navigate";
  }
}

// 동적 선택이라 log-viewer 복제 사전의 리터럴 스캐너를 우회하고, 값 drift 검사도 키가 아예
// 없으면 그냥 통과한다 — 이 닫힌 집합이 그 구멍을 막는 유일한 장치다(i18n.test.ts가 소비).
export const NAV_VERB_KEYS: readonly TranslationKey[] = [
  "actionLog.verb.navigate",
  "actionLog.verb.navigateBack",
  "actionLog.verb.navigateForward",
  "actionLog.verb.navigateReload",
  "actionLog.verb.navigateTraverse",
];

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
