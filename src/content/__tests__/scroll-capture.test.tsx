import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginScrollCapture,
  endScrollCapture,
  scrollCaptureTo,
} from "../scroll-capture";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
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
});
