import { t } from "@/i18n";
import type { NotionOAuthAuth } from "@/types/notion";
import { getMyself } from "./notion-api";
import { OAuthError } from "./oauth";

const CLIENT_ID = (import.meta.env.VITE_NOTION_CLIENT_ID ?? "").trim();
const PROXY_URL = ((import.meta.env.VITE_OAUTH_PROXY_URL ?? "") as string)
  .trim()
  .replace(/\/+$/, "");
const AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";

export function isNotionOAuthConfigured(): boolean {
  return !!CLIENT_ID && !!PROXY_URL;
}

function assertConfigured(): void {
  if (!CLIENT_ID || !PROXY_URL) {
    throw new OAuthError(t("notion.oauth.notConfigured"), {
      platform: "notion",
    });
  }
}

function redirectUri(): string {
  return chrome.identity.getRedirectURL();
}

const NOTION_CANCEL_ERROR_CODES = new Set(["access_denied", "user_denied"]);

export function isNotionCancellationCode(code: string | null): boolean {
  return !!code && NOTION_CANCEL_ERROR_CODES.has(code);
}

export interface ParsedNotionCallback {
  code: string;
}

export function parseNotionCallbackParams(
  redirectUrl: string,
  expectedState: string,
): ParsedNotionCallback {
  const parsed = new URL(redirectUrl);
  const errorParam = parsed.searchParams.get("error");
  if (errorParam) {
    throw new OAuthError(
      parsed.searchParams.get("error_description") || errorParam,
      { platform: "notion", cancelled: isNotionCancellationCode(errorParam) },
    );
  }
  const returnedState = parsed.searchParams.get("state");
  if (returnedState !== expectedState) {
    throw new OAuthError(t("oauth.error.stateMismatch"), {
      platform: "notion",
    });
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new OAuthError(t("oauth.error.codeMissing"), { platform: "notion" });
  }
  return { code };
}

interface NotionTokenResponse {
  access_token: string;
  token_type?: string;
  bot_id: string;
  workspace_id: string;
  workspace_name?: string;
  workspace_icon?: string;
  owner?: {
    type: "user" | "workspace";
    user?: {
      id?: string;
      name?: string;
      person?: { email?: string };
    };
    workspace?: boolean;
  };
}

async function exchangeCode(code: string): Promise<NotionTokenResponse> {
  const res = await fetch(`${PROXY_URL}/notion/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      redirect_uri: redirectUri(),
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenExchange", { status: res.status, text }),
      { platform: "notion" },
    );
  }
  return (await res.json()) as NotionTokenResponse;
}

export async function startNotionOAuth(): Promise<NotionOAuthAuth> {
  assertConfigured();
  const state = crypto.randomUUID();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("owner", "user");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  const redirect = await chrome.identity.launchWebAuthFlow({
    url: url.toString(),
    interactive: true,
  });
  if (!redirect) {
    throw new OAuthError(t("oauth.error.cancelled"), {
      platform: "notion",
      cancelled: true,
    });
  }

  const { code } = parseNotionCallbackParams(redirect, state);
  const tokens = await exchangeCode(code);

  const initial: NotionOAuthAuth = {
    kind: "oauth",
    accessToken: tokens.access_token,
    botId: tokens.bot_id,
    workspaceId: tokens.workspace_id,
    workspaceName: tokens.workspace_name ?? "",
    workspaceIcon: tokens.workspace_icon,
    ownerUserName: tokens.owner?.user?.name,
    ownerUserEmail: tokens.owner?.user?.person?.email,
    botName: "",
    grantedAt: Date.now(),
  };
  const me = await getMyself(initial);
  return {
    ...initial,
    botName: me.botName,
    workspaceName: initial.workspaceName || me.workspaceName || "",
    ownerUserName: initial.ownerUserName ?? me.ownerUserName,
    ownerUserEmail: initial.ownerUserEmail ?? me.ownerUserEmail,
  };
}
