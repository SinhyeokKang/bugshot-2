import { describe, it, expect } from "vitest";
import { haloTransform, HALO_DIAMETER } from "../cursor-halo";

describe("haloTransform", () => {
  it("centers the halo on the cursor position", () => {
    expect(haloTransform(100, 200, 36)).toBe("translate3d(82px, 182px, 0)");
  });

  it("handles zero coordinates", () => {
    expect(haloTransform(0, 0, 36)).toBe("translate3d(-18px, -18px, 0)");
  });

  it("rounds non-integer coordinates so transforms stay crisp", () => {
    expect(haloTransform(100.6, 200.4, 36)).toBe("translate3d(83px, 182px, 0)");
  });

  it("uses the configured diameter constant", () => {
    expect(haloTransform(100, 100, HALO_DIAMETER)).toBe(
      `translate3d(${100 - HALO_DIAMETER / 2}px, ${100 - HALO_DIAMETER / 2}px, 0)`,
    );
  });
});
