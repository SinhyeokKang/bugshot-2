import { describe, expect, it } from "vitest";
import { hasOpenDismissLayer } from "../dismiss-guard";

// 실제 DOM 셀렉터 매칭이 검증 대상이라 jsdom 트랙(.test.tsx)에 둔다.
function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe("hasOpenDismissLayer", () => {
  it("열린 dismiss 레이어가 있으면 true", () => {
    const host = mount(`<div data-dismiss-layer="popover" data-state="open"></div>`);
    expect(hasOpenDismissLayer(host)).toBe(true);
  });

  it("레이어가 없으면 false", () => {
    const host = mount(`<div data-state="open"></div>`);
    expect(hasOpenDismissLayer(host)).toBe(false);
  });

  it("닫히는 중(data-state=closed)인 레이어는 세지 않는다", () => {
    const host = mount(`<div data-dismiss-layer="popover" data-state="closed"></div>`);
    expect(hasOpenDismissLayer(host)).toBe(false);
  });

  // Radix는 Dialog 아래 깔린 레이어에 인라인 pointer-events: none을 건다. 그런 레이어는
  // 자기 outside 이벤트조차 못 받아 스스로 닫히지 못하므로, 세면 dim이 영영 막힌다.
  it("Dialog 아래 깔려 pointer-events가 꺼진 레이어는 세지 않는다", () => {
    const host = mount(
      `<div data-dismiss-layer="popover" data-state="open" style="pointer-events: none"></div>`,
    );
    expect(hasOpenDismissLayer(host)).toBe(false);
  });

  it("pointer-events가 살아 있는 레이어는 센다", () => {
    const host = mount(
      `<div data-dismiss-layer="popover" data-state="open" style="pointer-events: auto"></div>`,
    );
    expect(hasOpenDismissLayer(host)).toBe(true);
  });

  it("꺼진 레이어가 먼저 있어도 살아 있는 레이어가 있으면 센다", () => {
    const host = mount(
      `<div data-dismiss-layer="popover" data-state="open" style="pointer-events: none"></div>
       <div data-dismiss-layer="popover" data-state="open" style="pointer-events: auto"></div>`,
    );
    expect(hasOpenDismissLayer(host)).toBe(true);
  });

  it("마커 없는 다른 포털 콘텐츠(tooltip 등)는 세지 않는다", () => {
    const host = mount(
      `<div data-radix-popper-content-wrapper=""><div data-state="open"></div></div>`,
    );
    expect(hasOpenDismissLayer(host)).toBe(false);
  });
});
