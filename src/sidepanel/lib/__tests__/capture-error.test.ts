import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { issue } from "@/i18n/namespaces/issue";
import { onCaptureFailed, type CaptureFailureKind } from "@/lib/app-events";
import {
  CAPTURE_NO_WINDOW_MESSAGE,
  SCROLL_CAPTURE_ABORTED_MESSAGE,
  SCROLL_TAB_INACTIVE_MESSAGE,
  captureInactiveMessage,
} from "@/lib/capture-messages";
import {
  CAPTURE_FAILURE_KEYS,
  classifyCaptureFailure,
  emitCaptureFailure,
  fireCaptureFailure,
  isActiveTabExpiryDeferred,
  isActiveTabPermissionError,
  setActiveTabExpiryDeferred,
} from "../capture-error";

describe("isActiveTabPermissionError", () => {
  it("captureVisibleTab 권한 거부 메시지 → true", () => {
    const err = new Error(
      "Either the '<all_urls>' or 'activeTab' permission is required.",
    );
    expect(isActiveTabPermissionError(err)).toBe(true);
  });

  it("tabCapture 미호출 메시지 → true", () => {
    expect(
      isActiveTabPermissionError(
        new Error("The extension has not been invoked for the current page"),
      ),
    ).toBe(true);
  });

  it("문자열 에러도 처리 → true", () => {
    expect(
      isActiveTabPermissionError(
        "Either the '<all_urls>' or 'activeTab' permission is required.",
      ),
    ).toBe(true);
  });

  it("무관한 에러 → false", () => {
    expect(isActiveTabPermissionError(new Error("canvas context failed"))).toBe(
      false,
    );
  });

  it("null/undefined → false", () => {
    expect(isActiveTabPermissionError(null)).toBe(false);
    expect(isActiveTabPermissionError(undefined)).toBe(false);
  });
});

describe("classifyCaptureFailure", () => {
  it("관문 비활성 메시지 → inactive", () => {
    expect(classifyCaptureFailure(new Error(captureInactiveMessage(9)))).toBe("inactive");
  });

  it("스크롤 캡처 비활성 메시지 → inactive", () => {
    expect(classifyCaptureFailure(new Error(SCROLL_TAB_INACTIVE_MESSAGE))).toBe("inactive");
  });

  it("창 없음 → inactive", () => {
    expect(classifyCaptureFailure(new Error(CAPTURE_NO_WINDOW_MESSAGE))).toBe("inactive");
  });

  it("쿼터 재시도 소진 → rate-limit", () => {
    expect(
      classifyCaptureFailure(
        new Error("This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota."),
      ),
    ).toBe("rate-limit");
  });

  // 권한 만료는 기존 다이얼로그가 맡는다 — 토스트까지 뜨면 한 실패에 알림이 둘이다.
  it("activeTab 만료 → null", () => {
    expect(
      classifyCaptureFailure(
        new Error("Either the '<all_urls>' or 'activeTab' permission is required."),
      ),
    ).toBeNull();
  });

  it("사용자 취소 → null", () => {
    expect(classifyCaptureFailure(new Error(SCROLL_CAPTURE_ABORTED_MESSAGE))).toBeNull();
  });

  it("임의 Error → other", () => {
    expect(classifyCaptureFailure(new Error("No tab with id: 3."))).toBe("other");
  });

  it("비 Error 값 → other", () => {
    expect(classifyCaptureFailure(undefined)).toBe("other");
    expect(classifyCaptureFailure({ code: 1 })).toBe("other");
  });
});

describe("CAPTURE_FAILURE_KEYS", () => {
  it("4분류 전부 등록된 i18n 키를 가리킨다", () => {
    const kinds: CaptureFailureKind[] = ["inactive", "rate-limit", "element-missing", "other"];
    for (const kind of kinds) {
      const key = CAPTURE_FAILURE_KEYS[kind];
      expect(key, kind).toMatch(/^issue\.captureFailed\./);
      expect(issue.ko[key as keyof typeof issue.ko], kind).toBeTruthy();
      expect(issue.en[key as keyof typeof issue.en], kind).toBeTruthy();
    }
  });

  it("분류마다 다른 문구다", () => {
    expect(new Set(Object.values(CAPTURE_FAILURE_KEYS)).size).toBe(4);
  });
});

describe("fireCaptureFailure / emitCaptureFailure", () => {
  const spy = vi.fn();
  let off: () => void = () => {};

  beforeEach(() => {
    spy.mockReset();
    off = onCaptureFailed.subscribe(spy);
    setActiveTabExpiryDeferred(false);
  });

  afterEach(() => {
    off();
    setActiveTabExpiryDeferred(false);
  });

  it("분류가 있으면 그 kind로 1회 발화한다", () => {
    fireCaptureFailure(new Error(captureInactiveMessage(1)));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("inactive");
  });

  it("분류가 null(취소)이면 발화하지 않는다", () => {
    fireCaptureFailure(new Error(SCROLL_CAPTURE_ABORTED_MESSAGE));
    expect(spy).not.toHaveBeenCalled();
  });

  it("분류가 null(권한 만료)이면 발화하지 않는다", () => {
    fireCaptureFailure(new Error("The extension has not been invoked for the current page"));
    expect(spy).not.toHaveBeenCalled();
  });

  // 지연 권한 만료가 걸려 있으면 idle 복귀 때 다이얼로그가 뜬다 — 그 사이 실패를 토스트하면 중복이다.
  it("지연 권한 만료 플래그가 켜져 있으면 어떤 분류도 발화하지 않는다", () => {
    setActiveTabExpiryDeferred(true);
    fireCaptureFailure(new Error("boom"));
    emitCaptureFailure("element-missing");
    expect(spy).not.toHaveBeenCalled();
  });

  it("emitCaptureFailure는 플래그가 꺼져 있으면 kind 그대로 1회 발화한다", () => {
    emitCaptureFailure("element-missing");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("element-missing");
  });

  it("플래그 접근자가 상태를 그대로 돌려준다", () => {
    expect(isActiveTabExpiryDeferred()).toBe(false);
    setActiveTabExpiryDeferred(true);
    expect(isActiveTabExpiryDeferred()).toBe(true);
  });
});
