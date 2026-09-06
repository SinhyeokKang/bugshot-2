import { afterEach } from "vitest";

// jsdom 환경(*.test.tsx)에서만 동작. 순수 함수 테스트는 node 환경이라 통째로 스킵된다.
if (typeof window !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);

  // Radix Popover/cmdk가 요구하지만 jsdom에 없는 API들.
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // ProseMirror는 트랜잭션마다 selection을 화면 안으로 스크롤하려고 좌표를 잰다
  // (`focus()` → `scrollToSelection` → `coordsAtPos`). jsdom에 레이아웃이 없어
  // `getClientRects`가 Range·Text에 없으면 **비동기 unhandled error**로 새어
  // 테스트는 전부 통과하는데 종료 코드만 1이 된다. 빈 목록을 돌려주면 좌표 계산이
  // 조용히 포기한다 — 레이아웃을 재는 단언은 어차피 jsdom에서 못 한다.
  const emptyRects = () =>
    Object.assign([] as unknown as DOMRectList, { item: () => null });
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = emptyRects as () => DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  }

  // jsdom에는 CSS 전역 자체가 없고 @medv/finder는 CSS.escape를 무조건 호출한다
  // (없으면 첫 후보에서 TypeError). CSSOM 명세 알고리즘을 그대로 옮긴 폴리필이라
  // 이스케이프 **문법**은 맞지만, Chrome CSSOM이 클래스를 어떻게 직렬화하는지
  // (`2xl:mt-4` → `.\32 xl\:mt-4`)와 그걸 querySelector가 되받는지는 재현하지 않는다.
  // 실제 escaping 회귀의 그물은 e2e·수동이다(POSTMORTEM 2026-08-03).
  // 게이트를 `CSS` 네임스페이스 유무로 잡으면, jsdom이 나중에 `CSS.supports`만
  // 얹었을 때 폴리필이 안 깔려 finder가 첫 후보에서 죽는다.
  const cssNs = globalThis as { CSS?: { escape?(value: string): string } };
  if (typeof cssNs.CSS?.escape !== "function") {
    cssNs.CSS = {
      ...cssNs.CSS,
      escape(value: string): string {
        const s = String(value);
        const first = s.charCodeAt(0);
        if (s.length === 1 && first === 0x002d) return `\\${s}`;
        let out = "";
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i);
          if (c === 0x0000) {
            out += "�";
          } else if (
            (c >= 0x0001 && c <= 0x001f) ||
            c === 0x007f ||
            (i === 0 && c >= 0x0030 && c <= 0x0039) ||
            (i === 1 && c >= 0x0030 && c <= 0x0039 && first === 0x002d)
          ) {
            out += `\\${c.toString(16)} `;
          } else if (
            c >= 0x0080 ||
            c === 0x002d ||
            c === 0x005f ||
            (c >= 0x0030 && c <= 0x0039) ||
            (c >= 0x0041 && c <= 0x005a) ||
            (c >= 0x0061 && c <= 0x007a)
          ) {
            out += s.charAt(i);
          } else {
            out += `\\${s.charAt(i)}`;
          }
        }
        return out;
      },
    };
  }
}
