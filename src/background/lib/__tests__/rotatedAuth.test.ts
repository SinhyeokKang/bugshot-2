import { describe, it, expect } from "vitest";
import { pickRotatedAuth } from "../rotatedAuth";

describe("pickRotatedAuth — 회전 완료된 토큰 재사용", () => {
  it("저장분의 refresh token이 이미 갈렸으면 그걸 쓴다 (재요청 금지)", () => {
    const requested = { refreshToken: "RT1", accessToken: "AT1" };
    const stored = { refreshToken: "RT2", accessToken: "AT2" };
    expect(pickRotatedAuth(requested, stored)).toBe(stored);
  });

  it("같은 refresh token이면 null — 평소대로 refresh 진행", () => {
    const requested = { refreshToken: "RT1" };
    expect(pickRotatedAuth(requested, { refreshToken: "RT1" })).toBeNull();
  });

  it("저장분이 없거나 토큰이 비면 null (회귀 방향 안전)", () => {
    expect(pickRotatedAuth({ refreshToken: "RT1" }, null)).toBeNull();
    expect(pickRotatedAuth({ refreshToken: "RT1" }, undefined)).toBeNull();
    expect(pickRotatedAuth({ refreshToken: "RT1" }, { refreshToken: "" })).toBeNull();
  });

  it("요청 쪽 refresh token이 없으면 null (비교 불가)", () => {
    expect(pickRotatedAuth({ refreshToken: "" }, { refreshToken: "RT2" })).toBeNull();
  });
});
