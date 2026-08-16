// 로그 시맨틱(레벨/메서드) → 텍스트·배경 틴트 색 클래스의 단일 출처.
// 사이드패널 로그 탭·다이얼로그(아이콘 색)와 로그뷰어 마커 툴팁(라벨 텍스트 색),
// 통합 타임라인 패널(행 배경 틴트)이 공유해 다크모드·폴백 색에서 발산하지 않게 한다.
// 핀 색·콘텐츠타입 아이콘·syntax highlight는 레벨/메서드 시맨틱 톤이 아니라 각자 다른 색 축을
// 써서(콘텐츠타입 축·syntax 팔레트 등) 여기에 넣지 않는다.

type LogTone = "red" | "amber" | "blue" | "green" | "neutral";

export const TONE_TEXT: Record<LogTone, string> = {
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  blue: "text-blue-600 dark:text-blue-400",
  green: "text-green-600 dark:text-green-400",
  neutral: "", // 컨테이너 텍스트 색 상속
};

// 행 배경 틴트(base). hover는 TONE_BG_HOVER, 선택·코드블럭은 TONE_BG_STRONG이 잇는다.
// 콘솔 레벨 틴트와 타임라인 면색이 이 표를 공유한다(우측 로그 탭 ↔ 좌측 타임라인 색 sync).
export const TONE_BG: Record<LogTone, string> = {
  red: "bg-red-100 dark:bg-red-950/50",
  amber: "bg-amber-100 dark:bg-amber-950/50",
  blue: "bg-blue-100 dark:bg-blue-950/50",
  green: "bg-green-100 dark:bg-green-950/50",
  neutral: "",
};

// base 위 한 단계 강조 — 선택된 행, 그리고 이미 틴트된 행 안의 코드블럭처럼 "그 면 위에서
// 다시 떠야 하는" 표면용. 비교 대상이 페이지 배경이 아니라 이웃 행이라 한 스텝 진하다.
// neutral만 TONE_BG(빈 문자열)와 비대칭인데 의도다 — 여기는 면이 반드시 있어야 하는
// 자리라, 그대로 빈 값을 물려받으면 콘솔 log/debug 코드블럭 배경이 통째로 사라진다.
export const TONE_BG_STRONG: Record<LogTone, string> = {
  red: "bg-red-200 dark:bg-red-950/70",
  amber: "bg-amber-200 dark:bg-amber-950/70",
  blue: "bg-blue-200 dark:bg-blue-950/70",
  green: "bg-green-200 dark:bg-green-950/70",
  neutral: "bg-muted",
};

// base와 strong 사이의 hover 단계. neutral 행의 hover는 shadcn 선택 관용구(bg-accent 계열)라
// 이 축 밖에 있어 빈 문자열이다.
export const TONE_BG_HOVER: Record<LogTone, string> = {
  red: "hover:bg-red-200/70 dark:hover:bg-red-950/70",
  amber: "hover:bg-amber-200/70 dark:hover:bg-amber-950/70",
  blue: "hover:bg-blue-200/70 dark:hover:bg-blue-950/70",
  green: "hover:bg-green-200/70 dark:hover:bg-green-950/70",
  neutral: "",
};

// 상태 dot처럼 배경이 아니라 "칠해진 점"으로 쓰는 면색. 흰 배경엔 진한, 검은 배경엔 밝은
// 단계를 쓴다(TONE_TEXT와 같은 원리).
export const TONE_DOT: Record<LogTone, string> = {
  red: "bg-red-500 dark:bg-red-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  blue: "bg-blue-500 dark:bg-blue-400",
  green: "bg-green-500 dark:bg-green-400",
  neutral: "bg-muted-foreground",
};

export function consoleLevelBgClass(level: string): string {
  return TONE_BG[CONSOLE_LEVEL_TONE[level] ?? "neutral"];
}

export function consoleLevelBgStrongClass(level: string): string {
  return TONE_BG_STRONG[CONSOLE_LEVEL_TONE[level] ?? "neutral"];
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
