import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { JiraAuth } from "@/types/jira";
import { chromeLocalStorage } from "./chrome-storage";

export interface JiraConfig {
  auth: JiraAuth;
  projectKey?: string;
  issueTypeId?: string;
  issueTypeName?: string;
  titlePrefix?: string;
}

export interface LastSubmitFields {
  projectKey?: string;
  assigneeId?: string;
  assigneeName?: string;
  priorityId?: string;
  priorityName?: string;
  parentKey?: string;
  parentLabel?: string;
  relatesKey?: string;
  relatesLabel?: string;
}

interface SettingsState {
  jiraConfig: JiraConfig | null;
  lastSubmitFields: LastSubmitFields;
  setJiraConfig: (config: JiraConfig | null) => void;
  updateJiraConfig: (patch: Partial<JiraConfig>) => void;
  clearJiraConfig: () => void;
  setLastSubmitFields: (fields: LastSubmitFields) => void;
}

interface LegacyV1Config {
  baseUrl?: string;
  email?: string;
  apiToken?: string;
  projectKey?: string;
  issueTypeId?: string;
  issueTypeName?: string;
  titlePrefix?: string;
}

function migrateLegacy(legacy: LegacyV1Config | null): JiraConfig | null {
  if (!legacy?.baseUrl || !legacy.email || !legacy.apiToken) return null;
  return {
    auth: {
      kind: "apiKey",
      baseUrl: legacy.baseUrl,
      email: legacy.email,
      apiToken: legacy.apiToken,
    },
    projectKey: legacy.projectKey,
    issueTypeId: legacy.issueTypeId,
    issueTypeName: legacy.issueTypeName,
    titlePrefix: legacy.titlePrefix,
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      jiraConfig: null,
      lastSubmitFields: {},
      setJiraConfig: (jiraConfig) => set({ jiraConfig }),
      updateJiraConfig: (patch) =>
        set((state) => ({
          jiraConfig: state.jiraConfig
            ? { ...state.jiraConfig, ...patch }
            : null,
        })),
      clearJiraConfig: () => set({ jiraConfig: null }),
      setLastSubmitFields: (fields) => set({ lastSubmitFields: fields }),
    }),
    {
      name: "bugshot-settings",
      version: 2,
      storage: createJSONStorage(() => chromeLocalStorage),
      migrate: (persistedState, version) => {
        if (version >= 2) return persistedState as SettingsState;
        const legacy = (persistedState as { jiraConfig?: LegacyV1Config })
          ?.jiraConfig;
        return {
          jiraConfig: migrateLegacy(legacy ?? null),
        } as SettingsState;
      },
    },
  ),
);

export function isJiraConfigComplete(
  cfg: JiraConfig | null,
): cfg is JiraConfig & { projectKey: string } {
  return !!cfg?.auth && !!cfg.projectKey;
}

export function jiraCredentialsFilled(cfg: JiraConfig | null): boolean {
  return !!cfg?.auth;
}

export function jiraSiteId(auth: JiraAuth): string {
  if (auth.kind === "oauth") return auth.cloudId;
  try {
    return new URL(auth.baseUrl).hostname;
  } catch {
    return auth.baseUrl;
  }
}

export function jiraHostLabel(auth: JiraAuth): string {
  const url = auth.kind === "apiKey" ? auth.baseUrl : auth.siteUrl;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
