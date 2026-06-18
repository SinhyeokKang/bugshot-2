// pre-arm 게이트: 로그 레코더가 document_start에서 sessionStorage 플래그를 동기로 읽어,
// active origin(한 번이라도 armed된 origin/탭 세션)이면 sentinel 도착 전부터 버퍼에 쌓는다.
// 플래그는 setSentinel 시 기록하고 clear하지 않는다 — 탭 종료 시 sessionStorage 자연 소멸에 맡긴다.
export const PREARM_FLAG_KEY = "__bugshot_recorder_active__";

export function isPreArmFlag(value: string | null): boolean {
  return value === "1";
}

// sandboxed iframe 등 sessionStorage 접근 불가 환경에서 throw → 안전하게 비활성 처리.
export function readPreArmFlag(): boolean {
  try {
    return isPreArmFlag(sessionStorage.getItem(PREARM_FLAG_KEY));
  } catch {
    return false;
  }
}

export function setPreArmFlag(): void {
  try {
    sessionStorage.setItem(PREARM_FLAG_KEY, "1");
  } catch {
    /* sandboxed */
  }
}
