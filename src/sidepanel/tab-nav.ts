import { createContext, useContext } from "react";

// 메인 탭(+선택적 설정 sub-tab) 전환을 하위 컴포넌트에서 호출할 수 있게 노출. App이 Provider로 값 주입.
export const TabNavContext = createContext<(tab: string, settingsSub?: string) => void>(() => {});
export const useTabNav = () => useContext(TabNavContext);
