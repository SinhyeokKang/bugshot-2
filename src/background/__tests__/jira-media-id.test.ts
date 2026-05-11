import { describe, it, expect } from "vitest";
import { extractMediaId } from "../jira-api";

describe("extractMediaId", () => {
  it("extracts UUID from media redirect URL", () => {
    const url =
      "https://api.media.atlassian.com/file/ae43c028-161e-42c3-966d-96e75e6b5422/binary?token=xxx&client=xxx&dl=true&name=recording.mp4";
    expect(extractMediaId(url)).toBe("ae43c028-161e-42c3-966d-96e75e6b5422");
  });

  it("returns undefined for non-matching URL", () => {
    expect(extractMediaId("https://example.com/some/path")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(extractMediaId("")).toBeUndefined();
  });

  it("extracts UUID regardless of media domain", () => {
    const url =
      "https://media.atlassian.com/file/12345678-abcd-ef01-2345-678901234567/binary";
    expect(extractMediaId(url)).toBe("12345678-abcd-ef01-2345-678901234567");
  });

  it("ignores non-UUID segments in /file/ path", () => {
    expect(extractMediaId("https://example.com/file/not-a-uuid/binary")).toBeUndefined();
  });
});
