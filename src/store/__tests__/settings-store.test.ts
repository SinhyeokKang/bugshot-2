import { describe, expect, it } from "vitest";
import {
  connectedPlatforms,
  isLinearAccountComplete,
  isNotionAccountComplete,
  migrateV2ToV3,
  migrateToV5,
  migrateToV11,
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

const gitlabStub: Accounts["gitlab"] = {
  platform: "gitlab",
  connectedAt: 0,
  auth: {
    kind: "pat",
    pat: "glpat_x",
    baseUrl: "https://gitlab.com",
    viewerUsername: "u",
  },
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

  it("gitlab은 fallback 순서에서 linear 뒤·notion 앞에 온다", () => {
    expect(connectedPlatforms({ gitlab: gitlabStub })).toEqual(["gitlab"]);
    expect(
      connectedPlatforms({
        jira: jiraStub,
        github: githubStub,
        linear: linearStub,
        notion: notionStub,
        gitlab: gitlabStub,
      }),
    ).toEqual(["jira", "github", "linear", "gitlab", "notion"]);
  });
});

describe("updateGitlabAccount", () => {
  it("기존 gitlab account에 patch를 병합하고 다른 플랫폼은 보존한다", () => {
    useSettingsStore.setState({
      accounts: { jira: jiraStub, gitlab: gitlabStub },
      lastSubmitFields: {},
    });

    useSettingsStore.getState().updateGitlabAccount({ defaults: { projectId: 7 } });

    const s = useSettingsStore.getState();
    expect(s.accounts.gitlab).toEqual({ ...gitlabStub, defaults: { projectId: 7 } });
    expect(s.accounts.jira).toEqual(jiraStub);
  });

  it("계정이 없으면 no-op — 해제 직후 늦은 patch가 ghost 계정을 만들지 않는다", () => {
    useSettingsStore.setState({ accounts: { jira: jiraStub }, lastSubmitFields: {} });

    useSettingsStore.getState().updateGitlabAccount({ defaults: { projectId: 7 } });

    expect(useSettingsStore.getState().accounts.gitlab).toBeUndefined();
  });
});

const asanaStub = {
  platform: "asana",
  connectedAt: 0,
  auth: {
    kind: "pat",
    pat: "1/abc",
    viewerGid: "111",
    viewerName: "u",
  },
  defaults: {},
};

describe("updateAsanaAccount", () => {
  it("기존 asana account에 patch를 병합하고 다른 플랫폼은 보존한다", () => {
    useSettingsStore.setState({
      accounts: {
        jira: jiraStub,
        gitlab: gitlabStub,
        asana: asanaStub as Accounts["asana"],
      },
      lastSubmitFields: {},
    });

    useSettingsStore.getState().updateAsanaAccount({ defaults: { workspaceGid: "W" } });

    const s = useSettingsStore.getState();
    expect(s.accounts.asana).toEqual({ ...asanaStub, defaults: { workspaceGid: "W" } });
    expect(s.accounts.jira).toEqual(jiraStub);
    expect(s.accounts.gitlab).toEqual(gitlabStub);
  });

  it("계정이 없으면 no-op — 해제 직후 늦은 patch가 ghost 계정을 만들지 않는다", () => {
    useSettingsStore.setState({ accounts: { jira: jiraStub }, lastSubmitFields: {} });

    useSettingsStore.getState().updateAsanaAccount({ defaults: { workspaceGid: "W" } });

    expect(useSettingsStore.getState().accounts.asana).toBeUndefined();
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

describe("migrateToV11 — 연결 이슈 단일→복수 이관", () => {
  it("jira.relatesKey/relatesLabel을 relates[] 첫 항목으로 옮기고 옛 키는 제거", () => {
    const out = migrateToV11({
      accounts: {},
      lastSubmitFields: {
        jira: { projectKey: "ENG", relatesKey: "ENG-2", relatesLabel: "ENG-2 Foo" },
      },
    });
    expect(out.lastSubmitFields.jira).toEqual({
      projectKey: "ENG",
      relates: [{ key: "ENG-2", label: "ENG-2 Foo" }],
    });
  });

  it("relatesLabel이 없으면 label은 key로 폴백", () => {
    const out = migrateToV11({
      accounts: {},
      lastSubmitFields: { jira: { relatesKey: "ENG-2" } },
    });
    expect(out.lastSubmitFields.jira?.relates).toEqual([{ key: "ENG-2", label: "ENG-2" }]);
  });

  it("relatesKey가 없으면 relates를 만들지 않고 다른 필드는 보존", () => {
    const out = migrateToV11({
      accounts: {},
      lastSubmitFields: { jira: { projectKey: "ENG", priorityId: "3" } },
    });
    expect(out.lastSubmitFields.jira).toEqual({ projectKey: "ENG", priorityId: "3" });
    expect(out.lastSubmitFields.jira?.relates).toBeUndefined();
  });

  it("이미 relates[]로 이관된 상태(옛 키 없음)는 그대로 둔다", () => {
    const already = {
      accounts: {},
      lastSubmitFields: {
        jira: { relates: [{ key: "ENG-9", label: "ENG-9 Bar" }] },
      },
    };
    const out = migrateToV11(already);
    expect(out.lastSubmitFields.jira?.relates).toEqual([{ key: "ENG-9", label: "ENG-9 Bar" }]);
  });

  it("jira lastSubmitFields가 없으면 무변경, accounts·다른 플랫폼 보존", () => {
    const out = migrateToV11({
      accounts: { github: { platform: "github" } as never },
      lastSubmitFields: { github: { repo: "owner/repo" } },
    });
    expect(out.accounts.github).toBeDefined();
    expect(out.lastSubmitFields.github).toEqual({ repo: "owner/repo" });
    expect(out.lastSubmitFields.jira).toBeUndefined();
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
