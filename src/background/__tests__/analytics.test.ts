import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsEnabled, buildCaptureBody, postCapture, resolveInstallationId, isAllowedEvent, filterProperties, resolvePostHogHost } from "../analytics";
import { submitEventProperties } from "@/sidepanel/lib/track-submit";

// env가 비었을 때 어디로 나가느냐가 privacy 문서의 단언(`in.bug-shot.com`으로만 나간다)과
// 직결된다 — 폴백이 PostHog Cloud 직행이면 문서가 거짓이 되므로 기본값을 못으로 박는다.
describe("resolvePostHogHost", () => {
  it("env 값이 있으면 그걸 쓴다", () => {
    expect(resolvePostHogHost("https://in.example.com")).toBe("https://in.example.com");
  });

  it("후행 슬래시를 지운다", () => {
    expect(resolvePostHogHost("https://in.example.com///")).toBe("https://in.example.com");
  });

  it("앞뒤 공백을 지운다", () => {
    expect(resolvePostHogHost("  https://in.example.com  ")).toBe("https://in.example.com");
  });

  it("undefined면 BugShot 프록시로 폴백한다 (PostHog Cloud 직행 금지)", () => {
    expect(resolvePostHogHost(undefined)).toBe("https://in.bug-shot.com");
  });

  it("빈 문자열·공백만이어도 같은 폴백", () => {
    expect(resolvePostHogHost("")).toBe("https://in.bug-shot.com");
    expect(resolvePostHogHost("   ")).toBe("https://in.bug-shot.com");
  });
});

describe("analyticsEnabled", () => {
  it("키가 있으면 true", () => {
    expect(analyticsEnabled("phc_x")).toBe(true);
  });

  it("빈 문자열이면 false", () => {
    expect(analyticsEnabled("")).toBe(false);
  });

  it("공백만 있으면 false", () => {
    expect(analyticsEnabled("   ")).toBe(false);
  });

  it("undefined면 false", () => {
    expect(analyticsEnabled(undefined)).toBe(false);
  });
});

describe("buildCaptureBody", () => {
  const props = { platform: "github", capture_mode: "element", result: "success" };

  it("api_key/event/distinct_id가 인자값 그대로", () => {
    const body = buildCaptureBody("issue_submitted", props, "uuid-1", "phc_key");
    expect(body.api_key).toBe("phc_key");
    expect(body.event).toBe("issue_submitted");
    expect(body.distinct_id).toBe("uuid-1");
  });

  it("익명화 properties가 병합됨", () => {
    const body = buildCaptureBody("issue_submitted", props, "uuid-1", "phc_key");
    expect(body.properties.$process_person_profile).toBe(false);
    expect(body.properties.$ip).toBe("0.0.0.0");
    expect(body.properties.$geoip_disable).toBe(true);
  });

  it("입력 properties가 손실 없이 병합됨", () => {
    const body = buildCaptureBody("issue_submitted", props, "uuid-1", "phc_key");
    expect(body.properties.platform).toBe("github");
    expect(body.properties.capture_mode).toBe("element");
    expect(body.properties.result).toBe("success");
  });

  it("빈 properties여도 익명화 키는 존재", () => {
    const body = buildCaptureBody("issue_submitted", {}, "uuid-1", "phc_key");
    expect(body.properties.$process_person_profile).toBe(false);
    expect(body.properties.$ip).toBe("0.0.0.0");
    expect(body.properties.$geoip_disable).toBe(true);
  });
});

// A-21: analytics.capture는 사이드패널에서 임의 문자열을 받는다. 현재 호출자 4곳이 깨끗해도
// 런타임 방어가 0이면 Privacy 코어밸류의 유일한 무방비 지점이 된다.
describe("허용목록", () => {
  it("현재 호출자 5종 event를 전부 허용한다", () => {
    for (const e of [
      "issue_submitted",
      "platform_connect",
      "platform_disconnected",
      "extension_installed",
      "sidepanel_opened",
    ]) {
      expect(isAllowedEvent(e)).toBe(true);
    }
  });

  it("목록 밖 event는 거부한다", () => {
    expect(isAllowedEvent("page_url")).toBe(false);
    expect(isAllowedEvent("")).toBe(false);
    // 프로토타입 오염 경유 우회 차단.
    expect(isAllowedEvent("toString")).toBe(false);
    expect(isAllowedEvent("constructor")).toBe(false);
  });

  it("허용 property는 그대로 통과한다", () => {
    expect(
      filterProperties("issue_submitted", {
        platform: "jira",
        capture_mode: "video",
        result: "success",
        replay_trimmed: "false",
      }),
    ).toEqual({
      platform: "jira",
      capture_mode: "video",
      result: "success",
      replay_trimmed: "false",
    });
  });

  // 허용목록은 사이드패널 송신부와 손으로 맞춘 계약이다 — 한쪽만 늘리면 새 차원이 조용히
  // 드롭돼 지표가 무용지물이 된다(trim_source가 실제로 그렇게 새어나갔다).
  it("issue_submitted 허용목록이 track-submit 송신 키와 일치한다", () => {
    const sent = submitEventProperties("github", "video", "success", true, "recording");
    expect(filterProperties("issue_submitted", sent)).toEqual(sent);
  });

  // Jira 전용 차원이라 기본 인자 경로에는 키 자체가 없다 — 그 경로만 대조하면 허용목록의
  // 오타를 못 잡는다(위 케이스가 이 차원에 대해선 그물이 아니다).
  it("issue_submitted 허용목록이 project_overridden까지 통과시킨다", () => {
    const sent = submitEventProperties("jira", "video", "success", false, null, true);
    expect(sent.project_overridden).toBe("true");
    expect(filterProperties("issue_submitted", sent)).toEqual(sent);
  });

  // 스프린트 목록 조회 실패를 전부 삼키기로 했으므로(R6) 사후 관측은 이 두 축뿐이다 —
  // 허용목록 등록이 빠지면 filterProperties가 무음 폐기해 관측 수단이 통째로 사라진다.
  it("issue_submitted 허용목록이 sprint 축 2개를 통과시킨다", () => {
    const sent = submitEventProperties(
      "jira",
      "screenshot",
      "success",
      false,
      null,
      false,
      true,
      true,
    );
    expect(sent.sprint_field_shown).toBe("true");
    expect(sent.sprint_selected).toBe("true");
    expect(filterProperties("issue_submitted", sent)).toEqual(sent);
  });

  // 행은 보였는데 안 고른 조합이 표현돼야 한다 — 한 축으로 합치면 이 구간이 사라진다.
  it("sprint 축 2개는 서로 독립이다", () => {
    const sent = submitEventProperties(
      "jira",
      "screenshot",
      "success",
      false,
      null,
      false,
      true,
      false,
    );
    expect(sent.sprint_field_shown).toBe("true");
    expect(sent.sprint_selected).toBe("false");
  });

  it("Jira 외 플랫폼에는 sprint 축이 실리지 않는다", () => {
    const sent = submitEventProperties("github", "screenshot", "success");
    expect(sent).not.toHaveProperty("sprint_field_shown");
    expect(sent).not.toHaveProperty("sprint_selected");
  });

  it("목록 밖 property는 payload에서 빠진다", () => {
    expect(
      filterProperties("platform_disconnected", {
        platform: "github",
        page_url: "https://secret.internal/orders?token=abc",
        email: "a@b.c",
      }),
    ).toEqual({ platform: "github" });
  });

  it("허용목록 밖 property만 준 경우 빈 객체", () => {
    expect(filterProperties("sidepanel_opened", { anything: "x" })).toEqual({});
  });

  // sidepanel_opened는 미지원 페이지에서도 발화하게 됐다(패널이 열리므로). property가 없으면
  // 배포 후 지표 상승이 "미지원 페이지 오픈으로 인한 기계적 증가"인지 "실제 activation 회복"인지
  // 가를 수 없다 — 허용목록에 page_supported가 없으면 emit이 조용히 무효화되므로 여기서 잠근다.
  it("sidepanel_opened의 page_supported가 통과한다", () => {
    expect(filterProperties("sidepanel_opened", { page_supported: "true" })).toEqual({
      page_supported: "true",
    });
    expect(filterProperties("sidepanel_opened", { page_supported: "false" })).toEqual({
      page_supported: "false",
    });
  });

  it("page_supported와 함께 온 목록 밖 property는 여전히 빠진다", () => {
    expect(
      filterProperties("sidepanel_opened", {
        page_supported: "false",
        page_url: "chrome://settings",
      }),
    ).toEqual({ page_supported: "false" });
  });

  // 허용목록에 reason이 없으면 trackConnect가 실어 보내도 payload에서 조용히 빠져
  // "사유를 붙였는데 대시보드엔 안 보이는" 상태가 된다(trim_source 전례).
  it("platform_connect의 reason이 통과한다", () => {
    expect(
      filterProperties("platform_connect", {
        platform: "github",
        result: "failed",
        reason: "token_exchange_5xx",
      }),
    ).toEqual({ platform: "github", result: "failed", reason: "token_exchange_5xx" });
  });

  // reason은 고정 enum만 싣는 계약이지만 허용목록은 값을 검사하지 않는다 — 상류 응답
  // 원문이 끼어들 수 있는 인접 키를 전부 막아두는 게 Privacy 방어선이다.
  it("reason과 함께 온 상류 응답 원문 키는 전부 드롭된다", () => {
    expect(
      filterProperties("platform_connect", {
        platform: "slack",
        result: "failed",
        reason: "token_exchange_4xx",
        error_description: "invalid_grant: code was already redeemed",
        status_text: "{\"error\":\"bad_verification_code\"}",
        message: "token exchange failed (401)",
      }),
    ).toEqual({ platform: "slack", result: "failed", reason: "token_exchange_4xx" });
  });

  it("reason은 platform_connect 전용 — 다른 event엔 통과하지 않는다", () => {
    expect(
      filterProperties("platform_disconnected", { platform: "github", reason: "network" }),
    ).toEqual({ platform: "github" });
  });

  it("page_supported는 sidepanel_opened 전용 — 다른 event엔 통과하지 않는다", () => {
    expect(
      filterProperties("platform_disconnected", { platform: "github", page_supported: "true" }),
    ).toEqual({ platform: "github" });
  });

  it("목록 밖 event의 property는 통째로 드롭", () => {
    expect(filterProperties("unknown_event", { platform: "jira" })).toEqual({});
  });
});

describe("postCapture", () => {
  const originalFetch = globalThis.fetch;
  const body = {
    api_key: "phc_key",
    event: "issue_submitted",
    distinct_id: "uuid-1",
    properties: { result: "success", $ip: "" },
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("host+'/capture/'로 직렬화된 body를 POST", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    globalThis.fetch = fetchMock;

    await postCapture("https://us.i.posthog.com", body);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.i.posthog.com/capture/");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(init.body).toBe(JSON.stringify(body));
    expect(init.keepalive).toBe(true);
  });

  it("fetch가 reject해도 throw하지 않음", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(postCapture("https://us.i.posthog.com", body)).resolves.toBeUndefined();
  });

  it("non-ok 응답이어도 throw하지 않음", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 400 }) as Response);
    await expect(postCapture("https://us.i.posthog.com", body)).resolves.toBeUndefined();
  });
});

describe("resolveInstallationId", () => {
  it("저장된 유효 ID가 있으면 그대로 쓰고 생성 안 함", () => {
    const generate = vi.fn(() => "new-uuid");
    const { id, created } = resolveInstallationId("stored-uuid", generate);
    expect(id).toBe("stored-uuid");
    expect(created).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it("저장값이 undefined면 새로 생성", () => {
    const generate = vi.fn(() => "new-uuid");
    const { id, created } = resolveInstallationId(undefined, generate);
    expect(id).toBe("new-uuid");
    expect(created).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("저장값이 빈 문자열이면 무효로 보고 새로 생성", () => {
    const generate = vi.fn(() => "new-uuid");
    const { id, created } = resolveInstallationId("", generate);
    expect(id).toBe("new-uuid");
    expect(created).toBe(true);
  });
});
