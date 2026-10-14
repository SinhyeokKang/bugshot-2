import type { JiraAuth } from "@/types/jira";
import type { GithubAuth } from "@/types/github";
import type { LinearAuth } from "@/types/linear";
import type { NotionAuth } from "@/types/notion";
import type { GitlabAuth } from "@/types/gitlab";
import type { AsanaAuth } from "@/types/asana";
import type { ClickupAuth } from "@/types/clickup";
import type { SlackAuth } from "@/types/slack";
import type { WebhookAuth } from "@/types/webhook";

import { readSettingsEnvelope, transactSettings, StaleGrantError } from "./settings-envelope";
export { SETTINGS_STORAGE_KEY, withSettingsWriteLock } from "./settings-envelope";

type AccountsShape = {
  jira: { auth: JiraAuth }; github: { auth: GithubAuth }; linear: { auth: LinearAuth };
  notion: { auth: NotionAuth }; gitlab: { auth: GitlabAuth }; asana: { auth: AsanaAuth };
  clickup: { auth: ClickupAuth }; slack: { auth: SlackAuth }; webhook: { auth: WebhookAuth };
};
type AccountKey = keyof AccountsShape;
type OAuthAccountKey = Exclude<AccountKey, "webhook">;
type AuthOf<K extends OAuthAccountKey> = AccountsShape[K]["auth"];
type OAuthAuthOf<K extends OAuthAccountKey> = Extract<AuthOf<K>, { kind: "oauth" }>;
type SettingsEnvelope = { state?: { accounts?: Partial<AccountsShape>; jiraConfig?: { auth?: JiraAuth } } };

function reader<K extends OAuthAccountKey>(
  account: K,
  // jira만 v1 시절 `state.jiraConfig.auth`에 저장했다. 그 envelope이 남은 설치본이 있어
  // 폴백을 지우면 조용히 로그아웃된다.
  legacy?: (envelope: SettingsEnvelope) => AuthOf<K> | undefined,
): () => Promise<AuthOf<K> | null> {
  return async () => {
    const { envelope } = await readSettingsEnvelope();
    if (!envelope) return null;
    const auth = envelope.state?.accounts?.[account]?.auth ?? legacy?.(envelope) ?? null;
    if (auth?.kind === "oauth" && REFRESH_PLATFORMS.includes(account)) return acquireStoredAuth(account, auth) as Promise<AuthOf<K>>;
    return auth as AuthOf<K> | null;
  };
}

interface OAuthWriteSpec<K extends OAuthAccountKey, A extends OAuthAuthOf<K>> {
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

// Webhook header order is part of identity; compare nested values without losing it.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    return [...keys].every((k) => sameValue(ao[k], bo[k]));
  }
  return false;
}

export function sameAuthIdentity(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  excluded: readonly string[],
): boolean {
  for (const key of Object.keys(a)) {
    if (excluded.includes(key)) continue;
    const av = a[key];
    const bv = b[key];
    if (av === undefined || bv === undefined) continue;
    if (!sameValue(av, bv)) return false;
  }
  return true;
}

export const REFRESH_PLATFORMS: readonly string[] = ["jira", "github", "linear", "gitlab", "asana"];

export function sameOAuthGrant(platform: AccountKey, a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  if (left.kind !== right.kind) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const excluded = OAUTH_TOKEN_FIELDS[platform] as readonly string[];
  if (![...keys].every((key) => excluded.includes(key) || sameValue(left[key], right[key]))) return false;
  if (left.kind !== "oauth") return true;
  if (left.grantId || right.grantId) return !!left.grantId && left.grantId === right.grantId;
  return left.refreshToken === right.refreshToken && left.accessToken === right.accessToken;
}

export async function acquireStoredAuth<A extends { kind: string }>(platform: OAuthAccountKey, requested: A): Promise<A> {
  if (requested.kind !== "oauth" || !REFRESH_PLATFORMS.includes(platform)) return requested;
  const { result } = await transactSettings((state) => {
    const current = state.accounts[platform]?.auth as unknown as Record<string, unknown> | undefined;
    const input = requested as unknown as Record<string, unknown>;
    if (!current || current.kind !== "oauth") throw new StaleGrantError();
    if (input.grantId) {
      if (!sameOAuthGrant(platform, input, current)) throw new StaleGrantError();
    } else {
      const withoutId = { ...current }; delete withoutId.grantId;
      if (!sameOAuthGrant(platform, input, withoutId)) throw new StaleGrantError();
      current.grantId ??= crypto.randomUUID();
    }
    return { ...current } as unknown as A;
  });
  return result;
}

function writer<K extends OAuthAccountKey, A extends OAuthAuthOf<K>>(
  spec: OAuthWriteSpec<K, A>,
): (expected: A, refreshed: A) => Promise<void> {
  return async (expected, refreshed) => {
    if (!sameOAuthGrant(spec.account, expected, refreshed)) throw new StaleGrantError();
    await transactSettings((state) => {
      const cur = state.accounts[spec.account]?.auth;
      if (!cur || cur.kind !== "oauth" || !sameOAuthGrant(spec.account, expected, cur)) throw new StaleGrantError();
      const target = cur as A;
      for (const field of spec.fields) {
        target[field] = spec.keepIfAbsent?.includes(field) ? refreshed[field] ?? target[field] : refreshed[field];
      }
    });
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

// 플랫폼별 토큰 축의 **단일 출처**. writer의 갱신 whitelist이자 신원 판정의 여집합이고,
// store의 setAccount가 같은 값을 재사용한다(같은 계정 재연동이면 직전 제출값을 보전하는 판정).
// 두 곳에 따로 적으면 한쪽만 늘어난 채로 조용히 갈린다.
//
// notion·clickup·slack은 토큰이 회전하지 않아 writer가 없다(갱신 경로 자체가 없다). 그래도
// 신원 판정에는 자기 accessToken을 제외해야 하므로 여기 목록에 남긴다.
export const OAUTH_TOKEN_FIELDS = {
  jira: ["accessToken", "refreshToken", "expiresAt"],
  github: ["accessToken", "tokenType", "scope", "refreshToken", "expiresAt"],
  linear: ["accessToken", "refreshToken", "expiresAt", "scope"],
  notion: ["accessToken"],
  gitlab: ["accessToken", "refreshToken", "expiresAt", "scope"],
  asana: ["accessToken", "refreshToken", "expiresAt"],
  clickup: ["accessToken"],
  slack: ["accessToken"],
  // OAuth가 없다. 사용자 헤더는 시크릿이지만 토큰 축이 아니라 신원 축이다 —
  // 헤더를 바꾸면 다른 목적지일 수 있으므로 신원 비교에서 빼지 않는다.
  webhook: [],
} as const satisfies Record<AccountKey, readonly string[]>;

// Reconnecting the same account preserves prefill even though its grant changed.
export function accountIdentityExcluded(account: AccountKey): readonly string[] {
  return [...OAUTH_TOKEN_FIELDS[account], "grantedAt", "grantId"];
}

// auth **밖**(계정 필드)에 신원을 두는 플랫폼. 지금은 slack의 팀 하나뿐이지만(types/slack.ts;
// 나머지 7개는 cloudId·viewerLogin·baseUrl 등이 전부 auth 안에 있다) Partial로 두면 9번째
// 플랫폼이 같은 모양을 들고 와도 누락이 컴파일에도 테스트에도 안 걸린다 — 빈 배열을 명시해
// 컴파일러가 그 자리에서 결정을 강제하게 한다.
export const ACCOUNT_IDENTITY_FIELDS: Record<AccountKey, readonly string[]> = {
  jira: [],
  github: [],
  linear: [],
  notion: [],
  gitlab: [],
  asana: [],
  clickup: [],
  slack: ["teamId"],
  // 신원(엔드포인트 URL)이 auth 안에 있다.
  webhook: [],
};

export const writeStoredOAuthTokens = writer({
  account: "jira",
  fields: OAUTH_TOKEN_FIELDS.jira,
});
export const writeStoredGithubOAuthTokens = writer({
  account: "github",
  fields: OAUTH_TOKEN_FIELDS.github,
  keepIfAbsent: ["refreshToken", "expiresAt"],
});
export const writeStoredLinearOAuthTokens = writer({
  account: "linear",
  fields: OAUTH_TOKEN_FIELDS.linear,
});
export const writeStoredGitlabOAuthTokens = writer({
  account: "gitlab",
  fields: OAUTH_TOKEN_FIELDS.gitlab,
});
export const writeStoredAsanaOAuthTokens = writer({
  account: "asana",
  fields: OAUTH_TOKEN_FIELDS.asana,
});
