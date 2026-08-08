import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginScrollCapture,
  endScrollCapture,
  scrollCaptureTo,
} from "../scroll-capture";
import { DEVICE_FRAME_ID } from "../device-frame";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// 오케스트레이터는 frameId 0 고정이라, 디바이스 뷰포트 ON에서 페이지 전체 캡처가 돌면
// `html{overflow:hidden}`인 top을 스크롤시키며 **조용히 1타일**을 찍는다(에러도 truncated
// 배지도 없다). UI 잠금은 패널 인메모리 `width`에 걸려 있어 패널 재오픈 직후 그 값이 아직
// null인 창에서 열린다 — 페이지 쪽 2차 방어가 있어야 그 창이 닫힌다.
describe("beginScrollCapture — 디바이스 뷰포트 2차 방어", () => {
  it("래퍼가 있으면 metrics를 내주지 않는다", () => {
    const frame = document.createElement("iframe");
    frame.id = DEVICE_FRAME_ID;
    frame.style.width = "390px";
    document.body.appendChild(frame);
    expect(beginScrollCapture()).toBeNull();
  });

  it("래퍼가 없으면 평소대로 metrics를 준다", () => {
    expect(beginScrollCapture()?.metrics.viewport).toBeDefined();
  });
});

describe("scroll capture positioned elements", () => {
  it("첫 타일은 유지하고 후속 타일에서 숨긴 뒤 원래 스타일과 스크롤을 복원한다", async () => {
    let scrollY = 0;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    vi.spyOn(window, "scrollX", "get").mockReturnValue(12);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(((options?: ScrollToOptions | number) => {
      // window.scrollTo는 오버로드 2개(x,y | options)라 인자 타입을 명시하지 않으면
      // typeof === "object" 좁히기가 never로 떨어진다.
      if (typeof options === "object" && options) scrollY = Number(options.top ?? scrollY);
    }) as typeof window.scrollTo);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const fixed = document.createElement("header");
    const sticky = document.createElement("nav");
    sticky.style.setProperty("visibility", "visible", "important");
    document.body.append(fixed, sticky);
    Object.defineProperties(sticky, {
      offsetTop: { configurable: true, value: 100 },
      offsetHeight: { configurable: true, value: 40 },
    });
    vi.spyOn(sticky, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 40,
      left: 0,
      right: 800,
      width: 800,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el) =>
        ({
          position: el === fixed ? "fixed" : el === sticky ? "sticky" : "static",
          top: "0px",
          bottom: "auto",
        }) as CSSStyleDeclaration,
    );

    const { session } = beginScrollCapture()!;
    await scrollCaptureTo(session, 0, false);
    expect(fixed.style.visibility).toBe("");
    expect(sticky.style.visibility).toBe("visible");

    await scrollCaptureTo(session, 600, true);
    expect(fixed.style.visibility).toBe("hidden");
    expect(sticky.style.visibility).toBe("hidden");

    endScrollCapture(session);
    expect(fixed.style.visibility).toBe("");
    expect(sticky.style.getPropertyValue("visibility")).toBe("visible");
    expect(sticky.style.getPropertyPriority("visibility")).toBe("important");
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      left: 12,
      behavior: "instant",
    });
  });

  it("후속 스크롤 임계점에서 fixed로 전환된 요소도 새 후보로 숨긴다", async () => {
    let scrollY = 0;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    vi.spyOn(window, "scrollX", "get").mockReturnValue(0);
    vi.spyOn(window, "scrollTo").mockImplementation(((options?: ScrollToOptions | number) => {
      if (typeof options === "object" && options) scrollY = Number(options.top ?? scrollY);
    }) as typeof window.scrollTo);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const lateFixed = document.createElement("header");
    document.body.append(lateFixed);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el) =>
        ({
          position: el === lateFixed && lateFixed.classList.contains("fixed") ? "fixed" : "static",
          top: "auto",
          bottom: "auto",
        }) as CSSStyleDeclaration,
    );

    const { session } = beginScrollCapture()!;
    await scrollCaptureTo(session, 600, true);
    expect(lateFixed.style.visibility).toBe("");

    lateFixed.classList.add("fixed");
    await Promise.resolve();
    await scrollCaptureTo(session, 1200, true);
    expect(lateFixed.style.visibility).toBe("hidden");

    endScrollCapture(session);
  });

  it("캡처 도중 추가된 fixed 요소도 새 후보로 숨긴다", async () => {
    let scrollY = 600;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    vi.spyOn(window, "scrollX", "get").mockReturnValue(0);
    vi.spyOn(window, "scrollTo").mockImplementation(((options?: ScrollToOptions | number) => {
      if (typeof options === "object" && options) scrollY = Number(options.top ?? scrollY);
    }) as typeof window.scrollTo);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el) =>
        ({
          position: el instanceof HTMLElement && el.dataset.fixed === "true" ? "fixed" : "static",
          top: "auto",
          bottom: "auto",
        }) as CSSStyleDeclaration,
    );

    const { session } = beginScrollCapture()!;
    await scrollCaptureTo(session, 600, true);

    const inserted = document.createElement("aside");
    inserted.dataset.fixed = "true";
    document.body.append(inserted);
    await Promise.resolve();
    await scrollCaptureTo(session, 1200, true);

    expect(inserted.style.visibility).toBe("hidden");
    endScrollCapture(session);
  });
});
