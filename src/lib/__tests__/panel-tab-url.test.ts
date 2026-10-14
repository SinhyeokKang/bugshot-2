import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  PANEL_PATH,
  buildPanelUrl,
  parsePanelTabTarget,
  recordersToStopOnSwitch,
} from "../panel-tab-url";

const BASE = `chrome-extension://abcdefghijklmnop/${PANEL_PATH}`;

describe("PANEL_PATH", () => {
  it("manifest side_panel.default_path와 같은 경로다", () => {
    expect(PANEL_PATH).toBe("src/sidepanel/index.html");
  });
});

describe("parsePanelTabTarget", () => {
  it("같은 origin·path에 정수 tabId 쿼리면 그 id를 돌려준다", () => {
    expect(parsePanelTabTarget(`${BASE}?tabId=42`, BASE)).toBe(42);
  });

  it("다른 쿼리·해시가 섞여도 tabId를 읽는다", () => {
    expect(parsePanelTabTarget(`${BASE}?x=1&tabId=7#top`, BASE)).toBe(7);
  });

  it("tabId=0도 유효한 정수다", () => {
    expect(parsePanelTabTarget(`${BASE}?tabId=0`, BASE)).toBe(0);
  });

  const nulls: [string, string | undefined][] = [
    ["url 없음", undefined],
    ["빈 문자열", ""],
    ["파싱 불가", "not a url"],
    ["쿼리 없음", BASE],
    ["빈 tabId", `${BASE}?tabId=`],
    ["정수 아님(소수)", `${BASE}?tabId=1.5`],
    ["정수 아님(문자)", `${BASE}?tabId=abc`],
    ["음수", `${BASE}?tabId=-1`],
    ["Infinity", `${BASE}?tabId=Infinity`],
    ["다른 확장 origin", `chrome-extension://zzzzzzzzzzzzzzzz/${PANEL_PATH}?tabId=42`],
    ["다른 path", "chrome-extension://abcdefghijklmnop/src/log-viewer/index.html?tabId=42"],
    ["일반 웹 페이지", `https://example.com/${PANEL_PATH}?tabId=42`],
  ];

  for (const [name, url] of nulls) {
    it(`${name} → null`, () => {
      expect(parsePanelTabTarget(url, BASE)).toBeNull();
    });
  }

  it("panelBase가 파싱 불가면 null", () => {
    expect(parsePanelTabTarget(`${BASE}?tabId=42`, "")).toBeNull();
  });
});

describe("buildPanelUrl", () => {
  it("panelBase에 tabId 쿼리를 붙인다", () => {
    expect(buildPanelUrl(BASE, 42)).toBe(`${BASE}?tabId=42`);
  });

  it("panelBase에 남은 쿼리가 있으면 tabId만 교체한다", () => {
    expect(buildPanelUrl(`${BASE}?tabId=1`, 42)).toBe(`${BASE}?tabId=42`);
  });

  it("parsePanelTabTarget과 왕복한다", () => {
    expect(parsePanelTabTarget(buildPanelUrl(BASE, 9), BASE)).toBe(9);
  });
});

// design "인터페이스 설계"의 다섯 줄 표. T=10(대상), P=20(T의 패널 탭), X=30(제3 탭).
describe("recordersToStopOnSwitch", () => {
  const T = 10;
  const PANEL = 20;
  const X = 30;

  it("T → T의 패널: 정지하지 않는다 (자기 패널로 이동, 기록 유지)", () => {
    expect(
      recordersToStopOnSwitch({
        prevTabId: T,
        nextTabId: PANEL,
        prevPanelTarget: null,
        nextPanelTarget: T,
      }),
    ).toEqual([]);
  });

  it("T의 패널 → T: 정지하지 않는다 (돌아옴)", () => {
    expect(
      recordersToStopOnSwitch({
        prevTabId: PANEL,
        nextTabId: T,
        prevPanelTarget: T,
        nextPanelTarget: null,
      }),
    ).toEqual([]);
  });

  // 패널 id라 stop은 no-op — T는 계속 기록된다. 새 정지 동작(T 정지)을 넣지 않는다는 계약.
  it("T의 패널 → X: [패널 id]를 돌려준다 (T를 정지하지 않는다)", () => {
    expect(
      recordersToStopOnSwitch({
        prevTabId: PANEL,
        nextTabId: X,
        prevPanelTarget: T,
        nextPanelTarget: null,
      }),
    ).toEqual([PANEL]);
  });

  it("일반 P → X: [P] (기존 동작)", () => {
    expect(
      recordersToStopOnSwitch({
        prevTabId: T,
        nextTabId: X,
        prevPanelTarget: null,
        nextPanelTarget: null,
      }),
    ).toEqual([T]);
  });

  it("prev null → []", () => {
    expect(
      recordersToStopOnSwitch({
        prevTabId: null,
        nextTabId: X,
        prevPanelTarget: null,
        nextPanelTarget: null,
      }),
    ).toEqual([]);
  });

  it("prev === next → []", () => {
    expect(
      recordersToStopOnSwitch({
        prevTabId: T,
        nextTabId: T,
        prevPanelTarget: null,
        nextPanelTarget: null,
      }),
    ).toEqual([]);
  });

  // 예외는 "자기" 패널에만 걸린다 — 남의 패널로 가는 건 제3 탭으로 가는 것과 같다.
  it("T → 다른 대상 U의 패널: [T] (남의 패널은 예외가 아니다)", () => {
    expect(
      recordersToStopOnSwitch({
        prevTabId: T,
        nextTabId: PANEL,
        prevPanelTarget: null,
        nextPanelTarget: 99,
      }),
    ).toEqual([T]);
  });

  it("U의 패널 → T: [패널 id] (돌아온 곳이 자기 대상이 아니다)", () => {
    expect(
      recordersToStopOnSwitch({
        prevTabId: PANEL,
        nextTabId: T,
        prevPanelTarget: 99,
        nextPanelTarget: null,
      }),
    ).toEqual([PANEL]);
  });
});

// background SW와 사이드패널이 같이 무는 leaf다. 여기에 store·chrome 래퍼가 딸려오면 두 realm이
// 함께 오염된다 — typecheck도 다른 테스트도 안 잡는다(`session-keys`·`locales.ts`와 같은 불변식).
describe("panel-tab-url 런타임 import 0", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "panel-tab-url.ts"),
    "utf8",
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("소스를 실제로 읽었다 (앵커)", () => {
    expect(code).toMatch(/export function recordersToStopOnSwitch/);
  });

  it("value import가 없다", () => {
    const specifiers = [
      ...code.matchAll(/(?:\bfrom\s*|^\s*import\s*|\bimport\s*\(\s*)["']([^"']+)["']/gm),
    ].map((m) => m[1]);
    expect(specifiers).toEqual([]);
  });

  it("chrome API를 직접 만지지 않는다 (panelBase를 인자로 받는 이유)", () => {
    expect(code).not.toMatch(/\bchrome\s*\./);
  });
});
