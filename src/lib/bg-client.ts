import { t } from "@/i18n";
import { onOAuthExpired } from "./app-events";
import type { BgRequest, BgResponse } from "@/types/messages";
import { PLATFORM_TAB_KEYS, type PlatformId } from "@/types/platform";

export class BgError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "BgError";
  }
}

export function sendBg<T = unknown>(req: BgRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(req, (res: BgResponse<T>) => {
      if (chrome.runtime.lastError) {
        reject(new Error(t("bg.error.communication")));
        return;
      }
      if (!res?.ok) {
        const err = new BgError(
          res?.error ?? t("bg.error.unknown"),
          res?.status,
          res?.body,
        );
        if (isOAuthRefreshFailed(err)) {
          onOAuthExpired.fire(getOAuthErrorPlatform(err));
        }
        reject(err);
        return;
      }
      resolve(res.result);
    });
  });
}

function readErrorBodyFlag(err: unknown, key: string): boolean {
  if (!(err instanceof BgError)) return false;
  if (!err.body || typeof err.body !== "object") return false;
  return (err.body as Record<string, unknown>)[key] === true;
}

export function isOAuthRefreshFailed(err: unknown): boolean {
  return readErrorBodyFlag(err, "oauthRefreshFailed");
}

export function isOAuthCancelled(err: unknown): boolean {
  return readErrorBodyFlag(err, "oauthCancelled");
}

// 빌드에 client_id·proxy URL이 없어 OAuth를 시작조차 못 한 경우. isOAuthRefreshFailed와
// 배타적이라 onOAuthExpired가 발화하지 않는다.
export function isOAuthNotConfigured(err: unknown): boolean {
  return readErrorBodyFlag(err, "oauthNotConfigured");
}

// 손열거 화이트리스트였을 땐 9번째 플랫폼이 붙어도 컴파일이 안 잡았다(반환이 8리터럴
// union이라 넓은 PlatformId에 그냥 대입된다). PlatformId 축에서 파생해 그 드리프트를 없앤다.
export function getOAuthErrorPlatform(err: unknown): PlatformId | null {
  if (!(err instanceof BgError)) return null;
  if (!err.body || typeof err.body !== "object") return null;
  const p = (err.body as Record<string, unknown>).platform;
  return typeof p === "string" && Object.hasOwn(PLATFORM_TAB_KEYS, p)
    ? (p as PlatformId)
    : null;
}
