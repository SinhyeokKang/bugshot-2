import { t } from "@/i18n";
import type { AsanaAuth, AsanaOAuthAuth } from "@/types/asana";
import { writeStoredAsanaOAuthTokens } from "@/lib/settings-storage";
import { getMyself, setAsanaRefreshHook } from "./asana-api";
import { OAuthError, launchOAuthWebFlow } from "./oauth";
import {
  OAUTH_CONFIG,
  isConfigured as isOAuthPlatformConfigured,
  assertConfigured as assertOAuthConfigured,
  isCancellation,
} from "./oauth/config";

const AUTHORIZE_URL = "https://app.asana.com/-/oauth_authorize";
const SCOPES = ["default"];

export function isAsanaOAuthConfigured(): boolean {
  return isOAuthPlatformConfigured(OAUTH_CONFIG.asana);
}

function assertConfigured(): void {
  assertOAuthConfigured(OAUTH_CONFIG.asana);
}

function redirectUri(): string {
  return chrome.identity.getRedirectURL();
}

export function isAsanaCancellationCode(code: string | null): boolean {
  return isCancellation(OAUTH_CONFIG.asana, code);
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

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", OAUTH_CONFIG.asana.clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);

  const redirect = await launchOAuthWebFlow(url.toString(), "asana");
  if (!redirect) {
    throw new OAuthError(t("oauth.error.cancelled"), {
      platform: "asana",
      cancelled: true,
    });
  }

  const { code } = parseAsanaCallbackParams(redirect, state);
  const tokens = await exchangeCode(code);

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

async function exchangeCode(code: string): Promise<AsanaTokenResponse> {
  const res = await fetch(`${OAUTH_CONFIG.asana.proxyUrl}/asana/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      redirect_uri: redirectUri(),
      client_id: OAUTH_CONFIG.asana.clientId,
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
  const res = await fetch(`${OAUTH_CONFIG.asana.proxyUrl}/asana/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: auth.refreshToken,
      client_id: OAUTH_CONFIG.asana.clientId,
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
