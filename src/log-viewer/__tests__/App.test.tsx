import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import type { LogViewerData } from "@/types/log-viewer";

const legacy = { dataUrl: "data:image/webp;base64,LEGACY" };
const screenshots = ["A", "B", "A"].map((value) => ({ dataUrl: `data:image/webp;base64,${value}` }));
const base: LogViewerData = {
  networkLog: null, consoleLog: null, actionLog: null, video: null,
  screenshot: legacy, report: null,
  meta: { version: "1", createdAt: "2026-01-01", pageUrl: "https://example.com" },
};
function view(overrides: Partial<LogViewerData> = {}) {
  return render(<App data={{ ...base, ...overrides }} />).container;
}
function images(root: HTMLElement) {
  return [...root.querySelectorAll("img")].map((image) => image.getAttribute("src"));
}

describe("static screenshot media", () => {
  it("renders ordered repeated captures and ignores the legacy fallback", () => {
    expect(images(view({ screenshots }))).toEqual(screenshots.map((shot) => shot.dataUrl));
  });
  it("reads legacy reports without the optional array", () => {
    expect(images(view())).toEqual([legacy.dataUrl]);
  });
  it("does not resurrect legacy media for an explicit empty array", () => {
    const root = view({ screenshots: [] });
    expect(images(root)).toEqual([]);
    expect(root.querySelector("[data-panel-group]")).toBeNull();
  });
  it("keeps logs-only reports free of media panels", () => {
    const root = view({ screenshot: null });
    expect(images(root)).toEqual([]);
    expect(root.querySelector("[data-panel-group]")).toBeNull();
  });
  it("keeps video precedence and its timeline with multiple images present", () => {
    const root = view({ screenshots, video: { dataUrl: "data:video/mp4;base64,VIDEO", startedAt: 1000 } });
    expect(images(root)).toEqual([]);
    expect(root.querySelector("video")?.getAttribute("src")).toBe("data:video/mp4;base64,VIDEO");
    expect(root.querySelector('[data-panel-group-direction="vertical"]')).not.toBeNull();
  });
});
