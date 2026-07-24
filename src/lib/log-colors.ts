// 로그 시맨틱(레벨/메서드) → 텍스트·배경 틴트 색 클래스의 단일 출처.
// 사이드패널 로그 탭·다이얼로그(아이콘 색)와 로그뷰어 마커 툴팁(라벨 텍스트 색),
// 통합 타임라인 패널(행 배경 틴트)이 공유해 다크모드·폴백 색에서 발산하지 않게 한다.
// 핀 색·콘텐츠타입 아이콘·syntax highlight는 각 계층 단독 사용이라 여기에 넣지 않는다.

export type LogTone = "red" | "amber" | "blue" | "green" | "neutral";

export const TONE_TEXT: Record<LogTone, string> = {
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  blue: "text-blue-600 dark:text-blue-400",
  green: "text-green-600 dark:text-green-400",
  neutral: "", // 컨테이너 텍스트 색 상속
};

// 행 배경 틴트(base) — hover/active 변형은 각 소비처가 얹는다. 콘솔 레벨 틴트와
// 타임라인 면색이 이 표를 공유한다(우측 로그 탭 ↔ 좌측 타임라인 색 sync).
export const TONE_BG: Record<LogTone, string> = {
  red: "bg-red-100 dark:bg-red-950/50",
  amber: "bg-amber-100 dark:bg-amber-950/50",
  blue: "bg-blue-100 dark:bg-blue-950/50",
  green: "bg-green-100 dark:bg-green-950/50",
  neutral: "",
};

export function consoleLevelBgClass(level: string): string {
  return TONE_BG[CONSOLE_LEVEL_TONE[level] ?? "neutral"];
}

export const CONSOLE_LEVEL_TONE: Record<string, LogTone> = {
  error: "red",
  warn: "amber",
  info: "blue",
  debug: "neutral",
  log: "neutral",
};

export const NETWORK_METHOD_TONE: Record<string, LogTone> = {
  GET: "blue",
  POST: "green",
  PUT: "amber",
  PATCH: "amber",
  DELETE: "red",
};

export function consoleLevelTextClass(level: string): string {
  return TONE_TEXT[CONSOLE_LEVEL_TONE[level] ?? "neutral"];
}

export function networkMethodTextClass(method: string): string {
  return TONE_TEXT[NETWORK_METHOD_TONE[method.toUpperCase()] ?? "neutral"];
}
