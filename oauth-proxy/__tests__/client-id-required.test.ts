import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../worker";

// Asana/Notion 핸들러의 client_id 화이트리스트 검사가 필수임을 고정하는 회귀 테스트
// (과거엔 `body.client_id &&` 조건부라 client_id 생략 시 검사를 우회할 수 있었다).

const env = {
  ASANA_CLIENT_ID: "asana-id",
  ASANA_CLIENT_SECRET: "asana-secret",
  NOTION_CLIENT_ID: "notion-id",
  NOTION_CLIENT_SECRET: "notion-secret",
  ALLOWED_ORIGINS: "chrome-extension://abc",
};

function makeReq(path: string, body: unknown): Request {
  return new Request(`https://proxy.example${path}`, {
    method: "POST",
    headers: {
      Origin: "chrome-extension://abc",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function okFetch() {
  return vi.fn(async () =>
    new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
  );
}

describe.each([
  ["/asana/token", { code: "c", redirect_uri: "u" }, "asana-id"],
  ["/asana/refresh", { refresh_token: "rt" }, "asana-id"],
  ["/notion/token", { code: "c", redirect_uri: "u" }, "notion-id"],
])("%s client_id 필수화", (path, baseBody, registeredId) => {
  it("client_id 생략 → 400 (검사 우회 불가)", async () => {
    const fetchMock = okFetch();
    const res = await handleRequest(
      makeReq(path, baseBody),
      env,
      fetchMock as unknown as typeof fetch,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("등록되지 않은 client_id → 400", async () => {
    const fetchMock = okFetch();
    const res = await handleRequest(
      makeReq(path, { ...baseBody, client_id: "evil-id" }),
      env,
      fetchMock as unknown as typeof fetch,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("등록된 client_id → upstream 교환 호출", async () => {
    const fetchMock = okFetch();
    const res = await handleRequest(
      makeReq(path, { ...baseBody, client_id: registeredId }),
      env,
      fetchMock as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
