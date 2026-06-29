import { t } from "@/i18n";
import type { SlackOAuthAuth, SlackOAuthResult } from "@/types/slack";
import { getMyself } from "./slack-api";
import { OAuthError, launchOAuthWebFlow } from "./oauth";

const CLIENT_ID = (import.meta.env.VITE_SLACK_CLIENT_ID ?? "").trim();
const PROXY_URL = ((import.meta.env.VITE_OAUTH_PROXY_URL ?? "") as string)
  .trim()
  .replace(/\/+$/, "");
const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const USER_SCOPES =
  "chat:write,channels:read,groups:read,im:read,mpim:read,files:write,users:read";

export function isSlackOAuthConfigured(): boolean {
  const clientId = (import.meta.env.VITE_SLACK_CLIENT_ID ?? "").trim();
  const proxyUrl = (import.meta.env.VITE_OAUTH_PROXY_URL ?? "").trim();
  return !!clientId && !!proxyUrl;
}

function assertConfigured(): void {
  if (!CLIENT_ID || !PROXY_URL) {
    throw new OAuthError(t("slack.oauth.notConfigured"), { platform: "slack" });
  }
}

function redirectUri(): string {
  return chrome.identity.getRedirectURL();
}

const SLACK_CANCEL_ERROR_CODES = new Set(["access_denied"]);

export function isSlackCancellationCode(code: string | null): boolean {
  return !!code && SLACK_CANCEL_ERROR_CODES.has(code);
}

export interface ParsedSlackCallback {
  code: string;
}

export function parseSlackCallbackParams(
  redirectUrl: string,
  expectedState: string,
): ParsedSlackCallback {
  const parsed = new URL(redirectUrl);
  const errorParam = parsed.searchParams.get("error");
  if (errorParam) {
    throw new OAuthError(
      parsed.searchParams.get("error_description") || errorParam,
      { platform: "slack", cancelled: isSlackCancellationCode(errorParam) },
    );
  }
  const returnedState = parsed.searchParams.get("state");
  if (returnedState !== expectedState) {
    throw new OAuthError(t("oauth.error.stateMismatch"), { platform: "slack" });
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new OAuthError(t("oauth.error.codeMissing"), { platform: "slack" });
  }
  return { code };
}

interface SlackTokenResponse {
  ok: boolean;
  error?: string;
  authed_user?: { id: string; access_token: string; scope: string };
  team?: { id: string; name: string };
}

export async function startSlackOAuth(): Promise<SlackOAuthResult> {
  assertConfigured();
  const state = crypto.randomUUID();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("user_scope", USER_SCOPES);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);

  const redirect = await launchOAuthWebFlow(url.toString(), "slack");
  if (!redirect) {
    throw new OAuthError(t("oauth.error.cancelled"), {
      platform: "slack",
      cancelled: true,
    });
  }

  const { code } = parseSlackCallbackParams(redirect, state);
  const tokens = await exchangeCode(code);
  // user token은 최상위 access_token(bot)이 아니라 authed_user.access_token.
  const userToken = tokens.authed_user?.access_token;
  if (!userToken) {
    throw new OAuthError(t("slack.error.generic", { code: "no_user_token" }), {
      platform: "slack",
    });
  }

  const auth: SlackOAuthAuth = {
    kind: "oauth",
    accessToken: userToken,
    grantedAt: Date.now(),
    viewerId: tokens.authed_user?.id ?? "",
    viewerName: "",
  };
  const me = await getMyself(auth);
  return {
    auth: { ...auth, viewerId: me.id, viewerName: me.name },
    teamId: tokens.team?.id ?? me.teamId,
    teamName: tokens.team?.name ?? me.teamName,
  };
}

async function exchangeCode(code: string): Promise<SlackTokenResponse> {
  const res = await fetch(`${PROXY_URL}/slack/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: redirectUri(), client_id: CLIENT_ID }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenExchange", { status: res.status, text }),
      { platform: "slack" },
    );
  }
  const data = (await res.json()) as SlackTokenResponse;
  if (!data.ok) {
    throw new OAuthError(data.error || "slack_oauth_error", {
      platform: "slack",
      cancelled: isSlackCancellationCode(data.error ?? null),
    });
  }
  return data;
}
