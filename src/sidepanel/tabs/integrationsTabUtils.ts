import type { PlatformId } from "@/types/platform";

export type IntegrationSubTab = "connected" | "add";

export interface ConnectFlowProps {
  connected: boolean;
  onConnected: () => void;
}

// 연결 0개면 "플랫폼 추가", 1개+면 "내 연동"으로 진입.
export function pickInitialSubTab(connectedCount: number): IntegrationSubTab {
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
