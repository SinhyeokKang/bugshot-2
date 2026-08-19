import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginScrollCapture,
  endScrollCapture,
  scrollCaptureTo,
} from "../scroll-capture";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("scroll capture positioned elements", () => {
  it("첫 타일은 유지하고 후속 타일에서 숨긴 뒤 원래 스타일과 스크롤을 복원한다", async () => {
    let scrollY = 0;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    vi.spyOn(window, "scrollX", "get").mockReturnValue(12);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((options) => {
      if (typeof options === "object") scrollY = Number(options.top ?? scrollY);
    });
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

    const { session } = beginScrollCapture();
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
    vi.spyOn(window, "scrollTo").mockImplementation((options) => {
      if (typeof options === "object") scrollY = Number(options.top ?? scrollY);
    });
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

    const { session } = beginScrollCapture();
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
    vi.spyOn(window, "scrollTo").mockImplementation((options) => {
      if (typeof options === "object") scrollY = Number(options.top ?? scrollY);
    });
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

    const { session } = beginScrollCapture();
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

describe("scroll capture 응답 보장", () => {
  it("후보 수집이 throw해도 promise가 resolve된다 (오케스트레이터 무한 대기 방지)", async () => {
    vi.spyOn(window, "scrollY", "get").mockReturnValue(600);
    vi.spyOn(window, "scrollX", "get").mockReturnValue(0);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    // 브라우저 rAF는 콜백 예외를 window.onerror로 보고할 뿐 호출자에게 전파하지 않는다 —
    // 동기 스텁으로 두면 Promise executor가 예외를 삼켜 reject로 관측돼 실제 행(hang)을 못 재현한다.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      setTimeout(() => {
        try {
          cb(0);
        } catch {
          /* 전파하지 않는다 */
        }
      }, 0);
      return 1;
    });
    document.body.append(document.createElement("header"));
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      throw new Error("computed style unavailable");
    });

    const { session } = beginScrollCapture();
    const outcome = await Promise.race([
      scrollCaptureTo(session, 600, true).then(
        () => "resolved" as const,
        () => "rejected" as const,
      ),
      new Promise<"hung">((r) => setTimeout(() => r("hung"), 200)),
    ]);

    expect(outcome).toBe("resolved");
  });

  it("숨김 도중 throw해도 이미 숨긴 요소를 복원한다 (무음 페이지 오염 방지)", async () => {
    vi.spyOn(window, "scrollY", "get").mockReturnValue(600);
    vi.spyOn(window, "scrollX", "get").mockReturnValue(0);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      position: "fixed",
      top: "auto",
      bottom: "auto",
    } as CSSStyleDeclaration);

    const first = document.createElement("header");
    const second = document.createElement("aside");
    document.body.append(first, second);
    // 두 번째 숨김에서 throw — 첫 요소는 이미 hidden이 걸린 뒤다.
    vi.spyOn(second.style, "setProperty").mockImplementation(() => {
      throw new Error("style locked");
    });

    const { session } = beginScrollCapture();
    await scrollCaptureTo(session, 600, true);
    expect(first.style.visibility).toBe("hidden");

    endScrollCapture(session);

    expect(first.style.visibility).toBe("");
  });

  it("복원 중 한 요소가 throw해도 나머지를 복원하고 스크롤을 되돌린다", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(window, "scrollX", "get").mockReturnValue(0);
    vi.spyOn(window, "scrollY", "get").mockReturnValue(0);

    const broken = document.createElement("header");
    const intact = document.createElement("aside");
    document.body.append(broken, intact);
    const { session } = beginScrollCapture();
    broken.style.setProperty("visibility", "hidden", "important");
    intact.style.setProperty("visibility", "hidden", "important");
    session.hiddenFixed = [
      { el: broken, prevValue: "", prevPriority: "" },
      { el: intact, prevValue: "", prevPriority: "" },
    ];
    vi.spyOn(broken.style, "removeProperty").mockImplementation(() => {
      throw new Error("style locked");
    });

    endScrollCapture(session);

    expect(intact.style.visibility).toBe("");
    expect(session.hiddenFixed).toBeNull();
    expect(scrollTo).toHaveBeenCalled();
  });
});
