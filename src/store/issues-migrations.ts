import type { PlatformId } from "@/types/platform";

interface IssuePlatformShape {
  platform?: PlatformId;
}

export function migrateIssueToV4<T extends IssuePlatformShape>(
  issue: T,
): T & { platform: PlatformId } {
  if (issue.platform) return issue as T & { platform: PlatformId };
  return { ...issue, platform: "jira" };
}
