import type { JiraAuth } from "@/types/jira";
import type { GithubAuth } from "@/types/github";
import type { LinearAuth } from "@/types/linear";
import type { NotionAuth } from "@/types/notion";
import type { GitlabAuth } from "@/types/gitlab";
import type { AsanaAuth } from "@/types/asana";
import type { ClickupAuth } from "@/types/clickup";
import type { SlackAuth } from "@/types/slack";

export const SETTINGS_STORAGE_KEY = "bugshot-settings";

interface SettingsEnvelope {
  state?: {
    accounts?: {
      jira?: { auth?: JiraAuth };
      github?: { auth?: GithubAuth };
      linear?: { auth?: LinearAuth };
      notion?: { auth?: NotionAuth };
      gitlab?: { auth?: GitlabAuth };
      asana?: { auth?: AsanaAuth };
      clickup?: { auth?: ClickupAuth };
      slack?: { auth?: SlackAuth };
    };
    jiraConfig?: { auth?: JiraAuth };
  };
  version?: number;
}

type AccountsShape = NonNullable<NonNullable<SettingsEnvelope["state"]>["accounts"]>;
type AccountKey = keyof AccountsShape;
type AuthOf<K extends AccountKey> = NonNullable<NonNullable<AccountsShape[K]>["auth"]>;
type OAuthAuthOf<K extends AccountKey> = Extract<AuthOf<K>, { kind: "oauth" }>;

async function readEnvelope(): Promise<
  { raw: unknown; envelope: SettingsEnvelope | null }
> {
  const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const raw = result[SETTINGS_STORAGE_KEY];
  if (raw == null) return { raw: null, envelope: null };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { raw, envelope: parsed as SettingsEnvelope };
  } catch {
    return { raw, envelope: null };
  }
}

function reader<K extends AccountKey>(
  account: K,
  // jira만 v1 시절 `state.jiraConfig.auth`에 저장했다. 그 envelope이 남은 설치본이 있어
  // 폴백을 지우면 조용히 로그아웃된다.
  legacy?: (envelope: SettingsEnvelope) => AuthOf<K> | undefined,
): () => Promise<AuthOf<K> | null> {
  return async () => {
    const { envelope } = await readEnvelope();
    if (!envelope) return null;
    return envelope.state?.accounts?.[account]?.auth ?? legacy?.(envelope) ?? null;
  };
}

interface OAuthWriteSpec<K extends AccountKey, A extends OAuthAuthOf<K>> {
  account: K;
  // 갱신 대상 화이트리스트. 여기 없는 필드는 신원(cloudId·viewerLogin·grantedAt·baseUrl 등)이고
  // 갱신 응답에 값이 실려와도 건드리면 안 된다 — gitlab baseUrl은 self-managed 인스턴스 주소라
  // 덮이면 그 계정으로 요청이 안 나간다. `keyof A`는 오타만 막지 목록이 넓어지는 건 못 막으므로,
  // settings-storage.test.ts의 envelope 전량 대조가 그쪽 그물이다.
  fields: readonly (keyof A & string)[];
  // 응답에 값이 없으면 기존 값을 유지할 필드. github만 refreshToken·expiresAt이 optional이라
  // 단순 대입이면 갱신 때마다 refresh token이 지워져 무한 재로그인이 된다.
  keepIfAbsent?: readonly (keyof A & string)[];
}

function writer<K extends AccountKey, A extends OAuthAuthOf<K>>(
  spec: OAuthWriteSpec<K, A>,
): (auth: A) => Promise<void> {
  return async (auth) => {
    const { raw, envelope } = await readEnvelope();
    const cur = envelope?.state?.accounts?.[spec.account]?.auth;
    // 판별자 비교는 타입이 봐야 한다 — cur를 Record<string, unknown>으로 눕히면 "oauth2"
    // 같은 오타가 컴파일을 통과하고 5개 writer가 통째로 무음 no-op이 된다.
    if (!cur || cur.kind !== "oauth") return;
    const target = cur as A;
    for (const field of spec.fields) {
      target[field] = spec.keepIfAbsent?.includes(field)
        ? auth[field] ?? target[field]
        : auth[field];
    }
    const next = typeof raw === "string" ? JSON.stringify(envelope) : envelope;
    await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
  };
}

export const readStoredAuth = reader(
  "jira",
  (envelope) => envelope.state?.jiraConfig?.auth,
);
export const readStoredGithubAuth = reader("github");
export const readStoredLinearAuth = reader("linear");
export const readStoredNotionAuth = reader("notion");
export const readStoredGitlabAuth = reader("gitlab");
export const readStoredAsanaAuth = reader("asana");
export const readStoredClickupAuth = reader("clickup");
export const readStoredSlackAuth = reader("slack");

export const writeStoredOAuthTokens = writer({
  account: "jira",
  fields: ["accessToken", "refreshToken", "expiresAt"],
});
export const writeStoredGithubOAuthTokens = writer({
  account: "github",
  fields: ["accessToken", "tokenType", "scope", "refreshToken", "expiresAt"],
  keepIfAbsent: ["refreshToken", "expiresAt"],
});
export const writeStoredLinearOAuthTokens = writer({
  account: "linear",
  fields: ["accessToken", "refreshToken", "expiresAt", "scope"],
});
export const writeStoredGitlabOAuthTokens = writer({
  account: "gitlab",
  fields: ["accessToken", "refreshToken", "expiresAt", "scope"],
});
export const writeStoredAsanaOAuthTokens = writer({
  account: "asana",
  fields: ["accessToken", "refreshToken", "expiresAt"],
});
