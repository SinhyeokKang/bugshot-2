import { t } from "@/i18n";
import type { LinearAuth, LinearOAuthAuth } from "@/types/linear";
import { writeStoredLinearOAuthTokens } from "@/lib/settings-storage";
import { getMyself, setLinearRefreshHook } from "./linear-api";
import { OAuthError, launchOAuthWebFlow } from "./oauth";

const CLIENT_ID = (import.meta.env.VITE_LINEAR_CLIENT_ID ?? "").trim();
const AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const TOKEN_URL = "https://api.linear.app/oauth/token";
const SCOPES = ["read", "write", "issues:create"];

export function isLinearOAuthConfigured(): boolean {
  return !!CLIENT_ID;
}

function assertConfigured(): void {
  if (!CLIENT_ID) {
    throw new OAuthError(t("linear.oauth.notConfigured"), {
      platform: "linear",
    });
  }
}

function redirectUri(): string {
  return chrome.identity.getRedirectURL();
}

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

const LINEAR_CANCEL_ERROR_CODES = new Set(["access_denied"]);

export function isLinearCancellationCode(code: string | null): boolean {
  return !!code && LINEAR_CANCEL_ERROR_CODES.has(code);
}

export interface ParsedLinearCallback {
  code: string;
}

export function parseLinearCallbackParams(
  redirectUrl: string,
  expectedState: string,
): ParsedLinearCallback {
  const parsed = new URL(redirectUrl);
  const errorParam = parsed.searchParams.get("error");
  if (errorParam) {
    throw new OAuthError(
      parsed.searchParams.get("error_description") || errorParam,
      { platform: "linear", cancelled: isLinearCancellationCode(errorParam) },
    );
  }
  const returnedState = parsed.searchParams.get("state");
  if (returnedState !== expectedState) {
    throw new OAuthError(t("oauth.error.stateMismatch"), { platform: "linear" });
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new OAuthError(t("oauth.error.codeMissing"), { platform: "linear" });
  }
  return { code };
}

interface LinearTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string[];
}

export async function startLinearOAuth(): Promise<LinearOAuthAuth> {
  assertConfigured();
  const state = crypto.randomUUID();
  const { codeVerifier, codeChallenge } = await generatePkceChallenge();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(","));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "consent");

  const redirect = await launchOAuthWebFlow(url.toString(), "linear");
  if (!redirect) {
    throw new OAuthError(t("oauth.error.cancelled"), {
      platform: "linear",
      cancelled: true,
    });
  }

  const { code } = parseLinearCallbackParams(redirect, state);
  const tokens = await exchangeCode(code, codeVerifier);

  const auth: LinearOAuthAuth = {
    kind: "oauth",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: Array.isArray(tokens.scope) ? tokens.scope.join(",") : String(tokens.scope),
    viewerName: "",
    grantedAt: Date.now(),
  };
  const me = await getMyself(auth);
  return { ...auth, viewerName: me.name, viewerEmail: me.email };
}

async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<LinearTokenResponse> {
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
      { platform: "linear" },
    );
  }
  const data = (await res.json()) as LinearTokenResponse | { error?: string; error_description?: string };
  if ("error" in data && data.error) {
    throw new OAuthError(data.error_description || data.error, {
      platform: "linear",
      cancelled: isLinearCancellationCode(data.error),
    });
  }
  return data as LinearTokenResponse;
}

export async function refreshLinearToken(
  auth: LinearAuth,
): Promise<LinearAuth> {
  if (auth.kind !== "oauth") return auth;
  assertConfigured();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: auth.refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenRefresh", { status: res.status, text }),
      { platform: "linear" },
    );
  }
  const rData = (await res.json()) as LinearTokenResponse | { error?: string; error_description?: string };
  if ("error" in rData && rData.error) {
    throw new OAuthError(rData.error_description || rData.error, {
      platform: "linear",
    });
  }
  const tokens = rData as LinearTokenResponse;
  const refreshed: LinearOAuthAuth = {
    ...auth,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: Array.isArray(tokens.scope) ? tokens.scope.join(",") : String(tokens.scope),
  };
  await persistLinearOAuthTokens(refreshed);
  return refreshed;
}

export async function persistLinearOAuthTokens(
  auth: LinearOAuthAuth,
): Promise<void> {
  try {
    await writeStoredLinearOAuthTokens(auth);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new OAuthError(t("oauth.error.tokenPersist", { message }), {
      platform: "linear",
    });
  }
}

let refreshInFlight: Promise<LinearAuth> | null = null;

async function refreshOnceWithLock(auth: LinearAuth): Promise<LinearAuth> {
  if (auth.kind !== "oauth") return auth;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshLinearToken(auth).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

setLinearRefreshHook(refreshOnceWithLock);
