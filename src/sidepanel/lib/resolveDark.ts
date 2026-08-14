import type { ThemeMode } from "@/store/settings-ui-store";

// 앱 theme 설정 + OS 선호를 최종 다크 여부로 접는다. 사이드패널(useThemeEffect)과 페이지
// 오버레이(picker.start에 실어보내는 theme)가 같은 판정을 써야 두 표면이 안 갈린다.
export function resolveDark(theme: ThemeMode, prefersDark: boolean): boolean {
  return theme === "dark" || (theme === "system" && prefersDark);
}
