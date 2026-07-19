import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimelineMarkers } from "../TimelineMarkers";
import type { TimelineMarker } from "@/log-viewer/markers";

const MARKER: TimelineMarker = {
  id: "m1",
  type: "console",
  variant: "error",
  absTs: 1000,
  positionPct: 50,
  label: "boom",
  labelParts: [{ text: "boom", className: "text-red-500" }],
};

describe("TimelineMarkers — mono 툴팁", () => {
  it("마커 호버 시 portal 툴팁이 font-mono다", () => {
    render(<TimelineMarkers markers={[MARKER]} />);
    const pin = document.querySelector('button[aria-label="boom"]') as HTMLElement;
    fireEvent.mouseEnter(pin);

    const tooltip = document.querySelector(".bg-popover") as HTMLElement;
    expect(tooltip).toBeTruthy();
    expect(tooltip.className).toContain("font-mono");
  });
});
