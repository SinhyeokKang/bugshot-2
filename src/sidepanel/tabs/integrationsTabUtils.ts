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
