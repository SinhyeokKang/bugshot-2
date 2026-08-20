import { afterEach, describe, expect, it, vi } from "vitest";

import { mockFetchOnce, mockFetchRoutes, type MockFetch } from "@/test/fetch-mock";
import type { SlackAuth } from "@/types/slack";

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
  getMyself,
  getPermalink,
  listChannels,
  listMembers,
  messageForSlackError,
  normalizeChannel,
  normalizeMember,
  postMessage,
  uploadFiles,
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

// ---------------------------------------------------------------------------
// 아래는 `@/test/fetch-mock` 기반 fetch 경로 테스트다. 위쪽 순수 함수 describe들은
// 목이 필요 없으므로 restore() 대상이 아니고, 이 블록만 자기 afterEach로 목을 되돌린다.
// ---------------------------------------------------------------------------

const auth: SlackAuth = {
  kind: "oauth",
  accessToken: "xoxp-tok",
  grantedAt: 0,
  viewerId: "U1",
  viewerName: "me",
};

let mf: MockFetch | undefined;

afterEach(() => {
  mf?.restore();
  mf = undefined;
});

// slack 주 경로는 body가 URLSearchParams라 jsonBodyAt이 안내와 함께 throw한다 → init.body 직접.
function paramsAt(n: number): URLSearchParams {
  const body = mf?.callAt(n).init?.body;
  if (!(body instanceof URLSearchParams)) {
    throw new Error(`${n}번째 호출 body가 URLSearchParams가 아니다: ${String(body)}`);
  }
  return body;
}

// 커서 루프가 종료 조건을 잃으면 큐 마지막 값이 무한 반복돼 테스트가 타임아웃으로 죽는다.
// 마지막에 이걸 깔아두면 여분 호출이 SlackError로 즉시 reject → 타임아웃이 아니라 red.
const LOOP_GUARD = { body: { ok: false, error: "loop_guard" } };

describe("slackFetch 배선 (getMyself 경유)", () => {
  it("POST + form-urlencoded 인코딩으로 auth.test를 부르고 봉투를 매핑한다", async () => {
    mf = mockFetchOnce({
      body: { ok: true, user_id: "U9", user: "nine", team_id: "T1", team: "Acme" },
    });

    const me = await getMyself(auth);

    const call = mf.callAt(0);
    expect(call.url).toBe("https://slack.com/api/auth.test");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.headers).toEqual({
      Authorization: "Bearer xoxp-tok",
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    });
    expect(call.init?.body).toBeInstanceOf(URLSearchParams);
    expect(paramsAt(0).toString()).toBe("");
    expect(me).toEqual({ id: "U9", name: "nine", teamId: "T1", teamName: "Acme" });
  });

  it("HTTP 200 + {ok:false,error} → 그 code로 SlackError (status는 200)", async () => {
    mf = mockFetchOnce({ status: 200, body: { ok: false, error: "not_in_channel" } });

    const err = await getMyself(auth).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const se = err as { name: string; code: string; message: string; status: number; body: unknown };
    expect(se.name).toBe("SlackError");
    expect(se.code).toBe("not_in_channel");
    expect(se.message).toBe("slack.error.notInChannel");
    expect(se.status).toBe(200);
    expect(se.body).toEqual({ platform: "slack" });
  });

  it("HTTP 429 → json() 파싱 전에 ratelimited로 분기", async () => {
    // body가 Error면 json()이 reject한다 → 이 케이스가 통과하는 것 자체가 "json() 이전 분기" 증거.
    mf = mockFetchOnce({ status: 429, body: new Error("non-json body") });

    const err = (await getMyself(auth).catch((e: unknown) => e)) as {
      code: string;
      message: string;
      status: number;
    };

    expect(err.code).toBe("ratelimited");
    expect(err.message).toBe("slack.error.rateLimited");
    expect(err.status).toBe(429);
  });

  it("HTTP 500 → unknown_error + generic 메시지", async () => {
    mf = mockFetchOnce({ status: 500, body: new Error("boom") });

    const err = (await getMyself(auth).catch((e: unknown) => e)) as {
      code: string;
      message: string;
      status: number;
    };

    expect(err.code).toBe("unknown_error");
    expect(err.message).toBe("slack.error.generic code=unknown_error");
    expect(err.status).toBe(500);
  });
});

describe("listMembers", () => {
  it("users.list를 limit=200으로 부르고 첫 호출엔 cursor 키가 없다", async () => {
    mf = mockFetchOnce([{ body: { ok: true, members: [{ id: "U1", name: "one" }] } }, LOOP_GUARD]);

    await listMembers(auth);

    expect(mf.callAt(0).url).toBe("https://slack.com/api/users.list");
    expect(paramsAt(0).get("limit")).toBe("200");
    // undefined 파라미터는 form에 실리지 않는다(빈 문자열 cursor로 나가면 안 된다).
    expect(paramsAt(0).has("cursor")).toBe(false);
    expect(mf.fn.mock.calls.length).toBe(1);
  });

  it("커서를 따라 누적하고 bot·삭제·USLACKBOT은 제외한다", async () => {
    mf = mockFetchOnce([
      {
        body: {
          ok: true,
          members: [
            { id: "U1", name: "one" },
            { id: "UB", name: "bot", is_bot: true },
          ],
          response_metadata: { next_cursor: "cur2" },
        },
      },
      {
        body: {
          ok: true,
          members: [
            { id: "USLACKBOT" },
            { id: "UD", deleted: true },
            { id: "U2", profile: { display_name: "Two" } },
          ],
        },
      },
      LOOP_GUARD,
    ]);

    const members = await listMembers(auth);

    expect(mf.fn.mock.calls.length).toBe(2);
    expect(paramsAt(1).get("cursor")).toBe("cur2");
    expect(members).toEqual([
      { id: "U1", name: "one", image: undefined },
      { id: "U2", name: "Two", image: undefined },
    ]);
  }, 5000);
});

describe("listChannels — 필수 파라미터", () => {
  it("types·exclude_archived·limit을 실어 users.conversations를 부른다", async () => {
    mf = mockFetchOnce([{ body: { ok: true, channels: [] } }, LOOP_GUARD]);

    await listChannels(auth);

    expect(mf.callAt(0).url).toBe("https://slack.com/api/users.conversations");
    const p = paramsAt(0);
    expect(p.get("types")).toBe("public_channel,private_channel,im,mpim");
    // boolean은 문자열로 직렬화된다.
    expect(p.get("exclude_archived")).toBe("true");
    expect(p.get("limit")).toBe("200");
    expect(p.has("cursor")).toBe(false);
  });

  it("im이 없으면 users.list를 부르지 않는다 (N+1 회피)", async () => {
    mf = mockFetchOnce([
      { body: { ok: true, channels: [{ id: "C1", name: "general" }] } },
      LOOP_GUARD,
    ]);

    const channels = await listChannels(auth);

    expect(channels).toEqual([{ id: "C1", name: "#general", kind: "public" }]);
    expect(mf.fn.mock.calls.length).toBe(1);
  });
});

describe("listChannels — 커서 페이지네이션 종료 조건", () => {
  it("next_cursor가 빈 문자열이면 1회로 끝난다", async () => {
    mf = mockFetchOnce([
      {
        body: {
          ok: true,
          channels: [{ id: "C1", name: "general" }],
          response_metadata: { next_cursor: "" },
        },
      },
      LOOP_GUARD,
    ]);

    const channels = await listChannels(auth);

    expect(mf.fn.mock.calls.length).toBe(1);
    expect(channels).toEqual([{ id: "C1", name: "#general", kind: "public" }]);
  }, 5000);

  it("response_metadata 키 자체가 없으면 1회로 끝난다", async () => {
    mf = mockFetchOnce([
      { body: { ok: true, channels: [{ id: "C1", name: "general" }] } },
      LOOP_GUARD,
    ]);

    const channels = await listChannels(auth);

    expect(mf.fn.mock.calls.length).toBe(1);
    expect(channels).toEqual([{ id: "C1", name: "#general", kind: "public" }]);
  }, 5000);

  it("같은 커서가 다시 와도 조기 종료하지 않고 그 커서로 재요청한다", async () => {
    mf = mockFetchOnce([
      {
        body: {
          ok: true,
          channels: [{ id: "C1", name: "a" }],
          response_metadata: { next_cursor: "same" },
        },
      },
      {
        body: {
          ok: true,
          channels: [{ id: "C2", name: "b" }],
          response_metadata: { next_cursor: "same" },
        },
      },
      {
        body: {
          ok: true,
          channels: [{ id: "C3", name: "c" }],
          response_metadata: { next_cursor: "" },
        },
      },
      LOOP_GUARD,
    ]);

    const channels = await listChannels(auth);

    expect(mf.fn.mock.calls.length).toBe(3);
    expect(paramsAt(1).get("cursor")).toBe("same");
    expect(paramsAt(2).get("cursor")).toBe("same");
    expect(channels.map((c) => c.name)).toEqual(["#a", "#b", "#c"]);
  }, 5000);
});

describe("listChannels — im 이름·이미지 보강", () => {
  it("im이 있으면 users.list 1회로 id→이름·이미지를 치환한다", async () => {
    mf = mockFetchRoutes([
      {
        match: "users.conversations",
        // 라우트 큐는 고갈 후 마지막 값을 반복한다 → 커서 루프가 풀리면 무한 루프가 된다.
        // 뒤에 가드를 깔아 여분 호출이 즉시 reject되게 한다.
        respond: [
          {
            body: {
              ok: true,
              channels: [
                { id: "D1", is_im: true, user: "U9" },
                { id: "D2", is_im: true, user: "U404" },
                { id: "C1", name: "general" },
              ],
            },
          },
          LOOP_GUARD,
        ],
      },
      {
        match: "users.list",
        respond: [
          {
            body: {
              ok: true,
              members: [
                { id: "U9", name: "nine", profile: { display_name: "Nine", image_48: "img48" } },
              ],
            },
          },
          LOOP_GUARD,
        ],
      },
    ]);

    const channels = await listChannels(auth);

    expect(mf.fn.mock.calls.length).toBe(2);
    expect(channels).toEqual([
      { id: "D1", name: "Nine", kind: "im", imageUrl: "img48" },
      // 매핑에 없는 im은 user id 폴백을 유지한다.
      { id: "D2", name: "U404", kind: "im" },
      { id: "C1", name: "#general", kind: "public" },
    ]);
  }, 5000);
});

describe("postMessage", () => {
  it("channel·text·unfurl 억제를 싣고 ts를 반환한다", async () => {
    mf = mockFetchOnce({ body: { ok: true, ts: "1700000000.000100" } });

    const out = await postMessage(auth, { channelId: "C1", text: "*hi*" });

    expect(mf.callAt(0).url).toBe("https://slack.com/api/chat.postMessage");
    const p = paramsAt(0);
    expect(p.get("channel")).toBe("C1");
    expect(p.get("text")).toBe("*hi*");
    expect(p.get("unfurl_links")).toBe("false");
    expect(p.get("unfurl_media")).toBe("false");
    expect(p.has("thread_ts")).toBe(false);
    expect(out).toEqual({ ts: "1700000000.000100" });
  });

  it("threadTs가 있으면 thread_ts로 실린다", async () => {
    mf = mockFetchOnce({ body: { ok: true, ts: "2.2" } });

    await postMessage(auth, { channelId: "C1", text: "reply", threadTs: "1.1" });

    expect(paramsAt(0).get("thread_ts")).toBe("1.1");
  });

  it("{ok:false,error:channel_not_found} → 전용 메시지로 전파", async () => {
    mf = mockFetchOnce({ body: { ok: false, error: "channel_not_found" } });

    const err = (await postMessage(auth, { channelId: "CX", text: "x" }).catch(
      (e: unknown) => e,
    )) as { code: string; message: string };

    expect(err.code).toBe("channel_not_found");
    expect(err.message).toBe("slack.error.channelNotFound");
  });
});

describe("getPermalink", () => {
  it("channel·message_ts를 싣고 permalink를 뽑는다", async () => {
    mf = mockFetchOnce({ body: { ok: true, permalink: "https://acme.slack.com/archives/C1/p1" } });

    const link = await getPermalink(auth, "C1", "1700000000.000100");

    expect(mf.callAt(0).url).toBe("https://slack.com/api/chat.getPermalink");
    const p = paramsAt(0);
    expect(p.get("channel")).toBe("C1");
    expect(p.get("message_ts")).toBe("1700000000.000100");
    expect(link).toBe("https://acme.slack.com/archives/C1/p1");
  });
});

describe("uploadFiles — external upload 3단", () => {
  const file = () => ({ filename: "shot.png", blob: new Blob(["hello"]) });

  it("URL 발급 → 바이트 POST → complete 순으로 부르고 ok:true를 반환한다", async () => {
    mf = mockFetchRoutes([
      {
        match: "files.getUploadURLExternal",
        respond: { body: { ok: true, upload_url: "https://upload.example/u1", file_id: "F1" } },
      },
      { match: "https://upload.example/u1", respond: { body: "OK" } },
      { match: "files.completeUploadExternal", respond: { body: { ok: true } } },
    ]);

    const results = await uploadFiles(auth, "C1", "1.1", [file()]);

    expect(mf.fn.mock.calls.length).toBe(3);
    // 1단: 파일명 + 바이트 길이
    expect(paramsAt(0).get("filename")).toBe("shot.png");
    expect(paramsAt(0).get("length")).toBe("5");
    // 2단: multipart 바이트 POST
    expect(mf.callAt(1).url).toBe("https://upload.example/u1");
    expect(mf.callAt(1).init?.method).toBe("POST");
    expect(mf.formDataAt(1).get("file")).toBeInstanceOf(Blob);
    // 3단: file_id·title 배열 JSON + 채널·스레드
    const p = paramsAt(2);
    expect(p.get("files")).toBe('[{"id":"F1","title":"shot.png"}]');
    expect(p.get("channel_id")).toBe("C1");
    expect(p.get("thread_ts")).toBe("1.1");
    expect(results).toEqual([{ filename: "shot.png", ok: true }]);
  });

  it("바이트 POST가 실패하면 그 파일만 ok:false이고 complete를 안 부른다", async () => {
    mf = mockFetchRoutes([
      {
        match: "files.getUploadURLExternal",
        respond: { body: { ok: true, upload_url: "https://upload.example/u1", file_id: "F1" } },
      },
      { match: "https://upload.example/u1", respond: { status: 413 } },
      { match: "files.completeUploadExternal", respond: { body: { ok: true } } },
    ]);

    const results = await uploadFiles(auth, "C1", "1.1", [file()]);

    expect(results).toEqual([{ filename: "shot.png", ok: false }]);
    expect(mf.fn.mock.calls.length).toBe(2);
  });

  it("complete가 실패하면 성공했던 파일까지 전부 ok:false", async () => {
    mf = mockFetchRoutes([
      {
        match: "files.getUploadURLExternal",
        respond: { body: { ok: true, upload_url: "https://upload.example/u1", file_id: "F1" } },
      },
      { match: "https://upload.example/u1", respond: { body: "OK" } },
      {
        match: "files.completeUploadExternal",
        respond: { body: { ok: false, error: "not_in_channel" } },
      },
    ]);

    const results = await uploadFiles(auth, "C1", "1.1", [file()]);

    expect(results).toEqual([{ filename: "shot.png", ok: false }]);
  });

  it("일부 파일만 실패하면 성공분만 complete에 싣는다", async () => {
    mf = mockFetchRoutes([
      {
        match: "files.getUploadURLExternal",
        respond: [
          { body: { ok: false, error: "invalid_auth" } },
          { body: { ok: true, upload_url: "https://upload.example/u2", file_id: "F2" } },
        ],
      },
      { match: "https://upload.example/u2", respond: { body: "OK" } },
      { match: "files.completeUploadExternal", respond: { body: { ok: true } } },
    ]);

    const results = await uploadFiles(auth, "C1", "1.1", [
      { filename: "bad.png", blob: new Blob(["x"]) },
      { filename: "good.png", blob: new Blob(["yy"]) },
    ]);

    expect(results).toEqual([
      { filename: "bad.png", ok: false },
      { filename: "good.png", ok: true },
    ]);
    const last = mf.fn.mock.calls.length - 1;
    expect(paramsAt(last).get("files")).toBe('[{"id":"F2","title":"good.png"}]');
  });
});
