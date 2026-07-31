// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyStyleOverlay,
  createStyleOverlayState,
  restoreStyleOverlay,
} from "../style-overlay";

describe("style overlay", () => {
  it("편집하지 않은 페이지의 동시 inline 변경을 보존", () => {
    const el = document.createElement("div");
    el.style.color = "red";
    const state = createStyleOverlayState();

    applyStyleOverlay(el, state, { color: "blue" });
    el.style.backgroundColor = "green";
    applyStyleOverlay(el, state, { color: "purple" });

    expect(el.style.color).toBe("purple");
    expect(el.style.backgroundColor).toBe("green");
    restoreStyleOverlay(el, state);
    expect(el.style.color).toBe("red");
    expect(el.style.backgroundColor).toBe("green");
  });

  it("원래 없던 속성과 important priority를 정확히 복원", () => {
    const el = document.createElement("div");
    el.style.setProperty("color", "red", "important");
    const state = createStyleOverlayState();

    applyStyleOverlay(el, state, { color: "blue", padding: "8px" });
    restoreStyleOverlay(el, state);

    expect(el.style.getPropertyValue("color")).toBe("red");
    expect(el.style.getPropertyPriority("color")).toBe("important");
    expect(el.style.getPropertyValue("padding")).toBe("");
  });

  it("페이지가 편집 중 같은 속성을 다시 쓰면 cleanup이 덮어쓰지 않음", () => {
    const el = document.createElement("div");
    el.style.color = "red";
    const state = createStyleOverlayState();

    applyStyleOverlay(el, state, { color: "blue" });
    el.style.color = "green";
    restoreStyleOverlay(el, state);

    expect(el.style.color).toBe("green");
  });

  it("shorthand가 덮은 원래 inline longhand와 priority를 복원", () => {
    const el = document.createElement("div");
    el.style.setProperty("margin-left", "5px", "important");
    const state = createStyleOverlayState();

    applyStyleOverlay(el, state, { margin: "10px" });
    restoreStyleOverlay(el, state);

    expect(el.style.getPropertyValue("margin-left")).toBe("5px");
    expect(el.style.getPropertyPriority("margin-left")).toBe("important");
    expect(el.style.getPropertyValue("margin-top")).toBe("");
  });

  it("reset 뒤 페이지가 바꾼 같은 속성을 재편집해도 최신 baseline으로 복원", () => {
    const el = document.createElement("div");
    el.style.color = "red";
    const state = createStyleOverlayState();

    applyStyleOverlay(el, state, { color: "blue" });
    applyStyleOverlay(el, state, {});
    el.style.color = "green";
    applyStyleOverlay(el, state, { color: "purple" });
    restoreStyleOverlay(el, state);

    expect(el.style.color).toBe("green");
  });
});
