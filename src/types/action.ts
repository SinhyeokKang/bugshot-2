export type ActionEntryKind =
  | "click"
  | "navigation"
  | "input"
  | "keypress" // value: 키 조합 문자열, target?: 포커스 요소 이름, selector
  | "toggle" // checkbox/radio. fieldLabel, value: "checked"|"unchecked", selector
  | "select"; // <select>. fieldLabel, value: 선택 옵션 텍스트, selector

export interface ActionEntry {
  id: string;
  kind: ActionEntryKind;
  timestamp: number;
  pageUrl: string;
  // click / keypress(target=포커스 요소 접근성 이름)
  target?: string;
  role?: string;
  selector?: string;
  // navigation
  navType?: "load" | "pushState" | "replaceState" | "popstate" | "hashchange";
  fromUrl?: string;
  toUrl?: string;
  // input / toggle / select(fieldLabel), keypress(value=키 조합)
  fieldLabel?: string;
  value?: string;
  masked?: boolean;
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
