import type { AttachmentRetryResponse, CreatedDestination } from "@/types/attachment";

const IDENTITY_FIELDS: Record<Exclude<CreatedDestination["platform"], "webhook">, readonly string[]> = {
  jira: ["cloudId", "accountId"], github: ["userId"], gitlab: ["baseUrl", "userId"],
  linear: ["organizationId", "userId"], notion: ["workspaceId", "botId"],
  asana: ["workspaceGid", "userGid"], clickup: ["teamId", "userId"], slack: ["teamId", "userId"],
};
export function attachmentAccountIdentity(platform: CreatedDestination["platform"], input: Record<string, unknown>): string | null {
  if (platform === "webhook") return null;
  const parts: string[] = [];
  for (const field of IDENTITY_FIELDS[platform]) {
    const value = input[field];
    if ((typeof value !== "string" && typeof value !== "number") || !String(value).trim()) return null;
    let part = String(value);
    if (field === "baseUrl") {
      try {
        const url = new URL(part);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
        part = url.href.replace(/\/$/, "");
      } catch { return null; }
    }
    parts.push(part);
  }
  return JSON.stringify([platform, ...parts]);
}
export function attachmentRetryFailure(error: unknown): AttachmentRetryResponse<never> {
  const value = error && typeof error === "object" ? error as { status?: number; code?: string } : {};
  const reason = value.status === 401 || ["invalid_auth", "token_revoked", "account_inactive"].includes(value.code ?? "") ? "authentication"
    : value.status === 403 || ["missing_scope", "no_permission", "not_in_channel"].includes(value.code ?? "") ? "permission"
    : value.status === 404 || value.code === "channel_not_found" ? "remote-missing" : "ambiguous";
  return { ok: false, reason };
}
