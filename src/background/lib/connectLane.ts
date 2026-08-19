import { OAuthError } from "../oauth/errors";

// refresh 실패는 401(사이드패널 onOAuthExpired = 재로그인 안내) 레인이고, 최초 연결 실패는
// 400이다. 그런데 createRefreshRunner는 둘을 구별할 신호가 없다 — 양쪽이 같은 getMyself를
// 타고 auth 필드도 동일하며, hook 반환 채널이 `A` 하나뿐이라 hook이 아는 걸 runner로 못
// 넘긴다. 그래서 refresh 경로가 기본으로 태깅하고, 최초 연결 경로가 여기서 되벗긴다.

// 갱신 실패 레인 태깅. refresh in-flight promise는 동시 대기자 전원이 **같은 에러 인스턴스**를
// 받으므로 원본을 변이하지 않는다 — 한 대기자의 레인 판단이 다른 대기자에게 새면 안 된다.
export function tagRefreshFailure(err: unknown): unknown {
  if (!(err instanceof OAuthError) || err.refreshFailed) return err;
  return withRefreshFailed(err, true);
}

export async function inRefreshLane<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw tagRefreshFailure(err);
  }
}

export async function inConnectLane<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof OAuthError) || !err.refreshFailed) throw err;
    throw withRefreshFailed(err, false);
  }
}

// own property를 descriptor째 복사한다 — 필드를 손으로 열거하면 OAuthError에 축이 하나 늘 때
// 그 값이 조용히 유실되고, Object.assign은 non-enumerable인 `message`·`stack`을 안 옮긴다.
function withRefreshFailed(err: OAuthError, value: boolean): OAuthError {
  const copy = Object.create(
    Object.getPrototypeOf(err) as object,
    Object.getOwnPropertyDescriptors(err),
  ) as OAuthError;
  copy.refreshFailed = value;
  return copy;
}
