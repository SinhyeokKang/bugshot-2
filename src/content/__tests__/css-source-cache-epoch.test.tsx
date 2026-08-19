import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/bg-client", () => ({ sendBg: vi.fn(async () => ({ sheets: [] })) }));

import { ensureLoaded, invalidate, isCacheReady } from "../css-source-cache";

// 패널 열기(시트 로드 중) → 즉시 닫기(invalidate) → 옛 promise가 뒤늦게 resolve하며 isReady를
// 켜던 회귀. 재오픈 시 picker의 캐시 대기가 스킵돼 raw 캐시가 빈 채로 확정 발화하고,
// shorthand var() 원문이 CSSOM explode 값으로 강등된다.
describe("css-source-cache 에폭 가드", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    invalidate();
  });

  it("정상 로드는 isReady를 켠다", async () => {
    const style = document.createElement("style");
    style.textContent = ".a { color: red; }";
    document.head.appendChild(style);

    await ensureLoaded();

    expect(isCacheReady()).toBe(true);
  });

  it("로드 중 invalidate가 지나가면 뒤늦은 resolve가 isReady를 켜지 않는다", async () => {
    const style = document.createElement("style");
    style.textContent = ".a { color: red; }";
    document.head.appendChild(style);

    const pending = ensureLoaded();
    invalidate();
    await pending;

    expect(isCacheReady()).toBe(false);
  });

  it("invalidate 후 다시 로드하면 정상적으로 준비된다", async () => {
    const style = document.createElement("style");
    style.textContent = ".a { color: red; }";
    document.head.appendChild(style);

    const pending = ensureLoaded();
    invalidate();
    await pending;
    await ensureLoaded();

    expect(isCacheReady()).toBe(true);
  });

});

// 실패한 promise가 슬롯에 남으면 세션 내내 같은 rejection을 되돌려주고 isReady가 영영 안 선다 —
// 픽커가 매 요소 선택마다 빈 raw 캐시로 확정 발화한다.
describe("css-source-cache 실패 재시도", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    invalidate();
  });

  function failNextCollect(): () => void {
    Object.defineProperty(document, "styleSheets", {
      configurable: true,
      get() {
        throw new Error("styleSheets unavailable");
      },
    });
    return () => {
      delete (document as unknown as Record<string, unknown>).styleSheets;
    };
  }

  it("로드 실패 후 재호출하면 새로 시도한다", async () => {
    const restore = failNextCollect();
    const failed = ensureLoaded();
    restore();
    await expect(failed).rejects.toThrow("styleSheets unavailable");

    const style = document.createElement("style");
    style.textContent = ".a { color: red; }";
    document.head.appendChild(style);
    await ensureLoaded();

    expect(isCacheReady()).toBe(true);
  });

  it("invalidate 뒤 실패한 이전 promise가 새 슬롯을 지우지 않는다", async () => {
    const restore = failNextCollect();
    const failed = ensureLoaded();
    restore();

    invalidate();
    const style = document.createElement("style");
    style.textContent = ".a { color: red; }";
    document.head.appendChild(style);
    const fresh = ensureLoaded();

    await expect(failed).rejects.toThrow("styleSheets unavailable");
    await fresh;

    expect(ensureLoaded()).toBe(fresh);
    expect(isCacheReady()).toBe(true);
  });
});
