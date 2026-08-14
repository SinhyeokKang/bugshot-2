import { describe, it, expect } from "vitest";
import {
  TONE_TEXT,
  TONE_BG,
  TONE_BG_STRONG,
  TONE_BG_HOVER,
  TONE_DOT,
  CONSOLE_LEVEL_TONE,
  NETWORK_METHOD_TONE,
  consoleLevelTextClass,
  consoleLevelBgStrongClass,
  networkMethodTextClass,
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

// base(TONE_BG) 위 한 단계 강조. 선택된 행·이미 틴트된 행 안의 코드블럭처럼 "면이 반드시
// 있어야 하는" 표면용이라, neutral도 값을 가져야 한다 — TONE_BG.neutral(빈 문자열)을 그대로
// 참조하면 콘솔 log/debug 코드블럭 배경이 무음으로 사라진다.
describe("TONE_BG_STRONG", () => {
  it("TONE_BG와 키 집합이 같다", () => {
    expect(Object.keys(TONE_BG_STRONG).sort()).toEqual(Object.keys(TONE_BG).sort());
  });

  it("모든 톤이 빈 문자열이 아니다", () => {
    for (const [tone, value] of Object.entries(TONE_BG_STRONG)) {
      expect(value, `TONE_BG_STRONG.${tone}`).not.toBe("");
    }
  });

  it("neutral은 semantic 토큰(bg-muted)이다", () => {
    expect(TONE_BG_STRONG.neutral).toBe("bg-muted");
  });

  it("유채색 톤은 -200/dark:-950/70 쌍이다", () => {
    expect(TONE_BG_STRONG.red).toBe("bg-red-200 dark:bg-red-950/70");
    expect(TONE_BG_STRONG.amber).toBe("bg-amber-200 dark:bg-amber-950/70");
    expect(TONE_BG_STRONG.blue).toBe("bg-blue-200 dark:bg-blue-950/70");
  });
});

describe("TONE_BG_HOVER", () => {
  it("TONE_BG와 키 집합이 같다", () => {
    expect(Object.keys(TONE_BG_HOVER).sort()).toEqual(Object.keys(TONE_BG).sort());
  });

  it("유채색 톤은 hover: 접두를 갖는다", () => {
    expect(TONE_BG_HOVER.red).toBe("hover:bg-red-200/70 dark:hover:bg-red-950/70");
    expect(TONE_BG_HOVER.amber).toBe("hover:bg-amber-200/70 dark:hover:bg-amber-950/70");
  });

  // neutral 행의 hover는 shadcn 선택 관용구(bg-accent 계열)라 이 표 밖에 있다.
  it("neutral은 빈 문자열이다", () => {
    expect(TONE_BG_HOVER.neutral).toBe("");
  });
});

describe("TONE_DOT", () => {
  it("TONE_BG와 키 집합이 같다", () => {
    expect(Object.keys(TONE_DOT).sort()).toEqual(Object.keys(TONE_BG).sort());
  });

  it("유채색 톤은 -500/dark:-400 쌍을 갖는다", () => {
    expect(TONE_DOT.red).toBe("bg-red-500 dark:bg-red-400");
    expect(TONE_DOT.amber).toBe("bg-amber-500 dark:bg-amber-400");
    expect(TONE_DOT.green).toBe("bg-green-500 dark:bg-green-400");
  });
});

describe("consoleLevelBgStrongClass", () => {
  it("레벨을 강조 톤에 매핑한다", () => {
    expect(consoleLevelBgStrongClass("error")).toBe(TONE_BG_STRONG.red);
    expect(consoleLevelBgStrongClass("warn")).toBe(TONE_BG_STRONG.amber);
    expect(consoleLevelBgStrongClass("info")).toBe(TONE_BG_STRONG.blue);
  });

  it("debug/log는 neutral 강조(bg-muted)로 떨어진다", () => {
    expect(consoleLevelBgStrongClass("debug")).toBe("bg-muted");
    expect(consoleLevelBgStrongClass("log")).toBe("bg-muted");
  });

  it("미지의 레벨도 면을 잃지 않는다", () => {
    expect(consoleLevelBgStrongClass("trace")).toBe("bg-muted");
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
