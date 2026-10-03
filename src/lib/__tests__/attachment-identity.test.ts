import { describe, expect, it } from "vitest";
import { attachmentAccountIdentity, retryFailureReason } from "../attachment-identity";

describe("attachmentAccountIdentity", () => {
  it.each([
    ["jira", { siteId: "cloud-1", accountId: "acc" }, ["cloud-1", "acc"]],
    ["jira", { siteId: "https://acme.atlassian.net/", accountId: "acc" }, ["https://acme.atlassian.net", "acc"]],
    ["github", { userId: 123 }, ["123"]],
    ["gitlab", { baseUrl: "https://gitlab.example/", userId: 7 }, ["https://gitlab.example", "7"]],
    ["linear", { organizationId: "org", userId: "user" }, ["org", "user"]],
    ["notion", { workspaceId: "ws", botId: "bot" }, ["ws", "bot"]],
    ["asana", { workspaceGid: "ws", userGid: "user" }, ["ws", "user"]],
    ["clickup", { teamId: "team", userId: "user" }, ["team", "user"]],
    ["slack", { teamId: "T1", userId: "U1" }, ["T1", "U1"]],
  ] as const)("%s uses the design table IDs", (platform, input, parts) => {
    expect(attachmentAccountIdentity(platform, input)).toBe(JSON.stringify([platform, ...parts]));
  });

  it("ignores tokens and display names, so a refresh keeps the identity", () => {
    const base = attachmentAccountIdentity("github", { userId: 123 });
    expect(attachmentAccountIdentity("github", { userId: 123, accessToken: "refreshed", login: "renamed" })).toBe(base);
  });

  it("separates accounts, workspaces and self-managed origins", () => {
    const original = attachmentAccountIdentity("gitlab", { baseUrl: "https://gitlab.example", userId: 1 });
    expect(attachmentAccountIdentity("gitlab", { baseUrl: "https://gitlab.example", userId: 2 })).not.toBe(original);
    expect(attachmentAccountIdentity("gitlab", { baseUrl: "https://other.example", userId: 1 })).not.toBe(original);
    expect(attachmentAccountIdentity("slack", { teamId: "T2", userId: "U1" })).not.toBe(attachmentAccountIdentity("slack", { teamId: "T1", userId: "U1" }));
  });

  it("fails closed on a missing part or credentials in a base URL", () => {
    expect(attachmentAccountIdentity("github", { login: "user" })).toBeNull();
    expect(attachmentAccountIdentity("notion", { botId: "bot" })).toBeNull();
    expect(attachmentAccountIdentity("linear", { organizationId: " ", userId: "u" })).toBeNull();
    expect(attachmentAccountIdentity("gitlab", { baseUrl: "https://user:secret@gitlab.example", userId: 1 })).toBeNull();
    expect(attachmentAccountIdentity("gitlab", { baseUrl: "not a url", userId: 1 })).toBeNull();
  });
});

describe("retryFailureReason", () => {
  it.each([
    [401, "authentication"], [403, "permission"], [404, "remote-missing"], [410, "remote-missing"], [500, "ambiguous"],
  ] as const)("maps HTTP %i to %s", (status, reason) => {
    expect(retryFailureReason({ status, message: "secret", body: { token: "secret" } })).toBe(reason);
  });

  it("treats an exhausted OAuth refresh as authentication", () => {
    expect(retryFailureReason({ status: 401, body: { platform: "jira", oauthRefreshFailed: true } })).toBe("authentication");
    expect(retryFailureReason({ body: { oauthRefreshFailed: true } })).toBe("authentication");
  });

  it("maps provider codes and leaves an unknown outcome ambiguous", () => {
    expect(retryFailureReason({ status: 200, code: "missing_scope" })).toBe("permission");
    expect(retryFailureReason({ status: 200, code: "token_revoked" })).toBe("authentication");
    expect(retryFailureReason({ status: 200, code: "channel_not_found" })).toBe("remote-missing");
    expect(retryFailureReason({ status: 200, body: { platform: "slack", code: "not_in_channel" } })).toBe("permission");
    expect(retryFailureReason(new TypeError("Failed to fetch"))).toBe("ambiguous");
    expect(retryFailureReason(undefined)).toBe("ambiguous");
  });
});
