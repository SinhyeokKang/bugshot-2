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

/**
 * 두 auth가 같은가. `excluded`를 뺀 나머지를 대조하며, **첫 인자의 키만** 순회한다
 * (`a`에 없고 `b`에만 있는 키는 비교되지 않는다 — 호출부가 "새로 들어온 쪽"을 `a`에 둔다).
 *
 * `excluded`가 두 질문을 가른다:
 *  - **같은 그랜트인가**(storage writer) — 토큰 축만 뺀다. `grantedAt`이 비교에 남아야
 *    같은 계정을 다시 연결한 뒤 뒤늦게 돌아온 옛 갱신을 걸러낸다(그걸 쓰면 방금 받은
 *    토큰이 소모된 값으로 덮여 다음 갱신이 invalid_grant가 된다).
 *  - **같은 계정인가**(store) — 토큰 축 + `grantedAt`을 뺀다. 재연동은 매번 새 그랜트라
 *    `grantedAt`이 항상 갈리는데, 그걸 신원으로 세면 "같은 계정 보전"이 영영 성립하지 않는다.
 *
 * **한쪽에만 있는 필드는 불일치로 보지 않는다.** 오탐의 비용이 미탐만큼 크기 때문 —
 * 정상 회전을 no-op으로 만들면 회전 토큰이 유실돼 다음 갱신이 invalid_grant가 되고,
 * 그게 곧 사용자에게 강제 재연동으로 보인다.
 *
 * 비-oauth(PAT·apiKey) auth는 토큰 필드가 `excluded`에 없어 토큰까지 신원으로 읽힌다 —
 * 토큰만 갈아끼워도 "다른 계정"이 되지만, 실패가 "지우는 쪽"이라 안전 방향이다.
 */
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
    if (av !== bv) return false;
  }
  return true;
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
    // 재연동이 상시 경로가 되면서 생긴 창을 막는다: in-flight refresh가 재연동 뒤 resolve하면
    // 토큰 3필드만 구 계정 값으로 덮이고 신원 필드는 새 값으로 남아 `구 토큰 + 신 신원`이 된다.
    // GitLab self-managed면 A 인스턴스 토큰이 B의 baseUrl로 나간다.
    if (
      !sameAuthIdentity(
        auth as unknown as Record<string, unknown>,
        cur as unknown as Record<string, unknown>,
        grantIdentityExcluded(spec.account),
      )
    ) {
      return;
    }
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
} as const satisfies Record<AccountKey, readonly string[]>;

// 계정 신원 판정에서 뺄 축 = 토큰 축 + 그랜트 발급 시각. `grantedAt`은 재연동마다 새로
// 찍히므로(jira만 이 필드가 없다) 신원으로 세면 같은 계정 재연동이 영영 "다른 계정"이 된다.
// writer는 이걸 쓰지 않는다 — 거기선 그랜트가 갈렸는지가 곧 판정 대상이다.
export function accountIdentityExcluded(account: AccountKey): readonly string[] {
  return [...OAUTH_TOKEN_FIELDS[account], "grantedAt"];
}

// 같은 **그랜트**인지 볼 때 뺄 축. `grantedAt`을 남겨야 재연동 뒤 뒤늦게 돌아온 옛 갱신이
// 걸러진다. 이름을 붙이는 건 위 함수와 나란히 놓여 두 질문이 호출부에서 갈려 읽히게 하려는 것.
export function grantIdentityExcluded(account: AccountKey): readonly string[] {
  return OAUTH_TOKEN_FIELDS[account];
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
