import { OAuthError } from "../oauth/errors";
import type { PlatformId } from "@/types/platform";

// refresh 실패는 401(사이드패널 onOAuthExpired = 재로그인 안내) 레인이고, 최초 연결 실패는
// 400이다. 그런데 createRefreshRunner는 둘을 구별할 신호가 없다 — 양쪽이 같은 getMyself를
// 타고 auth 필드도 동일하며, hook 반환 채널이 `A` 하나뿐이라 hook이 아는 걸 runner로 못
// 넘긴다. 그래서 refresh 경로가 기본으로 태깅하고, 최초 연결 경로가 여기서 되벗긴다.

// 갱신 실패 레인 태깅. refresh in-flight promise는 동시 대기자 전원이 **같은 에러 인스턴스**를
// 받으므로 원본을 변이하지 않는다 — 한 대기자의 레인 판단이 다른 대기자에게 새면 안 된다.
//
// platform을 함께 각인하는 건 사이드패널이 그 값으로 **재연동 대상을 정하기** 때문이다.
// 401 레인에 platform 없는 에러가 들어오면 만료 안내가 아예 안 뜨고(어느 플랫폼인지 몰라
// 안내를 띄울 수 없다) 사용자는 제출 실패만 반복한다. `OAuthErrorOptions.platform`을
// required로 올리는 건 생성 지점 72곳을 건드리므로, 레인의 **단일 통로**인 여기서 채운다 —
// 그러면 어느 지점이 platform을 빠뜨려도 이 레인을 지나는 순간 메워진다.
export function tagRefreshFailure(err: unknown, platform: PlatformId): unknown {
  if (!(err instanceof OAuthError)) return err;
  if (err.refreshFailed && err.platform) return err;
  const copy = withRefreshFailed(err, true);
  copy.platform ??= platform;
  return copy;
}

export async function inRefreshLane<T>(
  run: () => Promise<T>,
  // **optional로 두지 않는다.** App이 `?? "jira"` 폴백을 없앤 뒤로 이 값은 라벨이 아니라
  // 만료 안내의 표시 여부 자체를 정한다 — 레인을 여는 새 코드가 빠뜨리면 `onOAuthExpired`가
  // null로 발화해 안내가 **아예 안 뜬다**. 레인을 여는 쪽은 항상 자기 플랫폼을 알고
  // (runner는 생성 인자로, jira는 자기 모듈이라) 호출부가 3곳뿐이라 강제 비용이 0이다.
  platform: PlatformId,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw tagRefreshFailure(err, platform);
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
