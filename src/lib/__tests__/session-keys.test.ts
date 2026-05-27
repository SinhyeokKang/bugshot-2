import { describe, expect, it } from "vitest";
import {
  PANEL_PORT_PREFIX,
  PICKER_PORT_NAME,
  originOf,
  pageKeyOf,
  sessionKey,
} from "../session-keys";

describe("sessionKey", () => {
  it("tabId를 editor: 접두사로 감싼다", () => {
    expect(sessionKey(42)).toBe("editor:42");
  });
});

describe("pageKeyOf", () => {
  it("origin + pathname 반환 (쿼리·해시 제거)", () => {
    expect(pageKeyOf("https://example.com/page?q=1#sec")).toBe(
      "https://example.com/page",
    );
  });

  it("경로 없으면 / 만", () => {
    expect(pageKeyOf("https://example.com")).toBe("https://example.com/");
  });

  it("undefined → null", () => {
    expect(pageKeyOf(undefined)).toBeNull();
  });

  it("빈 문자열 → null", () => {
    expect(pageKeyOf("")).toBeNull();
  });

  it("잘못된 URL → null", () => {
    expect(pageKeyOf("not-a-url")).toBeNull();
  });
});

describe("originOf", () => {
  it("origin 반환 (경로·쿼리·해시 제거)", () => {
    expect(originOf("https://example.com/page?q=1#sec")).toBe(
      "https://example.com",
    );
  });

  it("포트 포함 origin", () => {
    expect(originOf("http://localhost:3000/app")).toBe("http://localhost:3000");
  });

  it("같은 origin 다른 경로 → 같은 값", () => {
    expect(originOf("https://app.com/a")).toBe(originOf("https://app.com/b"));
  });

  it("다른 origin → 다른 값", () => {
    expect(originOf("https://a.com/page")).not.toBe(
      originOf("https://b.com/page"),
    );
  });

  it("undefined → null", () => {
    expect(originOf(undefined)).toBeNull();
  });

  it("빈 문자열 → null", () => {
    expect(originOf("")).toBeNull();
  });

  it("잘못된 URL → null", () => {
    expect(originOf("not-a-url")).toBeNull();
  });
});

describe("상수", () => {
  it("PICKER_PORT_NAME", () => {
    expect(PICKER_PORT_NAME).toBe("bugshot-picker");
  });

  it("PANEL_PORT_PREFIX", () => {
    expect(PANEL_PORT_PREFIX).toBe("bugshot-panel:");
  });
});
