import type { NetworkRequest } from "@/types/network";

// CORS·연결 실패로 fetch/XHR가 응답을 못 읽어 실제 서버 상태 코드가 가려진 경우.
// abort/timeout/beacon은 status 0이어도 "가려진" 게 아니라 응답 자체가 없는 것이라 제외.
export function isStatusHidden(
  req: Pick<NetworkRequest, "phase" | "status" | "statusText">,
): boolean {
  return req.phase === "error" && req.status === 0 && req.statusText === "Network Error";
}

// 요청이 "실패"인가 — phase error 또는 4xx+. pending은 아직 실패 아님.
export function isNetworkError(req: Pick<NetworkRequest, "phase" | "status">): boolean {
  if (req.phase === "error") return true;
  if (req.phase === "pending") return false;
  return req.status >= 400;
}

export function isNetworkPending(req: Pick<NetworkRequest, "phase">): boolean {
  return req.phase === "pending";
}
