import { describe, expect, it } from "vitest";
import {
  buildLinearAuthHeader,
  extractLinearErrors,
  messageForLinearStatus,
} from "../linear-api";

describe("buildLinearAuthHeader", () => {
  it("API Key는 키 그대로", () => {
    expect(
      buildLinearAuthHeader({
        kind: "apiKey",
        apiKey: "lin_api_xxx",
        viewerName: "u",
      }),
    ).toBe("lin_api_xxx");
  });

  it("OAuth는 'Bearer <accessToken>'", () => {
    expect(
      buildLinearAuthHeader({
        kind: "oauth",
        accessToken: "ATK",
        refreshToken: "RTK",
        expiresAt: 9999999999999,
        scope: "read,write",
        viewerName: "u",
        grantedAt: 1,
      }),
    ).toBe("Bearer ATK");
  });
});

describe("extractLinearErrors", () => {
  it("errors 배열의 message를 줄바꿈으로 합침", () => {
    expect(
      extractLinearErrors([
        { message: "Field 'teamId' is required" },
        { message: "Invalid input" },
      ]),
    ).toBe("Field 'teamId' is required\nInvalid input");
  });

  it("message가 없으면 fallback 메시지", () => {
    expect(extractLinearErrors([{}])).toBe("Unknown GraphQL error");
  });

  it("빈 배열이면 빈 문자열", () => {
    expect(extractLinearErrors([])).toBe("");
  });
});

describe("messageForLinearStatus", () => {
  it("주요 상태 코드별 비어있지 않은 메시지 반환", () => {
    expect(messageForLinearStatus(401)).toBeTruthy();
    expect(messageForLinearStatus(403)).toBeTruthy();
    expect(messageForLinearStatus(404)).toBeTruthy();
    expect(messageForLinearStatus(429)).toBeTruthy();
    expect(messageForLinearStatus(500)).toBeTruthy();
    expect(messageForLinearStatus(502)).toBeTruthy();
  });

  it("알려지지 않은 상태 코드는 generic 메시지에 코드 포함", () => {
    expect(messageForLinearStatus(418)).toContain("418");
  });
});
