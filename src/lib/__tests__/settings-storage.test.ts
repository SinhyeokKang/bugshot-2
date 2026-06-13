import { beforeEach, describe, expect, it, vi } from "vitest";

let stored: unknown;

vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: stored }),
    },
  },
});

import {
  readStoredAuth,
  readStoredGithubAuth,
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
