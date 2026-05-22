import { describe, it, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

import { filterEnvironmentRows, deriveReadonlyEnvRows, parseChromeVersion } from "../environmentRows";
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

describe("parseChromeVersion", () => {
  it("일반 Chrome UA → 'Chrome <version>' 형식 반환", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.85 Safari/537.36";
    expect(parseChromeVersion(ua)).toBe("Chrome 128.0.6613.85");
  });

  it("빈 문자열 → null", () => {
    expect(parseChromeVersion("")).toBeNull();
  });

  it("Chrome 토큰 없는 UA → null", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    expect(parseChromeVersion(ua)).toBeNull();
  });

  it("Edge UA (Chrome 토큰 포함) → Chrome 버전 정상 추출", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.85 Safari/537.36 Edg/128.0.2739.42";
    expect(parseChromeVersion(ua)).toBe("Chrome 128.0.6613.85");
  });

  it("HeadlessChrome UA → null", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.6613.85 Safari/537.36";
    expect(parseChromeVersion(ua)).toBeNull();
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

  it("browser가 있으면 첫 행이 Browser", () => {
    const rows = deriveReadonlyEnvRows({
      browser: "Chrome 128.0.6613.85",
      url: "https://example.com/page",
      selector: "div.card",
      viewport: { w: 1280, h: 800 },
    });
    expect(rows[0]).toEqual({ label: "Browser", value: "Chrome 128.0.6613.85" });
    expect(rows.map((r) => r.label)).toEqual(["Browser", "Page", "DOM", "Viewport"]);
  });

  it("browser가 null이면 Browser 행 없음", () => {
    const rows = deriveReadonlyEnvRows({
      browser: null,
      url: "https://example.com/page",
    });
    expect(rows.map((r) => r.label)).toEqual(["Page"]);
  });

  it("browser 미전달 시 기존 동작 유지", () => {
    const rows = deriveReadonlyEnvRows({
      url: "https://example.com/page",
      viewport: { w: 1280, h: 800 },
    });
    expect(rows.map((r) => r.label)).toEqual(["Page", "Viewport"]);
  });

  it("os가 있으면 첫 행이 OS", () => {
    const rows = deriveReadonlyEnvRows({
      os: "macOS 15.2",
      url: "https://example.com/page",
    });
    expect(rows[0]).toEqual({ label: "OS", value: "macOS 15.2" });
  });

  it("os + browser → OS가 Browser 앞", () => {
    const rows = deriveReadonlyEnvRows({
      os: "macOS 15.2",
      browser: "Chrome 128.0.6613.85",
      url: "https://example.com/page",
      selector: "div.card",
      viewport: { w: 1280, h: 800 },
    });
    expect(rows.map((r) => r.label)).toEqual(["OS", "Browser", "Page", "DOM", "Viewport"]);
  });

  it("os만 있고 browser 없으면 OS만 첫 행, Browser 행 없음", () => {
    const rows = deriveReadonlyEnvRows({
      os: "Windows 11",
      url: "https://example.com/page",
    });
    expect(rows[0]).toEqual({ label: "OS", value: "Windows 11" });
    expect(rows.map((r) => r.label)).not.toContain("Browser");
  });

  it("os null이면 OS 행 없음", () => {
    const rows = deriveReadonlyEnvRows({
      os: null,
      url: "https://example.com/page",
    });
    expect(rows.map((r) => r.label)).not.toContain("OS");
  });

  it("os 미전달 시 기존 동작 유지", () => {
    const rows = deriveReadonlyEnvRows({
      url: "https://example.com/page",
      selector: "div.card",
    });
    expect(rows.map((r) => r.label)).toEqual(["Page", "DOM"]);
  });
});
