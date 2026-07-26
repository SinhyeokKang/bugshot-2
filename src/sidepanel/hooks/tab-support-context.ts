import { createContext, useContext } from "react";

// App이 useTabUnsupported로 한 번 판정해 내려보낸다 — 소비처가 각자 구독하면 판정 출처가 늘고
// 같은 탭에 tabs.get·onUpdated가 중복 붙는다.
const TabSupportContext = createContext(false);

export const TabSupportProvider = TabSupportContext.Provider;
export const useUnsupportedTab = () => useContext(TabSupportContext);
