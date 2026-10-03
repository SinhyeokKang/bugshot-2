import type { AttachmentRetryReason, RetryPlatform } from "@/types/attachment";

// Stable per-account IDs only; tokens and display names never participate, so a refresh keeps the identity.
const IDENTITY_FIELDS: Record<RetryPlatform, readonly string[]> = {
  jira: ["siteId", "accountId"], github: ["userId"], gitlab: ["baseUrl", "userId"],
  linear: ["organizationId", "userId"], notion: ["workspaceId", "botId"],
  asana: ["workspaceGid", "userGid"], clickup: ["teamId", "userId"], slack: ["teamId", "userId"],
};

function originPart(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, "");
  } catch { return null; }
}

export function attachmentAccountIdentity(platform: RetryPlatform, input: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const field of IDENTITY_FIELDS[platform]) {
    const value = input[field];
    if ((typeof value !== "string" && typeof value !== "number") || !String(value).trim()) return null;
    let part: string | null = String(value).trim();
    // Jira API-key sites are identified by their base URL instead of a cloudId.
    if (field === "baseUrl" || (field === "siteId" && /^https?:/i.test(part))) part = originPart(part);
    if (!part) return null;
    parts.push(part);
  }
  return JSON.stringify([platform, ...parts]);
}

const AUTH_CODES = ["invalid_auth", "token_revoked", "account_inactive", "not_authed"];
const PERMISSION_CODES = ["missing_scope", "no_permission", "not_in_channel", "restricted_action"];

export function retryFailureReason(error: unknown): Extract<AttachmentRetryReason, "authentication" | "permission" | "remote-missing" | "ambiguous"> {
  const value = error && typeof error === "object" ? error as { status?: unknown; code?: unknown; body?: unknown } : {};
  const body = value.body && typeof value.body === "object" ? value.body as Record<string, unknown> : {};
  const code = typeof value.code === "string" ? value.code : typeof body.code === "string" ? body.code : "";
  if (body.oauthRefreshFailed === true || value.status === 401 || AUTH_CODES.includes(code)) return "authentication";
  if (value.status === 403 || PERMISSION_CODES.includes(code)) return "permission";
  if (value.status === 404 || value.status === 410 || code === "channel_not_found") return "remote-missing";
  return "ambiguous";
}
