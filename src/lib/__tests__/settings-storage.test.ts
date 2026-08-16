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

  // 각 write가 대입하는 필드 목록은 "갱신 대상 화이트리스트"다 — 나머지(신원 필드)는
  // 갱신 응답에 뭐가 실려 오든 건드리면 안 된다. 특히 gitlab의 baseUrl은 self-managed
  // 인스턴스 주소라 덮이면 그 계정으로 다시는 요청이 안 나간다. 위 케이스들은 갱신되는
  // 필드의 *값*만 재서, 목록이 넓어지는 방향(신원 필드까지 대입)을 잡지 못한다.
  const WHITELIST = [
    {
      platform: "jira",
      write: writeStoredOAuthTokens,
      stored: { kind: "oauth", cloudId: "c-old", siteUrl: "https://old.atlassian.net", email: "old@x.io", accessToken: "old", refreshToken: "r0", expiresAt: 1 },
      incoming: { kind: "oauth", cloudId: "c-NEW", siteUrl: "https://NEW.atlassian.net", email: "NEW@x.io", accessToken: "new", refreshToken: "r1", expiresAt: 999 },
      renewed: { accessToken: "new", refreshToken: "r1", expiresAt: 999 },
      absent: ["scope", "tokenType"],
    },
    {
      platform: "github",
      write: writeStoredGithubOAuthTokens,
      stored: { kind: "oauth", accessToken: "old", tokenType: "bearer", scope: "old-scope", refreshToken: "r0", expiresAt: 1, viewerLogin: "old-login", grantedAt: 100 },
      incoming: { kind: "oauth", accessToken: "new", tokenType: "mac", scope: "new-scope", refreshToken: "r1", expiresAt: 999, viewerLogin: "NEW-login", grantedAt: 777 },
      renewed: { accessToken: "new", tokenType: "mac", scope: "new-scope", refreshToken: "r1", expiresAt: 999 },
      absent: [],
    },
    {
      platform: "linear",
      write: writeStoredLinearOAuthTokens,
      stored: { kind: "oauth", accessToken: "old", refreshToken: "r0", expiresAt: 1, scope: "old-scope", viewerName: "old-name", grantedAt: 100 },
      incoming: { kind: "oauth", accessToken: "new", refreshToken: "r1", expiresAt: 999, scope: "new-scope", viewerName: "NEW-name", grantedAt: 777 },
      renewed: { accessToken: "new", refreshToken: "r1", expiresAt: 999, scope: "new-scope" },
      absent: ["tokenType"],
    },
    {
      platform: "gitlab",
      write: writeStoredGitlabOAuthTokens,
      stored: { kind: "oauth", accessToken: "old", refreshToken: "r0", expiresAt: 1, scope: "old-scope", baseUrl: "https://gitlab.self.io", viewerUsername: "old-user", grantedAt: 100 },
      incoming: { kind: "oauth", accessToken: "new", refreshToken: "r1", expiresAt: 999, scope: "new-scope", baseUrl: "https://gitlab.com", viewerUsername: "NEW-user", grantedAt: 777 },
      renewed: { accessToken: "new", refreshToken: "r1", expiresAt: 999, scope: "new-scope" },
      absent: ["tokenType"],
    },
    {
      platform: "asana",
      write: writeStoredAsanaOAuthTokens,
      stored: { kind: "oauth", accessToken: "old", refreshToken: "r0", expiresAt: 1, grantedAt: 100, viewerGid: "g-old", viewerName: "old-name" },
      incoming: { kind: "oauth", accessToken: "new", refreshToken: "r1", expiresAt: 999, grantedAt: 777, viewerGid: "g-NEW", viewerName: "NEW-name" },
      renewed: { accessToken: "new", refreshToken: "r1", expiresAt: 999 },
      absent: ["scope", "tokenType"],
    },
  ] as const;

  it.each(WHITELIST)(
    "$platform: 갱신 목록 밖 필드는 응답에 실려와도 그대로 둔다 (envelope 전량 대조)",
    async ({ platform, write, stored: seed, incoming, renewed }) => {
      stored = envelope({ accounts: { [platform]: { auth: { ...seed } } } });

      await write(incoming as never);

      // 부분 일치가 아니라 정확 일치 — 목록이 넓어지면(신원 필드 대입) 여기서 갈린다.
      expect(readBack()).toEqual(
        envelope({ accounts: { [platform]: { auth: { ...seed, ...renewed } } } }),
      );
    },
  );

  // toEqual은 값이 undefined인 키를 무시하므로 "이 플랫폼엔 이 키가 없어야 한다"를 못 잡는다
  // (POSTMORTEM 2026-08-15). 테이블이 필드를 공유하면 jira에 scope: undefined가 생긴다.
  it.each(WHITELIST.filter((c) => c.absent.length > 0))(
    "$platform: 남의 플랫폼 필드가 키로도 생기지 않는다",
    async ({ platform, write, stored: seed, incoming, absent }) => {
      stored = envelope({ accounts: { [platform]: { auth: { ...seed } } } });

      await write({ ...incoming, scope: "leak", tokenType: "leak" } as never);

      const auth = readBack().state.accounts[platform].auth;
      for (const key of absent) expect(key in auth, `${platform}.${key}`).toBe(false);
    },
  );

  // `?? cur.X` 폴백은 github 전용이다. 나머지 4개로 번지면, 갱신 응답이 토큰 회전으로
  // refreshToken을 비운 경우 옛 값이 살아남아 다음 갱신이 만료된 토큰으로 나간다.
  it.each(WHITELIST.filter((c) => c.platform !== "github"))(
    "$platform: 응답에 refreshToken이 없으면 지운다 (keepIfAbsent는 github 전용)",
    async ({ platform, write, stored: seed, incoming }) => {
      stored = envelope({ accounts: { [platform]: { auth: { ...seed } } } });
      const { refreshToken: _r, expiresAt: _e, ...withoutRenewable } = incoming;

      await write(withoutRenewable as never);

      const auth = readBack().state.accounts[platform].auth;
      expect(auth.refreshToken).toBeUndefined();
      expect(auth.expiresAt).toBeUndefined();
    },
  );

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
