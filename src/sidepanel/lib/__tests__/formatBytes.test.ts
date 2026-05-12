import { describe, it, expect } from "vitest";
import { formatBytes } from "../formatBytes";

describe("formatBytes", () => {
  it("0 → '0 B'", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("음수 → '0 B'", () => {
    expect(formatBytes(-100)).toBe("0 B");
  });

  it("NaN → '0 B'", () => {
    expect(formatBytes(NaN)).toBe("0 B");
  });

  it("Infinity → '0 B'", () => {
    expect(formatBytes(Infinity)).toBe("0 B");
  });

  it("1023 B 이하는 정수 B 표기", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("1024 이상 ~ 1 MB 미만은 KB 소수점 1자리", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10240)).toBe("10.0 KB");
  });

  it("1 MB 이상은 MB 소수점 1자리", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(formatBytes(5.5 * 1024 * 1024)).toBe("5.5 MB");
  });
});
