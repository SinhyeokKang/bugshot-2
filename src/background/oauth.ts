import { t } from "@/i18n";
import type { JiraOAuthAuth, JiraSite } from "@/types/jira";
import type { PlatformId } from "@/types/platform";
import { writeStoredOAuthTokens } from "@/lib/settings-storage";
import {
  OAUTH_CONFIG,
  isConfigured as isOAuthPlatformConfigured,
  assertConfigured as assertOAuthConfigured,
  isCancellation,
} from "./oauth/config";

const CLIENT_ID = (import.meta.env.VITE_ATLASSIAN_CLIENT_ID ?? "").trim();
const PROXY_URL = (import.meta.env.VITE_OAUTH_PROXY_URL ?? "")
  .trim()
  .replace(/\/+$/, "");
const AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
const RESOURCES_URL =
  "https://api.atlassian.com/oauth/token/accessible-resources";
const SCOPES = [
  "read:jira-user",
  "read:jira-work",
  "write:jira-work",
  "offline_access",
];

export interface OAuthErrorOptions {
  platform?: PlatformId;
  cancelled?: boolean;
}

export class OAuthError extends Error {
  cancelled: boolean;
  platform?: PlatformId;
  constructor(message: string, options: OAuthErrorOptions = {}) {
    super(message);
    this.name = "OAuthError";
    this.cancelled = options.cancelled ?? false;
    this.platform = options.platform;
  }
}

// BgError body로 직렬화하는 단일 출처. messages.ts의 isOAuthCancelled /
// isOAuthRefreshFailed / getOAuthErrorPlatform 판독부와 짝을 이룬다(드리프트 방지).
export function serializeOAuthError(error: OAuthError): {
  status: number | undefined;
  body: Record<string, unknown>;
} {
  return error.cancelled
    ? { status: undefined, body: { oauthCancelled: true, platform: error.platform } }
    : { status: 401, body: { oauthRefreshFailed: true, platform: error.platform } };
}

export function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function launchOAuthWebFlow(
  url: string,
  platform: PlatformId,
): Promise<string | undefined> {
  try {
    return await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/could not be loaded/i.test(message)) {
      throw new OAuthError(t("oauth.error.authorizationPageFailed"), {
        platform,
      });
    }
    throw err;
  }
}

export function isAtlassianCancellationCode(code: string | null): boolean {
  return isCancellation(OAUTH_CONFIG.jira, code);
}

function proxyTokenUrl(): string {
  return `${PROXY_URL}/token`;
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
  url.searchParams.set("client_id", CLIENT_ID);
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

export function isOAuthConfigured(): boolean {
  return isOAuthPlatformConfigured(OAUTH_CONFIG.jira);
}
