// chrome.runtime.sendMessage는 확장 reload/무효화 시 호출 시점에 동기 throw한다(.catch로 못 막음).
// stale content script가 죽은 컨텍스트로 보내는 경우를 id 가드 + try로 흡수해 Uncaught를 막는다.
export function postToRuntime(msg: object): void {
  if (!chrome.runtime?.id) return;
  try {
    void chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    /* Extension context invalidated */
  }
}
