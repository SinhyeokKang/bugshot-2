const ko = {
  "ai.badge.chromeAI": "Chrome AI",
  "ai.stop": "중단",

  "aiDraft.title": "AI 초안 작성",
  "aiDraft.placeholder": "버그를 간단히 설명해주세요...",
  "aiDraft.generate": "초안 작성",
  "aiDraft.disclaimer": "AI는 실수할 수 있습니다. 생성된 초안을 확인해주세요.",
  "aiDraft.contextTrimmed": "내용이 많아 일부 참고 정보를 빼고 작성했습니다.",
  "aiDraft.loading1": "로그를 훑어보는 중이에요",
  "aiDraft.loading2": "맥락을 파악하는 중이에요",
  "aiDraft.loading3": "핵심을 간추리는 중이에요",
  "aiDraft.loading4": "초안을 작성하는 중이에요",
  "aiDraft.loading5": "문장을 다듬는 중이에요",

  "aiStyling.banner": "AI에게 스타일 수정을 맡겨보세요",
  "aiStyling.generate": "AI 스타일링",
  "aiStyling.title": "AI 스타일링",
  "aiStyling.placeholder": "원하는 변경을 설명하세요...",
  "aiStyling.error": "AI 응답 처리에 실패했습니다",
  "aiStyling.noChanges": "변경할 스타일을 찾지 못했습니다",
  "aiStyling.disclaimer": "AI는 실수할 수 있습니다. 변경사항을 다시 한번 확인해 주세요.",
  "aiStyling.loading1": "요소를 살펴보는 중이에요",
  "aiStyling.loading2": "스타일 대안을 떠올리는 중이에요",
  "aiStyling.loading3": "속성을 조정하는 중이에요",
  "aiStyling.loading4": "코드를 다듬는 중이에요",
  "aiStyling.loading5": "결과를 확인하는 중이에요",

  "aiRepro.loading1": "액션 로그를 되짚는 중이에요",
  "aiRepro.loading2": "흐름을 따라가는 중이에요",
  "aiRepro.loading3": "재현 순서를 정리하는 중이에요",
  "aiRepro.loading4": "단계를 적는 중이에요",
  "aiRepro.loading5": "빠진 곳이 없는지 확인하는 중이에요",
} as const;

type Bundle = Record<keyof typeof ko, string>;

const en = {
  "ai.badge.chromeAI": "Chrome AI",
  "ai.stop": "Stop",

  "aiDraft.title": "AI Draft",
  "aiDraft.placeholder": "Briefly describe the bug...",
  "aiDraft.generate": "Generate",
  "aiDraft.disclaimer": "AI can make mistakes. Please review the generated draft.",
  "aiDraft.contextTrimmed": "There was a lot to cover, so some context was left out.",
  "aiDraft.loading1": "Skimming the logs",
  "aiDraft.loading2": "Getting the context",
  "aiDraft.loading3": "Picking out what matters",
  "aiDraft.loading4": "Writing the draft",
  "aiDraft.loading5": "Refining the wording",

  "aiStyling.banner": "Let AI handle the styling",
  "aiStyling.generate": "AI Styling",
  "aiStyling.title": "AI Styling",
  "aiStyling.placeholder": "Describe the changes you want...",
  "aiStyling.error": "Failed to process AI response",
  "aiStyling.noChanges": "No style changes found",
  "aiStyling.disclaimer": "AI can make mistakes. Please double-check the changes.",
  "aiStyling.loading1": "Looking over the element",
  "aiStyling.loading2": "Exploring style options",
  "aiStyling.loading3": "Adjusting the properties",
  "aiStyling.loading4": "Polishing the code",
  "aiStyling.loading5": "Checking the result",

  "aiRepro.loading1": "Retracing your actions",
  "aiRepro.loading2": "Following the flow",
  "aiRepro.loading3": "Ordering the repro steps",
  "aiRepro.loading4": "Writing the steps",
  "aiRepro.loading5": "Checking nothing's missing",
} satisfies Bundle;

export const ai = { ko, en };
