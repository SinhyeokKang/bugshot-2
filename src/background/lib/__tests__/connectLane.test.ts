import { describe, expect, it } from "vitest";

import { OAuthError } from "../../oauth/errors";
import { inConnectLane, inRefreshLane, tagRefreshFailure } from "../connectLane";

describe("inRefreshLane", () => {
  it("OAuthError에 refreshFailed를 세워 다시 던진다", async () => {
    const err = new OAuthError("refresh dead", { platform: "github" });

    await expect(
      inRefreshLane(() => Promise.reject(err)),
    ).rejects.toMatchObject({ refreshFailed: true, platform: "github" });
  });

  it("원본 에러를 변이하지 않는다", async () => {
    const err = new OAuthError("refresh dead", { platform: "github" });

    await inRefreshLane(() => Promise.reject(err)).catch(() => {});

    expect(err.refreshFailed).toBe(false);
  });

  it("OAuthError가 아니면 그대로 통과시킨다", async () => {
    const err = new Error("network down");
    await expect(inRefreshLane(() => Promise.reject(err))).rejects.toBe(err);
  });

  it("성공 경로는 값을 그대로 돌려준다", async () => {
    await expect(inRefreshLane(() => Promise.resolve(7))).resolves.toBe(7);
  });
});

describe("inConnectLane", () => {
  // 🔴 본체: 최초 연결 getMyself가 401을 받으면 runner가 refresh 레인으로 태깅해 던지는데,
  // 그대로 나가면 연동한 적 없는 사용자에게 "세션 만료" 배너가 뜬다.
  it("refresh 레인 태깅을 벗겨 최초 연결 실패로 되돌린다", async () => {
    const err = new OAuthError("profile 401", {
      platform: "linear",
      refreshFailed: true,
      reason: "profile_fetch_failed",
    });

    await expect(
      inConnectLane(() => Promise.reject(err)),
    ).rejects.toMatchObject({ refreshFailed: false, reason: "profile_fetch_failed" });
  });

  it("원본 에러를 변이하지 않는다", async () => {
    const err = new OAuthError("profile 401", { platform: "linear", refreshFailed: true });

    await inConnectLane(() => Promise.reject(err)).catch(() => {});

    expect(err.refreshFailed).toBe(true);
  });

  // 필드를 손으로 열거해 복사하면 축이 늘 때 값이 조용히 유실된다.
  it("platform·cancelled·reason 등 다른 필드를 보존한다", async () => {
    const err = new OAuthError("denied", {
      platform: "asana",
      refreshFailed: true,
      cancelled: true,
      reason: "cancelled_denied",
    });

    const thrown = await inConnectLane(() => Promise.reject(err)).catch((e) => e as OAuthError);

    expect(thrown).toBeInstanceOf(OAuthError);
    expect(thrown.platform).toBe("asana");
    expect(thrown.cancelled).toBe(true);
    expect(thrown.reason).toBe("cancelled_denied");
    expect(thrown.message).toBe("denied");
  });

  it("태깅이 없는 에러는 손대지 않는다", async () => {
    const err = new OAuthError("state mismatch", { platform: "github" });
    await expect(inConnectLane(() => Promise.reject(err))).rejects.toBe(err);
  });
});

describe("tagRefreshFailure", () => {
  it("이미 태깅된 에러는 그대로 돌려준다 (사본을 새로 만들지 않는다)", () => {
    const err = new OAuthError("x", { refreshFailed: true });
    expect(tagRefreshFailure(err)).toBe(err);
  });
});
