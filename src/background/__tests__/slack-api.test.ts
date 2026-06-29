import { describe, expect, it, vi } from "vitest";

// messageForSlackError는 i18n t()로 사용자 메시지를 매핑한다 → 키를 그대로 돌려받게 mock.
vi.mock("@/i18n", () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    if (params) {
      let s = key;
      for (const [k, v] of Object.entries(params)) s += ` ${k}=${v}`;
      return s;
    }
    return key;
  },
  dateBcp47: () => "en-US",
}));

import {
  messageForSlackError,
  normalizeChannel,
  normalizeMember,
} from "../slack-api";

// Slack conversations 항목은 is_im/is_mpim/is_private 플래그로 종류가 갈린다.
describe("normalizeChannel — 종류 라벨링", () => {
  it("public 채널 → kind:public, name에 # 접두", () => {
    const out = normalizeChannel({
      id: "C1",
      name: "general",
      is_channel: true,
      is_private: false,
    });
    expect(out).toEqual({ id: "C1", name: "#general", kind: "public" });
  });

  it("private 채널 → kind:private, name에 # 접두", () => {
    const out = normalizeChannel({
      id: "C2",
      name: "secret",
      is_channel: true,
      is_private: true,
    });
    expect(out).toEqual({ id: "C2", name: "#secret", kind: "private" });
  });

  it("im(1:1 DM) → kind:im, 이름 미해석 시 user id 폴백", () => {
    const out = normalizeChannel({ id: "D1", is_im: true, user: "U9" });
    expect(out.kind).toBe("im");
    expect(out.id).toBe("D1");
    // 이름은 이후 users.list 맵으로 치환되며, 이 단계에선 user id 폴백.
    expect(out.name).toBe("U9");
  });

  it("mpim(그룹 DM) → kind:mpim", () => {
    const out = normalizeChannel({
      id: "G1",
      name: "mpdm-a--b--c-1",
      is_mpim: true,
    });
    expect(out.kind).toBe("mpim");
    expect(out.id).toBe("G1");
  });
});

describe("normalizeMember — 표시 이름·프로필 이미지", () => {
  it("display_name 우선, image_48 추출", () => {
    expect(
      normalizeMember({
        id: "U1",
        name: "uname",
        profile: { display_name: "Disp", real_name: "Real", image_48: "img48" },
      }),
    ).toEqual({ id: "U1", name: "Disp", image: "img48" });
  });

  it("display_name 없으면 real_name → name → id 폴백", () => {
    expect(normalizeMember({ id: "U2", profile: { real_name: "Real" } })?.name).toBe(
      "Real",
    );
    expect(normalizeMember({ id: "U3", name: "uname" })?.name).toBe("uname");
    expect(normalizeMember({ id: "U4" })?.name).toBe("U4");
  });

  it("image 없으면 undefined", () => {
    expect(normalizeMember({ id: "U5", name: "n" })?.image).toBeUndefined();
  });

  it("deleted·bot·USLACKBOT은 null", () => {
    expect(normalizeMember({ id: "U6", deleted: true })).toBeNull();
    expect(normalizeMember({ id: "U7", is_bot: true })).toBeNull();
    expect(normalizeMember({ id: "USLACKBOT" })).toBeNull();
  });
});

describe("messageForSlackError — 에러 코드 → i18n 키", () => {
  it("token_revoked → 재연결 안내", () => {
    expect(messageForSlackError("token_revoked")).toBe("slack.oauthRevoked");
  });

  it("not_in_channel → 전용 안내", () => {
    expect(messageForSlackError("not_in_channel")).toBe("slack.error.notInChannel");
  });

  it("channel_not_found → 전용 안내", () => {
    expect(messageForSlackError("channel_not_found")).toBe(
      "slack.error.channelNotFound",
    );
  });

  it("ratelimited → 전용 안내 (Slack 실제 에러 문자열은 언더스코어 없음)", () => {
    expect(messageForSlackError("ratelimited")).toBe("slack.error.rateLimited");
  });

  it("알 수 없는 코드 → generic + code 파라미터", () => {
    expect(messageForSlackError("weird_thing")).toBe(
      "slack.error.generic code=weird_thing",
    );
  });
});
