import { useEditorStore } from "@/store/editor-store";

// useAiRun이 "슬롯이 아직 내 canceller인가"를 판정할 때 쓰는 라이브 리더.
// 모듈 레벨이라 참조가 안정적이고, 헬퍼가 store를 직접 import하지 않게 해준다.
export const getAiCancel = () => useEditorStore.getState().aiCancel;
