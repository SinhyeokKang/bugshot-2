import { describe, it, expect } from "vitest";
import {
  originKey,
  distinctOriginKeys,
  originCounts,
  originHostLabel,
  UNKNOWN_ORIGIN,
} from "../logOrigin";

describe("originKey", () => {
  it("유효 URL은 origin 반환", () => {
    expect(originKey("https://example.com/a/b?q=1")).toBe("https://example.com");
  });

  it("빈/잘못된 URL은 UNKNOWN_ORIGIN", () => {
    expect(originKey("")).toBe(UNKNOWN_ORIGIN);
    expect(originKey("not a url")).toBe(UNKNOWN_ORIGIN);
  });
});

describe("distinctOriginKeys", () => {
  it("첫 등장 순서를 보존하며 중복 제거", () => {
    const keys = distinctOriginKeys([
      "https://example.com/1",
      "https://ads.net/x",
      "https://example.com/2",
      "https://ads.net/y",
    ]);
    expect(keys).toEqual(["https://example.com", "https://ads.net"]);
  });

  it("빈/opaque은 UNKNOWN_ORIGIN 한 그룹으로 묶음", () => {
    const keys = distinctOriginKeys(["", "about:blank", "https://example.com/1"]);
    expect(keys).toEqual([UNKNOWN_ORIGIN, "https://example.com"]);
  });

  it("빈 입력이면 빈 배열", () => {
    expect(distinctOriginKeys([])).toEqual([]);
  });
});

describe("originCounts", () => {
  it("origin 키별 개수 집계", () => {
    const counts = originCounts([
      "https://example.com/1",
      "https://ads.net/x",
      "https://example.com/2",
      "https://example.com/3",
    ]);
    expect(counts).toEqual({ "https://example.com": 3, "https://ads.net": 1 });
  });

  it("빈/opaque은 UNKNOWN_ORIGIN으로 합산", () => {
    const counts = originCounts(["", "about:blank", "https://example.com/1"]);
    expect(counts).toEqual({ [UNKNOWN_ORIGIN]: 2, "https://example.com": 1 });
  });

  it("빈 입력이면 빈 객체", () => {
    expect(originCounts([])).toEqual({});
  });
});

describe("originHostLabel", () => {
  it("origin에서 호스트명만 추출", () => {
    expect(originHostLabel("https://stripe.com")).toBe("stripe.com");
    expect(originHostLabel("https://ads.example.net")).toBe("ads.example.net");
  });

  it("UNKNOWN_ORIGIN은 빈 문자열(호출부가 i18n 대체)", () => {
    expect(originHostLabel(UNKNOWN_ORIGIN)).toBe("");
  });
});
