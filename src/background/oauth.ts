import { t } from "@/i18n";
import type { TranslationKey } from "@/i18n/ko";
import type { JiraOAuthAuth, JiraSite } from "@/types/jira";
import type { PlatformId } from "@/types/platform";
import { writeStoredOAuthTokens } from "@/lib/settings-storage";
import {
  OAUTH_CONFIG,
  assertConfigured as assertOAuthConfigured,
  isCancellation,
} from "./oauth/config";
import { OAuthError } from "./oauth/errors";

export { OAuthError, type OAuthErrorOptions } from "./oauth/errors";

const AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
const RESOURCES_URL =
  "https://api.atlassian.com/oauth/token/accessible-resources";
const SCOPES = [
  "read:jira-user",
  "read:jira-work",
  "write:jira-work",
  "offline_access",
];

// BgError body로 직렬화하는 단일 출처. messages.ts의 isOAuthCancelled /
// isOAuthRefreshFailed / getOAuthErrorPlatform 판독부와 짝을 이룬다(드리프트 방지).
// oauthNotConfigured·oauthLaunchFailed는 401 레인을 벗어나기 위한 마커라 판독부가 없다 —
// 대칭이 안 맞아 보인다고 판독 함수를 늘리지 말 것(소비처 없는 reader가 된다).
export function serializeOAuthError(error: OAuthError): {
  status: number | undefined;
  body: Record<string, unknown>;
} {
  if (error.cancelled) {
    return { status: undefined, body: { oauthCancelled: true, platform: error.platform } };
  }
  // 설정 누락은 "세션 만료"가 아니다 — 401로 내리면 App이 onOAuthExpired를 발화해
  // 연결한 적 없는 사용자에게 재로그인 안내를 띄운다. 400 + 전용 플래그로 분기시킨다.
  if (error.notConfigured) {
    return { status: 400, body: { oauthNotConfigured: true, platform: error.platform } };
  }
  // 인증 창 자체가 못 뜬 것도 만료가 아니다 — 같은 이유로 401 레인에서 뺀다.
  if (error.launchFailed) {
    return { status: 400, body: { oauthLaunchFailed: true, platform: error.platform } };
  }
  return { status: 401, body: { oauthRefreshFailed: true, platform: error.platform } };
}

export function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Promise 형태의 launchWebAuthFlow는 창을 닫아도 resolve(undefined)가 아니라 reject한다
// (각 start*OAuth의 `if (!redirect)` 취소 분기는 그래서 도달하지 않는다). 문자열 출처는
// Chromium chrome/browser/extensions/api/identity/identity_constants.h.
// kPageLoadTimedOut은 빠져 있다 — web_auth_flow.cc의 MaybeStartTimeout이 SILENT 모드에서만
// 타이머를 걸고 우리는 항상 interactive: true라 도달하지 않는다.
interface LaunchFlowError {
  match: RegExp;
  key: TranslationKey;
  cancelled: boolean;
}

// 상호 배타적이라 순서는 무관하다 — 항목을 추가할 땐 겹치지 않는지 확인할 것.
const LAUNCH_FLOW_ERRORS: readonly LaunchFlowError[] = [
  { match: /did not approve access/i, key: "oauth.error.cancelled", cancelled: true },
  { match: /page could not be loaded/i, key: "oauth.error.authorizationPageFailed", cancelled: false },
  { match: /create a browser window/i, key: "oauth.error.windowCreateFailed", cancelled: false },
  // 프로필이 파괴돼야 나오는데 그러면 사이드패널도 같이 죽어 이 문구는 표시되지 않는다.
  // 집계도 미분류일 때와 같은 failed다 — 관측 가능한 효과는 없고 테이블 완전성으로 남긴다.
  { match: /browser context has been shut down/i, key: "oauth.error.browserContextShutDown", cancelled: false },
  { match: /one web auth flow is allowed/i, key: "oauth.error.flowAlreadyInProgress", cancelled: false },
];

export function classifyLaunchFlowError(message: string): LaunchFlowError | null {
  return LAUNCH_FLOW_ERRORS.find((entry) => entry.match.test(message)) ?? null;
}

export async function launchOAuthWebFlow(
  url: string,
  platform: PlatformId,
): Promise<string | undefined> {
  try {
    return await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const classified = classifyLaunchFlowError(message);
    if (classified) {
      throw new OAuthError(t(classified.key), {
        platform,
        cancelled: classified.cancelled,
        launchFailed: !classified.cancelled,
      });
    }
    throw err;
  }
}

export function isAtlassianCancellationCode(code: string | null): boolean {
  return isCancellation(OAUTH_CONFIG.jira, code);
}

function proxyTokenUrl(): string {
  return `${OAUTH_CONFIG.jira.proxyUrl}/token`;
}

function assertConfigured(): void {
  assertOAuthConfigured(OAUTH_CONFIG.jira);
}

function redirectUri(): string {
  return chrome.identity.getRedirectURL();
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface OAuthStartResult {
  sites: JiraSite[];
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function startOAuthFlow(): Promise<OAuthStartResult> {
  assertConfigured();
  const state = crypto.randomUUID();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", OAUTH_CONFIG.jira.clientId);
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt", "consent");

  const redirect = await launchOAuthWebFlow(url.toString(), "jira");
  if (!redirect) {
    throw new OAuthError(t("oauth.error.cancelled"), { platform: "jira", cancelled: true });
  }

  const parsed = new URL(redirect);
  const code = parsed.searchParams.get("code");
  const returnedState = parsed.searchParams.get("state");
  const errorParam = parsed.searchParams.get("error");
  if (errorParam) {
    throw new OAuthError(
      parsed.searchParams.get("error_description") || errorParam,
      { platform: "jira", cancelled: isAtlassianCancellationCode(errorParam) },
    );
  }
  if (returnedState !== state) {
    throw new OAuthError(t("oauth.error.stateMismatch"), { platform: "jira" });
  }
  if (!code) throw new OAuthError(t("oauth.error.codeMissing"), { platform: "jira" });

  const tokens = await exchangeCodeForTokens(code);
  const sites = await fetchSites(tokens.access_token);
  return {
    sites,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}

async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(proxyTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      // 프록시가 8개 플랫폼 전부에서 client_id 화이트리스트를 검사한다 — 빠뜨리면 400.
      client_id: OAUTH_CONFIG.jira.clientId,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenExchange", { status: res.status, text }),
      { platform: "jira" },
    );
  }
  return res.json() as Promise<TokenResponse>;
}

async function fetchSites(accessToken: string): Promise<JiraSite[]> {
  const res = await fetch(RESOURCES_URL, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new OAuthError(t("oauth.error.siteList", { status: res.status }), {
      platform: "jira",
    });
  }
  const raw = (await res.json()) as Array<{
    id: string;
    url: string;
    name: string;
    scopes: string[];
    avatarUrl?: string;
  }>;
  return raw.map((r) => ({
    id: r.id,
    url: r.url,
    name: r.name,
    scopes: r.scopes,
    avatarUrl: r.avatarUrl,
  }));
}

export async function refreshOAuthToken(
  auth: JiraOAuthAuth,
): Promise<JiraOAuthAuth> {
  assertConfigured();
  const res = await fetch(proxyTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken,
      client_id: OAUTH_CONFIG.jira.clientId,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenRefresh", { status: res.status, text }),
      { platform: "jira" },
    );
  }
  const data = (await res.json()) as TokenResponse;
  return {
    ...auth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function persistOAuthTokens(auth: JiraOAuthAuth): Promise<void> {
  try {
    await writeStoredOAuthTokens(auth);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new OAuthError(t("oauth.error.tokenPersist", { message }), {
      platform: "jira",
    });
  }
}
