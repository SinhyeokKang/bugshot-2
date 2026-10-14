import { create, type StoreApi, type UseBoundStore } from "zustand";
import { createSettingsAdapter } from "./settings-adapter";
import { applySettingsIntent, type SettingsIntent } from "@/lib/settings-mutations";
import { migrateSettings, SETTINGS_STORE_VERSION } from "@/lib/settings-migrations";
export { migrateV1ToV2, migrateV2ToV3, migrateToV5, migrateToV11, migrateToV12, isV3Shape, SETTINGS_STORE_VERSION } from "@/lib/settings-migrations";
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
import type { ClickupAccount } from "@/types/clickup";
import type { SlackAccount } from "@/types/slack";
import type { WebhookAccount } from "@/types/webhook";


export interface SettingsState {
  accounts: Accounts;
  lastSubmitFields: LastSubmitFieldsByPlatform;
  lastSubmittedPlatform?: PlatformId;
  titlePrefix: string;
  setAccount: <P extends PlatformId>(platform: P, account: Accounts[P]) => void;
  removeAccount: (platform: PlatformId) => void;
  removeAllAccounts: () => void;
  updateJiraAccount: (
    patch: Partial<Omit<JiraAccount, "platform" | "connectedAt">>,
    expectedAuth?: NonNullable<Accounts["jira"]>["auth"],
  ) => void;
  updateGithubAccount: (
    patch: Partial<Omit<GithubAccount, "platform" | "connectedAt">>,
    expectedAuth?: NonNullable<Accounts["github"]>["auth"],
  ) => void;
  updateLinearAccount: (
    patch: Partial<Omit<LinearAccount, "platform" | "connectedAt">>,
    expectedAuth?: NonNullable<Accounts["linear"]>["auth"],
  ) => void;
  updateNotionAccount: (
    patch: Partial<Omit<NotionAccount, "platform" | "connectedAt">>,
    expectedAuth?: NonNullable<Accounts["notion"]>["auth"],
  ) => void;
  updateGitlabAccount: (
    patch: Partial<Omit<GitlabAccount, "platform" | "connectedAt">>,
    expectedAuth?: NonNullable<Accounts["gitlab"]>["auth"],
  ) => void;
  updateAsanaAccount: (
    patch: Partial<Omit<AsanaAccount, "platform" | "connectedAt">>,
    expectedAuth?: NonNullable<Accounts["asana"]>["auth"],
  ) => void;
  updateClickupAccount: (
    patch: Partial<Omit<ClickupAccount, "platform" | "connectedAt">>,
    expectedAuth?: NonNullable<Accounts["clickup"]>["auth"],
  ) => void;
  updateSlackAccount: (
    patch: Partial<Omit<SlackAccount, "platform" | "connectedAt">>,
    expectedAuth?: NonNullable<Accounts["slack"]>["auth"],
  ) => void;
  updateWebhookAccount: (
    patch: Partial<Omit<WebhookAccount, "platform" | "connectedAt">>,
    expectedAuth?: NonNullable<Accounts["webhook"]>["auth"],
  ) => void;
  setLastSubmitFields: <P extends PlatformId>(
    platform: P,
    fields: NonNullable<LastSubmitFieldsByPlatform[P]>,
    expectedAuth?: Accounts[P] extends infer A ? A extends { auth: infer T } ? T : never : never,
  ) => void;
  setLastSubmittedPlatform: (platform: PlatformId) => void;
  setTitlePrefix: (prefix: string) => void;
}

export function createSettingsStore() {
  const store: UseBoundStore<StoreApi<SettingsState>> = create<SettingsState>()(() => ({
    accounts: {}, lastSubmitFields: {}, titlePrefix: "",
    setAccount: (platform, account) => mutate({ kind: "connect", platform, account }),
    removeAccount: (platform) => mutate({ kind: "disconnect", platform }),
    removeAllAccounts: () => mutate({ kind: "disconnectAll" }),
    updateJiraAccount: (patch, expectedAuth) => mutate({ kind: "accountPatch", platform: "jira", patch, expected: expectedAuth ?? store.getState().accounts.jira?.auth }),
    updateGithubAccount: (patch, expectedAuth) => mutate({ kind: "accountPatch", platform: "github", patch, expected: expectedAuth ?? store.getState().accounts.github?.auth }),
    updateLinearAccount: (patch, expectedAuth) => mutate({ kind: "accountPatch", platform: "linear", patch, expected: expectedAuth ?? store.getState().accounts.linear?.auth }),
    updateNotionAccount: (patch, expectedAuth) => mutate({ kind: "accountPatch", platform: "notion", patch, expected: expectedAuth ?? store.getState().accounts.notion?.auth }),
    updateGitlabAccount: (patch, expectedAuth) => mutate({ kind: "accountPatch", platform: "gitlab", patch, expected: expectedAuth ?? store.getState().accounts.gitlab?.auth }),
    updateAsanaAccount: (patch, expectedAuth) => mutate({ kind: "accountPatch", platform: "asana", patch, expected: expectedAuth ?? store.getState().accounts.asana?.auth }),
    updateClickupAccount: (patch, expectedAuth) => mutate({ kind: "accountPatch", platform: "clickup", patch, expected: expectedAuth ?? store.getState().accounts.clickup?.auth }),
    updateSlackAccount: (patch, expectedAuth) => mutate({ kind: "accountPatch", platform: "slack", patch, expected: expectedAuth ?? store.getState().accounts.slack?.auth }),
    updateWebhookAccount: (patch, expectedAuth) => mutate({ kind: "accountPatch", platform: "webhook", patch, expected: expectedAuth ?? store.getState().accounts.webhook?.auth }),
    setLastSubmitFields: (platform, fields, expectedAuth) => mutate({ kind: "prefill", platform, fields, expected: expectedAuth ?? store.getState().accounts[platform]?.auth }),
    setLastSubmittedPlatform: (platform) => mutate({ kind: "settings", patch: { lastSubmittedPlatform: platform } }),
    setTitlePrefix: (titlePrefix) => mutate({ kind: "settings", patch: { titlePrefix } }),
  }));
  const adapter = createSettingsAdapter((data) => store.setState(data));
  function mutate(intent: SettingsIntent) {
    store.setState(applySettingsIntent(store.getState(), intent));
    adapter.enqueue(intent);
  }
  const result = Object.assign(store, { persist: {
    ...adapter,
    getOptions: () => ({ version: SETTINGS_STORE_VERSION, migrate: migrateSettings }),
  } });
  return result;
}

export const useSettingsStore = createSettingsStore();
void useSettingsStore.persist.rehydrate();

export function isJiraAccountComplete(
  acc: JiraAccount | undefined,
): acc is JiraAccount & { projectKey: string } {
  return !!acc?.auth && !!acc.projectKey;
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

// 새 플랫폼이 PlatformId에 추가되면 키 누락으로 컴파일 에러 — 폴백 목록이 조용히 빠지는 걸 막는다.
const PLATFORM_FALLBACK_RANK = {
  jira: 0, github: 1, linear: 2, gitlab: 3,
  notion: 4, asana: 5, clickup: 6, slack: 7, webhook: 8,
} as const satisfies Record<PlatformId, number>;

const PLATFORM_FALLBACK_ORDER = (Object.keys(PLATFORM_FALLBACK_RANK) as PlatformId[])
  .sort((a, b) => PLATFORM_FALLBACK_RANK[a] - PLATFORM_FALLBACK_RANK[b]);

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
