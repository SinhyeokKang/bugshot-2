import { t } from "@/i18n";
import type { GithubAuth, GithubOAuthAuth } from "@/types/github";
import { writeStoredGithubOAuthTokens } from "@/lib/settings-storage";
import { getMyself, setGithubRefreshHook } from "./github-api";
import { OAuthError } from "./oauth";

const CLIENT_ID = (import.meta.env.VITE_GITHUB_CLIENT_ID ?? "").trim();
const PROXY_URL = (import.meta.env.VITE_OAUTH_PROXY_URL ?? "").replace(
  /\/+$/,
  "",
);
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const SCOPES = ["repo"];
const TOKEN_REFRESH_THRESHOLD_MS = 60_000;

export function isGithubOAuthConfigured(): boolean {
  return !!CLIENT_ID && !!PROXY_URL;
}

function assertConfigured(): void {
  if (!CLIENT_ID) {
    throw new OAuthError(t("oauth.error.github.notConfiguredClient"));
  }
  if (!PROXY_URL) {
    throw new OAuthError(t("oauth.error.notConfiguredProxy"));
  }
}

function redirectUri(): string {
  return chrome.identity.getRedirectURL();
}

function proxyTokenUrl(): string {
  return `${PROXY_URL}/github/token`;
}

function proxyRefreshUrl(): string {
  return `${PROXY_URL}/github/refresh`;
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

export function parseCallbackParams(
  redirectUrl: string,
  expectedState: string,
): ParsedCallback {
  const parsed = new URL(redirectUrl);
  const errorParam = parsed.searchParams.get("error");
  if (errorParam) {
    throw new OAuthError(
      parsed.searchParams.get("error_description") || errorParam,
    );
  }
  const returnedState = parsed.searchParams.get("state");
  if (returnedState !== expectedState) {
    throw new OAuthError(t("oauth.error.stateMismatch"));
  }
  const code = parsed.searchParams.get("code");
  if (!code) throw new OAuthError(t("oauth.error.codeMissing"));
  return { code };
}

export async function startGithubOAuth(): Promise<GithubOAuthAuth> {
  assertConfigured();
  const state = crypto.randomUUID();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);

  const redirect = await chrome.identity.launchWebAuthFlow({
    url: url.toString(),
    interactive: true,
  });
  if (!redirect) throw new OAuthError(t("oauth.error.cancelled"));

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
  return { ...auth, viewerLogin: me.login };
}

async function exchangeCodeForTokens(code: string): Promise<GithubTokenResponse> {
  const res = await fetch(proxyTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: redirectUri() }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenExchange", { status: res.status, text }),
    );
  }
  const data = (await res.json()) as GithubTokenResponse | { error?: string; error_description?: string };
  if ("error" in data && data.error) {
    throw new OAuthError(data.error_description || data.error);
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
    throw new OAuthError(t("oauth.error.github.refreshUnavailable"));
  }
  if (!isGithubOAuthConfigured()) {
    throw new OAuthError(t("oauth.error.notConfiguredProxy"));
  }
  const res = await fetch(proxyRefreshUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: auth.refreshToken }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenRefresh", { status: res.status, text }),
    );
  }
  const data = (await res.json()) as GithubTokenResponse | { error?: string; error_description?: string };
  if ("error" in data && data.error) {
    throw new OAuthError(data.error_description || data.error);
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
    throw new OAuthError(t("oauth.error.tokenPersist", { message }));
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

export async function ensureFreshGithubAuth(auth: GithubAuth): Promise<GithubAuth> {
  if (auth.kind !== "oauth") return auth;
  if (auth.expiresAt == null) return auth;
  if (auth.expiresAt - Date.now() > TOKEN_REFRESH_THRESHOLD_MS) return auth;
  return refreshOnceWithLock(auth);
}

// 모듈 로드 시점에 github-api의 401 refresh hook을 주입.
// service worker가 재시작되어도 background 진입 시 다시 등록됨.
setGithubRefreshHook(refreshOnceWithLock);
