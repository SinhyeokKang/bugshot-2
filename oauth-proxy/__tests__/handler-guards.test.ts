import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { handleRequest, resolveCorsOrigin } from "../worker";

// 8개 토큰 핸들러 전부에 "미설정 → 503" / "client_id 불일치 → 400" 가드가 있는지
// 파라미터라이즈드로 고정한다. 9번째 provider가 가드 없이 추가되면
// 아래 ROUTE_COVERAGE 검사가 먼저 깨진다.

const ORIGIN = "chrome-extension://abc";

const FULL_ENV = {
  ATLASSIAN_CLIENT_ID: "atlas-id",
  ATLASSIAN_CLIENT_SECRET: "atlas-secret",
  GITHUB_CLIENT_ID_DEV: "gh-dev-id",
  GITHUB_CLIENT_SECRET_DEV: "gh-dev-secret",
  GITHUB_CLIENT_ID_PROD: "gh-prod-id",
  GITHUB_CLIENT_SECRET_PROD: "gh-prod-secret",
  NOTION_CLIENT_ID: "notion-id",
  NOTION_CLIENT_SECRET: "notion-secret",
  ASANA_CLIENT_ID: "asana-id",
  ASANA_CLIENT_SECRET: "asana-secret",
  CLICKUP_CLIENT_ID: "clickup-id",
  CLICKUP_CLIENT_SECRET: "clickup-secret",
  SLACK_CLIENT_ID: "slack-id",
  SLACK_CLIENT_SECRET: "slack-secret",
  ALLOWED_ORIGINS: ORIGIN,
};

type Env = typeof FULL_ENV;

interface HandlerCase {
  path: string;
  body: Record<string, string>;
  secretKeys: (keyof Env)[];
  clientId: string;
}

const CASES: HandlerCase[] = [
  {
    path: "/token",
    body: { grant_type: "authorization_code", code: "c", redirect_uri: "u" },
    secretKeys: ["ATLASSIAN_CLIENT_ID", "ATLASSIAN_CLIENT_SECRET"],
    clientId: "atlas-id",
  },
  {
    path: "/github/token",
    body: { code: "c", redirect_uri: "u" },
    secretKeys: [
      "GITHUB_CLIENT_ID_DEV",
      "GITHUB_CLIENT_SECRET_DEV",
      "GITHUB_CLIENT_ID_PROD",
      "GITHUB_CLIENT_SECRET_PROD",
    ],
    clientId: "gh-dev-id",
  },
  {
    path: "/github/refresh",
    body: { refresh_token: "rt" },
    secretKeys: [
      "GITHUB_CLIENT_ID_DEV",
      "GITHUB_CLIENT_SECRET_DEV",
      "GITHUB_CLIENT_ID_PROD",
      "GITHUB_CLIENT_SECRET_PROD",
    ],
    clientId: "gh-dev-id",
  },
  {
    path: "/notion/token",
    body: { code: "c", redirect_uri: "u" },
    secretKeys: ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"],
    clientId: "notion-id",
  },
  {
    path: "/asana/token",
    body: { code: "c", redirect_uri: "u" },
    secretKeys: ["ASANA_CLIENT_ID", "ASANA_CLIENT_SECRET"],
    clientId: "asana-id",
  },
  {
    path: "/asana/refresh",
    body: { refresh_token: "rt" },
    secretKeys: ["ASANA_CLIENT_ID", "ASANA_CLIENT_SECRET"],
    clientId: "asana-id",
  },
  {
    path: "/clickup/token",
    body: { code: "c", redirect_uri: "u" },
    secretKeys: ["CLICKUP_CLIENT_ID", "CLICKUP_CLIENT_SECRET"],
    clientId: "clickup-id",
  },
  {
    path: "/slack/token",
    body: { code: "c", redirect_uri: "u" },
    secretKeys: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
    clientId: "slack-id",
  },
];

function makeReq(path: string, body: unknown, origin = ORIGIN): Request {
  return new Request(`https://proxy.example${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function okFetch() {
  return vi.fn(
    async () =>
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
  );
}

function withoutSecrets(keys: (keyof Env)[]): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...FULL_ENV };
  for (const k of keys) env[k] = undefined;
  return env;
}

describe.each(CASES.map((c) => [c.path, c] as const))(
  "%s 가드",
  (_path, c) => {
    it("secret 미설정 → 503, 상류 호출 없음", async () => {
      const fetchMock = okFetch();
      const res = await handleRequest(
        makeReq(c.path, { ...c.body, client_id: c.clientId }),
        withoutSecrets(c.secretKeys) as never,
        fetchMock as unknown as typeof fetch,
      );
      expect(res.status).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("등록되지 않은 client_id → 400, 상류 호출 없음", async () => {
      const fetchMock = okFetch();
      const res = await handleRequest(
        makeReq(c.path, { ...c.body, client_id: "evil-id" }),
        FULL_ENV as never,
        fetchMock as unknown as typeof fetch,
      );
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("client_id 생략 → 400, 상류 호출 없음", async () => {
      const fetchMock = okFetch();
      const res = await handleRequest(
        makeReq(c.path, c.body),
        FULL_ENV as never,
        fetchMock as unknown as typeof fetch,
      );
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("등록된 client_id + 설정 완료 → 상류 교환", async () => {
      const fetchMock = okFetch();
      const res = await handleRequest(
        makeReq(c.path, { ...c.body, client_id: c.clientId }),
        FULL_ENV as never,
        fetchMock as unknown as typeof fetch,
      );
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  },
);

describe("ROUTE_COVERAGE", () => {
  it("worker의 모든 POST 라우트가 위 파라미터라이즈드 표에 있다", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../worker.ts", import.meta.url)),
      "utf8",
    );
    const routes = [...src.matchAll(/url\.pathname === "([^"]+)"/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(0);
    expect([...routes].sort()).toEqual([...CASES.map((c) => c.path)].sort());
  });
});

describe("resolveCorsOrigin — 와일드카드 거부", () => {
  it('ALLOWED_ORIGINS="*" → 차단', () => {
    expect(resolveCorsOrigin(ORIGIN, "*")).toBe("null");
  });

  it("리스트에 섞인 *는 무시하고 명시 origin만 허용", () => {
    expect(resolveCorsOrigin(ORIGIN, `*,${ORIGIN}`)).toBe(ORIGIN);
    expect(resolveCorsOrigin("chrome-extension://other", `*,${ORIGIN}`)).toBe("null");
  });

  it("명시 origin 일치 → 반사, 불일치 → 차단", () => {
    expect(resolveCorsOrigin(ORIGIN, ORIGIN)).toBe(ORIGIN);
    expect(resolveCorsOrigin("https://evil.example", ORIGIN)).toBe("null");
  });

  it("미설정 → 차단", () => {
    expect(resolveCorsOrigin(ORIGIN, undefined)).toBe("null");
  });
});

describe('ALLOWED_ORIGINS="*" 배포는 요청을 거부한다', () => {
  it("토큰 요청 403", async () => {
    const fetchMock = okFetch();
    const res = await handleRequest(
      makeReq("/token", {
        grant_type: "authorization_code",
        code: "c",
        redirect_uri: "u",
        client_id: "atlas-id",
      }),
      { ...FULL_ENV, ALLOWED_ORIGINS: "*" } as never,
      fetchMock as unknown as typeof fetch,
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
