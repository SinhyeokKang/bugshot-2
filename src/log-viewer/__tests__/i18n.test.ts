import { describe, expect, it, vi } from "vitest";

// i18n.ts는 모듈 최상위에서 navigator.language를 읽는다. ES import는 호이스팅돼
// 일반 문장보다 먼저 실행되므로, import보다 앞서 도는 vi.hoisted에서 navigator를
// 정의해야 node 환경(navigator 미정의)에서 import-time ReferenceError를 막는다.
vi.hoisted(() => {
  (globalThis as { navigator?: unknown }).navigator = { language: "ko-KR" };
});

import { koDict, enDict, t } from "../i18n";

describe("log viewer i18n — 사전 구조", () => {
  it("ko/en 키 동일", () => {
    const koKeys = Object.keys(koDict).sort();
    const enKeys = Object.keys(enDict).sort();
    expect(koKeys).toEqual(enKeys);
  });

  it("빈 값 없음", () => {
    const koEmpty = Object.entries(koDict)
      .filter(([, v]) => !v || !String(v).trim())
      .map(([k]) => k);
    const enEmpty = Object.entries(enDict)
      .filter(([, v]) => !v || !String(v).trim())
      .map(([k]) => k);
    expect(koEmpty).toEqual([]);
    expect(enEmpty).toEqual([]);
  });

  it("placeholder 토큰 ko/en 동일", () => {
    function tokens(s: string): string[] {
      return [...s.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)]
        .map((m) => m[1])
        .sort();
    }
    const mismatches: string[] = [];
    for (const k of Object.keys(koDict)) {
      const kt = tokens(koDict[k] ?? "");
      const et = tokens(enDict[k] ?? "");
      if (JSON.stringify(kt) !== JSON.stringify(et)) {
        mismatches.push(`${k}: ko=[${kt}] en=[${et}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("log viewer i18n — 번역 동작", () => {
  it("파라미터 치환", () => {
    const result = t("networkLog.counter.captured" as any, { n: 42 });
    expect(result).toContain("42");
  });

  it("미등록 키 → 키 문자열 그대로 반환", () => {
    expect(t("this.key.does.not.exist" as any)).toBe(
      "this.key.does.not.exist",
    );
  });
});
