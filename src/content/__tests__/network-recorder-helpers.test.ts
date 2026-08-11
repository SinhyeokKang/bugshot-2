import { afterEach, describe, it, expect, vi } from "vitest";
import {
  estimateBodySize,
  findOldestBodyIndex,
  reclaimableSize,
  classifyResponseBody,
  classifyBeaconBody,
  createPatchedFetch,
  maskBody,
  maskUrl,
  classifyWsFrameData,
  maskWsFrame,
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

  it("비밀번호 변경·자격증명 계열 body 전용 키를 마스킹한다", () => {
    const masked = JSON.parse(
      maskBody(
        '{"currentPassword":"a","newPassword":"b"}',
        "application/json",
      ),
    );
    expect(masked.currentPassword).toBe("***");
    expect(masked.newPassword).toBe("***");
  });

  it("추가된 body 전용 키 전수 — client_secret·otp·private_key 등", () => {
    const keys = [
      "client_secret", "newpassword", "new_password", "currentpassword",
      "current_password", "oldpassword", "old_password", "session_token",
      "sessiontoken", "refreshtoken", "accesstoken", "idtoken", "credential",
      "private_key", "privatekey", "passwd", "otp",
    ];
    const masked = JSON.parse(
      maskBody(JSON.stringify(Object.fromEntries(keys.map((k) => [k, "v"]))), "application/json"),
    );
    for (const k of keys) expect(masked[k]).toBe("***");
  });

  it("본문이 {·[로 시작하면 contentType 무관 JSON으로 파싱해 마스킹한다", () => {
    expect(maskBody('{"password":"p","q":1}', "text/plain")).toBe(
      '{"password":"***","q":1}',
    );
    expect(maskBody('[{"token":"t"}]', "")).toBe('[{"token":"***"}]');
  });

  it("{·[로 시작해도 JSON 파싱에 실패하면 원문을 그대로 둔다", () => {
    expect(maskBody("{not json", "text/plain")).toBe("{not json");
    expect(maskBody("[1,2", "")).toBe("[1,2");
    expect(maskBody("{{mustache}}", "text/html")).toBe("{{mustache}}");
  });
});

// 마스킹 강화는 항상 오탐 쪽도 같이 고정한다 (POSTMORTEM 2026-07-14).
describe("maskBody — 부분일치 오탐 방지 (exact-match 유지)", () => {
  it("code 계열은 body에서 마스킹하지 않는다 — query 전용 키", () => {
    const masked = JSON.parse(
      maskBody(
        '{"code":"E401","error_code":"429","status_code":500,"zipcode":"06236"}',
        "application/json",
      ),
    );
    expect(masked.code).toBe("E401");
    expect(masked.error_code).toBe("429");
    expect(masked.status_code).toBe(500);
    expect(masked.zipcode).toBe("06236");
  });

  it("민감 키를 부분 문자열로 포함하는 일반 키는 마스킹하지 않는다", () => {
    const masked = JSON.parse(
      maskBody(
        '{"author":"kim","keyword":"bug","secretary":"lee","shipping":"KR","tokenizer":"bpe","credentials":["a"],"password_hint_shown":true}',
        "application/json",
      ),
    );
    expect(masked.author).toBe("kim"); // auth ⊂ author
    expect(masked.keyword).toBe("bug"); // key ⊂ keyword
    expect(masked.secretary).toBe("lee"); // secret ⊂ secretary
    expect(masked.shipping).toBe("KR"); // pin ⊂ shipping
    expect(masked.tokenizer).toBe("bpe"); // token ⊂ tokenizer
    expect(masked.credentials).toEqual(["a"]); // credential ⊂ credentials
    expect(masked.password_hint_shown).toBe(true);
  });

  it("urlencoded 본문에서도 오탐이 없다", () => {
    expect(maskBody("error_code=429&author=kim", "application/x-www-form-urlencoded")).toBe(
      "error_code=429&author=kim",
    );
  });
});

// MAIN world 레코더는 페이지와 같은 realm이라 페이지가 내장을 갈아끼울 수 있다.
// maskBody가 호출 시점의 전역을 쓰면 마스킹이 무음으로 무력화돼 원문이 이슈 본문·LLM으로 샌다.
describe("maskBody — 전역 오염 내성 (document_start 스냅샷)", () => {
  const realParse = JSON.parse;
  const realStringify = JSON.stringify;
  const realURLSearchParams = globalThis.URLSearchParams;

  afterEach(() => {
    JSON.parse = realParse;
    JSON.stringify = realStringify;
    globalThis.URLSearchParams = realURLSearchParams;
  });

  // 오염 상태에서 expect를 돌리면 실패 리포트 자체가 깨질 수 있어 호출만 오염 구간에 둔다.
  function whilePolluted<T>(pollute: () => void, run: () => T): T {
    pollute();
    try {
      return run();
    } finally {
      JSON.parse = realParse;
      JSON.stringify = realStringify;
      globalThis.URLSearchParams = realURLSearchParams;
    }
  }

  it("페이지가 JSON.parse를 throw로 바꿔도 JSON 본문이 마스킹된다", () => {
    const out = whilePolluted(
      () => {
        JSON.parse = () => {
          throw new Error("page hijacked JSON.parse");
        };
      },
      () => maskBody('{"token":"x","q":1}', "application/json"),
    );
    expect(out).toBe('{"token":"***","q":1}');
  });

  it("페이지가 JSON.stringify를 오염시켜도 결과가 정상이다", () => {
    const out = whilePolluted(
      () => {
        JSON.stringify = () => "POLLUTED";
      },
      () => maskBody('{"password":"p","q":1}', "application/json"),
    );
    expect(out).toBe('{"password":"***","q":1}');
  });

  it("contentType 없이 형태로 추론하는 경로도 오염에 견딘다", () => {
    const out = whilePolluted(
      () => {
        JSON.parse = () => {
          throw new Error("page hijacked JSON.parse");
        };
      },
      () => maskBody('[{"secret":"s"}]', ""),
    );
    expect(out).toBe('[{"secret":"***"}]');
  });

  it("페이지가 URLSearchParams를 오염시켜도 urlencoded 본문이 마스킹된다", () => {
    const out = whilePolluted(
      () => {
        globalThis.URLSearchParams = class {
          constructor() {
            throw new Error("page hijacked URLSearchParams");
          }
        } as unknown as typeof URLSearchParams;
      },
      () => maskBody("password=p&plain=1", "application/x-www-form-urlencoded"),
    );
    expect(out).toContain("password=***");
    expect(out).toContain("plain=1");
  });
});

describe("classifyWsFrameData", () => {
  it("일반 텍스트 프레임은 문자열 그대로 반환한다", () => {
    expect(classifyWsFrameData('{"type":"ping"}')).toBe('{"type":"ping"}');
  });

  it("빈 문자열 프레임은 빈 문자열 그대로 반환한다", () => {
    expect(classifyWsFrameData("")).toBe("");
  });

  it("BODY_CAP를 초과하는 텍스트 프레임은 truncated로 분류한다", () => {
    const big = "a".repeat(BODY_CAP + 100);
    expect(classifyWsFrameData(big)).toEqual({
      kind: "truncated",
      limit: BODY_CAP,
      size: BODY_CAP + 100,
    });
  });

  it("ArrayBuffer 바이너리 프레임은 null(드롭)을 반환한다", () => {
    expect(classifyWsFrameData(new ArrayBuffer(8))).toBeNull();
  });

  it("TypedArray(Uint8Array) 바이너리 프레임은 null(드롭)을 반환한다", () => {
    expect(classifyWsFrameData(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("Blob 바이너리 프레임은 null(드롭)을 반환한다", () => {
    expect(classifyWsFrameData(new Blob(["x"]))).toBeNull();
  });

  it("SharedArrayBuffer 바이너리 프레임은 null(드롭)을 반환한다", () => {
    expect(classifyWsFrameData(new SharedArrayBuffer(8))).toBeNull();
  });
});

describe("maskWsFrame", () => {
  it("JSON 프레임의 민감 키를 ***로 마스킹한다", () => {
    expect(maskWsFrame('{"token":"abc"}')).toBe('{"token":"***"}');
  });

  it("민감 키가 없는 JSON 프레임은 값을 보존한다", () => {
    expect(maskWsFrame('{"a":1}')).toBe('{"a":1}');
  });

  it("JSON이 아닌 텍스트 프레임은 원문을 유지한다", () => {
    expect(maskWsFrame("plain text")).toBe("plain text");
  });

  it("빈 문자열 프레임은 원문을 유지한다", () => {
    expect(maskWsFrame("")).toBe("");
  });
});

describe("maskUrl", () => {
  it("민감 쿼리 키(token·access_token 등)를 ***로 마스킹한다", () => {
    expect(maskUrl("https://x.com/cb?access_token=abc&state=1")).toBe(
      "https://x.com/cb?access_token=***&state=1",
    );
    expect(maskUrl("https://x.com/reset?token=secret")).toBe(
      "https://x.com/reset?token=***",
    );
  });

  it("민감 키 대소문자 무관하게 마스킹한다", () => {
    expect(maskUrl("https://x.com/?Password=p&API_KEY=k")).toBe(
      "https://x.com/?Password=***&API_KEY=***",
    );
  });

  it("민감 키가 없으면 원문을 유지한다", () => {
    const url = "https://x.com/path?page=2&q=hello";
    expect(maskUrl(url)).toBe(url);
  });

  it("URL이 아닌 문자열은 그대로 반환한다", () => {
    expect(maskUrl("about:blank")).toBe("about:blank");
    expect(maskUrl("not a url")).toBe("not a url");
  });

  it("fragment의 민감 키(OAuth implicit #access_token 등)도 마스킹한다", () => {
    expect(
      maskUrl("https://x.com/cb#access_token=SECRET&token_type=bearer"),
    ).toBe("https://x.com/cb#access_token=***&token_type=bearer");
  });

  // OAuth authorization code는 교환 가능한 자격증명이라 query에서 마스킹한다.
  // 대가: ?code=KR 같은 국가·에러 코드 재현값도 함께 손실 (수용).
  it("OAuth code 쿼리를 마스킹한다 (query 전용 키)", () => {
    expect(maskUrl("https://app/cb?code=4/0AY&state=x")).toBe(
      "https://app/cb?code=***&state=x",
    );
    expect(maskUrl("https://x.com/?code=KR")).toBe("https://x.com/?code=***");
  });

  it("code를 부분 문자열로 포함하는 쿼리 키는 마스킹하지 않는다", () => {
    const url = "https://x.com/?error_code=429&zipcode=06236&keyword=bug";
    expect(maskUrl(url)).toBe(url);
  });

  it("민감 키 없는 순수 앵커(#section)는 원문을 유지한다", () => {
    expect(maskUrl("https://x.com/page#section")).toBe(
      "https://x.com/page#section",
    );
    expect(maskUrl("https://x.com/docs?page=2#intro")).toBe(
      "https://x.com/docs?page=2#intro",
    );
  });
});

// eviction의 "무엇을 고르고 얼마를 회수하나" 계산부. buffer 변형·memoryUsed 대입은 recorder 쪽에 남기고
// 선택 로직만 순수 함수로 분리해 FIFO 순서·이중차감을 단위로 고정한다 (감사 🟡 항목).
describe("eviction 선택 로직", () => {
  describe("estimateBodySize", () => {
    it("문자열 본문은 UTF-16 기준 2바이트/문자로 추정한다", () => {
      expect(estimateBodySize("abc")).toBe(6);
    });

    it("omitted 객체·undefined는 0으로 센다", () => {
      expect(estimateBodySize(undefined)).toBe(0);
      expect(estimateBodySize({ kind: "omitted", reason: "memory-cap" } as const)).toBe(0);
    });

    it("빈 문자열은 0", () => {
      expect(estimateBodySize("")).toBe(0);
    });
  });

  describe("findOldestBodyIndex", () => {
    it("문자열 본문을 가진 가장 오래된 항목의 인덱스를 고른다 (FIFO)", () => {
      const entries = [
        { requestBody: undefined, responseBody: undefined },
        { requestBody: undefined, responseBody: "old" },
        { requestBody: "newer", responseBody: undefined },
      ];
      expect(findOldestBodyIndex(entries)).toBe(1);
    });

    it("requestBody만 있어도 후보로 잡는다", () => {
      const entries = [
        { requestBody: undefined, responseBody: undefined },
        { requestBody: "req", responseBody: undefined },
      ];
      expect(findOldestBodyIndex(entries)).toBe(1);
    });

    // 이미 omitted로 치환된 항목을 다시 고르면 회수량 0인 채 무한 루프가 된다.
    it("이미 omitted로 치환된 항목은 후보에서 제외한다", () => {
      const entries = [
        { requestBody: { kind: "omitted", reason: "memory-cap" } as const, responseBody: { kind: "omitted", reason: "memory-cap" } as const },
        { requestBody: undefined, responseBody: "live" },
      ];
      expect(findOldestBodyIndex(entries)).toBe(1);
    });

    it("회수할 본문이 하나도 없으면 -1", () => {
      expect(findOldestBodyIndex([{ requestBody: undefined, responseBody: undefined }])).toBe(-1);
      expect(findOldestBodyIndex([])).toBe(-1);
    });
  });

  describe("reclaimableSize", () => {
    it("request와 response 본문 크기를 합산한다", () => {
      expect(reclaimableSize({ requestBody: "ab", responseBody: "cde" })).toBe(10);
    });

    it("본문이 없으면 0 (evict해도 memoryUsed를 깎지 않는다)", () => {
      expect(reclaimableSize({ requestBody: undefined, responseBody: undefined })).toBe(0);
    });
  });
});
