import type { JiraAuth, JiraOAuthAuth } from "@/types/jira";

export const SETTINGS_STORAGE_KEY = "bugshot-settings";

interface SettingsEnvelope {
  state?: { jiraConfig?: { auth?: JiraAuth } };
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
  return envelope?.state?.jiraConfig?.auth ?? null;
}

export async function writeStoredOAuthTokens(
  auth: JiraOAuthAuth,
): Promise<void> {
  const { raw, envelope } = await readEnvelope();
  if (!envelope?.state?.jiraConfig?.auth) return;
  if (envelope.state.jiraConfig.auth.kind !== "oauth") return;
  envelope.state.jiraConfig.auth = {
    ...envelope.state.jiraConfig.auth,
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    expiresAt: auth.expiresAt,
  };
  const next = typeof raw === "string" ? JSON.stringify(envelope) : envelope;
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
}
