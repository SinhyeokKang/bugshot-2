import { describe, it, expect } from "vitest";
import {
  TONE_TEXT,
  CONSOLE_LEVEL_TONE,
  NETWORK_METHOD_TONE,
  consoleLevelTextClass,
  networkMethodTextClass,
  toneTextClass,
} from "../log-colors";

describe("TONE_TEXT", () => {
  it("색 톤은 -600/dark:-400 쌍을 갖는다", () => {
    expect(TONE_TEXT.red).toBe("text-red-600 dark:text-red-400");
    expect(TONE_TEXT.amber).toBe("text-amber-600 dark:text-amber-400");
    expect(TONE_TEXT.blue).toBe("text-blue-600 dark:text-blue-400");
    expect(TONE_TEXT.green).toBe("text-green-600 dark:text-green-400");
  });

  it("neutral은 무색(컨테이너 상속)", () => {
    expect(TONE_TEXT.neutral).toBe("");
  });
});

describe("consoleLevelTextClass", () => {
  it("레벨을 톤에 매핑한다", () => {
    expect(consoleLevelTextClass("error")).toBe(TONE_TEXT.red);
    expect(consoleLevelTextClass("warn")).toBe(TONE_TEXT.amber);
    expect(consoleLevelTextClass("info")).toBe(TONE_TEXT.blue);
  });

  it("debug/log는 neutral", () => {
    expect(consoleLevelTextClass("debug")).toBe(TONE_TEXT.neutral);
    expect(consoleLevelTextClass("log")).toBe(TONE_TEXT.neutral);
  });

  it("미지의 레벨은 neutral 폴백", () => {
    expect(consoleLevelTextClass("trace")).toBe(TONE_TEXT.neutral);
  });

  it("매핑 상수가 노출된다", () => {
    expect(CONSOLE_LEVEL_TONE.error).toBe("red");
  });
});

describe("networkMethodTextClass", () => {
  it("메서드를 톤에 매핑한다", () => {
    expect(networkMethodTextClass("GET")).toBe(TONE_TEXT.blue);
    expect(networkMethodTextClass("POST")).toBe(TONE_TEXT.green);
    expect(networkMethodTextClass("PUT")).toBe(TONE_TEXT.amber);
    expect(networkMethodTextClass("PATCH")).toBe(TONE_TEXT.amber);
    expect(networkMethodTextClass("DELETE")).toBe(TONE_TEXT.red);
  });

  it("소문자도 대응(대소문자 무시)", () => {
    expect(networkMethodTextClass("get")).toBe(TONE_TEXT.blue);
  });

  it("기타 메서드는 neutral 폴백", () => {
    expect(networkMethodTextClass("HEAD")).toBe(TONE_TEXT.neutral);
    expect(networkMethodTextClass("OPTIONS")).toBe(TONE_TEXT.neutral);
  });

  it("매핑 상수가 노출된다", () => {
    expect(NETWORK_METHOD_TONE.DELETE).toBe("red");
  });
});

describe("toneTextClass", () => {
  it("톤 직접 조회", () => {
    expect(toneTextClass("amber")).toBe(TONE_TEXT.amber);
  });
});
