import type { JiraAuth } from "@/types/jira";
import type { Accounts, JiraAccount, JiraLastSubmitFields, LastSubmitFieldsByPlatform, PlatformId } from "@/types/platform";

export interface SettingsData {
  accounts: Accounts;
  lastSubmitFields: LastSubmitFieldsByPlatform;
  lastSubmittedPlatform?: PlatformId;
  titlePrefix: string;
  [key: string]: unknown;
}
export const SETTINGS_STORE_VERSION = 12;

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

type V3Shape = Pick<SettingsData, "accounts" | "lastSubmitFields">;

export function migrateV1ToV2(legacy: LegacyV1): LegacyV2 {
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

function readTitlePrefix(account: unknown): string | undefined {
  const tp = (account as Record<string, unknown> | undefined)?.titlePrefix;
  return typeof tp === "string" ? tp : undefined;
}

export function migrateToV5(state: V3Shape): V3Shape & { titlePrefix: string } {
  const a = state.accounts;
  const prefix =
    readTitlePrefix(a.jira) ?? readTitlePrefix(a.github) ?? readTitlePrefix(a.linear) ?? "";
  return { ...state, titlePrefix: prefix };
}

// v11: jira 연결 이슈 단일→복수. 직전 제출값의 relatesKey/relatesLabel을 relates[] 첫 항목으로 이관.
// v10 데이터는 jira에 옛 relatesKey/relatesLabel을 들고 오므로 입력 타입에서 그 키를 허용한다.
type JiraLastSubmitPreV11 = JiraLastSubmitFields & {
  relatesKey?: string;
  relatesLabel?: string;
};
type PreV11Shape = {
  accounts: V3Shape["accounts"];
  lastSubmitFields: Omit<V3Shape["lastSubmitFields"], "jira"> & {
    jira?: JiraLastSubmitPreV11;
  };
};

export function migrateToV11(state: PreV11Shape): V3Shape {
  const lastSubmitFields = state.lastSubmitFields ?? {};
  const jira = lastSubmitFields.jira;
  if (!jira?.relatesKey) return { ...state, lastSubmitFields } as V3Shape;
  const { relatesKey, relatesLabel, ...rest } = jira;
  return {
    ...state,
    lastSubmitFields: {
      ...lastSubmitFields,
      jira: { ...rest, relates: [{ key: relatesKey, label: relatesLabel ?? relatesKey }] },
    },
  } as V3Shape;
}

// url 없는 webhook 계정은 제출이 불가능한 껍데기다. 정상 경로로는 생기지 않지만
// (연결 테스트를 통과해야 저장된다) 그대로 두면 탭만 뜨고 제출이 매번 실패한다.
export function migrateToV12(state: V3Shape): V3Shape {
  const accounts = (state.accounts ?? {}) as Record<string, unknown>;
  const wh = accounts.webhook as { auth?: { url?: unknown } } | undefined;
  if (!wh) return state;
  if (typeof wh.auth?.url === "string" && wh.auth.url !== "") return state;
  const { webhook: _drop, ...rest } = accounts;
  return { ...state, accounts: rest } as V3Shape;
}

export function isV3Shape(state: unknown): state is V3Shape {
  if (!state || typeof state !== "object") return false;
  return "accounts" in state;
}

export function migrateSettings(persistedState: unknown, version: number): SettingsData {
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
  if (version < 11) {
    state = migrateToV11(state as V3Shape) as Record<string, unknown>;
  }
  if (version < 12) {
    state = migrateToV12(state as V3Shape) as Record<string, unknown>;
  }
  const result = { ...(persistedState as object), ...state } as unknown as SettingsData;
  const legacy = result.jiraConfig as LegacyV2["jiraConfig"];
  if (legacy?.auth && !result.accounts.jira) {
    result.accounts = { ...result.accounts, ...migrateV2ToV3({ jiraConfig: legacy }).accounts };
  }
  delete result.jiraConfig;
  return result;
}
