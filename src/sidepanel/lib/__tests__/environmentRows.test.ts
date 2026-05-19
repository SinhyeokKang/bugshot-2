import { describe, it, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

import { filterEnvironmentRows, deriveReadonlyEnvRows } from "../environmentRows";
import { formatTimestamp } from "../formatTimestamp";

describe("filterEnvironmentRows", () => {
  it("label·value 모두 채워진 row는 그대로 유지", () => {
    const rows = [
      { label: "Browser", value: "Chrome 140" },
      { label: "OS", value: "macOS 15" },
    ];
    expect(filterEnvironmentRows(rows)).toEqual([
      { label: "Browser", value: "Chrome 140" },
      { label: "OS", value: "macOS 15" },
    ]);
  });

  it("label이 공백뿐인 row는 제외", () => {
    const rows = [
      { label: "   ", value: "Chrome 140" },
      { label: "OS", value: "macOS 15" },
    ];
    expect(filterEnvironmentRows(rows)).toEqual([
      { label: "OS", value: "macOS 15" },
    ]);
  });

  it("value가 공백뿐인 row는 제외", () => {
    const rows = [
      { label: "Browser", value: "   " },
      { label: "OS", value: "macOS 15" },
    ];
    expect(filterEnvironmentRows(rows)).toEqual([
      { label: "OS", value: "macOS 15" },
    ]);
  });

  it("label·value 둘 다 공백인 row는 제외", () => {
    expect(filterEnvironmentRows([{ label: "  ", value: "  " }])).toEqual([]);
  });

  it("빈 배열은 빈 배열 반환", () => {
    expect(filterEnvironmentRows([])).toEqual([]);
  });

  it("유지되는 row의 label·value는 trim된다", () => {
    expect(
      filterEnvironmentRows([{ label: "  Browser  ", value: "  Chrome 140  " }]),
    ).toEqual([{ label: "Browser", value: "Chrome 140" }]);
  });

  it("value의 개행은 공백으로 치환된다", () => {
    expect(
      filterEnvironmentRows([{ label: "OS", value: "macOS\n15" }]),
    ).toEqual([{ label: "OS", value: "macOS 15" }]);
  });
});

describe("deriveReadonlyEnvRows", () => {
  it("element 입력은 Page/DOM/Viewport/Captured 4행을 순서대로 파생", () => {
    const capturedAt = new Date(2024, 0, 15, 10, 30, 45).getTime();
    const rows = deriveReadonlyEnvRows({
      url: "https://example.com/page",
      selector: "div.card > button",
      viewport: { w: 1280, h: 800 },
      capturedAt,
    });
    expect(rows).toEqual([
      { label: "Page", value: "https://example.com/page" },
      { label: "DOM", value: "div.card > button" },
      { label: "Viewport", value: "1280×800" },
      { label: "Captured", value: formatTimestamp(capturedAt) },
    ]);
  });

  it("selector가 없으면 DOM 행을 생략 (비element 3행)", () => {
    const rows = deriveReadonlyEnvRows({
      url: "https://example.com/page",
      viewport: { w: 1280, h: 800 },
      capturedAt: 1700000000000,
    });
    expect(rows.map((r) => r.label)).toEqual(["Page", "Viewport", "Captured"]);
  });

  it("selector가 null이어도 DOM 행을 생략", () => {
    const rows = deriveReadonlyEnvRows({
      url: "https://example.com/page",
      selector: null,
      viewport: { w: 1280, h: 800 },
      capturedAt: 1700000000000,
    });
    expect(rows.map((r) => r.label)).toEqual(["Page", "Viewport", "Captured"]);
  });

  it("viewport가 null이면 Viewport 행을 생략", () => {
    const rows = deriveReadonlyEnvRows({
      url: "https://example.com/page",
      selector: "div.card",
      viewport: null,
      capturedAt: 1700000000000,
    });
    expect(rows.map((r) => r.label)).toEqual(["Page", "DOM", "Captured"]);
  });

  it("url이 빈 문자열이면 Page value를 '-'로 대체", () => {
    const rows = deriveReadonlyEnvRows({ url: "" });
    expect(rows).toEqual([{ label: "Page", value: "-" }]);
  });

  it("freeform — url만 있으면 Page 한 행만 파생", () => {
    const rows = deriveReadonlyEnvRows({ url: "https://example.com/page" });
    expect(rows).toEqual([
      { label: "Page", value: "https://example.com/page" },
    ]);
  });

  it("capturedAt이 없으면 Captured 행을 생략", () => {
    const rows = deriveReadonlyEnvRows({
      url: "https://example.com/page",
      viewport: { w: 1280, h: 800 },
    });
    expect(rows.map((r) => r.label)).toEqual(["Page", "Viewport"]);
  });
});
