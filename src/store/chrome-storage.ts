import type { StateStorage } from "zustand/middleware";

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
      console.error("[chrome-storage] setItem failed:", name, e);
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
