export interface EnvironmentRow {
  label: string;
  value: string;
  // 자동 파생 행 표식 — 화면엔 안 보이는 내부 메타데이터. 동기화가 자기 행을 찾는 데만 쓴다.
  // filterEnvironmentRows가 {label, value}로 재조립하므로 모든 출력에서 벗겨진다.
  source?: "api-hosts";
}
