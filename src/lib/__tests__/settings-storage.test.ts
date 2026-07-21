import { beforeEach, describe, expect, it, vi } from "vitest";

let stored: unknown;

vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: stored }),
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
} from "../settings-storage";

const jiraAuth = { kind: "oauth", accessToken: "j", cloudId: "c" };
const legacyJiraAuth = { kind: "apiToken", baseUrl: "https://x.atlassian.net" };
const githubAuth = { kind: "oauth", accessToken: "g" };

function envelope(state: unknown) {
  return { state, version: 8 };
}

beforeEach(() => {
  stored = undefined;
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

  it("깨진 JSON 문자열이면 null", async () => {
    stored = "{not valid json";
    expect(await readStoredAuth()).toBeNull();
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
    const auth = { kind: "oauth", accessToken: `tok-${platform}` };
    stored = envelope({ accounts: { [platform]: { auth } } });
    expect(await read()).toEqual(auth);
  });

  it.each(cases)("%s: 계정이 없으면 null", async (_platform, read) => {
    stored = envelope({ accounts: {} });
    expect(await read()).toBeNull();
  });

  it.each(cases)("%s: 저장소가 비어도 null", async (_platform, read) => {
    stored = undefined;
    expect(await read()).toBeNull();
  });
});

// write 계열은 전부 무그물이었다. 갱신이 영속되지 않으면 사용자가 반복 재로그인하게 된다.
describe("플랫폼별 write 계열 (토큰 갱신 영속)", () => {
  const cases = [
    ["jira", writeStoredOAuthTokens],
    ["github", writeStoredGithubOAuthTokens],
    ["linear", writeStoredLinearOAuthTokens],
    ["gitlab", writeStoredGitlabOAuthTokens],
    ["asana", writeStoredAsanaOAuthTokens],
  ] as const;

  function readBack(): any {
    return typeof stored === "string" ? JSON.parse(stored) : stored;
  }

  it.each(cases)("%s: oauth 계정의 accessToken을 갱신해 저장한다", async (platform, write) => {
    stored = envelope({
      accounts: { [platform]: { auth: { kind: "oauth", accessToken: "old", refreshToken: "r0", expiresAt: 1 } } },
    });
    await write({ kind: "oauth", accessToken: "new", refreshToken: "r1", expiresAt: 999 } as any);
    expect(readBack().state.accounts[platform].auth.accessToken).toBe("new");
  });

  // apiKey/PAT 계정에 OAuth 토큰을 덮어쓰면 자격증명이 깨진다 — 가드가 핵심이다.
  it.each(cases)("%s: oauth가 아닌 계정은 건드리지 않는다", async (platform, write) => {
    stored = envelope({
      accounts: { [platform]: { auth: { kind: "apiKey", token: "pat" } } },
    });
    // stored를 그대로 기대값으로 쓰면 in-place mutation 시 기대값도 같이 변해 무력해진다 — 깊은 복사로 고정.
    const before = structuredClone(stored);
    await write({ kind: "oauth", accessToken: "new", refreshToken: "r1", expiresAt: 999 } as any);
    expect(readBack()).toEqual(before);
  });

  it.each(cases)("%s: 계정 자체가 없으면 아무것도 쓰지 않는다", async (_platform, write) => {
    stored = envelope({ accounts: {} });
    const before = structuredClone(stored);
    await write({ kind: "oauth", accessToken: "new", refreshToken: "r1", expiresAt: 999 } as any);
    expect(readBack()).toEqual(before);
  });

  // accessToken만 보면 부족하다 — 갱신이 영속되지 않는 진짜 증상은 refreshToken/expiresAt 쪽에서 난다.
  it.each(cases)("%s: refreshToken과 expiresAt도 함께 갱신한다", async (platform, write) => {
    stored = envelope({
      accounts: { [platform]: { auth: { kind: "oauth", accessToken: "old", refreshToken: "r0", expiresAt: 1 } } },
    });
    await write({ kind: "oauth", accessToken: "new", refreshToken: "r1", expiresAt: 999, scope: "s1", tokenType: "bearer" } as any);
    const auth = readBack().state.accounts[platform].auth;
    expect(auth.refreshToken).toBe("r1");
    expect(auth.expiresAt).toBe(999);
  });

  // GitHub만 `?? cur.X` 폴백 시맨틱이다 — 응답에 refreshToken/expiresAt이 없는 경우가 있어,
  // 이게 단순 대입으로 퇴화하면 기존 refresh token이 undefined로 날아가 무한 재로그인이 된다.
  it("github: 응답에 refreshToken/expiresAt이 없으면 기존 값을 보존한다", async () => {
    stored = envelope({
      accounts: { github: { auth: { kind: "oauth", accessToken: "old", refreshToken: "keep-me", expiresAt: 42 } } },
    });
    await writeStoredGithubOAuthTokens({
      kind: "oauth",
      accessToken: "new",
      tokenType: "bearer",
      scope: "repo",
    } as any);
    const auth = readBack().state.accounts.github.auth;
    expect(auth.accessToken).toBe("new");
    expect(auth.refreshToken).toBe("keep-me");
    expect(auth.expiresAt).toBe(42);
  });

  it.each([
    ["github", writeStoredGithubOAuthTokens],
    ["linear", writeStoredLinearOAuthTokens],
    ["gitlab", writeStoredGitlabOAuthTokens],
  ] as const)("%s: scope도 갱신한다", async (platform, write) => {
    stored = envelope({
      accounts: { [platform]: { auth: { kind: "oauth", accessToken: "old", refreshToken: "r0", expiresAt: 1, scope: "old-scope" } } },
    });
    await write({ kind: "oauth", accessToken: "new", refreshToken: "r1", expiresAt: 999, scope: "new-scope", tokenType: "bearer" } as any);
    expect(readBack().state.accounts[platform].auth.scope).toBe("new-scope");
  });

  // 저장된 envelope이 문자열이면 문자열로 되돌려야 한다 — 타입이 바뀌면 zustand persist가 못 읽는다.
  it.each(cases)("%s: 문자열로 저장돼 있었다면 문자열로 돌려쓴다", async (platform, write) => {
    stored = JSON.stringify(
      envelope({
        accounts: { [platform]: { auth: { kind: "oauth", accessToken: "old", refreshToken: "r0", expiresAt: 1 } } },
      }),
    );
    await write({ kind: "oauth", accessToken: "new", refreshToken: "r1", expiresAt: 999 } as any);
    expect(typeof stored).toBe("string");
    expect(readBack().state.accounts[platform].auth.accessToken).toBe("new");
  });
});
