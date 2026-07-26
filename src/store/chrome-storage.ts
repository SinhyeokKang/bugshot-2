import type { StateStorage } from "zustand/middleware";
import { onStateSaveFailed } from "@/types/messages";

// 조회 실패를 삼켜 null을 주면 소비처가 "저장분 없음"으로 오독한다.
// settings 계열은 그래도 기본값으로 뜨는 게 낫다 — 사이드패널 렌더 게이트가
// persist.onFinishHydration에 걸려 있어(App.tsx `!settingsHydrated`) 실패를 전파하면
// hydration이 영영 끝나지 않고 패널이 빈 화면으로 굳는다.
export const chromeLocalStorage: StateStorage = {
  async getItem(name) {
    try {
      const result = await chrome.storage.local.get(name);
      return (result[name] as string | undefined) ?? null;
    } catch (e) {
      console.error("[chrome-storage] getItem failed:", name, e);
      return null;
    }
  },
  async setItem(name, value) {
    try {
      await chrome.storage.local.set({ [name]: value });
    } catch (e) {
      // QUOTA 초과·IO 오류. 삼키기만 하면 소비처는 저장에 성공한 줄 안다 — 알림을 올린다.
      console.error("[chrome-storage] setItem failed:", name, e);
      onStateSaveFailed.fire();
    }
  },
  async removeItem(name) {
    try {
      await chrome.storage.local.remove(name);
    } catch (e) {
      console.error("[chrome-storage] removeItem failed:", name, e);
    }
  },
};

// 조회 실패가 곧 데이터 삭제로 이어지는 스토어용. issues-store는 rehydrate 결과로
// orphan blob을 prune하므로, 실패를 null로 뭉개면 살아있는 blob 전부가 고아로 판정된다
// (POSTMORTEM 2026-07-23). 실패를 전파해 zustand의 에러 경로를 타게 하고 prune을 건너뛴다.
export const failClosedLocalStorage: StateStorage = {
  ...chromeLocalStorage,
  async getItem(name) {
    const result = await chrome.storage.local.get(name);
    return (result[name] as string | undefined) ?? null;
  },
};
