import { createContext, useContext } from "react";

export interface ReplayContextValue {
  replayEnabled: boolean;
  isReady: boolean;
  isEncoding: boolean;
  capture: () => Promise<void>;
}

const ReplayContext = createContext<ReplayContextValue>({
  replayEnabled: false,
  isReady: false,
  isEncoding: false,
  capture: async () => {},
});

export const ReplayProvider = ReplayContext.Provider;
export const useReplay = () => useContext(ReplayContext);
