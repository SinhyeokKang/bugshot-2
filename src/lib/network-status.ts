import type { NetworkRequest } from "@/types/network";

// CORS·연결 실패로 fetch/XHR가 응답을 못 읽어 실제 서버 상태 코드가 가려진 경우.
// abort/timeout/beacon은 status 0이어도 "가려진" 게 아니라 응답 자체가 없는 것이라 제외.
export function isStatusHidden(
  req: Pick<NetworkRequest, "phase" | "status" | "statusText">,
): boolean {
  return req.phase === "error" && req.status === 0 && req.statusText === "Network Error";
}
