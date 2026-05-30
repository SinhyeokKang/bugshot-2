import { t } from "@/i18n";
import type { AsanaAuth, AsanaOAuthAuth } from "@/types/asana";
import { writeStoredAsanaOAuthTokens } from "@/lib/settings-storage";
import { getMyself, setAsanaRefreshHook } from "./asana-api";
import { OAuthError } from "./oauth";

const CLIENT_ID = (import.meta.env.VITE_ASANA_CLIENT_ID ?? "").trim();
const AUTHORIZE_URL = "https://app.asana.com/-/oauth_authorize";
const TOKEN_URL = "https://app.asana.com/-/oauth_token";
const SCOPES = ["default"];

export function isAsanaOAuthConfigured(): boolean {
  return !!(import.meta.env.VITE_ASANA_CLIENT_ID ?? "").trim();
}

function assertConfigured(): void {
  if (!CLIENT_ID) {
    throw new OAuthError(t("asana.oauth.notConfigured"), { platform: "asana" });
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

const ASANA_CANCEL_ERROR_CODES = new Set(["access_denied"]);

export function isAsanaCancellationCode(code: string | null): boolean {
  return !!code && ASANA_CANCEL_ERROR_CODES.has(code);
}

export interface ParsedAsanaCallback {
  code: string;
}

export function parseAsanaCallbackParams(
  redirectUrl: string,
  expectedState: string,
): ParsedAsanaCallback {
  const parsed = new URL(redirectUrl);
  const errorParam = parsed.searchParams.get("error");
  if (errorParam) {
    throw new OAuthError(
      parsed.searchParams.get("error_description") || errorParam,
      { platform: "asana", cancelled: isAsanaCancellationCode(errorParam) },
    );
  }
  const returnedState = parsed.searchParams.get("state");
  if (returnedState !== expectedState) {
    throw new OAuthError(t("oauth.error.stateMismatch"), { platform: "asana" });
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new OAuthError(t("oauth.error.codeMissing"), { platform: "asana" });
  }
  return { code };
}

interface AsanaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export async function startAsanaOAuth(): Promise<AsanaOAuthAuth> {
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

  const redirect = await chrome.identity.launchWebAuthFlow({
    url: url.toString(),
    interactive: true,
  });
  if (!redirect) {
    throw new OAuthError(t("oauth.error.cancelled"), {
      platform: "asana",
      cancelled: true,
    });
  }

  const { code } = parseAsanaCallbackParams(redirect, state);
  const tokens = await exchangeCode(code, codeVerifier);

  const auth: AsanaOAuthAuth = {
    kind: "oauth",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? "",
    expiresAt: Date.now() + tokens.expires_in * 1000,
    grantedAt: Date.now(),
    viewerGid: "",
    viewerName: "",
  };
  const me = await getMyself(auth);
  return { ...auth, viewerGid: me.gid, viewerName: me.name, viewerEmail: me.email };
}

async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<AsanaTokenResponse> {
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
      { platform: "asana" },
    );
  }
  const data = (await res.json()) as
    | AsanaTokenResponse
    | { error?: string; error_description?: string };
  if ("error" in data && data.error) {
    throw new OAuthError(data.error_description || data.error, {
      platform: "asana",
      cancelled: isAsanaCancellationCode(data.error),
    });
  }
  return data as AsanaTokenResponse;
}

export async function refreshAsanaToken(auth: AsanaAuth): Promise<AsanaAuth> {
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
      { platform: "asana" },
    );
  }
  const rData = (await res.json()) as
    | AsanaTokenResponse
    | { error?: string; error_description?: string };
  if ("error" in rData && rData.error) {
    throw new OAuthError(rData.error_description || rData.error, {
      platform: "asana",
    });
  }
  const tokens = rData as AsanaTokenResponse;
  // Asana refresh 토큰은 회전하지 않으므로 응답에 없으면 기존 토큰 유지.
  const refreshed: AsanaOAuthAuth = {
    ...auth,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  await persistAsanaOAuthTokens(refreshed);
  return refreshed;
}

export async function persistAsanaOAuthTokens(
  auth: AsanaOAuthAuth,
): Promise<void> {
  try {
    await writeStoredAsanaOAuthTokens(auth);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new OAuthError(t("oauth.error.tokenPersist", { message }), {
      platform: "asana",
    });
  }
}

let refreshInFlight: Promise<AsanaAuth> | null = null;

async function refreshOnceWithLock(auth: AsanaAuth): Promise<AsanaAuth> {
  if (auth.kind !== "oauth") return auth;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshAsanaToken(auth).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

setAsanaRefreshHook(refreshOnceWithLock);
