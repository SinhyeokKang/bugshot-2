import { describe, expect, it } from "vitest";
import { networkLogPath } from "../network-log-path";

describe("networkLogPath", () => {
  it("정상 URL → pathname", () => {
    expect(networkLogPath("https://example.com/api/users")).toBe("/api/users");
  });

  it("쿼리스트링 포함 URL → pathname만 반환", () => {
    expect(networkLogPath("https://example.com/search?q=test&page=1")).toBe(
      "/search",
    );
  });

  it("루트 경로", () => {
    expect(networkLogPath("https://example.com/")).toBe("/");
  });

  it("잘못된 URL → 원본 문자열 반환", () => {
    expect(networkLogPath("not-a-url")).toBe("not-a-url");
  });

  it("빈 문자열 → 빈 문자열 반환", () => {
    expect(networkLogPath("")).toBe("");
  });
});
