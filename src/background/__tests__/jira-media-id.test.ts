import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JiraAuth, JiraOAuthAuth } from "@/types/jira";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
}));

const refreshOAuthToken = vi.fn();
const persistOAuthTokens = vi.fn();

vi.mock("../oauth", () => ({
  refreshOAuthToken: (auth: JiraOAuthAuth) => refreshOAuthToken(auth),
  persistOAuthTokens: (auth: JiraOAuthAuth) => persistOAuthTokens(auth),
  OAuthError: class OAuthError extends Error {},
}));

import { extractMediaId, getMediaFileId } from "../jira-api";

describe("extractMediaId", () => {
  it("extracts UUID from media redirect URL", () => {
    const url =
      "https://api.media.atlassian.com/file/ae43c028-161e-42c3-966d-96e75e6b5422/binary?token=xxx&client=xxx&dl=true&name=recording.mp4";
    expect(extractMediaId(url)).toBe("ae43c028-161e-42c3-966d-96e75e6b5422");
  });

  it("returns undefined for non-matching URL", () => {
    expect(extractMediaId("https://example.com/some/path")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(extractMediaId("")).toBeUndefined();
  });

  it("extracts UUID regardless of media domain", () => {
    const url =
      "https://media.atlassian.com/file/12345678-abcd-ef01-2345-678901234567/binary";
    expect(extractMediaId(url)).toBe("12345678-abcd-ef01-2345-678901234567");
  });

  it("ignores non-UUID segments in /file/ path", () => {
    expect(extractMediaId("https://example.com/file/not-a-uuid/binary")).toBeUndefined();
  });
});

const MEDIA_ID = "ae43c028-161e-42c3-966d-96e75e6b5422";
const MEDIA_URL = `https://api.media.atlassian.com/file/${MEDIA_ID}/binary?token=xxx`;
// 미디어 변환 전에는 리다이렉트 없이 요청 URL이 그대로 돌아온다.
const NO_REDIRECT_URL =
  "https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/attachment/content/10001";

function oauthAuth(overrides: Partial<JiraOAuthAuth> = {}): JiraOAuthAuth {
  return {
    kind: "oauth",
    cloudId: "cloud-1",
    siteUrl: "https://example.atlassian.net",
    email: "user@example.com",
    accessToken: "stale-token",
    refreshToken: "refresh-1",
    expiresAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

const apiKeyAuth: JiraAuth = {
  kind: "apiKey",
  baseUrl: "https://example.atlassian.net",
  email: "user@example.com",
  apiToken: "token",
};

interface FakeResponse {
  status: number;
  url: string;
}

/** 순차 응답 큐. 소진되면 fallback으로 계속 응답하고, 각 호출의 Authorization 헤더를 기록한다. */
function stubFetch(
  responses: FakeResponse[],
  fallback: FakeResponse = { status: 200, url: NO_REDIRECT_URL },
) {
  const authHeaders: string[] = [];
  const fetchMock = vi.fn((_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    authHeaders.push(headers.Authorization);
    const res = responses.shift() ?? fallback;
    return Promise.resolve(res as unknown as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, authHeaders };
}

/** 재시도 지연을 실제로 기다리지 않고 기록만 한다. */
function recordingSleep() {
  const delays: number[] = [];
  const sleepFn = (ms: number) => {
    delays.push(ms);
    return Promise.resolve();
  };
  return { delays, sleepFn };
}

describe("getMediaFileId", () => {
  beforeEach(() => {
    refreshOAuthToken.mockReset();
    persistOAuthTokens.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("리다이렉트 URL에서 mediaId를 뽑는다", async () => {
    const { sleepFn } = recordingSleep();
    stubFetch([{ status: 206, url: MEDIA_URL }]);

    expect(await getMediaFileId(oauthAuth(), "10001", sleepFn)).toBe(MEDIA_ID);
  });

  it("만료된 OAuth 토큰이면 probe 전에 갱신해 새 accessToken으로 요청한다", async () => {
    // 제출 시점에 이미 만료된 토큰. 지금까지는 낡은 토큰 그대로 probe해 401 → mediaId 유실.
    const expired = oauthAuth({ expiresAt: Date.now() - 1_000 });
    refreshOAuthToken.mockResolvedValue(oauthAuth({ accessToken: "fresh-token" }));
    const { sleepFn } = recordingSleep();
    const { authHeaders } = stubFetch([{ status: 206, url: MEDIA_URL }]);

    expect(await getMediaFileId(expired, "10001", sleepFn)).toBe(MEDIA_ID);
    expect(refreshOAuthToken).toHaveBeenCalledTimes(1);
    expect(persistOAuthTokens).toHaveBeenCalledTimes(1);
    expect(authHeaders).not.toContain("Bearer stale-token");
    expect(authHeaders[0]).toBe("Bearer fresh-token");
  });

  it("probe가 401이면 토큰을 갱신해 재시도한다", async () => {
    // expiresAt은 아직 유효한데 서버가 401 (조기 폐기·클럭 스큐).
    refreshOAuthToken.mockResolvedValue(oauthAuth({ accessToken: "fresh-token" }));
    const { sleepFn } = recordingSleep();
    const { authHeaders } = stubFetch([
      { status: 401, url: NO_REDIRECT_URL },
      { status: 206, url: MEDIA_URL },
    ]);

    expect(await getMediaFileId(oauthAuth(), "10001", sleepFn)).toBe(MEDIA_ID);
    expect(refreshOAuthToken).toHaveBeenCalledTimes(1);
    expect(authHeaders[0]).toBe("Bearer stale-token");
    expect(authHeaders[1]).toBe("Bearer fresh-token");
  });

  it("갱신하고도 401이 계속되면 토큰 갱신을 더 반복하지 않는다", async () => {
    // 토큰이 아닌 이유(권한 등)의 401. 재시도 루프(최대 10 probe)에 refresh가 곱해지면 안 된다.
    refreshOAuthToken.mockResolvedValue(oauthAuth({ accessToken: "fresh-token" }));
    const { sleepFn } = recordingSleep();
    stubFetch([], { status: 401, url: NO_REDIRECT_URL });

    expect(await getMediaFileId(oauthAuth(), "10001", sleepFn)).toBeUndefined();
    expect(refreshOAuthToken).toHaveBeenCalledTimes(1);
  });

  it("미디어 변환이 늦어 첫 probe가 비면 재시도해서 획득한다", async () => {
    const { delays, sleepFn } = recordingSleep();
    stubFetch([
      { status: 200, url: NO_REDIRECT_URL }, // Range GET — 아직 변환 전
      { status: 200, url: NO_REDIRECT_URL }, // HEAD — 아직 변환 전
      { status: 206, url: MEDIA_URL }, // 재시도 Range GET — 변환 완료
    ]);

    expect(await getMediaFileId(oauthAuth(), "10001", sleepFn)).toBe(MEDIA_ID);
    expect(delays).toHaveLength(1);
  });

  it("변환이 계속 안 끝나면 5초 이상 재시도한 뒤 포기한다", async () => {
    const { delays, sleepFn } = recordingSleep();
    stubFetch([]); // 큐 소진 → 계속 리다이렉트 없음

    expect(await getMediaFileId(oauthAuth(), "10001", sleepFn)).toBeUndefined();
    expect(delays.length).toBeGreaterThanOrEqual(4);
    expect(delays.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5_000);
  });

  it("apiKey 인증은 401이어도 토큰 갱신을 시도하지 않는다", async () => {
    const { sleepFn } = recordingSleep();
    stubFetch([], { status: 401, url: NO_REDIRECT_URL });

    expect(await getMediaFileId(apiKeyAuth, "10001", sleepFn)).toBeUndefined();
    expect(refreshOAuthToken).not.toHaveBeenCalled();
  });
});
