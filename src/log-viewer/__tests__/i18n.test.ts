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

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { DICTS, t } from "../i18n";
import { logs } from "../../i18n/namespaces/logs";
import { editor } from "../../i18n/namespaces/editor";
import { BASE_LOCALE, LOCALES } from "../../i18n/locales";
import { NET_VERB_KEYS } from "../timeline-merge";
import { findExtraneous, findParityViolations, findUncovered } from "@/test/locale-parity";

describe("log viewer i18n — 사전 구조", () => {
  // koDict/enDict를 하드 import해 둘만 비교하던 이전 버전은 3번째 로케일을 못 봤다.
  // 이 사전은 별도 빌드라 i18n 저장 훅도 안 걸리므로, N-way 검사가 유일한 그물이다.
  it("등록된 모든 로케일이 기준 로케일과 키·값·토큰이 대칭이다", () => {
    expect(findParityViolations(DICTS, BASE_LOCALE)).toEqual([]);
  });

  it("LOCALES의 모든 코드가 복제 사전을 갖는다", () => {
    expect(findUncovered(LOCALES, DICTS)).toEqual([]);
  });

  it("LOCALES에 없는 사전이 남아있지 않다", () => {
    expect(findExtraneous(LOCALES, DICTS)).toEqual([]);
  });
});

describe("log viewer i18n — 메인 테이블 대조", () => {
  // log-viewer dict는 메인 i18n 테이블(src/i18n/namespaces/의 logs·editor)의 부분집합 +
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
  const srcDir = join(srcRoot, "..");

  // log-viewer 번들은 사이드패널 공용 컴포넌트(NetworkLogContent 등)를 재사용하고,
  // vite.log-viewer.config.ts가 @/i18n을 이 복제 사전으로 alias하므로 그 컴포넌트의 t() 키도
  // 여기서 해결돼야 한다. log-viewer 디렉터리만 스캔하던 이전 스캐너는 그 바깥을 못 봐서
  // WebSocket 키 10개가 raw 노출된 채 통과했다. 그래서 스캔 범위를 실제 import 그래프로 넓힌다 —
  // 번들에 들어가는 파일이면 그 키도 해결돼야 한다는 규칙이 판정 기준이다.
  // 트레이드오프: 번들에 들어가지만 log-viewer가 렌더하지 않는 경로의 키(Section의 collapsible
  // 토글 등)까지 사전에 요구한다. 모듈 단위 그래프로는 렌더 도달성을 못 가리므로, 몇 개를 더
  // 넣는 쪽을 택했다 — 조용한 누락보다 나은 실패 모드다.
  function resolveImport(spec: string, fromFile: string): string | null {
    let base: string;
    if (spec === "@/i18n" || spec.startsWith("@/i18n/")) base = join(srcRoot, "i18n");
    else if (spec.startsWith("@/")) base = join(srcDir, spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
    else return null;
    const candidates = [
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
      join(base, "index.tsx"),
    ];
    return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
  }

  const bundledFiles = (() => {
    const seen = new Set(walk(srcRoot));
    const queue = [...seen];
    while (queue.length) {
      const file = queue.shift()!;
      const code = readFileSync(file, "utf8");
      // 타입 전용 import/export는 번들에 안 남으므로 그래프에서 제외한다.
      const specs = [
        ...code.matchAll(/\bimport\s+(?!type\s)[\s\S]*?\bfrom\s*["']([^"']+)["']/g),
        ...code.matchAll(/\bexport\s+(?!type\s)[\s\S]*?\bfrom\s*["']([^"']+)["']/g),
      ].map((m) => m[1]);
      for (const spec of specs) {
        const target = resolveImport(spec, file);
        if (!target || seen.has(target)) continue;
        seen.add(target);
        queue.push(target);
      }
    }
    return [...seen].sort();
  })();

  const referencedKeys = (() => {
    const keys = new Set<string>();
    for (const file of bundledFiles) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\bt\(\s*["'`]([a-zA-Z][\w.]*)["'`]/g)) {
        keys.add(m[1]);
      }
    }
    return [...keys].sort();
  })();

  // resolveImport가 조용히 아무것도 못 찾으면 위 검사가 log-viewer 디렉터리만 보던 상태로
  // 되돌아가면서 vacuous green이 된다. 스캐너가 실제로 그래프를 탄다는 것 자체를 고정한다.
  it("스캐너가 공용 로그 컴포넌트까지 도달한다 (자기검증 앵커)", () => {
    const relative = bundledFiles.map((f) => f.slice(srcDir.length + 1));
    expect(relative).toEqual(
      expect.arrayContaining([
        join("sidepanel", "components", "NetworkLogContent.tsx"),
        join("sidepanel", "components", "ConsoleLogContent.tsx"),
        join("sidepanel", "components", "ActionLogContent.tsx"),
        join("sidepanel", "components", "IssuePreviewView.tsx"),
      ]),
    );
  });

  it("코드가 t()로 참조하는 리터럴 키는 모든 로케일 사전에 존재", () => {
    const missing = referencedKeys.flatMap((key) =>
      LOCALES.filter((locale) => !(key in DICTS[locale])).map(
        (locale) => `${locale} ${key}`,
      ),
    );
    expect(missing).toEqual([]);
  });

  // netVerbKey는 t(`timeline.net.verb.${...}`) 동적 조립이라 위 리터럴 스캐너를 우회한다.
  // 가능한 키를 NET_VERB_KEYS 닫힌 집합(netVerbKey 반환 타입이 바인딩)으로 고정하고
  // dict 존재를 강제해 verb 추가 시 키 누락(raw 노출)을 잡는다.
  it("동적 조립 net.verb 키(NET_VERB_KEYS)가 모든 로케일 사전에 존재", () => {
    const missing = NET_VERB_KEYS.flatMap((v) => {
      const key = `timeline.net.verb.${v}`;
      return LOCALES.filter((locale) => !(key in DICTS[locale])).map(
        (locale) => `${locale} ${key}`,
      );
    });
    expect(missing).toEqual([]);
  });

  // 이 사전이 복제하는 키는 두 네임스페이스에 걸쳐 있다(logs의 로그 문구 + editor의 codeBlock.*).
  // 한쪽만 대조하면 나머지 쪽 drift가 무방비다.
  const MAIN_NAMESPACES: Record<string, Record<string, string>>[] = [logs, editor];

  it("메인 테이블과 공통인 키는 값도 일치 (stale drift 방지)", () => {
    const drift = LOCALES.flatMap((locale) => {
      const dict = DICTS[locale];
      return MAIN_NAMESPACES.flatMap((ns) => {
        const table = ns[locale];
        if (!table) return [`${locale}: 메인 네임스페이스에 이 로케일 테이블이 없다`];
        return Object.keys(dict)
          .filter((k) => k in table && table[k] !== dict[k])
          .map((k) => `${locale} ${k}`);
      });
    });
    expect(drift).toEqual([]);
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
