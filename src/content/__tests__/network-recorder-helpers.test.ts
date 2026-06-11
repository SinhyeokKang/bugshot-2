import { describe, it, expect, vi } from "vitest";
import {
  classifyResponseBody,
  classifyBeaconBody,
  createPatchedFetch,
  maskBody,
  BODY_CAP,
} from "../network-recorder-helpers";

describe("classifyResponseBody", () => {
  it("이미지 contentType은 binary + size", () => {
    const out = classifyResponseBody({
      contentType: "image/png",
      contentLength: 12345,
    });
    expect(out).toEqual({ kind: "binary", contentType: "image/png", size: 12345 });
  });

  it("contentLength가 BODY_CAP 초과면 truncated + size + limit", () => {
    const out = classifyResponseBody({
      contentType: "application/json",
      contentLength: BODY_CAP + 100,
    });
    expect(out).toEqual({ kind: "truncated", limit: BODY_CAP, size: BODY_CAP + 100 });
  });

  it("text/plain은 read 대상 — null 반환(인라인 처리)", () => {
    expect(
      classifyResponseBody({ contentType: "text/plain", contentLength: 500 }),
    ).toBeNull();
  });

  it("application/json도 read 대상", () => {
    expect(
      classifyResponseBody({ contentType: "application/json", contentLength: 1000 }),
    ).toBeNull();
  });

  it("알 수 없는 contentType은 binary + 0 size", () => {
    const out = classifyResponseBody({
      contentType: "application/x-unknown",
      contentLength: NaN,
    });
    expect(out).toEqual({ kind: "binary", contentType: "application/x-unknown", size: 0 });
  });

  it("font도 binary", () => {
    expect(
      classifyResponseBody({ contentType: "font/woff2", contentLength: 5000 }),
    ).toEqual({ kind: "binary", contentType: "font/woff2", size: 5000 });
  });

  it("text/event-stream은 binary 처리 — 무한 스트림 본문을 read하지 않는다", () => {
    expect(
      classifyResponseBody({ contentType: "text/event-stream", contentLength: NaN }),
    ).toEqual({ kind: "binary", contentType: "text/event-stream", size: 0 });
  });

  it("charset 붙은 text/event-stream도 binary 처리", () => {
    expect(
      classifyResponseBody({ contentType: "text/event-stream; charset=utf-8", contentLength: NaN }),
    ).toEqual({ kind: "binary", contentType: "text/event-stream; charset=utf-8", size: 0 });
  });
});

describe("classifyBeaconBody", () => {
  it("문자열은 string 그대로 (cap 이하)", () => {
    const out = classifyBeaconBody("hello");
    expect(out.body).toBe("hello");
    expect(out.size).toBe(5);
    expect(out.contentType).toBe("");
  });

  it("Blob은 binary + size + contentType", () => {
    const blob = new Blob(["hi"], { type: "image/png" });
    const out = classifyBeaconBody(blob);
    expect(out.body).toEqual({ kind: "binary", contentType: "image/png", size: blob.size });
    expect(out.contentType).toBe("image/png");
  });

  it("URLSearchParams은 형식 보존된 문자열", () => {
    const params = new URLSearchParams({ a: "1", b: "2" });
    const out = classifyBeaconBody(params);
    expect(out.body).toBe("a=1&b=2");
    expect(out.contentType).toBe("application/x-www-form-urlencoded");
  });

  it("BODY_CAP 초과 문자열은 truncated + size + limit", () => {
    const big = "x".repeat(BODY_CAP + 10);
    const out = classifyBeaconBody(big);
    expect(out.body).toEqual({ kind: "truncated", limit: BODY_CAP, size: BODY_CAP + 10 });
  });
});

// 과거 회귀: 레코더 wrap이 input/init을 재구성해 페이지 요청(GitHub 업로드·SigV4 서명 등)을 깨뜨렸다.
// 이 describe는 "wrap이 페이지 요청을 절대 방해하지 않는다"는 4중 방어를 잠근다 — 리팩터 시 깨지면 즉시 fail.
describe("createPatchedFetch — 페이지 요청 무간섭 회귀 가드", () => {
  function okFetch(response = new Response("ok")) {
    return vi.fn(async function (this: unknown, _input: RequestInfo | URL, _init?: RequestInit) {
      return response;
    });
  }

  it("shouldRecord=false면 원본 input/init을 재구성 없이 그대로 전달", async () => {
    const original = okFetch();
    const record = vi.fn();
    const patched = createPatchedFetch(original, record, () => false);
    const input = "https://example.com/api";
    const init = { method: "POST", body: "payload" };
    await patched(input, init);
    expect(original.mock.calls[0][0]).toBe(input);
    expect(original.mock.calls[0][1]).toBe(init);
    expect(record).not.toHaveBeenCalled();
  });

  it("new Request 생성 실패 시 원본 input/init으로 폴백 (record 미호출)", async () => {
    const original = okFetch();
    const record = vi.fn(() => vi.fn());
    const patched = createPatchedFetch(original, record, () => true);
    const input = "https://example.com";
    const init = { method: "BAD METHOD" }; // 공백 포함 토큰 → Request 생성자 throw
    await patched(input, init);
    expect(original.mock.calls[0][0]).toBe(input);
    expect(original.mock.calls[0][1]).toBe(init);
    expect(record).not.toHaveBeenCalled();
  });

  it("shouldRecord=true면 new Request로 보내고 record 호출", async () => {
    const original = okFetch();
    const record = vi.fn(() => vi.fn());
    const patched = createPatchedFetch(original, record, () => true);
    await patched("https://example.com/api", { method: "GET" });
    expect(record).toHaveBeenCalledTimes(1);
    expect(original.mock.calls[0][0]).toBeInstanceOf(Request);
  });

  it("shouldRecord 미지정이면 항상 기록 경로", async () => {
    const original = okFetch();
    const record = vi.fn(() => vi.fn());
    const patched = createPatchedFetch(original, record);
    await patched("https://example.com");
    expect(record).toHaveBeenCalled();
  });

  it("응답 객체를 변형 없이 그대로 반환", async () => {
    const response = new Response("body");
    const patched = createPatchedFetch(okFetch(response), () => vi.fn(), () => true);
    expect(await patched("https://example.com")).toBe(response);
  });

  it("originalFetch reject를 그대로 throw하고 settle(error) 호출", async () => {
    const err = new Error("network down");
    const original = vi.fn(async () => {
      throw err;
    });
    const settle = vi.fn();
    const patched = createPatchedFetch(original, () => settle, () => true);
    await expect(patched("https://example.com")).rejects.toBe(err);
    expect(settle).toHaveBeenCalledWith({ error: err });
  });

  it("record가 throw해도 페이지로 전파되지 않고 응답 정상 반환", async () => {
    const response = new Response("ok");
    const record = vi.fn(() => {
      throw new Error("recorder boom");
    });
    const patched = createPatchedFetch(okFetch(response), record, () => true);
    expect(await patched("https://example.com")).toBe(response);
  });

  it("settle이 reject해도 응답에 영향 없음", async () => {
    const response = new Response("ok");
    const settle = vi.fn(() => Promise.reject(new Error("settle boom")));
    const patched = createPatchedFetch(okFetch(response), () => settle, () => true);
    expect(await patched("https://example.com")).toBe(response);
  });

  it("settle을 await하지 않는다 — 응답이 settle 완료 전에 반환", async () => {
    let settleDone = false;
    const settle = () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          settleDone = true;
          resolve();
        }, 30);
      });
    const patched = createPatchedFetch(okFetch(), () => settle, () => true);
    await patched("https://example.com");
    expect(settleDone).toBe(false);
  });

  it("this(호출 컨텍스트)를 원본 fetch로 전파", async () => {
    const ctx = { tag: "ctx" };
    let received: unknown;
    const original = vi.fn(async function (this: unknown) {
      received = this;
      return new Response();
    });
    const patched = createPatchedFetch(original, undefined, () => false);
    await patched.call(ctx, "https://example.com");
    expect(received).toBe(ctx);
  });
});

describe("maskBody — 본문 민감 키 마스킹 (요청·응답 공용)", () => {
  it("JSON 본문의 민감 키(access_token/password 등)를 ***로 치환한다", () => {
    const body = JSON.stringify({
      access_token: "secret-value",
      user: { password: "p@ss", name: "kim" },
      items: [{ token: "t1" }, { note: "ok" }],
    });

    const masked = JSON.parse(maskBody(body, "application/json"));

    expect(masked.access_token).toBe("***");
    expect(masked.user.password).toBe("***");
    expect(masked.user.name).toBe("kim");
    expect(masked.items[0].token).toBe("***");
    expect(masked.items[1].note).toBe("ok");
  });

  it("urlencoded 본문의 민감 키를 ***로 치환한다", () => {
    const masked = maskBody(
      "refresh_token=abc&plain=1",
      "application/x-www-form-urlencoded",
    );
    expect(masked).toContain("refresh_token=***");
    expect(masked).toContain("plain=1");
  });

  it("json/urlencoded 외 contentType과 비정상 JSON은 원문을 유지한다", () => {
    expect(maskBody("token=abc", "text/plain")).toBe("token=abc");
    expect(maskBody("{not json", "application/json")).toBe("{not json");
  });
});
