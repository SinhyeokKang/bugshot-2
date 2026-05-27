import { describe, expect, it } from "vitest";
import { isActiveTabPermissionError } from "../capture-error";

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
