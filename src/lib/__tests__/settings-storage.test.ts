import { beforeEach, describe, expect, it, vi } from "vitest";

let stored: unknown;

vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: structuredClone(stored) }),
      // write 계열 검증용 — 기록된 값을 그대로 stored에 되돌려 왕복을 관찰한다.
      set: async (obj: Record<string, unknown>) => {
        stored = obj[SETTINGS_STORAGE_KEY];
      },
    },
  },
});

import {
  readStoredAuth,
  readStoredAsanaAuth,
  readStoredClickupAuth,
  readStoredGithubAuth,
  readStoredGitlabAuth,
  readStoredLinearAuth,
  readStoredNotionAuth,
  readStoredSlackAuth,
  writeStoredAsanaOAuthTokens,
  writeStoredGithubOAuthTokens,
  writeStoredGitlabOAuthTokens,
  writeStoredLinearOAuthTokens,
  writeStoredOAuthTokens,
  SETTINGS_STORAGE_KEY,
  sameAuthIdentity,
  acquireStoredAuth,
} from "../settings-storage";
import { SettingsCorruptError, StaleGrantError } from "../settings-envelope";
import { getLocale, setLocale, t } from "@/i18n";

const jiraAuth = { kind: "oauth", grantId: "g", accessToken: "j", cloudId: "c" };
const legacyJiraAuth = { kind: "apiToken", baseUrl: "https://x.atlassian.net" };
const githubAuth = { kind: "oauth", grantId: "g", accessToken: "g" };

function envelope(state: unknown) {
  return { state, version: 8 };
}

beforeEach(() => {
  stored = undefined;
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, _opts: object, run: () => unknown) => run() } });
});

describe("readStoredAuth", () => {
  it("accounts.jira.auth가 있으면 그것을 반환", async () => {
    stored = envelope({ accounts: { jira: { auth: jiraAuth } } });
    expect(await readStoredAuth()).toEqual(jiraAuth);
  });

  it("accounts.jira가 없으면 legacy jiraConfig.auth로 폴백", async () => {
    stored = envelope({ jiraConfig: { auth: legacyJiraAuth } });
    expect(await readStoredAuth()).toEqual(legacyJiraAuth);
  });

  it("accounts.jira.auth가 jiraConfig보다 우선", async () => {
    stored = envelope({
      accounts: { jira: { auth: jiraAuth } },
      jiraConfig: { auth: legacyJiraAuth },
    });
    expect(await readStoredAuth()).toEqual(jiraAuth);
  });

  it("아무것도 없으면 null", async () => {
    stored = null;
    expect(await readStoredAuth()).toBeNull();
  });

  it("문자열로 직렬화된 envelope도 JSON.parse 후 처리", async () => {
    stored = JSON.stringify(envelope({ accounts: { jira: { auth: jiraAuth } } }));
    expect(await readStoredAuth()).toEqual(jiraAuth);
  });

  it("깨진 JSON 문자열은 손상 오류 — 현지화된 문구로 던진다", async () => {
    stored = "{not valid json";
    const err = await readStoredAuth().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SettingsCorruptError);
    expect((err as Error).message).toBe(t("app.settingsStorage.corrupt"));
  });
});

describe("readStoredGithubAuth", () => {
  it("accounts.github.auth 반환", async () => {
    stored = envelope({ accounts: { github: { auth: githubAuth } } });
    expect(await readStoredGithubAuth()).toEqual(githubAuth);
  });

  it("없으면 null", async () => {
    stored = envelope({ accounts: {} });
    expect(await readStoredGithubAuth()).toBeNull();
  });
});

describe("SETTINGS_STORAGE_KEY", () => {
  it("스토리지 키 상수", () => {
    expect(SETTINGS_STORAGE_KEY).toBe("bugshot-settings");
  });
});

// 나머지 6개 read 계열 — 플랫폼별로 envelope 경로가 다른데 jira/github만 검증돼 있었다 (감사 🔴 항목).
describe("플랫폼별 read 계열", () => {
  const cases = [
    ["linear", readStoredLinearAuth],
    ["notion", readStoredNotionAuth],
    ["gitlab", readStoredGitlabAuth],
    ["asana", readStoredAsanaAuth],
    ["clickup", readStoredClickupAuth],
    ["slack", readStoredSlackAuth],
  ] as const;

  it.each(cases)("%s: accounts.%s.auth를 읽는다", async (platform, read) => {
    const auth = { kind: "oauth", grantId: "g", accessToken: `tok-${platform}` };
    stored = envelope({ accounts: { [platform]: { auth } } });
    expect(await read()).toEqual(auth);
  });

  it.each(cases)("%s: 계정이 없으면 null", async (_platform, read) => {
    stored = envelope({ accounts: {} });
    expect(await read()).toBeNull();
  });

  it.each(cases)("%s: 저장소가 비어도 null", async (_platform, read) => {
    stored = undefined;
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, _opts: object, run: () => unknown) => run() } });
    expect(await read()).toBeNull();
  });
});

describe("strict start/refreshed token writers", () => {
  const cases = [
    ["jira", writeStoredOAuthTokens, ["accessToken", "refreshToken", "expiresAt"]],
    ["github", writeStoredGithubOAuthTokens, ["accessToken", "refreshToken", "expiresAt", "scope", "tokenType"]],
    ["linear", writeStoredLinearOAuthTokens, ["accessToken", "refreshToken", "expiresAt", "scope"]],
    ["gitlab", writeStoredGitlabOAuthTokens, ["accessToken", "refreshToken", "expiresAt", "scope"]],
    ["asana", writeStoredAsanaOAuthTokens, ["accessToken", "refreshToken", "expiresAt"]],
  ] as const;
  const seed = { kind: "oauth", grantId: "g", accessToken: "old", refreshToken: "r0", expiresAt: 1 };
  it.each(cases)("%s updates only its complete token whitelist and preserves the envelope", async (platform, write, fields) => {
    const auth = { ...seed, viewerName: "user", baseUrl: "https://example.com" };
    const state = { accounts: { [platform]: { auth, defaults: { keep: 1 } } }, lastSubmitFields: {}, unknown: "keep" };
    stored = { state: structuredClone(state), version: 99, unknown: "outer" };
    const changes = { accessToken: "new", refreshToken: "r1", expiresAt: 999, scope: "new", tokenType: "bearer" };
    const refreshed = { ...auth, ...Object.fromEntries(fields.map((key) => [key, changes[key]])) };
    await write(auth as never, refreshed as never);
    expect(stored).toEqual({ state: { ...state, accounts: { [platform]: { auth: refreshed, defaults: { keep: 1 } } } }, version: 99, unknown: "outer" });
  });
  it.each(cases)("%s rejects changed/deleted grants and forged refreshed identity", async (platform, write) => {
    for (const current of [{ ...seed, grantId: "new" }, { kind: "pat" }, undefined]) {
      stored = envelope({ accounts: current ? { [platform]: { auth: current } } : {} });
      const before = structuredClone(stored);
      await expect(write(seed as never, { ...seed, accessToken: "late" } as never)).rejects.toThrow();
      expect(stored).toEqual(before);
    }
    stored = envelope({ accounts: { [platform]: { auth: seed } } });
    await expect(write(seed as never, { ...seed, viewerName: "forged" } as never)).rejects.toThrow();
  });
  it.each(cases)("%s retains string envelopes", async (platform, write) => {
    stored = JSON.stringify(envelope({ accounts: { [platform]: { auth: seed } } }));
    await write(seed as never, { ...seed, accessToken: "new" } as never);
    expect(typeof stored).toBe("string");
    expect(JSON.parse(stored as string).state.accounts[platform].auth.accessToken).toBe("new");
  });
  it("GitHub missing optional fields retain values, while falsy explicit values replace them", async () => {
    for (const value of [undefined, ""]) {
      stored = envelope({ accounts: { github: { auth: seed } } });
      await writeStoredGithubOAuthTokens(seed as never, { ...seed, accessToken: "new", refreshToken: value, expiresAt: value === undefined ? undefined : 0 } as never);
      const auth = (stored as any).state.accounts.github.auth;
      expect(auth.refreshToken).toBe(value === undefined ? "r0" : "");
      expect(auth.expiresAt).toBe(value === undefined ? 1 : 0);
    }
  });
});

// 이 함수는 "같은 계정인가"를 판정해 직전 제출값을 살릴지 지울지 정한다. 스칼라만 비교하면
// auth에 배열·객체를 둔 플랫폼은 **늘 다른 계정**으로 읽힌다 — webhook의 headers가 그렇다.
// 지금 낙진이 없는 건 lastSubmitFields.webhook이 never라서일 뿐이라, 그 전제가 바뀌는 순간
// 무음으로 깨진다. ACCOUNT_IDENTITY_FIELDS.webhook의 주석도 이미 그 비교가 된다고 말한다.
describe("sameAuthIdentity — 스칼라가 아닌 값", () => {
  it("같은 내용의 배열은 같은 신원이다", () => {
    const a = { url: "https://x/hook", headers: [{ name: "X-Api-Key", value: "k" }] };
    const b = { url: "https://x/hook", headers: [{ name: "X-Api-Key", value: "k" }] };
    expect(sameAuthIdentity(a, b, [])).toBe(true);
  });

  it("내용이 다른 배열은 다른 신원이다", () => {
    const a = { headers: [{ name: "X-Api-Key", value: "k1" }] };
    const b = { headers: [{ name: "X-Api-Key", value: "k2" }] };
    expect(sameAuthIdentity(a, b, [])).toBe(false);
  });

  it("길이가 다른 배열은 다른 신원이다", () => {
    expect(sameAuthIdentity({ h: [1, 2] }, { h: [1] }, [])).toBe(false);
  });

  it("순서가 다른 배열은 다른 신원이다 — 헤더 순서는 요청에 그대로 실린다", () => {
    expect(sameAuthIdentity({ h: ["a", "b"] }, { h: ["b", "a"] }, [])).toBe(false);
  });

  it("중첩 객체도 내용으로 비교한다", () => {
    expect(sameAuthIdentity({ o: { a: 1 } }, { o: { a: 1 } }, [])).toBe(true);
    expect(sameAuthIdentity({ o: { a: 1 } }, { o: { a: 2 } }, [])).toBe(false);
  });

  it("제외 목록은 중첩 값에도 그대로 적용된다 (최상위 키 기준)", () => {
    const a = { headers: [{ name: "X", value: "1" }], accessToken: "t1" };
    const b = { headers: [{ name: "X", value: "1" }], accessToken: "t2" };
    expect(sameAuthIdentity(a, b, ["accessToken"])).toBe(true);
  });

  it("한쪽이 undefined인 키는 기존대로 건너뛴다", () => {
    expect(sameAuthIdentity({ h: [1], x: undefined }, { h: [1] }, [])).toBe(true);
  });
});
describe("token field omission contracts", () => {
  const cases = [["jira", writeStoredOAuthTokens, ["scope", "tokenType"]], ["linear", writeStoredLinearOAuthTokens, ["tokenType"]], ["gitlab", writeStoredGitlabOAuthTokens, ["tokenType"]], ["asana", writeStoredAsanaOAuthTokens, ["scope", "tokenType"]]] as const;
  it.each(cases)("%s deletes omitted RT/expiry and never introduces another provider's fields", async (platform, write, absent) => {
    const auth = { kind: "oauth", grantId: "g", accessToken: "old", refreshToken: "r", expiresAt: 1 };
    stored = envelope({ accounts: { [platform]: { auth } } });
    const refreshed = { kind: "oauth", grantId: "g", accessToken: "new" };
    await write(auth as never, refreshed as never);
    const current = (stored as any).state.accounts[platform].auth;
    expect(current.refreshToken).toBeUndefined(); expect(current.expiresAt).toBeUndefined();
    for (const field of absent) expect(field in current).toBe(false);
  });
});

describe("StaleGrantError — 사유 분류와 던지는 시점 현지화", () => {
  const notConnected = () => t("platform.notConnected.title", { platform: t("platform.tab.github") });
  const accountChanged = () => t("platform.accountChanged.title", { platform: t("platform.tab.github") });

  it("저장소에 계정이 없으면(다른 패널에서 해제) missing + 연결 안 됨 문구", async () => {
    stored = envelope({ accounts: {} });
    const err = await acquireStoredAuth("github", githubAuth).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleGrantError);
    expect((err as StaleGrantError).reason).toBe("missing");
    expect((err as Error).message).toBe(notConnected());
  });

  it("grant가 교체됐으면(재연결) replaced + 계정 변경 문구", async () => {
    stored = envelope({ accounts: { github: { auth: { ...githubAuth, grantId: "other", accessToken: "B" } } } });
    const err = await acquireStoredAuth("github", githubAuth).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleGrantError);
    expect((err as StaleGrantError).reason).toBe("replaced");
    expect((err as Error).message).toBe(accountChanged());
  });

  it("writer의 grant 불일치도 replaced로 분류", async () => {
    stored = envelope({ accounts: { github: { auth: { ...githubAuth, grantId: "other" } } } });
    const err = await writeStoredGithubOAuthTokens(githubAuth as never, { ...githubAuth, accessToken: "late" } as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleGrantError);
    expect((err as StaleGrantError).reason).toBe("replaced");
  });

  it("문구는 던지는 시점의 로케일을 따른다 — 영어 하드코딩이 아니다", async () => {
    const previous = getLocale();
    try {
      for (const locale of ["ko", "de"] as const) {
        setLocale(locale);
        stored = envelope({ accounts: {} });
        const err = await acquireStoredAuth("github", githubAuth).catch((e: unknown) => e);
        expect((err as Error).message).toBe(notConnected());
        expect((err as Error).message).not.toMatch(/connected account changed/i);
      }
    } finally {
      setLocale(previous);
    }
  });
});
