import { createAuthCandidate, createGrantRefresh } from "./lib/authContext";
import { inConnectLane } from "./lib/connectLane";
import { t } from "@/i18n";
import type { GithubAuth, GithubOAuthAuth } from "@/types/github";
import { writeStoredGithubOAuthTokens } from "@/lib/settings-storage";
import { getMyself, setGithubRefreshHook } from "./github-api";
import { OAuthError, authorizeRejection, grantRejection, httpReason, launchOAuthWebFlow } from "./oauth";
import {
  OAUTH_CONFIG,
  assertConfigured as assertOAuthConfigured,
  isCancellation,
} from "./oauth/config";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const SCOPES = ["repo", "user:email"];

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
      { platform: "github", ...authorizeRejection(isGithubCancellationCode(errorParam)) },
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
      reason: "cancelled_window",
    });
  }

  const { code } = parseCallbackParams(redirect, state);
  const tokens = await exchangeCodeForTokens(code);
  const auth: GithubOAuthAuth = {
    kind: "oauth",
    grantId: crypto.randomUUID(),
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
  const candidate = createAuthCandidate(auth);
  const me = await inConnectLane(() => getMyself(auth));
  return { ...candidate.current, viewerLogin: me.login, viewerEmail: me.email };
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
      { platform: "github", reason: httpReason(res.status) },
    );
  }
  const data = (await res.json()) as GithubTokenResponse | { error?: string; error_description?: string };
  if ("error" in data && data.error) {
    throw new OAuthError(data.error_description || data.error, {
      platform: "github",
      ...grantRejection(isGithubCancellationCode(data.error)),
    });
  }
  return data as GithubTokenResponse;
}

async function requestGithubRefresh(
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
  // 나머지 4개 플랫폼 refresh와 같은 경로로 던진다 — 맨 OAuthError를 던지면 notConfigured
  // 플래그가 빠져 401 + oauthRefreshFailed로 오분류되고, analytics reason도 other가 된다.
  assertConfigured();
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
      { platform: "github", reason: httpReason(res.status) },
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
  return refreshed;
}

export async function persistGithubOAuthTokens(expected: GithubOAuthAuth, refreshed: GithubOAuthAuth): Promise<void> {
  await writeStoredGithubOAuthTokens(expected, refreshed);
}

export const refreshGithubToken = createGrantRefresh<GithubAuth>(
  "github", requestGithubRefresh,
  async (expected, refreshed) => {
    if (expected.kind === "oauth" && refreshed.kind === "oauth") await persistGithubOAuthTokens(expected, refreshed);
  },
);
setGithubRefreshHook(refreshGithubToken);
