import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

import { submitEventProperties, trackDisconnect, trackSubmit } from "../track-submit";
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

  it("반환 키가 정확히 platform/capture_mode/result/replay_trimmed/trim_source 5개 (식별 정보 없음)", () => {
    const out = submitEventProperties("github", "element", "success");
    expect(Object.keys(out).sort()).toEqual([
      "capture_mode",
      "platform",
      "replay_trimmed",
      "result",
      "trim_source",
    ]);
  });

  // Jira 전용 차원. 프로젝트 키가 아니라 "기본값과 달랐나"만 나간다.
  it("projectOverridden을 넘기면 문자열 boolean 1개만 늘어난다 (프로젝트 키는 안 나간다)", () => {
    const out = submitEventProperties("jira", "element", "success", false, null, false);
    expect(out.project_overridden).toBe("false");
    expect(Object.keys(out).sort()).toEqual([
      "capture_mode",
      "platform",
      "project_overridden",
      "replay_trimmed",
      "result",
      "trim_source",
    ]);
  });

  it("projectOverridden을 안 넘기면 키 자체가 없다 (Jira 외 플랫폼)", () => {
    expect(submitEventProperties("github", "element", "success")).not.toHaveProperty(
      "project_overridden",
    );
  });

  it("replay_trimmed 플래그 — 기본 false, 전달 시 문자열 'true'", () => {
    expect(submitEventProperties("github", "video", "success").replay_trimmed).toBe("false");
    expect(submitEventProperties("github", "video", "success", true).replay_trimmed).toBe("true");
  });

  // replay_trimmed가 리플레이 전용에서 영상 전체로 넓어졌다 — 어느 경로가 잘랐는지 남긴다.
  it("trim_source — 미트림은 'none', 리플레이는 'frames', 녹화는 'recording'", () => {
    expect(submitEventProperties("github", "video", "success").trim_source).toBe("none");
    expect(submitEventProperties("github", "video", "success", true, "frames").trim_source).toBe(
      "frames",
    );
    expect(submitEventProperties("github", "video", "success", true, "recording").trim_source).toBe(
      "recording",
    );
  });
});

describe("trackSubmit", () => {
  beforeEach(() => {
    sendBg.mockReset();
  });

  // boolean|null 위치 인자가 3연속이라 순서가 어긋나도 타입이 못 잡는다. 중계 구간에
  // 그물이 없으면 관측치가 통째로 뒤집혀도 전 스위트가 green이다.
  it("Jira 전용 boolean 축 3개를 순서 그대로 중계한다", () => {
    sendBg.mockResolvedValue({ ok: true });
    trackSubmit("jira", "screenshot", "success", false, null, true, false, true);

    const props = (sendBg.mock.calls[0][0] as { properties: Record<string, string> })
      .properties;
    expect(props.project_overridden).toBe("true");
    expect(props.sprint_field_shown).toBe("false");
    expect(props.sprint_selected).toBe("true");
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
        replay_trimmed: "false",
        trim_source: "none",
      },
    });
  });

  it("sendBg가 reject해도 동기적으로 throw하지 않음", () => {
    sendBg.mockRejectedValue(new Error("boom"));
    expect(() => trackSubmit("github", "element", "failure")).not.toThrow();
  });
});

describe("trackDisconnect", () => {
  beforeEach(() => {
    sendBg.mockReset();
  });

  it("analytics.capture 메시지를 platform_disconnected 이벤트로 전송", () => {
    sendBg.mockResolvedValue({ ok: true });
    trackDisconnect("notion");

    expect(sendBg).toHaveBeenCalledTimes(1);
    expect(sendBg).toHaveBeenCalledWith({
      type: "analytics.capture",
      event: "platform_disconnected",
      properties: { platform: "notion" },
    });
  });

  it("sendBg가 reject해도 동기적으로 throw하지 않음", () => {
    sendBg.mockRejectedValue(new Error("boom"));
    expect(() => trackDisconnect("jira")).not.toThrow();
  });
});
