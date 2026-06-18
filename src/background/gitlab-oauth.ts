import { t } from "@/i18n";
import type { GitlabAuth, GitlabOAuthAuth } from "@/types/gitlab";
import { writeStoredGitlabOAuthTokens } from "@/lib/settings-storage";
import { getMyself, setGitlabRefreshHook } from "./gitlab-api";
import { OAuthError, base64url, launchOAuthWebFlow } from "./oauth";

const CLIENT_ID = (import.meta.env.VITE_GITLAB_CLIENT_ID ?? "").trim();
const BASE_URL = "https://gitlab.com";
const AUTHORIZE_URL = `${BASE_URL}/oauth/authorize`;
const TOKEN_URL = `${BASE_URL}/oauth/token`;
const SCOPES = ["api"];

export function isGitlabOAuthConfigured(): boolean {
  return !!CLIENT_ID;
}

function assertConfigured(): void {
  if (!CLIENT_ID) {
    throw new OAuthError(t("gitlab.oauth.notConfigured"), {
      platform: "gitlab",
    });
  }
}

function redirectUri(): string {
  return chrome.identity.getRedirectURL();
}

export async function generatePkceChallenge(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = base64url(bytes.buffer);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = base64url(hash);
  return { codeVerifier, codeChallenge };
}

const GITLAB_CANCEL_ERROR_CODES = new Set(["access_denied"]);

export function isGitlabCancellationCode(code: string | null): boolean {
  return !!code && GITLAB_CANCEL_ERROR_CODES.has(code);
}

export interface ParsedGitlabCallback {
  code: string;
}

export function parseGitlabCallbackParams(
  redirectUrl: string,
  expectedState: string,
): ParsedGitlabCallback {
  const parsed = new URL(redirectUrl);
  const errorParam = parsed.searchParams.get("error");
  if (errorParam) {
    throw new OAuthError(
      parsed.searchParams.get("error_description") || errorParam,
      { platform: "gitlab", cancelled: isGitlabCancellationCode(errorParam) },
    );
  }
  const returnedState = parsed.searchParams.get("state");
  if (returnedState !== expectedState) {
    throw new OAuthError(t("oauth.error.stateMismatch"), { platform: "gitlab" });
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new OAuthError(t("oauth.error.codeMissing"), { platform: "gitlab" });
  }
  return { code };
}

interface GitlabTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export async function startGitlabOAuth(): Promise<GitlabOAuthAuth> {
  assertConfigured();
  const state = crypto.randomUUID();
  const { codeVerifier, codeChallenge } = await generatePkceChallenge();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  const redirect = await launchOAuthWebFlow(url.toString(), "gitlab");
  if (!redirect) {
    throw new OAuthError(t("oauth.error.cancelled"), {
      platform: "gitlab",
      cancelled: true,
    });
  }

  const { code } = parseGitlabCallbackParams(redirect, state);
  const tokens = await exchangeCode(code, codeVerifier);

  const auth: GitlabOAuthAuth = {
    kind: "oauth",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
    baseUrl: BASE_URL,
    viewerUsername: "",
    grantedAt: Date.now(),
  };
  const me = await getMyself(auth);
  return { ...auth, viewerUsername: me.username, viewerEmail: me.email };
}

async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<GitlabTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri(),
      code,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenExchange", { status: res.status, text }),
      { platform: "gitlab" },
    );
  }
  const data = (await res.json()) as
    | GitlabTokenResponse
    | { error?: string; error_description?: string };
  if ("error" in data && data.error) {
    throw new OAuthError(data.error_description || data.error, {
      platform: "gitlab",
      cancelled: isGitlabCancellationCode(data.error),
    });
  }
  return data as GitlabTokenResponse;
}

export async function refreshGitlabToken(auth: GitlabAuth): Promise<GitlabAuth> {
  if (auth.kind !== "oauth") return auth;
  assertConfigured();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: auth.refreshToken,
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenRefresh", { status: res.status, text }),
      { platform: "gitlab" },
    );
  }
  const rData = (await res.json()) as
    | GitlabTokenResponse
    | { error?: string; error_description?: string };
  if ("error" in rData && rData.error) {
    throw new OAuthError(rData.error_description || rData.error, {
      platform: "gitlab",
    });
  }
  const tokens = rData as GitlabTokenResponse;
  const refreshed: GitlabOAuthAuth = {
    ...auth,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
  };
  await persistGitlabOAuthTokens(refreshed);
  return refreshed;
}

export async function persistGitlabOAuthTokens(
  auth: GitlabOAuthAuth,
): Promise<void> {
  try {
    await writeStoredGitlabOAuthTokens(auth);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new OAuthError(t("oauth.error.tokenPersist", { message }), {
      platform: "gitlab",
    });
  }
}

let refreshInFlight: Promise<GitlabAuth> | null = null;

async function refreshOnceWithLock(auth: GitlabAuth): Promise<GitlabAuth> {
  if (auth.kind !== "oauth") return auth;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshGitlabToken(auth).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

setGitlabRefreshHook(refreshOnceWithLock);
