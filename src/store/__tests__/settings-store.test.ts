import { describe, expect, it } from "vitest";
import {
  connectedPlatforms,
  isLinearAccountComplete,
  isNotionAccountComplete,
  migrateV2ToV3,
  migrateToV5,
  pickInitialPlatform,
  useSettingsStore,
} from "../settings-store";
import type { Accounts } from "@/types/platform";

const jiraStub: Accounts["jira"] = {
  platform: "jira",
  connectedAt: 0,
  auth: {
    kind: "apiKey",
    baseUrl: "https://x.atlassian.net",
    email: "a@b.c",
    apiToken: "t",
  },
};

const githubStub: Accounts["github"] = {
  platform: "github",
  connectedAt: 0,
  auth: { kind: "pat", pat: "ghp_x", viewerLogin: "u" },
  defaults: {},
};

const linearStub: Accounts["linear"] = {
  platform: "linear",
  connectedAt: 0,
  auth: { kind: "apiKey", apiKey: "lin_api_x", viewerName: "u" },
  defaults: {},
};

const notionStub: Accounts["notion"] = {
  platform: "notion",
  connectedAt: 0,
  auth: { kind: "apiKey", token: "secret_x", botName: "Bug Bot" },
  defaults: {},
};

describe("settings-store v2→v3 마이그레이션", () => {
  it("jiraConfig 있음 + lastSubmitFields 있음 → accounts.jira + lastSubmitFields.jira", () => {
    const out = migrateV2ToV3({
      jiraConfig: {
        auth: {
          kind: "apiKey",
          baseUrl: "https://x.atlassian.net",
          email: "a@b.c",
          apiToken: "tok",
        },
        projectKey: "BUG",
        issueTypeId: "10001",
        issueTypeName: "Bug",
        titlePrefix: "[QA] ",
      },
      lastSubmitFields: { projectKey: "BUG", assigneeId: "id-1" },
    });
    expect(out.accounts.jira).toBeDefined();
    expect(out.accounts.jira?.platform).toBe("jira");
    expect(out.accounts.jira?.connectedAt).toBeTypeOf("number");
    expect(out.accounts.jira?.auth.kind).toBe("apiKey");
    expect(out.accounts.jira?.projectKey).toBe("BUG");
    expect(out.accounts.jira?.issueTypeId).toBe("10001");
    expect(out.lastSubmitFields.jira).toEqual({
      projectKey: "BUG",
      assigneeId: "id-1",
    });
  });

  it("jiraConfig 있음 + lastSubmitFields 없음 → accounts.jira만", () => {
    const out = migrateV2ToV3({
      jiraConfig: {
        auth: {
          kind: "oauth",
          cloudId: "cid",
          siteUrl: "https://x.atlassian.net",
          email: "a@b.c",
          accessToken: "at",
          refreshToken: "rt",
          expiresAt: 9999,
        },
      },
    });
    expect(out.accounts.jira?.auth.kind).toBe("oauth");
    expect(out.lastSubmitFields).toEqual({});
  });

  it("jiraConfig 없음 + lastSubmitFields 있음 → lastSubmitFields.jira만, accounts 비어있음", () => {
    const out = migrateV2ToV3({
      jiraConfig: null,
      lastSubmitFields: { projectKey: "OLD" },
    });
    expect(out.accounts).toEqual({});
    expect(out.lastSubmitFields.jira).toEqual({ projectKey: "OLD" });
  });

  it("둘 다 없음 → 빈 셰이프", () => {
    const out = migrateV2ToV3({});
    expect(out.accounts).toEqual({});
    expect(out.lastSubmitFields).toEqual({});
  });

  it("멱등 — 같은 v2 두 번 마이그레이션 결과 동일", () => {
    const v2 = {
      jiraConfig: {
        auth: {
          kind: "apiKey" as const,
          baseUrl: "https://x.atlassian.net",
          email: "a@b.c",
          apiToken: "tok",
        },
        projectKey: "BUG",
      },
    };
    const first = migrateV2ToV3(v2);
    const second = migrateV2ToV3(v2);
    expect(first.accounts.jira?.projectKey).toBe(
      second.accounts.jira?.projectKey,
    );
    expect(first.accounts.jira?.auth).toEqual(second.accounts.jira?.auth);
  });
});

describe("pickInitialPlatform", () => {
  it("lastSubmittedPlatform이 연결되어 있으면 그것 우선", () => {
    expect(
      pickInitialPlatform(
        { jira: jiraStub, github: githubStub },
        "github",
      ),
    ).toBe("github");
  });

  it("lastSubmittedPlatform이 더 이상 연결 안 됐으면 fallback (jira→github)", () => {
    expect(pickInitialPlatform({ github: githubStub }, "jira")).toBe("github");
  });

  it("lastSubmittedPlatform 없으면 jira 우선", () => {
    expect(
      pickInitialPlatform({ jira: jiraStub, github: githubStub }, undefined),
    ).toBe("jira");
  });

  it("jira만 연결되면 jira", () => {
    expect(pickInitialPlatform({ jira: jiraStub }, undefined)).toBe("jira");
  });

  it("github만 연결되면 github", () => {
    expect(pickInitialPlatform({ github: githubStub }, undefined)).toBe(
      "github",
    );
  });

  it("linear만 연결되면 linear", () => {
    expect(pickInitialPlatform({ linear: linearStub }, undefined)).toBe(
      "linear",
    );
  });

  it("lastSubmittedPlatform=linear이 연결되어 있으면 linear", () => {
    expect(
      pickInitialPlatform(
        { jira: jiraStub, linear: linearStub },
        "linear",
      ),
    ).toBe("linear");
  });

  it("notion만 연결되면 notion", () => {
    expect(pickInitialPlatform({ notion: notionStub }, undefined)).toBe(
      "notion",
    );
  });

  it("lastSubmittedPlatform=notion이 연결되어 있으면 notion", () => {
    expect(
      pickInitialPlatform(
        { jira: jiraStub, notion: notionStub },
        "notion",
      ),
    ).toBe("notion");
  });

  it("아무것도 연결 안 됐으면 null", () => {
    expect(pickInitialPlatform({}, undefined)).toBeNull();
    expect(pickInitialPlatform({}, "jira")).toBeNull();
  });
});

describe("connectedPlatforms", () => {
  it("연결된 플랫폼만 jira→github→linear→notion 순으로 반환", () => {
    expect(
      connectedPlatforms({
        jira: jiraStub,
        github: githubStub,
        linear: linearStub,
        notion: notionStub,
      }),
    ).toEqual(["jira", "github", "linear", "notion"]);
    expect(connectedPlatforms({ github: githubStub })).toEqual(["github"]);
    expect(connectedPlatforms({ linear: linearStub })).toEqual(["linear"]);
    expect(connectedPlatforms({ notion: notionStub })).toEqual(["notion"]);
    expect(connectedPlatforms({})).toEqual([]);
  });
});

describe("migrateToV5 — titlePrefix 전역 승격", () => {
  it("jira의 titlePrefix를 전역으로 승격", () => {
    const v3 = migrateV2ToV3({
      jiraConfig: {
        auth: {
          kind: "apiKey",
          baseUrl: "https://x.atlassian.net",
          email: "a@b.c",
          apiToken: "tok",
        },
        titlePrefix: "[QA] ",
      },
    });
    const v5 = migrateToV5(v3);
    expect(v5.titlePrefix).toBe("[QA] ");
  });

  it("titlePrefix 없으면 빈 문자열", () => {
    const v5 = migrateToV5({ accounts: {}, lastSubmitFields: {} });
    expect(v5.titlePrefix).toBe("");
  });
});

describe("isLinearAccountComplete", () => {
  it("auth가 있으면 true", () => {
    expect(isLinearAccountComplete(linearStub)).toBe(true);
  });

  it("undefined면 false", () => {
    expect(isLinearAccountComplete(undefined)).toBe(false);
  });
});

describe("isNotionAccountComplete", () => {
  it("auth가 있으면 true", () => {
    expect(isNotionAccountComplete(notionStub)).toBe(true);
  });

  it("undefined면 false", () => {
    expect(isNotionAccountComplete(undefined)).toBe(false);
  });
});

describe("removeAccount — 연동 해제 시 prefill 정리", () => {
  it("해제한 플랫폼의 account와 lastSubmitFields를 함께 지우고, 다른 플랫폼은 보존", () => {
    useSettingsStore.setState({
      accounts: { jira: jiraStub, github: githubStub },
      lastSubmitFields: {
        jira: { projectKey: "BUG", assigneeId: "id-1", priorityId: "3" },
        github: { repo: "owner/repo" },
      },
    });

    useSettingsStore.getState().removeAccount("jira");

    const s = useSettingsStore.getState();
    expect(s.accounts.jira).toBeUndefined();
    expect(s.lastSubmitFields.jira).toBeUndefined();
    expect(s.accounts.github).toBeDefined();
    expect(s.lastSubmitFields.github).toEqual({ repo: "owner/repo" });
  });

  it("removeAllAccounts는 모든 account와 lastSubmitFields를 비운다", () => {
    useSettingsStore.setState({
      accounts: { jira: jiraStub, github: githubStub },
      lastSubmitFields: { jira: { projectKey: "BUG" }, github: { repo: "r" } },
    });

    useSettingsStore.getState().removeAllAccounts();

    const s = useSettingsStore.getState();
    expect(s.accounts).toEqual({});
    expect(s.lastSubmitFields).toEqual({});
  });
});
