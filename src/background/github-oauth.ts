import { t } from "@/i18n";
import type { GithubAuth, GithubOAuthAuth } from "@/types/github";
import { writeStoredGithubOAuthTokens } from "@/lib/settings-storage";
import { getMyself, setGithubRefreshHook } from "./github-api";
import { OAuthError, launchOAuthWebFlow } from "./oauth";
import {
  OAUTH_CONFIG,
  isConfigured as isOAuthPlatformConfigured,
  assertConfigured as assertOAuthConfigured,
  isCancellation,
} from "./oauth/config";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const SCOPES = ["repo", "user:email"];
export function isGithubOAuthConfigured(): boolean {
  return isOAuthPlatformConfigured(OAUTH_CONFIG.github);
}

function assertConfigured(): void {
  assertOAuthConfigured(OAUTH_CONFIG.github);
}

function redirectUri(): string {
  return chrome.identity.getRedirectURL();
}

function proxyTokenUrl(): string {
  return `${OAUTH_CONFIG.github.proxyUrl}/github/token`;
}

function proxyRefreshUrl(): string {
  return `${OAUTH_CONFIG.github.proxyUrl}/github/refresh`;
}

interface GithubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface ParsedCallback {
  code: string;
}

export function isGithubCancellationCode(code: string | null): boolean {
  return isCancellation(OAUTH_CONFIG.github, code);
}

export function parseCallbackParams(
  redirectUrl: string,
  expectedState: string,
): ParsedCallback {
  const parsed = new URL(redirectUrl);
  const errorParam = parsed.searchParams.get("error");
  if (errorParam) {
    throw new OAuthError(
      parsed.searchParams.get("error_description") || errorParam,
      { platform: "github", cancelled: isGithubCancellationCode(errorParam) },
    );
  }
  const returnedState = parsed.searchParams.get("state");
  if (returnedState !== expectedState) {
    throw new OAuthError(t("oauth.error.stateMismatch"), { platform: "github" });
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new OAuthError(t("oauth.error.codeMissing"), { platform: "github" });
  }
  return { code };
}

export async function startGithubOAuth(): Promise<GithubOAuthAuth> {
  assertConfigured();
  const state = crypto.randomUUID();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", OAUTH_CONFIG.github.clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);

  const redirect = await launchOAuthWebFlow(url.toString(), "github");
  if (!redirect) {
    throw new OAuthError(t("oauth.error.cancelled"), {
      platform: "github",
      cancelled: true,
    });
  }

  const { code } = parseCallbackParams(redirect, state);
  const tokens = await exchangeCodeForTokens(code);
  const auth: GithubOAuthAuth = {
    kind: "oauth",
    accessToken: tokens.access_token,
    tokenType: tokens.token_type,
    scope: tokens.scope,
    refreshToken: tokens.refresh_token,
    expiresAt:
      tokens.expires_in != null
        ? Date.now() + tokens.expires_in * 1000
        : undefined,
    viewerLogin: "",
    grantedAt: Date.now(),
  };
  const me = await getMyself(auth);
  return { ...auth, viewerLogin: me.login, viewerEmail: me.email };
}

async function exchangeCodeForTokens(code: string): Promise<GithubTokenResponse> {
  const res = await fetch(proxyTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      redirect_uri: redirectUri(),
      client_id: OAUTH_CONFIG.github.clientId,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenExchange", { status: res.status, text }),
      { platform: "github" },
    );
  }
  const data = (await res.json()) as GithubTokenResponse | { error?: string; error_description?: string };
  if ("error" in data && data.error) {
    throw new OAuthError(data.error_description || data.error, {
      platform: "github",
      cancelled: isGithubCancellationCode(data.error),
    });
  }
  return data as GithubTokenResponse;
}

export async function refreshGithubToken(
  auth: GithubAuth,
): Promise<GithubAuth> {
  if (auth.kind !== "oauth") return auth;
  if (!auth.refreshToken) {
    // OAuth App에서 "Token expiration" 옵션 OFF면 refresh token이 없다.
    // 만료 없는 토큰이라 호출 자체가 비정상 — 재인증 안내.
    throw new OAuthError(t("oauth.error.github.refreshUnavailable"), {
      platform: "github",
    });
  }
  if (!isGithubOAuthConfigured()) {
    throw new OAuthError(t("oauth.error.notConfiguredProxy"), {
      platform: "github",
    });
  }
  const res = await fetch(proxyRefreshUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: auth.refreshToken,
      client_id: OAUTH_CONFIG.github.clientId,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenRefresh", { status: res.status, text }),
      { platform: "github" },
    );
  }
  const data = (await res.json()) as GithubTokenResponse | { error?: string; error_description?: string };
  if ("error" in data && data.error) {
    throw new OAuthError(data.error_description || data.error, {
      platform: "github",
    });
  }
  const tokens = data as GithubTokenResponse;
  const refreshed: GithubOAuthAuth = {
    ...auth,
    accessToken: tokens.access_token,
    tokenType: tokens.token_type,
    scope: tokens.scope,
    refreshToken: tokens.refresh_token ?? auth.refreshToken,
    expiresAt:
      tokens.expires_in != null
        ? Date.now() + tokens.expires_in * 1000
        : undefined,
  };
  await persistGithubOAuthTokens(refreshed);
  return refreshed;
}

export async function persistGithubOAuthTokens(
  auth: GithubOAuthAuth,
): Promise<void> {
  try {
    await writeStoredGithubOAuthTokens(auth);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new OAuthError(t("oauth.error.tokenPersist", { message }), {
      platform: "github",
    });
  }
}

let refreshInFlight: Promise<GithubAuth> | null = null;

async function refreshOnceWithLock(auth: GithubAuth): Promise<GithubAuth> {
  if (auth.kind !== "oauth") return auth;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshGithubToken(auth).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// 모듈 로드 시점에 github-api의 401 refresh hook을 주입.
// service worker가 재시작되어도 background 진입 시 다시 등록됨.
setGithubRefreshHook(refreshOnceWithLock);
