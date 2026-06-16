import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

import { submitEventProperties, trackSubmit } from "../track-submit";
import type { PlatformId } from "@/types/platform";

const PLATFORMS: PlatformId[] = [
  "jira",
  "github",
  "linear",
  "notion",
  "gitlab",
  "asana",
];

describe("submitEventProperties", () => {
  it("6개 platform 각각 그대로 매핑", () => {
    for (const p of PLATFORMS) {
      expect(submitEventProperties(p, "element", "success").platform).toBe(p);
    }
  });

  it("captureMode 4종 매핑", () => {
    expect(submitEventProperties("github", "element", "success").capture_mode).toBe(
      "element",
    );
    expect(submitEventProperties("github", "screenshot", "success").capture_mode).toBe(
      "screenshot",
    );
    expect(submitEventProperties("github", "video", "success").capture_mode).toBe(
      "video",
    );
    expect(submitEventProperties("github", "freeform", "success").capture_mode).toBe(
      "freeform",
    );
  });

  it("captureMode undefined면 'unknown'으로 방어", () => {
    expect(submitEventProperties("github", undefined, "success").capture_mode).toBe(
      "unknown",
    );
  });

  it("result가 그대로 실림", () => {
    expect(submitEventProperties("github", "element", "success").result).toBe("success");
    expect(submitEventProperties("github", "element", "failure").result).toBe("failure");
  });

  it("반환 키가 정확히 platform/capture_mode/result 3개 (식별 정보 없음)", () => {
    const out = submitEventProperties("github", "element", "success");
    expect(Object.keys(out).sort()).toEqual(["capture_mode", "platform", "result"]);
  });
});

describe("trackSubmit", () => {
  beforeEach(() => {
    sendBg.mockReset();
  });

  it("analytics.capture 메시지를 issue_submitted 이벤트로 전송", () => {
    sendBg.mockResolvedValue({ ok: true });
    trackSubmit("github", "element", "success");

    expect(sendBg).toHaveBeenCalledTimes(1);
    expect(sendBg).toHaveBeenCalledWith({
      type: "analytics.capture",
      event: "issue_submitted",
      properties: {
        platform: "github",
        capture_mode: "element",
        result: "success",
      },
    });
  });

  it("sendBg가 reject해도 동기적으로 throw하지 않음", () => {
    sendBg.mockRejectedValue(new Error("boom"));
    expect(() => trackSubmit("github", "element", "failure")).not.toThrow();
  });
});
