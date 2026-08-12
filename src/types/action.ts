export type ActionEntryKind =
  | "click"
  | "navigation"
  | "input"
  | "keypress" // value: 키 조합 문자열, target?: 포커스 요소 이름, selector
  | "toggle" // checkbox/radio. fieldLabel, value: "checked"|"unchecked", selector
  | "select" // <select>. fieldLabel, value: 선택 옵션 텍스트, selector
  // 새 kind를 추가하면 `sidepanel/lib/buildLogSummary.ts:buildActionLogSummary`의
  // exhaustive check가 컴파일 에러로 잡는다 — 라벨 분기를 반드시 함께 추가할 것.
  | "drag"; // dragSource(항상) + dragTarget(네이티브 DnD에서만 — 신뢰 가능한 드롭존)

// drag endpoint 1개를 기술 — recordClick의 인라인 로직(accessibleName→truncateName,
// implicitRole, buildLightSelector, tagName, tagType)을 승격 없이 재사용.
export interface ActionNode {
  name?: string;
  role?: string;
  selector?: string;
  tagName?: string;
  tagType?: string;
}

export interface ActionEntry {
  id: string;
  kind: ActionEntryKind;
  timestamp: number;
  pageUrl: string;
  // click / keypress(target=포커스 요소 접근성 이름)
  target?: string;
  role?: string;
  selector?: string;
  // click 전용: 접근성 이름이 없을 때 태그 폴백 표시용.
  tagName?: string;
  tagType?: string;
  // navigation. 구 5개는 하위호환(IndexedDB 초안)과 Navigation API 실패 시 popstate 폴백 때문에
  // 남는다. 이 축엔 exhaustive 검사가 저장소에 0건이라 렌더 분기 누락을 컴파일러가 못 잡는다 —
  // navVerbKey/buildActionLogSummary의 폴백이 유일한 그물이다.
  navType?:
    | "load" | "pushState" | "replaceState" | "popstate" | "hashchange"
    | "reload" | "traverse" | "back" | "forward";
  fromUrl?: string;
  toUrl?: string;
  // input / toggle / select(fieldLabel), keypress(value=키 조합)
  fieldLabel?: string;
  value?: string;
  masked?: boolean;
  // drag: dragSource(drag면 항상) / dragTarget(네이티브 DnD에서만. 없으면 포인터 경로 source-only).
  dragSource?: ActionNode;
  dragTarget?: ActionNode;
  // pre-arm 버퍼링으로 sentinel 도착 전(페이지 로드 초반) 캡처됨 → reload logClear 경계 우회 보존.
  preArm?: boolean;
}

export interface ActionLog {
  id: string;
  startedAt: number;
  endedAt: number;
  totalSeen: number;
  captured: number;
  entries: ActionEntry[];
}

export type ActionLogSummary = string[];
