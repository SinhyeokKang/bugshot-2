import type { PlatformId } from "@/types/platform";
import { sameOAuthGrant } from "@/lib/settings-storage";

export function pickRotatedAuth<A extends { accessToken?: string; refreshToken?: string | null }>(
  platform: PlatformId, requested: A, stored: A | null | undefined,
): A | null {
  if (!stored || !sameOAuthGrant(platform, requested, stored)) return null;
  return stored.accessToken !== requested.accessToken || stored.refreshToken !== requested.refreshToken ? stored : null;
}
