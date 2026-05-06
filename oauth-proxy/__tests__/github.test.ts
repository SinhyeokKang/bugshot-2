import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../worker";

const baseEnv = {
  ATLASSIAN_CLIENT_ID: "atlas-id",
  ATLASSIAN_CLIENT_SECRET: "atlas-secret",
  GITHUB_CLIENT_ID: "gh-id",
  GITHUB_CLIENT_SECRET: "gh-secret",
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

describe("/github/token", () => {
  it("정상 — code/redirect_uri 받아 GitHub /access_token에 client_secret 첨부 후 응답 릴레이", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "ghx" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const req = makeReq("/github/token", {
      code: "the-code",
      redirect_uri: "https://x.chromiumapp.org/cb",
    });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: "ghx" });

    const upstreamCall = fetchMock.mock.calls[0];
    expect(upstreamCall[0]).toBe("https://github.com/login/oauth/access_token");
    const sentBody = JSON.parse((upstreamCall[1] as RequestInit).body as string);
    expect(sentBody).toEqual({
      client_id: "gh-id",
      client_secret: "gh-secret",
      code: "the-code",
      redirect_uri: "https://x.chromiumapp.org/cb",
    });
  });

  it("400 — code 누락", async () => {
    const fetchMock = vi.fn();
    const req = makeReq("/github/token", { redirect_uri: "x" });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 — redirect_uri 누락", async () => {
    const fetchMock = vi.fn();
    const req = makeReq("/github/token", { code: "x" });
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

  it("503 — GITHUB_CLIENT_SECRET 미설정", async () => {
    const fetchMock = vi.fn();
    const env = { ...baseEnv, GITHUB_CLIENT_SECRET: undefined };
    const req = makeReq("/github/token", { code: "c", redirect_uri: "u" });
    const res = await handleRequest(req, env, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upstream 4xx도 그대로 릴레이", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "bad_verification_code" }), {
        status: 200, // GitHub는 통상 200으로 에러 body를 돌려줌 — 그대로 릴레이
        headers: { "Content-Type": "application/json" },
      }),
    );
    const req = makeReq("/github/token", { code: "c", redirect_uri: "u" });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ error: "bad_verification_code" });
  });
});

describe("/github/refresh", () => {
  it("정상 — refresh_token으로 grant_type=refresh_token 교환", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "new", refresh_token: "newrt" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const req = makeReq("/github/refresh", { refresh_token: "rt" });
    const res = await handleRequest(req, baseEnv, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(200);
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody).toEqual({
      client_id: "gh-id",
      client_secret: "gh-secret",
      grant_type: "refresh_token",
      refresh_token: "rt",
    });
  });

  it("400 — refresh_token 누락", async () => {
    const fetchMock = vi.fn();
    const req = makeReq("/github/refresh", {});
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
      body: JSON.stringify({ code: "c", redirect_uri: "u" }),
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
