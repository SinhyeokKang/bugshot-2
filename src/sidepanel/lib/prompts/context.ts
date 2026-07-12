import type { CaptureMode } from "@/store/editor-store";
import type { Token } from "@/types/picker";

// 프롬프트 줄에 들어가는 값 상당수(action log 라벨, 콘솔 메시지, 디자인 토큰)는 페이지가
// 통제한다. 개행이 살아있으면 악성 페이지가 지시 줄을 위조할 수 있다 — 한 줄로 접는다.
export function oneLine(text: string): string {
  return text.replace(/[\r\n\u2028\u2029]+/g, " ");
}

// 어느 캡처 모드에 로그 컨텍스트를 싣는가의 단일 출처 — 본문 빌더 2개와 호출부가 공유한다.
// 각자 판단하면 갈라지고, 그 틈이 곧 "compact에만 로그가 실리는" 비대칭이 된다.
export function includesLogContext(mode: CaptureMode): boolean {
  return mode === "video" || mode === "freeform";
}

export function extractVarRefs(styles: Record<string, string>): string[] {
  const refs: string[] = [];
  for (const value of Object.values(styles)) {
    for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!refs.includes(m[1])) refs.push(m[1]);
    }
  }
  return refs;
}

function familyOf(name: string): string {
  const i = name.lastIndexOf("-");
  return i > 0 ? name.slice(0, i) : name;
}

// collectTokens는 이름순 정렬이라 단순 slice는 알파벳 앞 family만 남긴다.
// 요소가 실제 참조하는 토큰 → 같은 family → 나머지 순으로 선별해야
// "쓰던 family 우선" 지시가 실제로 성립한다.
export function selectRelevantTokens(
  tokens: Token[],
  referencedNames: string[],
  limit: number,
): Token[] {
  const referenced = new Set(referencedNames);
  const families = new Set(referencedNames.map(familyOf));

  const picked: Token[] = [];
  const seen = new Set<string>();

  const take = (predicate: (t: Token) => boolean) => {
    for (const t of tokens) {
      if (picked.length >= limit) return;
      if (seen.has(t.name) || !predicate(t)) continue;
      seen.add(t.name);
      picked.push(t);
    }
  };

  take((t) => referenced.has(t.name));
  take((t) => families.has(familyOf(t.name)));
  take(() => true);

  return picked;
}

// {...specifiedStyles, ...styleEdits.inlineStyle} spread 순서상 사용자가 새로 추가한
// prop이 객체 tail이라, 단순 slice는 그것부터 버린다 — AI가 편집을 못 보고 되돌린다.
export function selectStyles(
  specifiedStyles: Record<string, string>,
  editedProps: string[],
  limit: number,
): Record<string, string> {
  const edited = new Set(editedProps);
  const out: Record<string, string> = {};

  for (const prop of Object.keys(specifiedStyles)) {
    if (Object.keys(out).length >= limit) break;
    if (edited.has(prop)) out[prop] = specifiedStyles[prop];
  }
  for (const prop of Object.keys(specifiedStyles)) {
    if (Object.keys(out).length >= limit) break;
    if (!edited.has(prop)) out[prop] = specifiedStyles[prop];
  }

  return out;
}

// "기존 초안 중 무엇이 프롬프트에 실렸는가"의 단일 출처. 빌더와 예산 계산기가 각자
// 추정하면 어긋나고, 그 틈에서 "AI가 못 본 섹션의 빈 응답"이 비우기 의도로 오인돼
// 사용자 텍스트가 삭제된다. 섹션은 통째로 싣거나 통째로 뺀다 — 중간에 자르지 않는다.
export function selectDraftSections(
  existingDraft: { title: string; sections: Record<string, string> } | undefined,
  enabledSectionIds: string[],
  budgetChars: number,
  strip: (text: string) => string,
): { parts: string[]; includedIds: string[]; titleIncluded: boolean } {
  if (!existingDraft) {
    return { parts: [], includedIds: [], titleIncluded: false };
  }

  const parts: string[] = [];
  const includedIds: string[] = [];
  let used = 0;
  let titleIncluded = false;

  const title = existingDraft.title.trim();
  if (title) {
    const line = `title: ${title}`;
    if (line.length <= budgetChars) {
      parts.push(line);
      used = line.length;
      titleIncluded = true;
    }
  }

  for (const id of enabledSectionIds) {
    const text = strip(existingDraft.sections[id] ?? "");
    if (!text) continue;
    const line = `${id}: ${text}`;
    if (used + line.length > budgetChars) continue;
    parts.push(line);
    includedIds.push(id);
    used += line.length;
  }

  return { parts, includedIds, titleIncluded };
}

export const LAYOUT_PROPS: readonly string[] = [
  "display",
  "position",
  "flex-direction",
  "justify-content",
  "align-items",
  "gap",
  "box-sizing",
  "overflow",
  "width",
  "height",
  "margin",
  "padding",
];

export function extractLayoutContext(
  computedStyles: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const prop of LAYOUT_PROPS) {
    const value = computedStyles[prop];
    if (value) out[prop] = value;
  }
  return out;
}

// 멀티턴에서 요소 상태를 매 턴 전량 재주입하면 컨텍스트가 선형 증가한다.
// 직전 턴 대비 변경분만 보낸다.
//
// currentAll: 캡 적용 전 현재 스타일 전체. prev/next는 캡 적용 후 맵이라, 편집이 늘면
// 캡 윈도 밖으로 밀려난 비편집 prop이 next에서 사라진다 — 그걸 "제거됨"으로 통보하면
// 모델이 멀쩡한 속성을 되살린다. 실제 삭제와 캡 축출을 구분하는 근거다.
export function buildStyleDeltaBlock(
  prev: Record<string, string>,
  next: Record<string, string>,
  currentAll: Record<string, string>,
): string {
  const lines: string[] = [];

  for (const [prop, value] of Object.entries(next)) {
    if (prev[prop] !== value) lines.push(`  ${prop}: ${value}`);
  }
  for (const prop of Object.keys(prev)) {
    if (!(prop in next) && !(prop in currentAll)) {
      lines.push(`  ${prop}: (removed)`);
    }
  }

  if (lines.length === 0) return "";
  return ["[Changed since last turn]", ...lines].join("\n");
}

// classList는 delta에 안 실으면 세션 시스템 프롬프트의 생성 시점 목록이 영원히 stale해진다.
// rich 규칙이 "COMPLETE class list를 유지하라"고 요구하므로, 모델이 stale 목록을
// 완전 목록으로 믿고 사용자의 수동 클래스 편집을 되돌린다.
export function buildClassDeltaLine(
  prev: string[],
  next: string[],
): string {
  if (prev.join(" ") === next.join(" ")) return "";
  return `  classes: ${next.join(" ") || "(none)"}`;
}
