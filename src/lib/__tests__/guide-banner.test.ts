import { describe, expect, it } from "vitest";
import { shouldShowGuideBanner } from "../guide-banner";

describe("shouldShowGuideBanner", () => {
  describe("정상 케이스", () => {
    it("한 번도 안 닫음(null)이면 true", () => {
      expect(shouldShowGuideBanner(null, "1.2.0")).toBe(true);
    });

    it("minor 상승이면 true", () => {
      expect(shouldShowGuideBanner("1.2.0", "1.3.0")).toBe(true);
    });

    it("major 상승이면 true", () => {
      expect(shouldShowGuideBanner("1.2.0", "2.0.0")).toBe(true);
    });

    it("patch만 상승이면 false", () => {
      expect(shouldShowGuideBanner("1.2.0", "1.2.5")).toBe(false);
    });

    it("동일 버전이면 false", () => {
      expect(shouldShowGuideBanner("1.2.0", "1.2.0")).toBe(false);
    });

    it("버전 하락이면 false", () => {
      expect(shouldShowGuideBanner("1.3.0", "1.2.0")).toBe(false);
    });
  });

  describe("엣지 — 비정상 current (dismissed null이면 true 우선)", () => {
    it("dismissed null이면 current가 비정상이어도 true", () => {
      expect(shouldShowGuideBanner(null, "1.2")).toBe(true);
      expect(shouldShowGuideBanner(null, "x.y")).toBe(true);
      expect(shouldShowGuideBanner(null, "")).toBe(true);
    });

    it("dismissed 정상 + current 파싱 실패면 fail-closed(false)", () => {
      expect(shouldShowGuideBanner("1.2.0", "1.2")).toBe(false);
      expect(shouldShowGuideBanner("1.2.0", "1.2.3.4")).toBe(false);
      expect(shouldShowGuideBanner("1.2.0", "x.y")).toBe(false);
      expect(shouldShowGuideBanner("1.2.0", "")).toBe(false);
    });
  });

  describe("엣지 — prerelease / v 접두 / 공백", () => {
    it("dismissed의 prerelease 태그는 무시하고 major.minor 비교", () => {
      expect(shouldShowGuideBanner("1.2.0-beta", "1.3.0")).toBe(true);
    });

    it("current의 prerelease 태그는 무시하고 major.minor 비교", () => {
      expect(shouldShowGuideBanner("1.2.0", "1.3.0-rc1")).toBe(true);
    });

    it("v 접두는 허용/strip 후 비교", () => {
      expect(shouldShowGuideBanner("v1.2.0", "v1.3.0")).toBe(true);
    });

    it("앞뒤 공백은 trim 후 비교", () => {
      expect(shouldShowGuideBanner(" 1.2.0 ", " 1.3.0 ")).toBe(true);
    });
  });

  describe("에러 — dismissed 비정상(null 아님)은 fail-closed", () => {
    it("dismissed가 garbage면 current가 정상이어도 false", () => {
      expect(shouldShowGuideBanner("garbage", "1.3.0")).toBe(false);
    });
  });
});
