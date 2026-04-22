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
    throw new OAuthError(
      "Atlassian OAuth 앱이 설정되지 않았습니다. VITE_ATLASSIAN_CLIENT_ID 환경 변수를 지정하세요.",
    );
  }
  if (!PROXY_URL) {
    throw new OAuthError(
      "OAuth proxy가 설정되지 않았습니다. VITE_OAUTH_PROXY_URL 환경 변수를 지정하세요.",
    );
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
  if (!redirect) throw new OAuthError("OAuth 취소됨");

  const parsed = new URL(redirect);
  const code = parsed.searchParams.get("code");
  const returnedState = parsed.searchParams.get("state");
  const errorParam = parsed.searchParams.get("error");
  if (errorParam) {
    throw new OAuthError(
      parsed.searchParams.get("error_description") || errorParam,
    );
  }
  if (returnedState !== state) throw new OAuthError("OAuth state 불일치");
  if (!code) throw new OAuthError("OAuth code 누락");

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
    throw new OAuthError(`토큰 교환 실패 (${res.status}) ${text}`);
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
  if (!res.ok) throw new OAuthError(`사이트 목록 조회 실패 (${res.status})`);
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
    throw new OAuthError(`토큰 갱신 실패 (${res.status}) ${text}`);
  }
  const data = (await res.json()) as TokenResponse;
  return {
    ...auth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

const SETTINGS_KEY = "bugshot-settings";

export async function persistOAuthTokens(auth: JiraOAuthAuth): Promise<void> {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  const envelope = raw[SETTINGS_KEY];
  if (!envelope) return;
  try {
    const parsed =
      typeof envelope === "string" ? JSON.parse(envelope) : envelope;
    if (!parsed?.state?.jiraConfig?.auth) return;
    if (parsed.state.jiraConfig.auth.kind !== "oauth") return;
    parsed.state.jiraConfig.auth = {
      ...parsed.state.jiraConfig.auth,
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      expiresAt: auth.expiresAt,
    };
    const next =
      typeof envelope === "string" ? JSON.stringify(parsed) : parsed;
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  } catch {
    /* storage shape changed; skip silently */
  }
}

export function isOAuthConfigured(): boolean {
  return !!CLIENT_ID && !!PROXY_URL;
}
