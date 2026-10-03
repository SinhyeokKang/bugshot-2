import type { RetryPlatform } from "@/types/attachment";

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
