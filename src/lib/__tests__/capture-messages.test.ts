import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { captureOwnedTab } from "@/background/capture-throttle";
import {
  CAPTURE_NO_WINDOW_MESSAGE,
  SCROLL_CAPTURE_ABORTED_MESSAGE,
  SCROLL_TAB_INACTIVE_MESSAGE,
  captureInactiveMessage,
  isCaptureInactiveError,
  isCaptureRateLimitError,
} from "@/lib/capture-messages";

function rateLimitErr() {
  return new Error(
    "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.",
  );
}

describe("isCaptureRateLimitError", () => {
  it("captureVisibleTab 쿼터 메시지 → true", () => {
    expect(isCaptureRateLimitError(rateLimitErr())).toBe(true);
  });

  it("무관한 에러·문자열 → false", () => {
    expect(isCaptureRateLimitError(new Error("tab closed"))).toBe(false);
    expect(isCaptureRateLimitError("nope")).toBe(false);
  });
});

describe("isCaptureInactiveError", () => {
  it("관문(captureOwnedTab) 비활성 메시지 → true", () => {
    expect(isCaptureInactiveError(new Error(captureInactiveMessage(42)))).toBe(true);
  });

  it("스크롤 캡처 비활성 메시지 → true", () => {
    expect(isCaptureInactiveError(new Error(SCROLL_TAB_INACTIVE_MESSAGE))).toBe(true);
  });

  it("창 없음 메시지 → true", () => {
    expect(isCaptureInactiveError(new Error(CAPTURE_NO_WINDOW_MESSAGE))).toBe(true);
  });

  // sendBg는 background 에러를 message 문자열만 실어 새 Error로 만든다 — 문자열로도 판정돼야 한다.
  it("문자열 메시지도 판정한다", () => {
    expect(isCaptureInactiveError(captureInactiveMessage(7))).toBe(true);
  });

  it("무관한 에러·취소·rate limit → false", () => {
    expect(isCaptureInactiveError(new Error("No tab with id: 3."))).toBe(false);
    expect(isCaptureInactiveError(new Error(SCROLL_CAPTURE_ABORTED_MESSAGE))).toBe(false);
    expect(isCaptureInactiveError(rateLimitErr())).toBe(false);
    expect(isCaptureInactiveError(null)).toBe(false);
  });
});

// 술어가 상수만 보고 green이면, 관문이 다른 문구를 throw하도록 바뀌어도 아무도 모른다.
// 실제 throw 지점을 태워 메시지 계약을 고정한다.
describe("관문이 throw하는 메시지와 술어가 맞물린다", () => {
  const capture = async () => "data:image/png;base64,x";

  it("비활성 탭 → isCaptureInactiveError", async () => {
    const err = await captureOwnedTab(5, { format: "png" }, {
      getTab: async () => ({ active: false, windowId: 1 }),
      captureVisibleTab: capture,
    }).catch((e: unknown) => e);
    expect(isCaptureInactiveError(err)).toBe(true);
    expect((err as Error).message).toBe(captureInactiveMessage(5));
  });

  it("창 없음 → isCaptureInactiveError", async () => {
    const err = await captureOwnedTab(5, { format: "png" }, {
      getTab: async () => ({ active: true }),
      captureVisibleTab: capture,
    }).catch((e: unknown) => e);
    expect(isCaptureInactiveError(err)).toBe(true);
  });
});

// background SW·사이드패널이 함께 무는 leaf다. value import가 하나라도 생기면 한쪽 realm 그래프가
// 다른 쪽으로 새는데 typecheck·test는 green이다(session-keys의 "런타임 import 0"과 같은 형태).
describe("capture-messages.ts 런타임 import 0", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "capture-messages.ts"),
    "utf8",
  );

  it("소스를 실제로 읽었다 (앵커)", () => {
    expect(source).toMatch(/export function isCaptureInactiveError/);
  });

  it("value import가 없다", () => {
    const runtimeImports = [
      ...source.matchAll(/\bimport\s+(?!type\s)[\s\S]*?\bfrom\s*["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g),
      ...source.matchAll(/^\s*export\s+(?!type\s)[^;]*?\bfrom\s*["']([^"']+)["']/gm),
    ].map((m) => m[1]);
    expect(runtimeImports).toEqual([]);
  });
});
