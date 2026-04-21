import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { JiraConfigPayload } from "@/types/jira";
import { chromeLocalStorage } from "./chrome-storage";

export interface JiraConfig extends JiraConfigPayload {
  projectKey?: string;
  issueTypeId?: string;
  issueTypeName?: string;
  titlePrefix?: string;
}

interface SettingsState {
  jiraConfig: JiraConfig | null;
  setJiraConfig: (config: JiraConfig | null) => void;
  updateJiraConfig: (patch: Partial<JiraConfig>) => void;
  clearJiraConfig: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      jiraConfig: null,
      setJiraConfig: (jiraConfig) => set({ jiraConfig }),
      updateJiraConfig: (patch) =>
        set((state) => ({
          jiraConfig: state.jiraConfig
            ? { ...state.jiraConfig, ...patch }
            : null,
        })),
      clearJiraConfig: () => set({ jiraConfig: null }),
    }),
    {
      name: "bugshot-settings",
      storage: createJSONStorage(() => chromeLocalStorage),
    },
  ),
);

export function isJiraConfigComplete(
  cfg: JiraConfig | null,
): cfg is JiraConfig & { projectKey: string } {
  return !!cfg?.baseUrl && !!cfg.email && !!cfg.apiToken && !!cfg.projectKey;
}

export function jiraCredentialsFilled(cfg: JiraConfig | null): boolean {
  return !!cfg?.baseUrl && !!cfg.email && !!cfg.apiToken;
}
