import { describe, it, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

import { createRefreshRunner } from "../createRefreshRunner";
import { OAuthError } from "../../oauth";

interface FakeAuth {
  kind: "oauth" | "manual";
  token: string;
  expiresAt?: number | null;
}

const FAR = () => Date.now() + 10 * 60_000; // threshold(60s) 밖
const SOON = () => Date.now() + 30_000; // threshold(60s) 안

function res(status: number): { status: number } {
  return { status };
}

describe("createRefreshRunner — ensureFresh (pre-refresh)", () => {
  it("hook 미등록이면 auth 그대로 반환", async () => {
    const runner = createRefreshRunner<FakeAuth>({ platform: "github" });
    const auth: FakeAuth = { kind: "oauth", token: "old", expiresAt: SOON() };
    expect(await runner.ensureFresh(auth)).toBe(auth);
  });

  it("oauth + 만료 60s 이내면 hook으로 갱신 auth 반환", async () => {
    const runner = createRefreshRunner<FakeAuth>({ platform: "github" });
    const refreshed: FakeAuth = { kind: "oauth", token: "new", expiresAt: FAR() };
    const hook = vi.fn(async () => refreshed);
    runner.setRefreshHook(hook);

    const auth: FakeAuth = { kind: "oauth", token: "old", expiresAt: SOON() };
    expect(await runner.ensureFresh(auth)).toBe(refreshed);
    expect(hook).toHaveBeenCalledWith(auth);
  });

  it("만료 여유(60s 초과)면 hook 미호출", async () => {
    const runner = createRefreshRunner<FakeAuth>({ platform: "github" });
    const hook = vi.fn(async (a: FakeAuth) => a);
    runner.setRefreshHook(hook);

    const auth: FakeAuth = { kind: "oauth", token: "ok", expiresAt: FAR() };
    expect(await runner.ensureFresh(auth)).toBe(auth);
    expect(hook).not.toHaveBeenCalled();
  });

  it("expiresAt이 없으면(null/undefined) pre-refresh 스킵", async () => {
    const runner = createRefreshRunner<FakeAuth>({ platform: "github" });
    const hook = vi.fn(async (a: FakeAuth) => a);
    runner.setRefreshHook(hook);

    const auth: FakeAuth = { kind: "oauth", token: "no-expiry", expiresAt: null };
    expect(await runner.ensureFresh(auth)).toBe(auth);
    expect(hook).not.toHaveBeenCalled();
  });
});

describe("createRefreshRunner — runWithAuthRetry (401 경로)", () => {
  it("401 → hook 갱신 → 갱신 auth로 재요청 성공", async () => {
    const runner = createRefreshRunner<FakeAuth>({ platform: "github" });
    const refreshed: FakeAuth = { kind: "oauth", token: "new", expiresAt: FAR() };
    const hook = vi.fn(async () => refreshed);
    runner.setRefreshHook(hook);

    const doFetch = vi.fn(async (a: FakeAuth) => (a.token === "new" ? res(200) : res(401)));
    const auth: FakeAuth = { kind: "oauth", token: "old", expiresAt: FAR() };

    const out = await runner.runWithAuthRetry(auth, doFetch);
    expect(out.status).toBe(200);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(doFetch).toHaveBeenCalledTimes(2);
    expect(doFetch.mock.calls[1][0]).toBe(refreshed);
  });

  it("갱신 후에도 401이면 OAuthError(platform) throw", async () => {
    const runner = createRefreshRunner<FakeAuth>({ platform: "gitlab" });
    runner.setRefreshHook(async (a) => a);

    const doFetch = vi.fn(async () => res(401));
    const auth: FakeAuth = { kind: "oauth", token: "dead", expiresAt: FAR() };

    const err = await runner.runWithAuthRetry(auth, doFetch).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).platform).toBe("gitlab");
    expect((err as OAuthError).message).toContain("oauth.error.refreshExhausted");
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("manual auth는 401이어도 hook 미호출, 401 응답 그대로 반환", async () => {
    const runner = createRefreshRunner<FakeAuth>({ platform: "github" });
    const hook = vi.fn(async (a: FakeAuth) => a);
    runner.setRefreshHook(hook);

    const doFetch = vi.fn(async () => res(401));
    const auth: FakeAuth = { kind: "manual", token: "pat" };

    const out = await runner.runWithAuthRetry(auth, doFetch);
    expect(out.status).toBe(401);
    expect(hook).not.toHaveBeenCalled();
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("hook 미등록 oauth는 401 응답 그대로 반환 (재시도 없음)", async () => {
    const runner = createRefreshRunner<FakeAuth>({ platform: "github" });
    const doFetch = vi.fn(async () => res(401));
    const auth: FakeAuth = { kind: "oauth", token: "old", expiresAt: FAR() };

    const out = await runner.runWithAuthRetry(auth, doFetch);
    expect(out.status).toBe(401);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });
});
