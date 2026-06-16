import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsEnabled, buildCaptureBody, postCapture } from "../analytics";

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
