const ko = {
  "ai.badge.chromeAI": "Chrome AI",

  "aiDraft.title": "AI 초안 작성",
  "aiDraft.placeholder": "버그를 간단히 설명해주세요...",
  "aiDraft.generate": "초안 작성",
  "aiDraft.disclaimer": "AI는 실수할 수 있습니다. 생성된 초안을 확인해주세요.",

  "aiStyling.banner": "AI에게 스타일 수정을 맡겨보세요",
  "aiStyling.generate": "AI 스타일링",
  "aiStyling.title": "AI 스타일링",
  "aiStyling.placeholder": "원하는 변경을 설명하세요...",
  "aiStyling.error": "AI 응답 처리에 실패했습니다",
  "aiStyling.noChanges": "변경할 스타일을 찾지 못했습니다",
  "aiStyling.disclaimer": "AI는 실수할 수 있습니다. 변경사항을 다시 한번 확인해 주세요.",
} as const;

type Bundle = Record<keyof typeof ko, string>;

const en = {
  "ai.badge.chromeAI": "Chrome AI",

  "aiDraft.title": "AI Draft",
  "aiDraft.placeholder": "Briefly describe the bug...",
  "aiDraft.generate": "Generate",
  "aiDraft.disclaimer": "AI can make mistakes. Please review the generated draft.",

  "aiStyling.banner": "Let AI handle the styling",
  "aiStyling.generate": "AI Styling",
  "aiStyling.title": "AI Styling",
  "aiStyling.placeholder": "Describe the changes you want...",
  "aiStyling.error": "Failed to process AI response",
  "aiStyling.noChanges": "No style changes found",
  "aiStyling.disclaimer": "AI can make mistakes. Please double-check the changes.",
} satisfies Bundle;

export const ai = { ko, en };
