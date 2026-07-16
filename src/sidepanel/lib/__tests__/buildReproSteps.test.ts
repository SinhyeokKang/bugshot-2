import { describe, it, expect } from "vitest";
import { buildReproSteps } from "../buildReproSteps";
import type { ActionLog, ActionEntry } from "@/types/action";

// 최소 필드로 ActionLog을 만든다. captured/totalSeen은 entries 길이에 맞춘다.
function log(entries: Partial<ActionEntry>[]): ActionLog {
  const full = entries.map((e, i) => ({
    id: String(i),
    kind: "click",
    timestamp: i,
    pageUrl: "https://ex.com",
    ...e,
  })) as ActionEntry[];
  return {
    id: "l",
    startedAt: 0,
    endedAt: full.length,
    totalSeen: full.length,
    captured: full.length,
    entries: full,
  };
}

describe("buildReproSteps", () => {
  it("navigation(load 제외)은 'Go to <url>' 줄을 만든다", () => {
    const out = buildReproSteps(
      log([
        { kind: "navigation", navType: "load", toUrl: "https://ex.com/home" },
        { kind: "navigation", navType: "pushState", toUrl: "https://ex.com/cart" },
      ]),
    );
    expect(out).toBe("Go to https://ex.com/cart");
    expect(out).not.toContain("home");
  });

  it("정상 흐름을 한 줄=한 단계로 나열한다", () => {
    const out = buildReproSteps(
      log([
        { kind: "navigation", navType: "pushState", toUrl: "https://ex.com/login" },
        { kind: "input", selector: "#email", fieldLabel: "Email", value: "me@x.com" },
        { kind: "click", target: "Sign in" },
      ]),
    );
    expect(out.split("\n")).toEqual([
      "Go to https://ex.com/login",
      'Type "me@x.com" in "Email"',
      'Click "Sign in"',
    ]);
  });

  it("같은 selector 연속 input은 마지막 값 한 줄로 dedup한다", () => {
    const out = buildReproSteps(
      log([
        { kind: "input", selector: "#email", fieldLabel: "Email", value: "a" },
        { kind: "input", selector: "#email", fieldLabel: "Email", value: "ab" },
        { kind: "input", selector: "#email", fieldLabel: "Email", value: "abc" },
      ]),
    );
    expect(out).toBe('Type "abc" in "Email"');
  });

  it("keypress 엔트리는 결과에 없다", () => {
    const out = buildReproSteps(
      log([
        { kind: "click", target: "Login" },
        { kind: "keypress", value: "Meta+K", target: "body" },
      ]),
    );
    expect(out).toContain('Click "Login"');
    expect(out).not.toContain("Meta+K");
  });

  it("MAX_STEPS 초과 로그는 상한 이하로 잘리고 최근 단계를 남긴다", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      kind: "click" as const,
      target: `item-${i}`,
    }));
    const out = buildReproSteps(log(entries));
    const lines = out.split("\n");
    expect(lines.length).toBeLessThanOrEqual(15);
    expect(out).toContain('Click "item-19"');
    expect(out).not.toContain('Click "item-0"');
  });

  it("masked input 값은 *** 그대로 유지한다", () => {
    const out = buildReproSteps(
      log([
        { kind: "input", selector: "#pw", fieldLabel: "Password", value: "***", masked: true },
      ]),
    );
    expect(out).toBe('Type "***" in "Password"');
  });

  it("captured 0(빈 entries)이면 빈 문자열", () => {
    expect(
      buildReproSteps({
        id: "l",
        startedAt: 0,
        endedAt: 0,
        totalSeen: 0,
        captured: 0,
        entries: [],
      }),
    ).toBe("");
  });

  it("captured>0이나 전부 keypress/load라 필터 후 0줄이면 빈 문자열", () => {
    const out = buildReproSteps(
      log([
        { kind: "navigation", navType: "load", toUrl: "https://ex.com" },
        { kind: "keypress", value: "Tab" },
        { kind: "keypress", value: "Enter" },
      ]),
    );
    expect(out).toBe("");
  });
});
