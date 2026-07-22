// 구 3플래그 스냅샷 → 단일 logsAttach OR 파생. 셋 중 하나라도 true면 true,
// 셋 다 정의됐고 모두 false면 false, 구 필드가 전부 부재(신규 스냅샷)면 기본 true.
// (`??` first-defined가 아니라 `||` — 부분 첨부 구 데이터에서 "하나라도 켜져 있었으면 on"이 의미에 맞다.)
export function deriveLogsAttach(snap: {
  networkLogAttach?: boolean;
  consoleLogAttach?: boolean;
  actionLogAttach?: boolean;
}): boolean {
  const { networkLogAttach, consoleLogAttach, actionLogAttach } = snap;
  if (
    networkLogAttach === undefined &&
    consoleLogAttach === undefined &&
    actionLogAttach === undefined
  ) {
    return true;
  }
  return Boolean(networkLogAttach || consoleLogAttach || actionLogAttach);
}
