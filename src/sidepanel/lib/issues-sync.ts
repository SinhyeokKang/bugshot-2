import {
  lastWrittenIssuesValue,
  rehydrateIssuesFromExternalWrite,
  shouldSyncIssuesChange,
} from "@/store/issues-store";
import { ISSUES_PERSIST_KEY } from "@/lib/session-keys";
import { createTrailingThrottle } from "./trailing-throttle";

// 사이드패널 인스턴스가 둘 이상이면(두 창의 패널, 패널 URL을 탭으로 연 경우) 각자 마운트 시점
// 스냅샷을 계속 재직렬화해 마지막 write가 issues 배열을 통째로 덮는다 — 제출된 이슈가 Draft로
// 되돌아가 중복 제출을 부른다(#240). 다른 인스턴스의 write를 읽어 메모리를 갱신한다.
//
// main.tsx가 아니라 여기 있는 이유: 엔트리는 import 즉시 ReactDOM을 마운트해 테스트가 못
// 태운다. 엔트리에 두면 리스너를 통째로 지워도, area 가드를 부숴도 그물이 무음으로 통과한다.
export function installIssuesSync(intervalMs = 300): () => void {
  // 다른 인스턴스의 배지 버스트(제출 이슈 N건 = write N번)를 한 번으로 접는다.
  const sync = createTrailingThrottle(() => {
    void rehydrateIssuesFromExternalWrite();
  }, intervalMs);

  const onChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== "local") return;
    if (!shouldSyncIssuesChange(changes[ISSUES_PERSIST_KEY], lastWrittenIssuesValue())) {
      return;
    }
    sync.schedule();
  };

  chrome.storage.onChanged.addListener(onChanged);
  return () => {
    sync.cancel();
    chrome.storage.onChanged.removeListener(onChanged);
  };
}
