import type { JiraAuth, JiraOAuthAuth } from "@/types/jira";
import type { GithubAuth, GithubOAuthAuth } from "@/types/github";

export const SETTINGS_STORAGE_KEY = "bugshot-settings";

interface SettingsEnvelope {
  state?: {
    accounts?: {
      jira?: { auth?: JiraAuth };
      github?: { auth?: GithubAuth };
    };
    jiraConfig?: { auth?: JiraAuth };
  };
  version?: number;
}

async function readEnvelope(): Promise<
  { raw: unknown; envelope: SettingsEnvelope | null }
> {
  const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const raw = result[SETTINGS_STORAGE_KEY];
  if (raw == null) return { raw: null, envelope: null };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { raw, envelope: parsed as SettingsEnvelope };
  } catch {
    return { raw, envelope: null };
  }
}

export async function readStoredAuth(): Promise<JiraAuth | null> {
  const { envelope } = await readEnvelope();
  return envelope?.state?.accounts?.jira?.auth
    ?? envelope?.state?.jiraConfig?.auth
    ?? null;
}

export async function readStoredGithubAuth(): Promise<GithubAuth | null> {
  const { envelope } = await readEnvelope();
  return envelope?.state?.accounts?.github?.auth ?? null;
}

export async function writeStoredOAuthTokens(
  auth: JiraOAuthAuth,
): Promise<void> {
  const { raw, envelope } = await readEnvelope();
  const cur = envelope?.state?.accounts?.jira?.auth;
  if (!cur || cur.kind !== "oauth") return;
  envelope!.state!.accounts!.jira!.auth = {
    ...cur,
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    expiresAt: auth.expiresAt,
  };
  const next = typeof raw === "string" ? JSON.stringify(envelope) : envelope;
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
}

export async function writeStoredGithubOAuthTokens(
  auth: GithubOAuthAuth,
): Promise<void> {
  const { raw, envelope } = await readEnvelope();
  const cur = envelope?.state?.accounts?.github?.auth;
  if (!cur || cur.kind !== "oauth") return;
  envelope!.state!.accounts!.github!.auth = {
    ...cur,
    accessToken: auth.accessToken,
    tokenType: auth.tokenType,
    scope: auth.scope,
    refreshToken: auth.refreshToken ?? cur.refreshToken,
    expiresAt: auth.expiresAt ?? cur.expiresAt,
  };
  const next = typeof raw === "string" ? JSON.stringify(envelope) : envelope;
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
}
