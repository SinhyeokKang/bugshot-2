import { describe, expect, it } from "vitest";
import { initialSlackFields } from "../SlackIssueFields";

const last = {
  channelId: "C_LAST",
  channelName: "last-channel",
  mentions: [{ id: "U1", name: "alice" }],
};

describe("initialSlackFields", () => {
  it("기본 채널이 없으면 직전 제출 채널·멘션을 복원한다", () => {
    expect(initialSlackFields(last, undefined)).toEqual({
      channelId: "C_LAST",
      channelName: "last-channel",
      mentions: last.mentions,
    });
  });

  it("기본 채널이 직전 채널과 달라도 직전 채널·멘션을 우선 복원한다", () => {
    const defaults = { channelId: "C_DEFAULT", channelName: "default-channel" };
    expect(initialSlackFields(last, defaults)).toEqual({
      channelId: "C_LAST",
      channelName: "last-channel",
      mentions: last.mentions,
    });
  });

  it("직전 제출이 없으면 기본 채널을 쓰고 멘션은 비운다", () => {
    const defaults = { channelId: "C_DEFAULT", channelName: "default-channel" };
    expect(initialSlackFields(undefined, defaults)).toEqual({
      channelId: "C_DEFAULT",
      channelName: "default-channel",
      mentions: undefined,
    });
  });

  it("직전·기본 모두 없으면 전부 비운다", () => {
    expect(initialSlackFields(undefined, undefined)).toEqual({
      channelId: undefined,
      channelName: undefined,
      mentions: undefined,
    });
  });

  it("직전 채널과 기본 채널이 같으면 멘션을 복원한다", () => {
    const defaults = { channelId: "C_LAST", channelName: "last-channel" };
    expect(initialSlackFields(last, defaults)).toEqual({
      channelId: "C_LAST",
      channelName: "last-channel",
      mentions: last.mentions,
    });
  });
});
