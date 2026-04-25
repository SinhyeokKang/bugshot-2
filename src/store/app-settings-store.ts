import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { chromeLocalStorage } from "./chrome-storage";

export type ThemeMode = "light" | "dark" | "system";
export type LocaleMode = "ko" | "en";

function detectLocale(): LocaleMode {
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("ko")) return "ko";
  return "en";
}

interface AppSettingsState {
  theme: ThemeMode;
  locale: LocaleMode;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: LocaleMode) => void;
}

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set) => ({
      theme: "system",
      locale: detectLocale(),
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: "bugshot-app-settings",
      storage: createJSONStorage(() => chromeLocalStorage),
    },
  ),
);
