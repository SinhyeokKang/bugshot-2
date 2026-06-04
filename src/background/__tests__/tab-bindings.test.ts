import { describe, it, expect } from "vitest";
import { shouldPreserveSession, resolveTabSwitch } from "../tab-bindings";

describe("shouldPreserveSession", () => {
  it("returns false for undefined snap", () => {
    expect(shouldPreserveSession(undefined)).toBe(false);
  });

  it("returns false for empty snap", () => {
    expect(shouldPreserveSession({})).toBe(false);
  });

  it("returns true for video mode regardless of phase", () => {
    expect(shouldPreserveSession({ captureMode: "video", phase: "recording" })).toBe(true);
    expect(shouldPreserveSession({ captureMode: "video", phase: "drafting" })).toBe(true);
    expect(shouldPreserveSession({ captureMode: "video", phase: "idle" })).toBe(true);
    expect(shouldPreserveSession({ captureMode: "video" })).toBe(true);
  });

  const frozenModes = ["screenshot", "element", "freeform"] as const;
  const frozenPhases = ["drafting", "previewing", "done"] as const;
  const nonFrozenPhases = ["idle", "picking", "styling", "capturing", "recording"] as const;

  for (const mode of frozenModes) {
    it(`returns true for ${mode} in frozen phases`, () => {
      for (const phase of frozenPhases) {
        expect(shouldPreserveSession({ captureMode: mode, phase })).toBe(true);
      }
    });

    it(`returns false for ${mode} in non-frozen phases`, () => {
      for (const phase of nonFrozenPhases) {
        expect(shouldPreserveSession({ captureMode: mode, phase })).toBe(false);
      }
    });
  }

  it("returns false for unknown captureMode", () => {
    expect(shouldPreserveSession({ captureMode: "unknown", phase: "drafting" })).toBe(false);
  });
});

describe("resolveTabSwitch", () => {
  it("returns null on first activation in a window and records it", () => {
    const map = new Map<number, number>();
    expect(resolveTabSwitch(map, 1, 10)).toBeNull();
    expect(map.get(1)).toBe(10);
  });

  it("returns the previous tab on switch within the same window", () => {
    const map = new Map<number, number>([[1, 10]]);
    expect(resolveTabSwitch(map, 1, 20)).toBe(10);
    expect(map.get(1)).toBe(20);
  });

  it("returns null when re-activating the same tab", () => {
    const map = new Map<number, number>([[1, 10]]);
    expect(resolveTabSwitch(map, 1, 10)).toBeNull();
    expect(map.get(1)).toBe(10);
  });

  it("tracks each window independently (no cross-window stop)", () => {
    const map = new Map<number, number>();
    expect(resolveTabSwitch(map, 1, 10)).toBeNull();
    expect(resolveTabSwitch(map, 2, 20)).toBeNull();
    // switching back to window 1 stops window 1's prev, not window 2's visible tab
    expect(resolveTabSwitch(map, 1, 11)).toBe(10);
    expect(map.get(2)).toBe(20);
  });
});
