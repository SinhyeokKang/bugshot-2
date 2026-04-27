import { t } from "@/i18n";
import type { JiraOAuthAuth, JiraSite } from "@/types/jira";

const CLIENT_ID = import.meta.env.VITE_ATLASSIAN_CLIENT_ID ?? "";
const PROXY_URL = (import.meta.env.VITE_OAUTH_PROXY_URL ?? "").replace(
  /\/+$/,
  "",
);
const AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
const RESOURCES_URL =
  "https://api.atlassian.com/oauth/token/accessible-resources";
const SCOPES = [
  "read:jira-user",
  "read:jira-work",
  "write:jira-work",
  "offline_access",
];

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthError";
  }
}

function proxyTokenUrl(): string {
  return `${PROXY_URL}/token`;
}

function assertConfigured(): void {
  if (!CLIENT_ID) {
    throw new OAuthError(t("oauth.error.notConfiguredClient"));
  }
  if (!PROXY_URL) {
    throw new OAuthError(t("oauth.error.notConfiguredProxy"));
  }
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

  const redirect = await chrome.identity.launchWebAuthFlow({
    url: url.toString(),
    interactive: true,
  });
  if (!redirect) throw new OAuthError(t("oauth.error.cancelled"));

  const parsed = new URL(redirect);
  const code = parsed.searchParams.get("code");
  const returnedState = parsed.searchParams.get("state");
  const errorParam = parsed.searchParams.get("error");
  if (errorParam) {
    throw new OAuthError(
      parsed.searchParams.get("error_description") || errorParam,
    );
  }
  if (returnedState !== state) throw new OAuthError(t("oauth.error.stateMismatch"));
  if (!code) throw new OAuthError(t("oauth.error.codeMissing"));

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
    throw new OAuthError(t("oauth.error.tokenExchange", { status: res.status, text }));
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
  if (!res.ok) throw new OAuthError(t("oauth.error.siteList", { status: res.status }));
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
    throw new OAuthError(t("oauth.error.tokenRefresh", { status: res.status, text }));
  }
  const data = (await res.json()) as TokenResponse;
  return {
    ...auth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

import { writeStoredOAuthTokens } from "@/lib/settings-storage";

export async function persistOAuthTokens(auth: JiraOAuthAuth): Promise<void> {
  try {
    await writeStoredOAuthTokens(auth);
  } catch (err) {
    console.warn("[bugshot] persistOAuthTokens failed", err);
  }
}

export function isOAuthConfigured(): boolean {
  return !!CLIENT_ID && !!PROXY_URL;
}
