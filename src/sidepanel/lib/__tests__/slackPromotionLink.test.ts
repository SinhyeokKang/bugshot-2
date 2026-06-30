import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

import { parseSlackChannelId, postSlackPromotionReply } from "../slackPromotionLink";

describe("parseSlackChannelId", () => {
  it("표준 permalink에서 channel을 추출한다", () => {
    expect(
      parseSlackChannelId(
        "https://ws.slack.com/archives/C123ABC/p1700000000123456",
      ),
    ).toBe("C123ABC");
  });

  it("enterprise grid permalink에서도 channel을 추출한다", () => {
    expect(
      parseSlackChannelId(
        "https://ws.enterprise.slack.com/archives/C0AB/p1700000000123456",
      ),
    ).toBe("C0AB");
  });

  it("DM permalink의 channel(D…)도 무구분으로 추출한다", () => {
    expect(
      parseSlackChannelId(
        "https://ws.slack.com/archives/D123/p1700000000123456",
      ),
    ).toBe("D123");
  });

  it("archives 세그먼트가 없으면 null", () => {
    expect(parseSlackChannelId("https://ws.slack.com/foo")).toBeNull();
  });

  it("/client/ 포맷은 지원하지 않아 null", () => {
    expect(
      parseSlackChannelId(
        "https://app.slack.com/client/T1/C123/p1700000000123456",
      ),
    ).toBeNull();
  });

  it("channel 뒤 트레일링 세그먼트(/p…)가 없으면 null", () => {
    expect(parseSlackChannelId("https://ws.slack.com/archives/C123")).toBeNull();
  });

  it("빈 문자열이면 null", () => {
    expect(parseSlackChannelId("")).toBeNull();
  });
});

describe("postSlackPromotionReply", () => {
  beforeEach(() => {
    sendBg.mockReset();
  });

  it("유효 permalink면 slack.postMessage를 1회, 파싱된 payload로 호출한다", async () => {
    sendBg.mockResolvedValue({ ts: "999" });

    await postSlackPromotionReply({
      permalink: "https://ws.slack.com/archives/C123/p1700000000123456",
      ts: "1700000000.123456",
      text: "Filed as an issue in Jira.\nhttps://jira.test/browse/BUG-1",
    });

    expect(sendBg).toHaveBeenCalledTimes(1);
    expect(sendBg).toHaveBeenCalledWith({
      type: "slack.postMessage",
      payload: {
        channelId: "C123",
        text: "Filed as an issue in Jira.\nhttps://jira.test/browse/BUG-1",
        threadTs: "1700000000.123456",
      },
    });
  });

  it("channel 파싱 실패 permalink면 sendBg를 호출하지 않고 정상 resolve", async () => {
    await expect(
      postSlackPromotionReply({
        permalink: "https://app.slack.com/client/T1/C123/p1700000000123456",
        ts: "1700000000.123456",
        text: "Filed as an issue in Jira.\nhttps://jira.test/browse/BUG-1",
      }),
    ).resolves.toBeUndefined();

    expect(sendBg).not.toHaveBeenCalled();
  });

  it("sendBg가 reject해도 throw 없이 resolve한다 (best-effort)", async () => {
    sendBg.mockRejectedValue(new Error("not_in_channel"));

    await expect(
      postSlackPromotionReply({
        permalink: "https://ws.slack.com/archives/C123/p1700000000123456",
        ts: "1700000000.123456",
        text: "Filed as an issue in Jira.\nhttps://jira.test/browse/BUG-1",
      }),
    ).resolves.toBeUndefined();

    expect(sendBg).toHaveBeenCalledTimes(1);
  });
});
