import { describe, expect, it } from "vitest";
import {
  connectedPlatforms,
  migrateV2ToV3,
  pickInitialPlatform,
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
    expect(out.accounts.jira?.titlePrefix).toBe("[QA] ");
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

  it("아무것도 연결 안 됐으면 null", () => {
    expect(pickInitialPlatform({}, undefined)).toBeNull();
    expect(pickInitialPlatform({}, "jira")).toBeNull();
  });
});

describe("connectedPlatforms", () => {
  it("연결된 플랫폼만 jira→github 순으로 반환", () => {
    expect(connectedPlatforms({ jira: jiraStub, github: githubStub })).toEqual([
      "jira",
      "github",
    ]);
    expect(connectedPlatforms({ github: githubStub })).toEqual(["github"]);
    expect(connectedPlatforms({})).toEqual([]);
  });
});
