import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// `background/index.ts`는 SW 엔트리(리스너가 모듈 최상단에서 등록)라 런타임 유닛으로 못 잡고,
// coverage-report의 BROWSER_BOUND_EXACT에도 있어 분모 밖이다. 그런데 여기서 지켜야 할 건
// 로직이 아니라 **순서** 하나라, connect-reason-coverage.test.ts와 같은 원문 대조로 잠근다.
//
// 잠그는 계약: onBeforeNavigate에서 `isTopLikeFrame(getDeviceFrame(...))` 게이트와 그 안의
// 로그 꼬리 sync가 `applyDeviceSignal(... "beforeNavigate" ...)`보다 **앞**에 있어야 한다.
// handoff 판정이 binding을 폐기하므로(decideDeviceSignal의 handoff 분기 → setDeviceFrame(null)),
// 뒤에서 읽으면 떠나는 래퍼가 top-like가 아니게 돼 그 문서의 로그 꼬리가 통째로 사라진다.
// 두 줄을 되돌려도 나머지 5000여 테스트는 전부 green이다.
const SRC = readFileSync(resolve(__dirname, "..", "index.ts"), "utf8");

function block(marker: RegExp): string {
  const start = SRC.search(marker);
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf("\nchrome.webNavigation.onCommitted", start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("onBeforeNavigate — 로그 꼬리 sync가 handoff 판정보다 앞선다", () => {
  const body = block(/chrome\.webNavigation\.onBeforeNavigate\.addListener/);

  it("isTopLikeFrame 게이트가 beforeNavigate 판정보다 먼저 나온다", () => {
    const gate = body.indexOf("isTopLikeFrame(getDeviceFrame(");
    const decide = body.indexOf('kind: "beforeNavigate"');
    expect(gate).toBeGreaterThan(-1);
    expect(decide).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(decide);
  });

  it("3종 recorder sync가 모두 그 게이트 안에서, 판정보다 먼저 나간다", () => {
    const decide = body.indexOf('kind: "beforeNavigate"');
    for (const kind of ["networkRecorder", "consoleRecorder", "actionRecorder"]) {
      const at = body.indexOf(`{ type: "${kind}.sync" }`);
      expect(at, `${kind}.sync 발송이 없다`).toBeGreaterThan(-1);
      expect(at, `${kind}.sync가 판정 뒤로 밀렸다`).toBeLessThan(decide);
    }
  });
});

// 같은 이유로 원문 대조 — 래퍼 내부 same-origin 이동은 top URL을 안 바꾸므로
// `tabs.onUpdated(info.url)`이 안 오고, 세션 만료 판정이 통째로 건너뛰어진다. 그러면 죽은
// 문서의 selector가 `editor:${tabId}`에 남아 after 캡처가 새 문서의 같은 selector를 찍는다.
// PRD가 "로그·세션 수명주기 동일화"를 한 항목으로 묶은 게 이 지점이다.
describe("onCommitted — 래퍼 이동도 세션 수명주기를 탄다", () => {
  const start = SRC.search(/chrome\.webNavigation\.onCommitted\.addListener/);
  const body = SRC.slice(start);

  it("clearIfPageChanged가 top-like 게이트 안에서 래퍼 프레임에만 불린다", () => {
    const gate = body.indexOf("isTopLikeFrame(binding, frameId)");
    const call = body.indexOf("clearIfPageChanged(tabId, url)");
    expect(gate).toBeGreaterThan(-1);
    expect(call, "clearIfPageChanged 호출이 없다").toBeGreaterThan(gate);
    // top(frameId 0)은 tabs.onUpdated가 이미 부른다 — 여기서 또 부르면 2중 판정이다.
    expect(body.slice(gate, call)).toMatch(/frameId !== 0/);
  });
});
