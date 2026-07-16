import type { IssueSection } from "@/store/settings-ui-store";

// 재현 과정 섹션 on/off 판정 단일 출처 — 자동 채움 발화(DraftingPanel)와 설정 토글 활성(SettingsTab)이
// 같은 답을 봐야 한다. 하드코딩이 갈리면 토글은 켜졌는데 안 채워지는 식으로 조용히 어긋난다.
export function isReproSectionEnabled(sections: IssueSection[]): boolean {
  return sections.some((s) => s.id === "stepsToReproduce" && s.enabled);
}
