import type { StateStorage } from "zustand/middleware";

export const chromeLocalStorage: StateStorage = {
  async getItem(name) {
    const result = await chrome.storage.local.get(name);
    return (result[name] as string | undefined) ?? null;
  },
  async setItem(name, value) {
    await chrome.storage.local.set({ [name]: value });
  },
  async removeItem(name) {
    await chrome.storage.local.remove(name);
  },
};
