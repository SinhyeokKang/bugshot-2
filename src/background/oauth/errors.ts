import type { PlatformId } from "@/types/platform";

// oauth.ts와 config.ts가 공유하는 leaf — 순환 import 방지용으로 분리.
export interface OAuthErrorOptions {
  platform?: PlatformId;
  cancelled?: boolean;
}

export class OAuthError extends Error {
  cancelled: boolean;
  platform?: PlatformId;
  constructor(message: string, options: OAuthErrorOptions = {}) {
    super(message);
    this.name = "OAuthError";
    this.cancelled = options.cancelled ?? false;
    this.platform = options.platform;
  }
}
