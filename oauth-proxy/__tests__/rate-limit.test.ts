import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../worker";

// Origin 헤더는 브라우저만 강제하고 확장 ID·client_id는 둘 다 공개값이라 curl로 재현된다.
// 상류 abuse로 client_secret이 정지되면 전 사용자 연결이 죽으므로 IP당 상한을 둔다(감사 A-08).

const baseEnv = {
  ATLASSIAN_CLIENT_ID: "atlassian-id",
  ATLASSIAN_CLIENT_SECRET: "atlassian-secret",
  ALLOWED_ORIGINS: "chrome-extension://abc",
};

function req(opts: { method?: string; ip?: string; path?: string } = {}): Request {
  return new Request(`https://proxy.example${opts.path ?? "/token"}`, {
    method: opts.method ?? "POST",
    headers: {
      Origin: "chrome-extension://abc",
      "Content-Type": "application/json",
      ...(opts.ip ? { "CF-Connecting-IP": opts.ip } : {}),
    },
    ...(opts.method === "OPTIONS" ? {} : { body: "{}" }),
  });
}

const okFetch = () => vi.fn(async () => new Response("{}", { status: 200 }));

function limiter(success: boolean) {
  return { limit: vi.fn(async () => ({ success })) };
}

describe("rate limit 게이트", () => {
  it("한도 내면 평소대로 핸들러까지 간다", async () => {
    const env = { ...baseEnv, RATE_LIMITER: limiter(true) };
    const res = await handleRequest(req({ ip: "1.2.3.4" }), env as never, okFetch() as never);
    // 빈 body라 400 — 403/429가 아니라는 게 요점(게이트 통과).
    expect(res.status).toBe(400);
    expect(env.RATE_LIMITER.limit).toHaveBeenCalledWith({ key: "1.2.3.4" });
  });

  it("한도 초과면 429로 끊고 상류를 안 부른다", async () => {
    const fetchMock = okFetch();
    const env = { ...baseEnv, RATE_LIMITER: limiter(false) };
    const res = await handleRequest(req({ ip: "1.2.3.4" }), env as never, fetchMock as never);
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("IP별로 키가 갈린다 (한 사용자가 전체를 소진하지 않는다)", async () => {
    const env = { ...baseEnv, RATE_LIMITER: limiter(true) };
    await handleRequest(req({ ip: "1.1.1.1" }), env as never, okFetch() as never);
    await handleRequest(req({ ip: "2.2.2.2" }), env as never, okFetch() as never);
    expect(env.RATE_LIMITER.limit.mock.calls.map((c) => c[0].key)).toEqual([
      "1.1.1.1",
      "2.2.2.2",
    ]);
  });

  // 제한기 장애로 전 사용자 토큰 교환이 막히는 쪽이 초과 허용보다 나쁘다.
  it("제한기가 throw하면 통과시킨다 (fail-open)", async () => {
    const env = {
      ...baseEnv,
      RATE_LIMITER: { limit: vi.fn(async () => { throw new Error("limiter down"); }) },
    };
    const res = await handleRequest(req({ ip: "1.2.3.4" }), env as never, okFetch() as never);
    expect(res.status).toBe(400);
  });

  it("바인딩이 없으면 제한을 건너뛴다 (로컬·테스트 env)", async () => {
    const res = await handleRequest(req({ ip: "1.2.3.4" }), baseEnv as never, okFetch() as never);
    expect(res.status).toBe(400);
  });

  // preflight가 예산을 먹으면 실효 한도가 절반이 된다.
  it("OPTIONS preflight는 예산을 소비하지 않는다", async () => {
    const env = { ...baseEnv, RATE_LIMITER: limiter(true) };
    const res = await handleRequest(req({ method: "OPTIONS" }), env as never, okFetch() as never);
    expect(res.status).toBe(204);
    expect(env.RATE_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("미허용 origin은 제한기까지 가지 않고 403 (예산 오염 방지)", async () => {
    const env = { ...baseEnv, RATE_LIMITER: limiter(true) };
    const bad = new Request("https://proxy.example/token", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: "{}",
    });
    const res = await handleRequest(bad, env as never, okFetch() as never);
    expect(res.status).toBe(403);
    expect(env.RATE_LIMITER.limit).not.toHaveBeenCalled();
  });
});
