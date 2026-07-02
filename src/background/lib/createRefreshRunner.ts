import { t } from "@/i18n";
import type { PlatformId } from "@/types/platform";
import { OAuthError } from "../oauth";

const TOKEN_REFRESH_THRESHOLD_MS = 60_000;

export type RefreshHook<A> = ((auth: A) => Promise<A>) | null;

export interface RefreshRunner<A> {
  setRefreshHook: (hook: RefreshHook<A>) => void;
  ensureFresh: (auth: A) => Promise<A>;
  runWithAuthRetry: <R extends { status: number }>(
    auth: A,
    doFetch: (auth: A) => Promise<R>,
  ) => Promise<R>;
}

// github/gitlab/asana/linear 공용 refresh 골격. 요청 본체(doFetch — 헤더·baseUrl·
// 언랩·GraphQL)는 각 api 파일 소유. 인스턴스는 api 모듈 top-level 1회 발급 필수 —
// 이중 발급 시 hook과 fetch가 다른 클로저가 되어 401→refresh가 무음 사망한다.
export function createRefreshRunner<
  A extends { kind: string; expiresAt?: number | null },
>(cfg: { platform: PlatformId }): RefreshRunner<A> {
  let refreshHook: RefreshHook<A> = null;

  async function ensureFresh(auth: A): Promise<A> {
    if (auth.kind !== "oauth" || !refreshHook) return auth;
    if (auth.expiresAt == null) return auth;
    if (auth.expiresAt - Date.now() > TOKEN_REFRESH_THRESHOLD_MS) return auth;
    return refreshHook(auth);
  }

  async function runWithAuthRetry<R extends { status: number }>(
    auth: A,
    doFetch: (auth: A) => Promise<R>,
  ): Promise<R> {
    let cur = await ensureFresh(auth);
    let res = await doFetch(cur);
    if (res.status === 401 && cur.kind === "oauth" && refreshHook) {
      cur = await refreshHook(cur);
      res = await doFetch(cur);
      if (res.status === 401) {
        throw new OAuthError(t("oauth.error.refreshExhausted"), {
          platform: cfg.platform,
        });
      }
    }
    return res;
  }

  return {
    setRefreshHook: (hook) => {
      refreshHook = hook;
    },
    ensureFresh,
    runWithAuthRetry,
  };
}
