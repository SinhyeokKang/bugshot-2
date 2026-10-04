import { describe, expect, it } from "vitest";
import { retryFailureReason, safeAttachmentFailure } from "../attachment-failure";

describe("safeAttachmentFailure", () => {
  it("classifies a Slack code that crossed the message boundary in the error body", () => {
    expect(safeAttachmentFailure({ status: 200, body: { platform: "slack", code: "token_revoked" } })).toEqual({ stage: "upload", code: "authentication", httpStatus: 200 });
    expect(safeAttachmentFailure({ status: 200, body: { platform: "slack", code: "not_in_channel" } }, "link")).toEqual({ stage: "link", code: "permission", httpStatus: 200 });
  });

  it("still reads a Slack code on the error itself", () => {
    expect(safeAttachmentFailure({ status: 200, code: "ratelimited" })).toEqual({ stage: "upload", code: "rate-limit", httpStatus: 200 });
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
    expect(retryFailureReason({ status: 200, body: { platform: "slack", code: "not_authed" } })).toBe("authentication");
    expect(retryFailureReason({ status: 200, body: { platform: "slack", code: "restricted_action" } })).toBe("permission");
    expect(retryFailureReason({ status: 200, code: "channel_not_found" })).toBe("remote-missing");
    expect(retryFailureReason({ status: 200, body: { platform: "slack", code: "not_in_channel" } })).toBe("permission");
    expect(retryFailureReason(new TypeError("Failed to fetch"))).toBe("ambiguous");
    expect(retryFailureReason(undefined)).toBe("ambiguous");
  });
});
