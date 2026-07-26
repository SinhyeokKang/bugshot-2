import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshOAuthToken, startOAuthFlow } from "../oauth";
import type { JiraOAuthAuth } from "@/types/jira";

// 배포 순서 제약을 만들던 구멍의 회귀 테스트.
//
// oauth-proxy는 8개 플랫폼 전부에 `body.client_id !== env.<P>_CLIENT_ID → 400` 가드를 둔다
// (oauth-proxy/__tests__/client-id-required.test.ts). Atlassian만 확장이 client_id를 안 실어서,
// 프록시를 먼저 배포하면 Jira 연결·토큰 갱신이 전부 400으로 죽는 상태였다. 유닛·타입체크는
// 통과하고 e2e는 OAuth를 안 태우므로 **이 테스트가 유일한 검출 경로**다.

const CLIENT_ID = "atlassian-client-id";
const PROXY = "https://proxy.example";
const REDIRECT = "https://abc.chromiumapp.org/";

let fetchMock: ReturnType<typeof vi.fn>;

function bodyOf(callIndex: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[callIndex][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv("VITE_ATLASSIAN_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("VITE_OAUTH_PROXY_URL", PROXY);

  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/token")) {
      return new Response(
        JSON.stringify({
          access_token: "at",
          refresh_token: "rt2",
          expires_in: 3600,
        }),
        { status: 200 },
      );
    }
    // accessible-resources
    return new Response(JSON.stringify([]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);

  vi.stubGlobal("chrome", {
    identity: {
      getRedirectURL: () => REDIRECT,
      // 인가 URL의 state를 그대로 되돌려줘 실제 왕복을 재현한다.
      launchWebAuthFlow: async ({ url }: { url: string }) => {
        const state = new URL(url).searchParams.get("state");
        return `${REDIRECT}?code=AUTH_CODE&state=${state}`;
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Atlassian 토큰 요청 — 프록시 client_id 가드 호환", () => {
  it("authorization_code 교환에 client_id를 싣는다", async () => {
    await startOAuthFlow();

    const body = bodyOf(0);
    expect(body.grant_type).toBe("authorization_code");
    expect(body.code).toBe("AUTH_CODE");
    expect(body.client_id).toBe(CLIENT_ID);
  });

  it("refresh_token 갱신에 client_id를 싣는다", async () => {
    const auth = {
      kind: "oauth",
      cloudId: "site-1",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: 0,
    } as JiraOAuthAuth;

    await refreshOAuthToken(auth);

    const body = bodyOf(0);
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe("rt");
    expect(body.client_id).toBe(CLIENT_ID);
  });

  it("두 경로가 같은 client_id를 쓴다 (dev/prod 치환 일관성)", async () => {
    await startOAuthFlow();
    const exchange = bodyOf(0);
    fetchMock.mockClear();

    await refreshOAuthToken({
      kind: "oauth",
      cloudId: "s",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 0,
    } as JiraOAuthAuth);
    const refresh = bodyOf(0);

    expect(refresh.client_id).toBe(exchange.client_id);
  });
});
