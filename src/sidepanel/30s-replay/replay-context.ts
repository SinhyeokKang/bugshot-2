import { createContext, useContext } from "react";

export interface ReplayContextValue {
  replayEnabled: boolean;
  isReady: boolean;
  isEncoding: boolean;
  bufferedSeconds: number;
  capture: () => Promise<void>;
  // trim 오버레이가 떠 있는 동안 true — DraftingPanel(TiptapEditor) 마운트를 보류해
  // ReplayTrimDialog와 두 lazy 청크가 동시 로드되며 생기는 editor 라이프사이클 레이스를 피한다.
  trimming: boolean;
}

const ReplayContext = createContext<ReplayContextValue>({
  replayEnabled: false,
  isReady: false,
  isEncoding: false,
  bufferedSeconds: 0,
  capture: async () => {},
  trimming: false,
});

export const ReplayProvider = ReplayContext.Provider;
export const useReplay = () => useContext(ReplayContext);
