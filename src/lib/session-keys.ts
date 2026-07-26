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
