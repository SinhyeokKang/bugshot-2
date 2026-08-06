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

  it("마커 없는 다른 포털 콘텐츠(tooltip 등)는 세지 않는다", () => {
    const host = mount(
      `<div data-radix-popper-content-wrapper=""><div data-state="open"></div></div>`,
    );
    expect(hasOpenDismissLayer(host)).toBe(false);
  });
});
