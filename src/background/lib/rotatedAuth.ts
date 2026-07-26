// refresh 락은 `.finally`에서 풀리지만, 락을 기다리지 않고 이미 stale한 auth 객체를 손에 쥔
// 병렬 요청은 그 뒤에 자기 차례로 락을 잡는다 — 그때 인자로 받은 refresh token은 앞선 회전에서
// 이미 소모돼 invalid_grant가 난다. 저장소엔 새 토큰이 멀쩡히 있는데 재인증을 강요당하는 경로.
//
// 락을 잡은 직후 저장분을 다시 읽어, refresh token이 이미 갈렸으면 refresh 없이 그걸 쓴다.
// 저장분이 없거나 같은 토큰이면 null — 호출부는 평소대로 refresh를 진행한다(회귀 방향 안전).
export function pickRotatedAuth<A extends { refreshToken?: string | null }>(
  requested: A,
  stored: A | null | undefined,
): A | null {
  if (!stored?.refreshToken) return null;
  if (!requested.refreshToken) return null;
  return stored.refreshToken !== requested.refreshToken ? stored : null;
}
