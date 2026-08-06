import { describe, expect, it } from "vitest";
import { clampToDeviceFrame } from "../device-frame";

const FRAME = { x: 100, y: 0, width: 390, height: 800 };

describe("clampToDeviceFrame", () => {
  it("래퍼가 없으면(frame=null) rect를 그대로 돌려준다", () => {
    const rect = { x: 0, y: 0, width: 1200, height: 800 };
    expect(clampToDeviceFrame(rect, null)).toEqual(rect);
  });

  it("래퍼 안에 완전히 든 rect는 그대로다", () => {
    const rect = { x: 150, y: 100, width: 200, height: 300 };
    expect(clampToDeviceFrame(rect, FRAME)).toEqual(rect);
  });

  it("래퍼에 걸친 rect는 겹치는 부분으로 잘린다", () => {
    // 좌측 여백(x<100)과 우측 여백(x>490)을 동시에 물고 있는 드래그.
    const rect = { x: 20, y: -50, width: 600, height: 400 };
    expect(clampToDeviceFrame(rect, FRAME)).toEqual({
      x: 100,
      y: 0,
      width: 390,
      height: 350,
    });
  });

  it("래퍼 밖으로 완전히 벗어난 rect는 0 크기로 접힌다", () => {
    const rect = { x: 0, y: 0, width: 50, height: 100 };
    const clamped = clampToDeviceFrame(rect, FRAME);
    expect(clamped.width).toBe(0);
    expect(clamped.height).toBeGreaterThanOrEqual(0);
  });
});
