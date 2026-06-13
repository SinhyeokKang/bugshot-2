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
import type { LinearAccount } from "@/types/linear";
import type { NotionAccount } from "@/types/notion";
import type { GitlabAccount } from "@/types/gitlab";
import type { AsanaAccount } from "@/types/asana";
import { SETTINGS_STORAGE_KEY } from "@/lib/settings-storage";
import { chromeLocalStorage } from "./chrome-storage";

// v6: notion 플랫폼 추가 (accounts.notion / lastSubmitFields.notion / lastSubmittedPlatform="notion").
// v7: gitlab 플랫폼 추가. 새 필드는 모두 optional이라 v6→v7 데이터 마이그레이션 불필요 — 버전 마커만 bump.
// v8: asana 플랫폼 추가. 동일하게 새 필드 모두 optional이라 버전 마커만 bump.
export const SETTINGS_STORE_VERSION = 8;

interface SettingsState {
  accounts: Accounts;
  lastSubmitFields: LastSubmitFieldsByPlatform;
  lastSubmittedPlatform?: PlatformId;
  titlePrefix: string;
  setAccount: <P extends PlatformId>(platform: P, account: Accounts[P]) => void;
  removeAccount: (platform: PlatformId) => void;
  removeAllAccounts: () => void;
  updateJiraAccount: (
    patch: Partial<Omit<JiraAccount, "platform" | "connectedAt">>,
  ) => void;
  updateGithubAccount: (
    patch: Partial<Omit<GithubAccount, "platform" | "connectedAt">>,
  ) => void;
  updateLinearAccount: (
    patch: Partial<Omit<LinearAccount, "platform" | "connectedAt">>,
  ) => void;
  updateNotionAccount: (
    patch: Partial<Omit<NotionAccount, "platform" | "connectedAt">>,
  ) => void;
  updateGitlabAccount: (
    patch: Partial<Omit<GitlabAccount, "platform" | "connectedAt">>,
  ) => void;
  updateAsanaAccount: (
    patch: Partial<Omit<AsanaAccount, "platform" | "connectedAt">>,
  ) => void;
  setLastSubmitFields: <P extends PlatformId>(
    platform: P,
    fields: NonNullable<LastSubmitFieldsByPlatform[P]>,
  ) => void;
  setLastSubmittedPlatform: (platform: PlatformId) => void;
  setTitlePrefix: (prefix: string) => void;
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
      ...(j.titlePrefix ? { titlePrefix: j.titlePrefix } : {}),
    } as JiraAccount;
  }
  const lastSubmitFields: LastSubmitFieldsByPlatform = {};
  if (legacy.lastSubmitFields && Object.keys(legacy.lastSubmitFields).length) {
    lastSubmitFields.jira = { ...legacy.lastSubmitFields };
  }
  return { accounts, lastSubmitFields };
}

export function migrateToV5(state: V3Shape): V3Shape & { titlePrefix: string } {
  const a = state.accounts;
  const prefix =
    (a.jira as Record<string, unknown> | undefined)?.titlePrefix as string | undefined ??
    (a.github as Record<string, unknown> | undefined)?.titlePrefix as string | undefined ??
    (a.linear as Record<string, unknown> | undefined)?.titlePrefix as string | undefined ??
    "";
  return { ...state, titlePrefix: prefix };
}

function isV3Shape(state: unknown): state is V3Shape {
  if (!state || typeof state !== "object") return false;
  return "accounts" in state;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      accounts: {},
      lastSubmitFields: {},
      titlePrefix: "",
      setAccount: (platform, account) =>
        set((s) => ({ accounts: { ...s.accounts, [platform]: account } })),
      removeAccount: (platform) =>
        set((s) => {
          const next = { ...s.accounts };
          delete next[platform];
          // 연동 해제 시 해당 플랫폼의 prefill(issueType·assignee 등)도 함께 정리.
          const nextFields = { ...s.lastSubmitFields };
          delete nextFields[platform];
          return { accounts: next, lastSubmitFields: nextFields };
        }),
      removeAllAccounts: () => set({ accounts: {}, lastSubmitFields: {} }),
      updateJiraAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.jira;
          if (!cur) return s;
          return { accounts: { ...s.accounts, jira: { ...cur, ...patch } } };
        }),
      updateGithubAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.github;
          if (!cur) return s;
          return { accounts: { ...s.accounts, github: { ...cur, ...patch } } };
        }),
      updateLinearAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.linear;
          if (!cur) return s;
          return { accounts: { ...s.accounts, linear: { ...cur, ...patch } } };
        }),
      updateNotionAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.notion;
          if (!cur) return s;
          return { accounts: { ...s.accounts, notion: { ...cur, ...patch } } };
        }),
      updateGitlabAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.gitlab;
          if (!cur) return s;
          return { accounts: { ...s.accounts, gitlab: { ...cur, ...patch } } };
        }),
      updateAsanaAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.asana;
          if (!cur) return s;
          return { accounts: { ...s.accounts, asana: { ...cur, ...patch } } };
        }),
      setLastSubmitFields: (platform, fields) =>
        set((s) => ({
          lastSubmitFields: { ...s.lastSubmitFields, [platform]: fields },
        })),
      setLastSubmittedPlatform: (platform) =>
        set({ lastSubmittedPlatform: platform }),
      setTitlePrefix: (prefix) => set({ titlePrefix: prefix }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: SETTINGS_STORE_VERSION,
      storage: createJSONStorage(() => chromeLocalStorage),
      migrate: (persistedState, version) => {
        let state: Record<string, unknown>;
        if (isV3Shape(persistedState)) {
          state = persistedState as Record<string, unknown>;
        } else {
          let v2: LegacyV2;
          if (version >= 2) {
            v2 = (persistedState as LegacyV2) ?? {};
          } else {
            v2 = migrateV1ToV2((persistedState as LegacyV1) ?? {});
          }
          state = migrateV2ToV3(v2) as Record<string, unknown>;
        }
        if (version < 5) {
          state = migrateToV5(state as V3Shape);
        }
        return state as unknown as SettingsState;
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

const PLATFORM_FALLBACK_ORDER: PlatformId[] = [
  "jira",
  "github",
  "linear",
  "gitlab",
  "notion",
  "asana",
];

// 다이얼로그가 열릴 때 어느 플랫폼 탭을 default로 보여줄지 결정.
// 1) lastSubmittedPlatform이 여전히 연결돼 있으면 그것
// 2) 그 외엔 jira → github 순으로 처음 연결된 것
// 3) 아무것도 연결 안 됐으면 null (다이얼로그 진입 자체를 막아야 함)
export function pickInitialPlatform(
  accounts: Accounts,
  lastSubmittedPlatform: PlatformId | undefined,
): PlatformId | null {
  if (lastSubmittedPlatform && accounts[lastSubmittedPlatform]) {
    return lastSubmittedPlatform;
  }
  for (const p of PLATFORM_FALLBACK_ORDER) {
    if (accounts[p]) return p;
  }
  return null;
}

export function connectedPlatforms(accounts: Accounts): PlatformId[] {
  return PLATFORM_FALLBACK_ORDER.filter((p) => !!accounts[p]);
}

export function isLinearAccountComplete(
  acc: LinearAccount | undefined,
): boolean {
  return !!acc?.auth;
}

export function isNotionAccountComplete(
  acc: NotionAccount | undefined,
): boolean {
  return !!acc?.auth;
}
