import { describe, it, expect } from "vitest";
import { selectorLineProtectedRange } from "../selectorLock";

describe("selectorLineProtectedRange", () => {
  it("1행 끝(firstLineTo)까지를 protected range로 반환", () => {
    // e.g. ".foo {" 끝 위치가 10이면 [0,10]을 보호 → 1행 편집만 드롭, 본문은 통과.
    expect(selectorLineProtectedRange(10)).toEqual([0, 10]);
  });

  it("빈/짧은 선택자(길이 0)도 안전", () => {
    expect(selectorLineProtectedRange(0)).toEqual([0, 0]);
  });
});
