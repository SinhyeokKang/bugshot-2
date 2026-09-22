import {
  rehydrateIssuesFromExternalWrite,
  shouldSyncIssuesChange,
} from "@/store/issues-store";
import { ISSUES_PERSIST_KEY } from "@/lib/session-keys";

// 사이드패널 인스턴스가 둘 이상이면(두 창의 패널, 패널 URL을 탭으로 연 경우) 각자 마운트 시점
// 스냅샷을 계속 재직렬화해 마지막 write가 issues 배열을 통째로 덮는다 — 제출된 이슈가 Draft로
// 되돌아가 중복 제출을 부른다(#240). 다른 인스턴스의 write를 읽어 메모리를 갱신한다.
//
// main.tsx가 아니라 여기 있는 이유: 엔트리는 import 즉시 ReactDOM을 마운트해 테스트가 못
// 태운다. 엔트리에 두면 리스너를 통째로 지워도, area 가드를 부숴도 그물이 무음으로 통과한다.
//
// **throttle을 쓰지 않는다.** 묶으면 그 대기 구간에 로컬 뮤테이션이 끼어들어 이쪽 메모리(아직
// 원격 삭제를 못 읽은 배열)가 storage를 덮고, 뒤늦게 도는 rehydrate는 이미 덮인 storage를 읽어
// 지워진 레코드를 양쪽에 되살린다. 읽기 증폭은 자기 write 토큰이 이미 막는다
// (shouldSyncIssuesChange) — 남는 건 진짜 원격 변경뿐이라 접을 이유가 없다.
export function installIssuesSync(): () => void {
  const onChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== "local") return;
    if (!shouldSyncIssuesChange(changes[ISSUES_PERSIST_KEY])) return;
    void rehydrateIssuesFromExternalWrite();
  };

  chrome.storage.onChanged.addListener(onChanged);
  return () => {
    chrome.storage.onChanged.removeListener(onChanged);
  };
}
