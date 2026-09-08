import type { PlatformId } from "@/types/platform";

export type IntegrationSubTab = "connected" | "add";

export interface ConnectFlowProps {
  connected: boolean;
  onConnected: () => void;
  // 만료 안내의 [다시 연결]이 지목한 셸이 스스로 한 번 열리게 하는 intent. 연동 탭까지만
  // 데려다주면 사용자가 8개 중에서 그 플랫폼을 다시 찾아야 한다.
  //
  // **optional로 두지 않는다.** 셸을 감싸는 래퍼가 8개인데(6개는 PlatformConnectFlow 위임,
  // jira·slack은 자체 셸), optional이면 전달을 빠뜨린 래퍼가 typecheck도 테스트도 안 걸리고
  // 그 플랫폼만 재연동이 무음으로 죽는다. 실제로 그렇게 6개가 빠졌다 — 여기를 required로
  // 두는 것이 그 그물이다(POSTMORTEM 2026-08-14 "excess property check는 객체 리터럴에만
  // 걸린다" 계열: 셸 추출이 타입 게이트를 내리는 같은 형태).
  autoStart: boolean;
  // 소비 통보 — 부모가 intent를 지워야 같은 플랫폼이 두 번 만료됐을 때 값이 바뀌어 다시 온다.
  // 셸이 이걸 안 부르면 intent가 고착돼 연동 탭 서브탭이 "add"에 붙는다.
  onAutoStartHandled: () => void;
}

// 진입 서브탭 판정의 **유일한** export. 축이 둘인데 진입점을 둘로 두면 미래 호출부가 한쪽을
// 골라 intent 축을 빠뜨리는데, 그게 정확히 이번 버그의 형태였다. 축이 둘이 됐으므로(연결 수 / 재연동 intent) 각자 effect로
// 두면 둘 다 상위 탭 전환 순간에 돌아 순서가 승부를 가른다 — 재연동은 정확히 그 순간에
// 도착한다. 재연동 버튼은 "플랫폼 추가" 목록에 있어서 intent가 이겨야 하고, 그 서브탭이
// 활성이어야 Radix가 셸을 마운트해 autoStart가 돌 수 있다.
export function resolveEntrySubTab({
  reconnect,
  connectedCount,
}: {
  reconnect: PlatformId | null;
  connectedCount: number;
}): IntegrationSubTab {
  if (reconnect) return "add";
  // 연결 0개면 "플랫폼 추가", 1개+면 "내 연동".
  return connectedCount > 0 ? "connected" : "add";
}

// 연결 가능 수단 판정 (컨펌 생략 분기 근거). null=조회 중 → [](pending, 버튼 비활성).
export function connectMethods(
  oauthAvailable: boolean | null,
): ("oauth" | "token")[] {
  if (oauthAvailable === null) return [];
  return oauthAvailable ? ["oauth", "token"] : ["token"];
}

// "플랫폼 추가" 목록 정렬: 미연결 우선, 같은 그룹 내에선 원래(bugshot) 순서 유지(안정 정렬).
export function orderAddPlatforms(
  ids: PlatformId[],
  isConnected: (id: PlatformId) => boolean,
): PlatformId[] {
  return [...ids].sort(
    (a, b) => Number(isConnected(a)) - Number(isConnected(b)),
  );
}
