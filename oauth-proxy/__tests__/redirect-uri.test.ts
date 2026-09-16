import { describe, expect, it, vi } from "vitest";
import { handleRequest, isAllowedRedirectUri } from "../worker";

// 제공자 앱 설정에서 wildcard callback matching이 실수로 켜지면, 공격자 확장이
// 우리 client_id로 authorize를 띄워 자기 chromiumapp.org로 인가 코드를 받을 수 있다.
// 교환에는 우리 client_secret이 필요해 반드시 이 프록시를 지나므로, 여기서
// redirect_uri를 막으면 그 오설정이 코드 레벨에서 무력화된다.
// 허용 목록은 ALLOWED_ORIGINS에서 파생한다 — 새 secret 축을 만들지 않는다.

const ALLOWED = "chrome-extension://abc,chrome-extension://def";

describe("isAllowedRedirectUri", () => {
  it("ALLOWED_ORIGINS의 확장 ID에서 파생한 origin은 허용", () => {
    expect(isAllowedRedirectUri("https://abc.chromiumapp.org/", ALLOWED)).toBe(true);
    expect(isAllowedRedirectUri("https://def.chromiumapp.org/", ALLOWED)).toBe(true);
  });

  it("목록에 없는 확장 ID는 거부 — wildcard 오설정을 막는 지점", () => {
    expect(isAllowedRedirectUri("https://evil.chromiumapp.org/", ALLOWED)).toBe(false);
  });

  it("origin만 본다 — 경로·쿼리가 붙어도 허용", () => {
    expect(isAllowedRedirectUri("https://abc.chromiumapp.org/cb?x=1", ALLOWED)).toBe(true);
  });

  it("스킴·호스트가 다르면 거부", () => {
    expect(isAllowedRedirectUri("http://abc.chromiumapp.org/", ALLOWED)).toBe(false);
    expect(isAllowedRedirectUri("https://abc.chromiumapp.org.evil.com/", ALLOWED)).toBe(false);
    expect(isAllowedRedirectUri("https://abc.example.com/", ALLOWED)).toBe(false);
  });

  it("ALLOWED_ORIGINS가 비었거나 미설정이면 전부 거부", () => {
    expect(isAllowedRedirectUri("https://abc.chromiumapp.org/", "")).toBe(false);
    expect(isAllowedRedirectUri("https://abc.chromiumapp.org/", undefined)).toBe(false);
  });

  it('와일드카드 항목("*")에서는 아무것도 파생하지 않는다', () => {
    expect(isAllowedRedirectUri("https://abc.chromiumapp.org/", "*")).toBe(false);
    expect(isAllowedRedirectUri("https://abc.chromiumapp.org/", `*,${ALLOWED}`)).toBe(true);
  });

  it("확장 origin이 아닌 항목에서는 파생하지 않는다", () => {
    expect(isAllowedRedirectUri("https://x.chromiumapp.org/", "https://x.example.com")).toBe(false);
  });

  it("항목 주변 공백은 무시", () => {
    expect(isAllowedRedirectUri("https://abc.chromiumapp.org/", " chrome-extension://abc ")).toBe(
      true,
    );
  });

  it("redirect_uri가 없거나 URL로 파싱되지 않으면 거부", () => {
    expect(isAllowedRedirectUri(undefined, ALLOWED)).toBe(false);
    expect(isAllowedRedirectUri("", ALLOWED)).toBe(false);
    expect(isAllowedRedirectUri("not-a-url", ALLOWED)).toBe(false);
  });
});

describe("라우트 통합 — 허용되지 않은 redirect_uri", () => {
  const env = {
    ATLASSIAN_CLIENT_ID: "atlas-id",
    ATLASSIAN_CLIENT_SECRET: "atlas-secret",
    GITHUB_CLIENT_ID: "gh-id",
    GITHUB_CLIENT_SECRET: "gh-secret",
    ALLOWED_ORIGINS: "chrome-extension://abc",
  };

  function makeReq(path: string, body: unknown): Request {
    return new Request(`https://proxy.example${path}`, {
      method: "POST",
      headers: { Origin: "chrome-extension://abc", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("공격자 확장의 redirect_uri는 400 — 상류 교환에 도달하지 못한다", async () => {
    const fetchMock = vi.fn();
    const res = await handleRequest(
      makeReq("/github/token", {
        code: "stolen",
        redirect_uri: "https://evil.chromiumapp.org/",
        client_id: "gh-id",
      }),
      env,
      fetchMock as unknown as typeof fetch,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refresh 라우트는 redirect_uri를 싣지 않으므로 영향 없음", async () => {
    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const res = await handleRequest(
      makeReq("/github/refresh", { refresh_token: "rt", client_id: "gh-id" }),
      env,
      fetchMock as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
  });
});
