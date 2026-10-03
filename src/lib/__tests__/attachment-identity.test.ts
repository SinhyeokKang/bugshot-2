import { describe, expect, it } from "vitest";
import { attachmentAccountIdentity, attachmentRetryFailure } from "../attachment-identity";

describe("attachment account identity", () => {
  it.each([
    ["jira", { cloudId: "cloud", accountId: "user" }, ["cloud", "user"]],
    ["github", { userId: 123 }, ["123"]],
    ["gitlab", { baseUrl: "https://gitlab.example/", userId: 123 }, ["https://gitlab.example", "123"]],
    ["linear", { organizationId: "org", userId: "user" }, ["org", "user"]],
    ["notion", { workspaceId: "workspace", botId: "bot" }, ["workspace", "bot"]],
    ["asana", { workspaceGid: "workspace", userGid: "user" }, ["workspace", "user"]],
    ["clickup", { teamId: "team", userId: "user" }, ["team", "user"]],
    ["slack", { teamId: "team", userId: "user" }, ["team", "user"]],
  ] as const)("%s uses stable scoped IDs", (platform, identity, parts) => {
    expect(attachmentAccountIdentity(platform, identity)).toBe(JSON.stringify([platform, ...parts]));
    expect(attachmentAccountIdentity(platform, { ...identity, accessToken: "refreshed", login: "renamed" })).toBe(JSON.stringify([platform, ...parts]));
  });
  it("fails closed on absent identity and webhook", () => {
    expect(attachmentAccountIdentity("github", { login: "user" })).toBeNull();
    expect(attachmentAccountIdentity("notion", { botId: "b" })).toBeNull();
    expect(attachmentAccountIdentity("jira", { baseUrl: "https://site", accountId: "u" })).toBeNull();
    expect(attachmentAccountIdentity("webhook", {})).toBeNull();
  });
  it("separates accounts, workspaces and self-hosted origins", () => {
    const identity = { baseUrl: "https://gitlab.example", userId: 123 };
    const original = attachmentAccountIdentity("gitlab", identity);
    expect(attachmentAccountIdentity("gitlab", { ...identity, userId: 456 })).not.toBe(original);
    expect(attachmentAccountIdentity("gitlab", { ...identity, baseUrl: "https://other.example" })).not.toBe(original);
    expect(attachmentAccountIdentity("gitlab", { ...identity, baseUrl: "https://user:secret@gitlab.example" })).toBeNull();
  });
});
describe("safe retry unavailability", () => {
  it.each([[401,"authentication"],[403,"permission"],[404,"remote-missing"],[500,"ambiguous"]] as const)("maps %s without persisting the raw response", (status, reason) => {
    expect(attachmentRetryFailure({ status, message: "secret", body: { token: "secret" } })).toEqual({ ok: false, reason });
  });
  it("maps Slack missing_scope and network ambiguity", () => {
    expect(attachmentRetryFailure({ code: "missing_scope" })).toEqual({ ok: false, reason: "permission" });
    expect(attachmentRetryFailure(new Error("secret"))).toEqual({ ok: false, reason: "ambiguous" });
  });
});
