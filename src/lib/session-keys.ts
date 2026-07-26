export const PICKER_PORT_NAME = "bugshot-picker";
export const PANEL_PORT_PREFIX = "bugshot-panel:";

export const EDITOR_SESSION_PREFIX = "editor:";

// issues-store의 zustand persist 키. blob-db의 GC가 이 키로 저장분을 직접 읽으므로,
// 리터럴을 두 벌 두면 이름이 바뀌는 순간 GC가 참조 집합을 통째로 놓친다.
export const ISSUES_PERSIST_KEY = "bugshot-issues";

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

export const FROZEN_PHASES: ReadonlySet<string> = new Set([
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
