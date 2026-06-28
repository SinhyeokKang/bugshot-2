import { describe, expect, it, vi } from "vitest";

// i18n.ts는 모듈 최상위에서 navigator.language를 읽는다. ES import는 호이스팅돼
// 일반 문장보다 먼저 실행되므로, import보다 앞서 도는 vi.hoisted에서 navigator를
// 정의해야 node 환경(navigator 미정의)에서 import-time ReferenceError를 막는다.
vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: { language: "ko-KR" },
    writable: true,
    configurable: true,
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { koDict, enDict, t } from "../i18n";
import { logs } from "../../i18n/namespaces/logs";

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

describe("log viewer i18n — 메인 테이블 대조", () => {
  // log-viewer dict는 메인 i18n 테이블(src/i18n/namespaces/logs.ts)의 부분집합 +
  // 동일 문구를 의도한다. 두 가지 회귀를 막는다:
  //  (1) 누락 — 코드는 t("key")로 참조하는데 dict에 없어 키 문자열이 그대로 노출
  //      (actionLog.filter.keypress 등)
  //  (2) drift — 공통 키인데 메인 갱신이 dict에 반영 안 됨 (networkLog.search 본문 검색)

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "__tests__") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const referencedKeys = (() => {
    const keys = new Set<string>();
    for (const file of walk(srcRoot)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\bt\(\s*["'`]([a-zA-Z][\w.]*)["'`]/g)) {
        keys.add(m[1]);
      }
    }
    return [...keys].sort();
  })();

  it("코드가 t()로 참조하는 리터럴 키는 dict에 모두 존재", () => {
    const missing = referencedKeys.filter(
      (k) => !(k in koDict) || !(k in enDict),
    );
    expect(missing).toEqual([]);
  });

  it("메인 테이블과 공통인 키는 값도 일치 (stale drift 방지)", () => {
    const koDrift = Object.keys(koDict)
      .filter((k) => k in logs.ko && logs.ko[k as keyof typeof logs.ko] !== koDict[k])
      .map((k) => `ko ${k}`);
    const enDrift = Object.keys(enDict)
      .filter((k) => k in logs.en && logs.en[k as keyof typeof logs.en] !== enDict[k])
      .map((k) => `en ${k}`);
    expect([...koDrift, ...enDrift]).toEqual([]);
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
