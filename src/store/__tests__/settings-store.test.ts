import { describe, expect, it } from "vitest";
import { migrateV2ToV3 } from "../settings-store";

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

  it("멱등 — v2가 비어있어도 두 번 마이그레이션 안전", () => {
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
