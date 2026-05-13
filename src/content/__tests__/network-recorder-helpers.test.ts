import { describe, it, expect } from "vitest";
import {
  classifyResponseBody,
  classifyBeaconBody,
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
