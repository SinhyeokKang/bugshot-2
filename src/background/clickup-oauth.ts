import { t } from "@/i18n";
import type { ClickupOAuthAuth } from "@/types/clickup";
import { getMyself } from "./clickup-api";
import { OAuthError, launchOAuthWebFlow } from "./oauth";
import {
  OAUTH_CONFIG,
  assertConfigured as assertOAuthConfigured,
  isCancellation,
} from "./oauth/config";

const AUTHORIZE_URL = "https://app.clickup.com/api";

function assertConfigured(): void {
  assertOAuthConfigured(OAUTH_CONFIG.clickup);
}

function redirectUri(): string {
  return chrome.identity.getRedirectURL();
}

export function isClickupCancellationCode(code: string | null): boolean {
  return isCancellation(OAUTH_CONFIG.clickup, code);
}

export interface ParsedClickupCallback {
  code: string;
}

export function parseClickupCallbackParams(
  redirectUrl: string,
  expectedState: string,
): ParsedClickupCallback {
  const parsed = new URL(redirectUrl);
  const errorParam = parsed.searchParams.get("error");
  if (errorParam) {
    throw new OAuthError(
      parsed.searchParams.get("error_description") || errorParam,
      { platform: "clickup", cancelled: isClickupCancellationCode(errorParam) },
    );
  }
  const returnedState = parsed.searchParams.get("state");
  if (returnedState !== expectedState) {
    throw new OAuthError(t("oauth.error.stateMismatch"), { platform: "clickup" });
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new OAuthError(t("oauth.error.codeMissing"), { platform: "clickup" });
  }
  return { code };
}

interface ClickupTokenResponse {
  access_token: string;
}

export async function startClickupOAuth(): Promise<ClickupOAuthAuth> {
  assertConfigured();
  const state = crypto.randomUUID();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", OAUTH_CONFIG.clickup.clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);

  const redirect = await launchOAuthWebFlow(url.toString(), "clickup");
  if (!redirect) {
    throw new OAuthError(t("oauth.error.cancelled"), {
      platform: "clickup",
      cancelled: true,
    });
  }

  const { code } = parseClickupCallbackParams(redirect, state);
  const tokens = await exchangeCode(code);

  const auth: ClickupOAuthAuth = {
    kind: "oauth",
    accessToken: tokens.access_token,
    grantedAt: Date.now(),
    viewerId: "",
    viewerName: "",
  };
  const me = await getMyself(auth);
  return { ...auth, viewerId: me.id, viewerName: me.name, viewerEmail: me.email };
}

async function exchangeCode(code: string): Promise<ClickupTokenResponse> {
  const res = await fetch(`${OAUTH_CONFIG.clickup.proxyUrl}/clickup/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      redirect_uri: redirectUri(),
      client_id: OAUTH_CONFIG.clickup.clientId,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenExchange", { status: res.status, text }),
      { platform: "clickup" },
    );
  }
  const data = (await res.json()) as
    | ClickupTokenResponse
    | { error?: string; error_description?: string };
  if ("error" in data && data.error) {
    throw new OAuthError(data.error_description || data.error, {
      platform: "clickup",
      cancelled: isClickupCancellationCode(data.error),
    });
  }
  return data as ClickupTokenResponse;
}
