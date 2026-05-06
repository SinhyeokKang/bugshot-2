import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { JiraAuth } from "@/types/jira";
import type {
  Accounts,
  JiraAccount,
  LastSubmitFieldsByPlatform,
  PlatformId,
} from "@/types/platform";
import type { GithubAccount } from "@/types/github";
import { SETTINGS_STORAGE_KEY } from "@/lib/settings-storage";
import { chromeLocalStorage } from "./chrome-storage";

export type { JiraAccount } from "@/types/platform";

export const SETTINGS_STORE_VERSION = 3;

interface SettingsState {
  accounts: Accounts;
  lastSubmitFields: LastSubmitFieldsByPlatform;
  setAccount: <P extends PlatformId>(platform: P, account: Accounts[P]) => void;
  removeAccount: (platform: PlatformId) => void;
  updateJiraAccount: (
    patch: Partial<Omit<JiraAccount, "platform" | "connectedAt">>,
  ) => void;
  updateGithubAccount: (
    patch: Partial<Omit<GithubAccount, "platform" | "connectedAt">>,
  ) => void;
  setLastSubmitFields: <P extends PlatformId>(
    platform: P,
    fields: NonNullable<LastSubmitFieldsByPlatform[P]>,
  ) => void;
}

interface LegacyV1 {
  jiraConfig?: {
    baseUrl?: string;
    email?: string;
    apiToken?: string;
    projectKey?: string;
    issueTypeId?: string;
    issueTypeName?: string;
    titlePrefix?: string;
  };
}

interface LegacyV2 {
  jiraConfig?: {
    auth?: JiraAuth;
    projectKey?: string;
    issueTypeId?: string;
    issueTypeName?: string;
    titlePrefix?: string;
  } | null;
  lastSubmitFields?: {
    projectKey?: string;
    assigneeId?: string;
    assigneeName?: string;
    priorityId?: string;
    priorityName?: string;
    parentKey?: string;
    parentLabel?: string;
    relatesKey?: string;
    relatesLabel?: string;
  };
}

type V3Shape = Pick<SettingsState, "accounts" | "lastSubmitFields">;

function migrateV1ToV2(legacy: LegacyV1): LegacyV2 {
  const j = legacy.jiraConfig;
  if (!j?.baseUrl || !j.email || !j.apiToken) return { jiraConfig: null };
  return {
    jiraConfig: {
      auth: {
        kind: "apiKey",
        baseUrl: j.baseUrl,
        email: j.email,
        apiToken: j.apiToken,
      },
      projectKey: j.projectKey,
      issueTypeId: j.issueTypeId,
      issueTypeName: j.issueTypeName,
      titlePrefix: j.titlePrefix,
    },
  };
}

export function migrateV2ToV3(legacy: LegacyV2): V3Shape {
  const accounts: Accounts = {};
  const j = legacy.jiraConfig;
  if (j?.auth) {
    accounts.jira = {
      platform: "jira",
      connectedAt: Date.now(),
      auth: j.auth,
      projectKey: j.projectKey,
      issueTypeId: j.issueTypeId,
      issueTypeName: j.issueTypeName,
      titlePrefix: j.titlePrefix,
    };
  }
  const lastSubmitFields: LastSubmitFieldsByPlatform = {};
  if (legacy.lastSubmitFields && Object.keys(legacy.lastSubmitFields).length) {
    lastSubmitFields.jira = { ...legacy.lastSubmitFields };
  }
  return { accounts, lastSubmitFields };
}

function isV3Shape(state: unknown): state is V3Shape {
  if (!state || typeof state !== "object") return false;
  return "accounts" in state;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      accounts: {},
      lastSubmitFields: {},
      setAccount: (platform, account) =>
        set((s) => ({ accounts: { ...s.accounts, [platform]: account } })),
      removeAccount: (platform) =>
        set((s) => {
          const next = { ...s.accounts };
          delete next[platform];
          return { accounts: next };
        }),
      updateJiraAccount: (patch) => {
        const cur = get().accounts.jira;
        if (!cur) return;
        set((s) => ({
          accounts: { ...s.accounts, jira: { ...cur, ...patch } },
        }));
      },
      updateGithubAccount: (patch) => {
        const cur = get().accounts.github;
        if (!cur) return;
        set((s) => ({
          accounts: { ...s.accounts, github: { ...cur, ...patch } },
        }));
      },
      setLastSubmitFields: (platform, fields) =>
        set((s) => ({
          lastSubmitFields: { ...s.lastSubmitFields, [platform]: fields },
        })),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: SETTINGS_STORE_VERSION,
      storage: createJSONStorage(() => chromeLocalStorage),
      migrate: (persistedState, version) => {
        if (isV3Shape(persistedState)) return persistedState as SettingsState;
        let v2: LegacyV2;
        if (version >= 2) {
          v2 = (persistedState as LegacyV2) ?? {};
        } else {
          v2 = migrateV1ToV2((persistedState as LegacyV1) ?? {});
        }
        return migrateV2ToV3(v2) as SettingsState;
      },
    },
  ),
);

export function isJiraAccountComplete(
  acc: JiraAccount | undefined,
): acc is JiraAccount & { projectKey: string } {
  return !!acc?.auth && !!acc.projectKey;
}

export function jiraCredentialsFilled(acc: JiraAccount | undefined): boolean {
  return !!acc?.auth;
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
