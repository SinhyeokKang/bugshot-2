// **type-only를 유지할 것.** `type` 키워드가 빠지면 background 번들(tab-bindings가 이 파일을
// 문다)에 editor-store와 zustand가 유입되고, bundleBoundary.test.ts는 src/store만 스캔하므로
// 그걸 잡는 그물이 없다.
import type { EditorPhase } from "@/store/editor-store";

export const PICKER_PORT_NAME = "bugshot-picker";
export const PANEL_PORT_PREFIX = "bugshot-panel:";

export const EDITOR_SESSION_PREFIX = "editor:";

// 탭에 매인 임시 소유자 키. 로그·영상·첨부 blob은 이슈가 확정되기 전 이 키로 저장됐다가
// confirmDraft에서 issueId로 rekey된다. 리터럴이 15곳+에 흩어져 있었고, 그 사각지대에서
// issues-store의 image 루프만 접두사 스킵을 빠뜨려 전 탭 pending 이미지가 지워졌다.
export const PENDING_PREFIX = "pending:";

export function pendingKey(tabId: number | string): string {
  return `${PENDING_PREFIX}${tabId}`;
}

export function isPendingKey(key: string): boolean {
  return key.startsWith(PENDING_PREFIX);
}

// issues-store의 zustand persist 키. blob-db의 GC가 이 키로 저장분을 직접 읽으므로,
// 리터럴을 두 벌 두면 이름이 바뀌는 순간 GC가 참조 집합을 통째로 놓친다.
export const ISSUES_PERSIST_KEY = "bugshot-issues";

// settings-ui-store의 zustand persist 키. background의 i18n/bg-init이 이 봉투에서 locale을
// 직접 뽑아 미러링하므로, 리터럴을 두 벌 두면 이름이 바뀌는 순간 background 에러 문자열만
// 타입 에러 없이 조용히 영어로 굳는다.
export const APP_SETTINGS_PERSIST_KEY = "bugshot-app-settings";

export function sessionKey(tabId: number): string {
  return `${EDITOR_SESSION_PREFIX}${tabId}`;
}

export function pageKeyOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

// `has`는 판독 불가한 세션 스냅샷의 `string`도 받아야 하므로 ReadonlySet<string>을 유지하고,
// **내용만** EditorPhase에 묶는다 — 그냥 new Set([...])이면 EditorPhase 리네임에 소비처
// (tab-bindings·useEditorSessionSync·log-merge)가 무음으로 상시 false가 된다.
export const FROZEN_PHASES: ReadonlySet<string> = new Set<EditorPhase>([
  "drafting",
  "previewing",
  "done",
]);

export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
