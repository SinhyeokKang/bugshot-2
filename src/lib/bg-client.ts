import { t } from "@/i18n";
import { onOAuthExpired } from "./app-events";
import type { BgRequest, BgResponse } from "@/types/messages";
import type { PlatformId } from "@/types/platform";

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

export function getOAuthErrorPlatform(err: unknown): PlatformId | null {
  if (!(err instanceof BgError)) return null;
  if (!err.body || typeof err.body !== "object") return null;
  const p = (err.body as Record<string, unknown>).platform;
  return p === "jira" ||
    p === "github" ||
    p === "linear" ||
    p === "notion" ||
    p === "gitlab" ||
    p === "asana" ||
    p === "clickup" ||
    p === "slack"
    ? p
    : null;
}
