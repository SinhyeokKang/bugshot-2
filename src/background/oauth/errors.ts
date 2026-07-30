import type { PlatformId } from "@/types/platform";

// oauth.ts와 config.ts가 공유하는 leaf — 순환 import 방지용으로 분리.
export interface OAuthErrorOptions {
  platform?: PlatformId;
  cancelled?: boolean;
  // 빌드에 client_id·proxy URL이 없어 시작조차 못 한 경우. "세션 만료"와 구분해야 한다 —
  // 연결한 적 없는 사용자에게 만료 안내가 뜨던 회귀(A-23).
  notConfigured?: boolean;
  // 인증 창을 띄우는 단계에서 실패한 경우(로드 실패·타임아웃·동시 flow 등). notConfigured와
  // 같은 이유로 "세션 만료"와 구분한다 — 최초 연결 시도라 만료될 토큰 자체가 없다.
  launchFailed?: boolean;
}

export class OAuthError extends Error {
  cancelled: boolean;
  notConfigured: boolean;
  launchFailed: boolean;
  platform?: PlatformId;
  constructor(message: string, options: OAuthErrorOptions = {}) {
    super(message);
    this.name = "OAuthError";
    this.cancelled = options.cancelled ?? false;
    this.notConfigured = options.notConfigured ?? false;
    this.launchFailed = options.launchFailed ?? false;
    this.platform = options.platform;
  }
}
