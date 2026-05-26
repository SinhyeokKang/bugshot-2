import { describe, it, expect } from "vitest";
import { shouldPreserveSession } from "../tab-bindings";

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
