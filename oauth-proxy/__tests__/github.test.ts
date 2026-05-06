import { describe, expect, it, vi } from "vitest";
import { handleRequest, resolveGithubApp } from "../worker";

const baseEnv = {
  ATLASSIAN_CLIENT_ID: "atlas-id",
  ATLASSIAN_CLIENT_SECRET: "atlas-secret",
  GITHUB_CLIENT_ID_DEV: "gh-dev-id",
  GITHUB_CLIENT_SECRET_DEV: "gh-dev-secret",
  GITHUB_CLIENT_ID_PROD: "gh-prod-id",
  GITHUB_CLIENT_SECRET_PROD: "gh-prod-secret",
  ALLOWED_ORIGINS: "chrome-extension://abc",
};

const corsHeaders = { Origin: "chrome-extension://abc" };

function makeReq(path: string, body: unknown, init?: RequestInit): Request {
  return new Request(`https://proxy.example${path}`, {
    method: "POST",
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

describe("resolveGithubApp", () => {
  it("DEV/PROD 둘 다 등록, dev client_id 일치 → dev secret", () => {
    const out = resolveGithubApp(baseEnv, "gh-dev-id");
    expect(out).toEqual({ clientId: "gh-dev-id", clientSecret: "gh-dev-secret" });
  });

  it("DEV/PROD 둘 다 등록, prod client_id 일치 → prod secret", () => {
    const out = resolveGithubApp(baseEnv, "gh-prod-id");
    expect(out).toEqual({ clientId: "gh-prod-id", clientSecret: "gh-prod-secret" });
  });

  it("DEV만 등록된 환경에서 prod client_id 요청 → 400 client_id not registered", () => {
    const env = {
      ...baseEnv,
      GITHUB_CLIENT_ID_PROD: undefined,
      GITHUB_CLIENT_SECRET_PROD: undefined,
    };
    const out = resolveGithubApp(env, "gh-prod-id");
    expect(out).toEqual({ error: "client_id not registered", status: 400 });
  });

  it("DEV만 등록된 환경에서 dev client_id 요청 → 정상", () => {
    const env = {
      ...baseEnv,
      GITHUB_CLIENT_ID_PROD: undefined,
      GITHUB_CLIENT_SECRET_PROD: undefined,
    };
    const out = resolveGithubApp(env, "gh-dev-id");
    expect(out).toEqual({ clientId: "gh-dev-id", clientSecret: "gh-dev-secret" });
  });

  it("아무것도 등록 안 됨 → 503", () => {
    const env = {
      ...baseEnv,
      GITHUB_CLIENT_ID_DEV: undefined,
      GITHUB_CLIENT_SECRET_DEV: undefined,
      GITHUB_CLIENT_ID_PROD: undefined,
      GITHUB_CLIENT_SECRET_PROD: undefined,
    };
    const out = resolveGithubApp(env, "any");
    expect(out).toEqual({ error: "github oauth not configured", status: 503 });
  });

  it("client_id 미전송 → 400 missing client_id", () => {
    const out = resolveGithubApp(baseEnv, undefined);
    expect(out).toEqual({ error: "missing client_id", status: 400 });
  });

  it("등록되지 않은 client_id → 400", () => {
    const out = resolveGithubApp(baseEnv, "evil-attacker-id");
    expect(out).toEqual({ error: "client_id not registered", status: 400 });
  });
});

describe("/github/token", () => {
  it("정상 — dev client_id로 요청하면 dev secret으로 GitHub에 교환", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "ghx" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const req = makeReq("/github/token", {
      code: "the-code",
      redirect_uri: "https://x.chromiumapp.org/cb",
      client_id: "gh-dev-id",
    });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: "ghx" });

    const upstreamCall = fetchMock.mock.calls[0];
    expect(upstreamCall[0]).toBe("https://github.com/login/oauth/access_token");
    const sentBody = JSON.parse((upstreamCall[1] as RequestInit).body as string);
    expect(sentBody).toEqual({
      client_id: "gh-dev-id",
      client_secret: "gh-dev-secret",
      code: "the-code",
      redirect_uri: "https://x.chromiumapp.org/cb",
    });
  });

  it("prod client_id로 요청 → prod secret 사용", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const req = makeReq("/github/token", {
      code: "c",
      redirect_uri: "u",
      client_id: "gh-prod-id",
    });
    await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.client_secret).toBe("gh-prod-secret");
  });

  it("400 — code 누락", async () => {
    const fetchMock = vi.fn();
    const req = makeReq("/github/token", { redirect_uri: "x", client_id: "gh-dev-id" });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 — redirect_uri 누락", async () => {
    const fetchMock = vi.fn();
    const req = makeReq("/github/token", { code: "x", client_id: "gh-dev-id" });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 — client_id 누락", async () => {
    const fetchMock = vi.fn();
    const req = makeReq("/github/token", { code: "c", redirect_uri: "u" });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 — body가 invalid JSON", async () => {
    const fetchMock = vi.fn();
    const req = makeReq("/github/token", "not-json");
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("503 — 두 set 모두 미설정", async () => {
    const fetchMock = vi.fn();
    const env = {
      ...baseEnv,
      GITHUB_CLIENT_ID_DEV: undefined,
      GITHUB_CLIENT_SECRET_DEV: undefined,
      GITHUB_CLIENT_ID_PROD: undefined,
      GITHUB_CLIENT_SECRET_PROD: undefined,
    };
    const req = makeReq("/github/token", { code: "c", redirect_uri: "u", client_id: "x" });
    const res = await handleRequest(req, env, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upstream 응답을 그대로 릴레이", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "bad_verification_code" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const req = makeReq("/github/token", {
      code: "c",
      redirect_uri: "u",
      client_id: "gh-dev-id",
    });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ error: "bad_verification_code" });
  });
});

describe("/github/refresh", () => {
  it("정상 — refresh_token + client_id로 grant_type=refresh_token 교환", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "new", refresh_token: "newrt" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const req = makeReq("/github/refresh", { refresh_token: "rt", client_id: "gh-dev-id" });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(200);
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody).toEqual({
      client_id: "gh-dev-id",
      client_secret: "gh-dev-secret",
      grant_type: "refresh_token",
      refresh_token: "rt",
    });
  });

  it("400 — refresh_token 누락", async () => {
    const fetchMock = vi.fn();
    const req = makeReq("/github/refresh", { client_id: "gh-dev-id" });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 — client_id 미등록", async () => {
    const fetchMock = vi.fn();
    const req = makeReq("/github/refresh", { refresh_token: "rt", client_id: "evil" });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CORS / 라우팅 가드", () => {
  it("허용되지 않은 origin은 403", async () => {
    const fetchMock = vi.fn();
    const req = new Request("https://proxy.example/github/token", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ code: "c", redirect_uri: "u", client_id: "gh-dev-id" }),
    });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(403);
  });

  it("알 수 없는 path는 404", async () => {
    const fetchMock = vi.fn();
    const req = makeReq("/unknown", {});
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(404);
  });

  it("OPTIONS — preflight는 204", async () => {
    const fetchMock = vi.fn();
    const req = new Request("https://proxy.example/github/token", {
      method: "OPTIONS",
      headers: corsHeaders,
    });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abc");
  });
});
