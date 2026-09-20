import { afterEach, describe, expect, it, vi } from "vitest";
import { lastReadCancelled, mockFetchOnce } from "@/test/fetch-mock";
import {
  WEBHOOK_BODY_MAX_BYTES,
  WebhookError,
  normalizeWebhookResult,
  submitWebhook,
  testWebhook,
} from "../webhook-api";
import type { WebhookSubmitPayload } from "@/types/webhook";
import { setLocale } from "@/i18n";

const URL_ = "https://bugs.acme.io/intake";

function payload(overrides: Partial<WebhookSubmitPayload> = {}): WebhookSubmitPayload {
  return {
    title: "버튼이 안 눌린다",
    body: "![shot](cid:screenshot.webp)\n\n[logs](cid:logs.html)",
    environment: [{ label: "OS", value: "macOS" }],
    media: [
      { part: "screenshot.webp", filename: "screenshot.webp", contentType: "image/webp", kind: "image" },
      { part: "logs.html", filename: "logs.html", contentType: "text/html", kind: "logs" },
    ],
    bugshot: { version: "1.7.40", sentAt: 1700000000000, idempotencyKey: "draft-1:1700000000000" },
    ...overrides,
  };
}

// submitWebhook이 dataUrl 슬롯을 비우므로(합본이라 GC가 못 걷어간다) 매번 새로 만든다.
const files = () => [
  { part: "screenshot.webp", filename: "screenshot.webp", dataUrl: "data:image/webp;base64,AAAA" },
  { part: "logs.html", filename: "logs.html", dataUrl: "data:text/html;base64,BBBB" },
];

const AUTH = { url: URL_, headers: [{ name: "Authorization", value: "Bearer secret-token" }] };

afterEach(() => vi.unstubAllGlobals());

describe("submitWebhook — multipart", () => {
  it("파트 구성이 payload 1개 + 파일 N개다", async () => {
    const m = mockFetchOnce({ body: { key: "BUG-41", url: "https://bugs.acme.io/b/41" } });
    await submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: files() });

    const form = m.formDataAt(0);
    expect(new Set([...form.keys()])).toEqual(new Set(["payload", "screenshot.webp", "logs.html"]));
  });

  it("payload 파트의 모든 cid: 참조에 대응하는 파일 파트가 있다 (양방향)", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    await submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: files() });

    const form = m.formDataAt(0);
    const sent = JSON.parse(String(form.get("payload"))) as WebhookSubmitPayload;
    const refs = [...sent.body.matchAll(/cid:([^\s)"'\]]+)/g)].map((x) => x[1]);
    for (const ref of refs) expect(form.get(ref)).toBeInstanceOf(Blob);
    for (const entry of sent.media) expect(refs).toContain(entry.part);
  });

  it("Content-Type을 직접 세팅하지 않는다 — fetch가 boundary를 붙여야 한다", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    await submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: files() });

    const headers = m.callAt(0).init?.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("content-type");
  });

  it("사용자가 넣은 Content-Type도 multipart 모드에선 제거한다", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    await submitWebhook({
      mode: "multipart",
      auth: { ...AUTH, headers: [...AUTH.headers, { name: "Content-Type", value: "application/json" }] },
      payload: payload(),
      files: files(),
    });

    const headers = m.callAt(0).init?.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("content-type");
    expect(headers.Authorization).toBe("Bearer secret-token");
  });

  it("isSettableHeaderName을 통과 못 한 헤더는 요청에 실리지 않는다", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    await submitWebhook({
      mode: "multipart",
      auth: {
        ...AUTH,
        headers: [
          { name: "Authorization", value: "Bearer t" },
          { name: "Cookie", value: "session=abc" },
          { name: "Host", value: "evil.example" },
        ],
      },
      payload: payload(),
      files: files(),
    });

    const headers = m.callAt(0).init?.headers as Record<string, string>;
    const lower = Object.keys(headers).map((k) => k.toLowerCase());
    expect(lower).toContain("authorization");
    expect(lower).not.toContain("cookie");
    expect(lower).not.toContain("host");
  });

  it("요청 init에 redirect:manual과 credentials:omit이 들어간다", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    await submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: files() });

    const init = m.callAt(0).init;
    expect(init?.redirect).toBe("manual");
    expect(init?.credentials).toBe("omit");
  });

  it("멱등 키가 요청에 실리고, 같은 payload 재전송은 같은 키를 쓴다", async () => {
    const m = mockFetchOnce([{ body: { key: "K", url: "https://bugs.acme.io/b/41" } }, { body: { key: "K", url: "https://bugs.acme.io/b/41" } }]);
    const p = payload();
    await submitWebhook({ mode: "multipart", auth: AUTH, payload: p, files: files() });
    await submitWebhook({ mode: "multipart", auth: AUTH, payload: p, files: files() });

    const read = (n: number) =>
      (JSON.parse(String(m.formDataAt(n).get("payload"))) as WebhookSubmitPayload).bugshot
        .idempotencyKey;
    expect(read(0)).toBe("draft-1:1700000000000");
    expect(read(1)).toBe(read(0));
  });
});

describe("submitWebhook — 응답 계약", () => {
  it.each([
    [{ key: "BUG-41", url: "https://bugs.acme.io/b/41" }, "BUG-41"],
    [{ id: 41, html_url: "https://bugs.acme.io/b/41" }, "41"],
    [{ iid: "7", web_url: "https://x/7" }, "7"],
    [{ number: 9, link: "https://x/9" }, "9"],
  ])("multipart 응답 %j 는 key/url을 뽑아낸다", async (body, key) => {
    mockFetchOnce({ body });
    const r = await submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: files() });
    expect(r.key).toBe(key);
    expect(r.url).toBeTruthy();
  });

  it.each([
    ["빈 객체", { body: {} }],
    ["key만", { body: { key: "K" } }],
    ["url만", { body: { url: "https://bugs.acme.io/b/41" } }],
    ["비-JSON", { body: new Error("not json") }],
    ["204 No Content", { status: 204, body: undefined }],
  ])("multipart에서 %s 은 계약 위반으로 throw한다", async (_l, res) => {
    mockFetchOnce(res);
    await expect(
      submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: files() }),
    ).rejects.toBeInstanceOf(WebhookError);
  });
});

describe("submitWebhook — json 모드", () => {
  it.each([
    ["204 No Content", { status: 204, body: undefined }],
    ["빈 바디", { body: "" }],
    ["비-JSON", { body: new Error("not json") }],
    ["200 임의 객체", { body: { anything: true } }],
  ])("%s 는 전부 성공이고 응답을 파싱하지 않는다", async (_l, res) => {
    mockFetchOnce(res);
    const r = await submitWebhook({ mode: "json", auth: AUTH, body: { content: "x" } });
    expect(r).toEqual({});
  });

  it("application/json으로 보내고 사용자 Content-Type은 존중한다", async () => {
    const m = mockFetchOnce({ status: 204 });
    await submitWebhook({
      mode: "json",
      auth: { ...AUTH, headers: [{ name: "Content-Type", value: "application/vnd.x+json" }] },
      body: { content: "x" },
    });

    const headers = m.callAt(0).init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/vnd.x+json");
    expect(m.callAt(0).init?.body).toBe(JSON.stringify({ content: "x" }));
  });

  it("사용자 Content-Type이 없으면 application/json을 붙인다", async () => {
    const m = mockFetchOnce({ status: 204 });
    await submitWebhook({ mode: "json", auth: AUTH, body: { content: "x" } });

    const headers = m.callAt(0).init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("submitWebhook — 실패", () => {
  it.each([404, 401, 500])("%d 는 WebhookError로 throw한다", async (status) => {
    mockFetchOnce({ status, body: "nope" });
    const err = await submitWebhook({
      mode: "multipart",
      auth: AUTH,
      payload: payload(),
      files: files(),
    }).catch((e) => e as WebhookError);
    expect(err).toBeInstanceOf(WebhookError);
    expect((err as WebhookError).status).toBe(status);
  });

  it("302(opaqueredirect)는 거부하고, 사용자 헤더 값이 에러 어디에도 없다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ type: "opaqueredirect", ok: false, status: 0, url: URL_ })),
    );
    const err = await submitWebhook({
      mode: "multipart",
      auth: AUTH,
      payload: payload(),
      files: files(),
    }).catch((e) => e as WebhookError);

    expect(err).toBeInstanceOf(WebhookError);
    const dump = `${(err as Error).message} ${JSON.stringify((err as WebhookError).body ?? "")}`;
    expect(dump).not.toContain("secret-token");
    expect(dump).not.toMatch(/bearer/i);
  });

  it("에코 서버가 헤더를 되비춰도 토큰이 에러 본문에 남지 않는다", async () => {
    mockFetchOnce({ status: 400, body: 'got {"Authorization":"Bearer secret-token"}' });
    const err = await submitWebhook({
      mode: "multipart",
      auth: AUTH,
      payload: payload(),
      files: files(),
    }).catch((e) => e as WebhookError);

    expect(String((err as WebhookError).body)).not.toContain("secret-token");
    expect(String((err as WebhookError).body)).toContain("***");
  });

  it("거대한 에러 본문은 캡에서 잘린다", async () => {
    mockFetchOnce({ status: 500, body: "x".repeat(200_000) });
    const err = await submitWebhook({
      mode: "multipart",
      auth: AUTH,
      payload: payload(),
      files: files(),
    }).catch((e) => e as WebhookError);
    expect(String((err as WebhookError).body).length).toBeLessThan(20_000);
  });

  // 위 케이스는 목이 body 스트림을 안 주던 시절 res.text() 폴백만 탔고, 그때 실제로 검증된
  // 건 마지막 .slice() 한 줄이었다(스트리밍 캡 루프 커버리지 0). 임의 서버가 상대라 "끝까지
  // 안 읽는다"가 이 함수의 존재 이유이므로, 그걸 재는 단언을 따로 둔다.
  it("캡을 넘기면 스트림을 끝까지 읽지 않고 취소한다", async () => {
    mockFetchOnce({ status: 500, body: "x".repeat(200_000) });
    const err = await submitWebhook({
      mode: "multipart",
      auth: AUTH,
      payload: payload(),
      files: files(),
    }).catch((e) => e as WebhookError);
    const body = String((err as WebhookError).body);
    expect(body.length).toBeLessThan(20_000);
    // 폴백(res.text())은 200_000자를 전부 버퍼링한 뒤 자른다. 스트림 경로만 캡 근처에서
    // 멈추므로, 읽은 양이 캡의 몇 배 이내라는 것이 경로를 가른다.
    expect(lastReadCancelled()).toBe(true);
  });

  it("바디가 하드캡을 넘으면 fetch 전에 중단한다 — multipart 조립분도 같은 캡을 받는다", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    const huge = `data:video/mp4;base64,${"A".repeat(Math.ceil((WEBHOOK_BODY_MAX_BYTES * 4) / 3) + 8)}`;
    await expect(
      submitWebhook({
        mode: "multipart",
        auth: AUTH,
        payload: payload(),
        files: [...files(), { part: "replay.mp4", filename: "replay.mp4", dataUrl: huge }],
      }),
    ).rejects.toBeInstanceOf(WebhookError);
    expect(m.fn).not.toHaveBeenCalled();
  });

  it("캡을 코드유닛이 아니라 실바이트로 잰다 — CJK 본문이 3배까지 새지 않는다", async () => {
    const m = mockFetchOnce({ status: 204 });
    // 코드유닛으로는 캡 아래, UTF-8 실바이트(3B/자)로는 캡 위.
    const cjk = "가".repeat(Math.floor(WEBHOOK_BODY_MAX_BYTES / 2));
    await expect(
      submitWebhook({ mode: "json", auth: AUTH, body: { big: cjk } }),
    ).rejects.toBeInstanceOf(WebhookError);
    expect(m.fn).not.toHaveBeenCalled();
  });

  it("multipart 캡은 파일뿐 아니라 payload JSON도 센다", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    const huge = payload({ body: "x".repeat(WEBHOOK_BODY_MAX_BYTES + 10) });
    await expect(
      submitWebhook({ mode: "multipart", auth: AUTH, payload: huge, files: [] }),
    ).rejects.toBeInstanceOf(WebhookError);
    expect(m.fn).not.toHaveBeenCalled();
  });

  // 위 케이스는 ASCII라 코드유닛 == 바이트다. 합산만 코드유닛으로 세면 CJK 본문이 최대
  // 3배까지 과소 계상돼, 개별 검사를 통과한 payload + 파일 조합이 캡을 넘긴 채 나간다.
  it("합산 캡도 실바이트로 잰다 — CJK payload가 파일과 합쳐 캡을 넘기면 막는다", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    // 코드유닛 3M(개별 검사 통과) = UTF-8 9MB. 파일 18MB를 더하면 실제 27MB > 25MB인데,
    // 코드유닛으로 세면 3M + 18M = 21M이라 통과해 버린다.
    const cjk = "가".repeat(3_000_000);
    const b64 = "A".repeat(24_000_000); // estimateDataUrlBytes ≈ 18MB
    await expect(
      submitWebhook({
        mode: "multipart",
        auth: AUTH,
        payload: payload({ body: cjk }),
        files: [{ part: "big.bin", filename: "big.bin", dataUrl: `data:application/octet-stream;base64,${b64}` }],
      }),
    ).rejects.toBeInstanceOf(WebhookError);
    expect(m.fn).not.toHaveBeenCalled();
  });

  it("json 모드의 바디도 같은 캡을 받는다", async () => {
    const m = mockFetchOnce({ status: 204 });
    await expect(
      submitWebhook({ mode: "json", auth: AUTH, body: { big: "y".repeat(WEBHOOK_BODY_MAX_BYTES + 10) } }),
    ).rejects.toBeInstanceOf(WebhookError);
    expect(m.fn).not.toHaveBeenCalled();
  });

  it("타임아웃이 WebhookError로 떨어진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }))),
    );
    await expect(
      submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: files() }),
    ).rejects.toBeInstanceOf(WebhookError);
  });
});

describe("submitWebhook — 시크릿", () => {
  const withSecret = { url: URL_, headers: [], secret: "s3cr3t-team-token" };

  it("secret이 있으면 Authorization: Bearer로 합성해 보낸다", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    await submitWebhook({ mode: "multipart", auth: withSecret, payload: payload(), files: files() });

    const headers = m.callAt(0).init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer s3cr3t-team-token");
  });

  it("json 모드에도 같은 헤더가 실린다", async () => {
    const m = mockFetchOnce({ status: 204 });
    await submitWebhook({ mode: "json", auth: withSecret, body: { c: "x" } });

    const headers = m.callAt(0).init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer s3cr3t-team-token");
  });

  it("연결 테스트에도 같은 헤더가 실린다", async () => {
    const m = mockFetchOnce({ status: 204 });
    await testWebhook(withSecret);

    const headers = m.callAt(0).init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer s3cr3t-team-token");
  });

  it.each(["Authorization", "authorization", "AUTHORIZATION"])(
    "고급 헤더가 %s를 정의하면 그쪽이 이기고 시크릿은 안 실린다",
    async (name) => {
      const m = mockFetchOnce({ status: 204 });
      await submitWebhook({
        mode: "json",
        auth: { ...withSecret, headers: [{ name, value: "Token explicit" }] },
        body: { c: "x" },
      });

      const headers = m.callAt(0).init?.headers as Record<string, string>;
      const values = Object.entries(headers)
        .filter(([k]) => k.toLowerCase() === "authorization")
        .map(([, v]) => v);
      expect(values).toEqual(["Token explicit"]);
      expect(JSON.stringify(headers)).not.toContain("s3cr3t-team-token");
    },
  );

  it.each([undefined, "", "   "])(
    "secret이 %j면 Authorization 헤더 자체가 없다 — 빈 Bearer를 보내지 않는다",
    async (secret) => {
      const m = mockFetchOnce({ status: 204 });
      await submitWebhook({ mode: "json", auth: { url: URL_, headers: [], secret }, body: { c: "x" } });

      const headers = m.callAt(0).init?.headers as Record<string, string>;
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");
    },
  );

  it("에코 서버가 되비친 에러 본문에서 시크릿이 가려진다", async () => {
    mockFetchOnce({ status: 400, body: 'saw Bearer s3cr3t-team-token' });
    const err = await submitWebhook({
      mode: "multipart",
      auth: withSecret,
      payload: payload(),
      files: files(),
    }).catch((e) => e as WebhookError);

    expect(String((err as WebhookError).body)).not.toContain("s3cr3t-team-token");
  });

  // 위 둘은 에코가 `Bearer ` 접두까지 그대로 되비추는 형태만 본다. 실제 서버는 스킴을 떼고
  // 토큰만 싣는 쪽이 흔하고(`invalid token <값>`), 헤더 값 전체와의 부분문자열 일치로는
  // 그게 안 걸린다 — POSTMORTEM 2026-07-14(값 경로만 막고 이름 경로로 샌 마스킹)와 같은 형태.
  it("스킴을 뗀 토큰만 되비춰도 가려진다", async () => {
    mockFetchOnce({ status: 401, body: '{"error":"invalid token s3cr3t-team-token"}' });
    const err = await submitWebhook({
      mode: "multipart",
      auth: withSecret,
      payload: payload(),
      files: files(),
    }).catch((e) => e as WebhookError);

    expect(String((err as WebhookError).body)).not.toContain("s3cr3t-team-token");
    expect(String((err as WebhookError).body)).toContain("***");
  });

  it("사용자가 직접 넣은 헤더도 스킴 뒤 토큰만 되비추면 가려진다", async () => {
    mockFetchOnce({ status: 401, body: "rejected: long-enough-api-key" });
    const err = await submitWebhook({
      mode: "multipart",
      auth: { url: URL_, headers: [{ name: "X-Api-Key", value: "Token long-enough-api-key" }] },
      payload: payload(),
      files: files(),
    }).catch((e) => e as WebhookError);

    expect(String((err as WebhookError).body)).not.toContain("long-enough-api-key");
  });
});

describe("submitWebhook — 전송 시점 2층 방어", () => {
  it.each([
    ["file:///etc/passwd", "file 스킴"],
    ["http://bugs.acme.io/intake", "공인망 평문"],
    ["https://u:p@bugs.acme.io/hook", "URL 자격증명"],
  ])("%s (%s)는 저장소가 조작돼도 fetch에 닿지 않는다", async (url) => {
    const m = mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    await expect(
      submitWebhook({
        mode: "multipart",
        auth: { url, headers: [] },
        payload: payload(),
        files: files(),
      }),
    ).rejects.toThrow();
    expect(m.fn).not.toHaveBeenCalled();
  });

  it("URL 정책 위반은 번역된 문구로 실패한다 — reason 원문이 토스트에 안 뜬다", async () => {
    mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    const err = await submitWebhook({
      mode: "multipart",
      auth: { url: "ftp://x/hook", headers: [] },
      payload: payload(),
      files: files(),
    }).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).not.toBe("scheme");
    expect(err?.message).not.toBe("credentials");
    expect(err).toBeInstanceOf(WebhookError);
  });

  it("헤더 값에 CRLF가 있으면 그 헤더만 빼고 보낸다 — Headers가 TypeError로 요청을 죽이지 않게", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    await submitWebhook({
      mode: "multipart",
      auth: {
        url: URL_,
        headers: [
          { name: "Authorization", value: "Bearer ok" },
          { name: "X-Bad", value: "a\r\nX-Injected: 1" },
        ],
      },
      payload: payload(),
      files: files(),
    });

    const headers = m.callAt(0).init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ok");
    expect(headers["X-Bad"]).toBeUndefined();
  });

  it("status 0(opaque) 응답도 리다이렉트로 거부한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ type: "opaque", ok: false, status: 0, url: URL_ })),
    );
    await expect(
      submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: files() }),
    ).rejects.toBeInstanceOf(WebhookError);
  });
});

describe("testWebhook — 연결 테스트", () => {
  it.each([{ content: "BugShot sample" }, null, false, 0])("JSON 샘플 %j를 확인용 payload로 덮어쓰지 않는다", async (sampleBody) => {
    const m = mockFetchOnce({ status: 204 });
    await testWebhook(AUTH, sampleBody);
    expect(m.jsonBodyAt(0)).toEqual(sampleBody);
    const headers = m.callAt(0).init?.headers as Record<string, string>;
    expect(headers["X-BugShot-Test"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("JSON 샘플도 제출과 같은 바디 상한을 적용한다", async () => {
    const m = mockFetchOnce({ status: 204 });
    await expect(testWebhook(AUTH, { content: "x".repeat(WEBHOOK_BODY_MAX_BYTES + 1) }))
      .rejects.toBeInstanceOf(WebhookError);
    expect(m.fn).not.toHaveBeenCalled();
  });

  it.each(["json", "multipart"] as const)("%s 제출 타임아웃은 수신 확인을 요구하고 재전송 안전을 보장하지 않는다", async (mode) => {
    setLocale("ko");
    const m = mockFetchOnce({ status: 204 });
    m.fn.mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    const error = await submitWebhook(mode === "json"
      ? { mode, auth: AUTH, body: { text: "report" } }
      : { mode, auth: AUTH, payload: payload(), files: files() }).catch((e) => e as WebhookError);
    expect((error as WebhookError).message).toContain("수신 여부를 확인");
    expect((error as WebhookError).message).not.toContain("멱등 키로 중복이 걸러");
  });

  it("X-BugShot-Test: 1 헤더를 실은 최소 페이로드를 POST한다", async () => {
    const m = mockFetchOnce({ status: 204 });
    await testWebhook(AUTH);

    const headers = m.callAt(0).init?.headers as Record<string, string>;
    expect(headers["X-BugShot-Test"]).toBe("1");
    expect(m.callAt(0).init?.method).toBe("POST");
  });

  it("2xx면 성공, 그 외는 WebhookError다 — 응답 계약을 요구하지 않는다", async () => {
    mockFetchOnce({ status: 204 });
    await expect(testWebhook(AUTH)).resolves.toBeUndefined();

    vi.unstubAllGlobals();
    mockFetchOnce({ status: 403, body: "forbidden" });
    await expect(testWebhook(AUTH)).rejects.toBeInstanceOf(WebhookError);
  });
});

describe("submitWebhook — 입력 소비 계약", () => {
  it("변환 직후 dataUrl 슬롯을 비운다 — 합본이라 GC가 원본을 걷어갈 틈이 없다", async () => {
    mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    const input = files();
    await submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: input });
    expect(input.map((f) => f.dataUrl)).toEqual(["", ""]);
  });
});

describe("normalizeWebhookResult", () => {
  it("key·url 후보를 순서대로 찾는다", () => {
    expect(
      normalizeWebhookResult({ key: "A", id: "B", url: "https://x/1", html_url: "https://x/2" }),
    ).toEqual({ key: "A", url: "https://x/1" });
  });

  // 이 url은 **임의 서버가 제어하는 값**이고, 이슈 목록 행 클릭이 그걸 그대로
  // chrome.tabs.create에 넘긴다(IssueRow.tsx). 8개 플랫폼과 달리 우리가 만든 주소가 아니다.
  it.each(["javascript:alert(1)", "data:text/html,<script>x</script>", "file:///etc/passwd", "chrome://settings"])(
    "http(s)가 아닌 url 후보는 채택하지 않는다: %s",
    (url) => {
      expect(normalizeWebhookResult({ key: "K", url }).url).toBeUndefined();
    },
  );

  it("http·https url은 그대로 채택한다", () => {
    expect(normalizeWebhookResult({ key: "K", url: "https://bugs.acme.io/b/41" }).url)
      .toBe("https://bugs.acme.io/b/41");
    expect(normalizeWebhookResult({ key: "K", html_url: "http://tracker.internal/b/41" }).url)
      .toBe("http://tracker.internal/b/41");
  });

  it("둘 중 하나라도 없으면 빈 값을 남긴다 — throw 판정은 호출부가 한다", () => {
    expect(normalizeWebhookResult({ key: "A" })).toEqual({ key: "A", url: undefined });
    expect(normalizeWebhookResult(null)).toEqual({ key: undefined, url: undefined });
  });
});

// 문구는 원인마다 처방이 달라야 한다. 한 키로 뭉치면 "연결하지 못했습니다"가 스킴 오류에
// 뜨고, "30초 안에"가 8초 연결 테스트에 뜨며, 401이 무엇을 고쳐야 하는지 안 알려준다.
// 실제 t()가 도는 파일이라 키가 아니라 **문구가 서로 갈리는지**로 잰다.
describe("에러 문구는 원인을 가린다", () => {
  const messageFor = async (auth: { url: string; headers: [] }) => {
    mockFetchOnce({ body: { key: "K", url: "https://bugs.acme.io/b/41" } });
    const err = await submitWebhook({
      mode: "multipart",
      auth,
      payload: payload(),
      files: files(),
    }).catch((e) => e as WebhookError);
    return (err as WebhookError).message;
  };

  it("URL 정책 위반은 reason마다 다른 문구를 쓴다 — network 한 키로 뭉치지 않는다", async () => {
    const scheme = await messageFor({ url: "ftp://x/hook", headers: [] });
    const insecure = await messageFor({ url: "http://bugs.acme.io/intake", headers: [] });
    const creds = await messageFor({ url: "https://u:p@bugs.acme.io/intake", headers: [] });
    const network = await (async () => {
      const m = mockFetchOnce({ body: {} });
      m.fn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const err = await submitWebhook({
        mode: "multipart",
        auth: AUTH,
        payload: payload(),
        files: files(),
      }).catch((e) => e as WebhookError);
      return (err as WebhookError).message;
    })();

    expect(new Set([scheme, insecure, creds, network]).size).toBe(4);
  });

  const statusMessage = async (status: number) => {
    mockFetchOnce({ status, body: "nope" });
    const err = await submitWebhook({
      mode: "multipart",
      auth: AUTH,
      payload: payload(),
      files: files(),
    }).catch((e) => e as WebhookError);
    return (err as WebhookError).message;
  };

  it("401·403·5xx는 일반 status 문구와 갈린다", async () => {
    // 상태코드가 문구에 치환되므로 숫자를 지우고 **템플릿**을 비교한다 — 안 그러면 401이
    // 일반 문구로 떨어져도 "401"이 박혀 서로 달라 보여 그물이 공허해진다(실제로 그랬다).
    const shape = async (status: number) => (await statusMessage(status)).replace(/\d+/g, "#");
    const unauth = await shape(401);
    const forbidden = await shape(403);
    const server = await shape(500);
    const other = await shape(418);

    expect(new Set([unauth, forbidden, server, other]).size).toBe(4);
    // 5xx는 상태코드만 갈리고 템플릿은 같아야 한다.
    expect(await shape(503)).toBe(server);
  });

  it("상한 문구는 상수에서 파생한다 — 3로케일에 박아두면 상수를 바꿀 때 거짓이 된다", async () => {
    mockFetchOnce({ status: 204 });
    const err = await submitWebhook({
      mode: "json",
      auth: AUTH,
      body: { big: "x".repeat(WEBHOOK_BODY_MAX_BYTES + 10) },
    }).catch((e) => e as WebhookError);
    expect((err as WebhookError).message).toContain(
      `${Math.round(WEBHOOK_BODY_MAX_BYTES / (1024 * 1024))}MB`,
    );
  });

  it("연결 테스트 타임아웃은 제출 타임아웃과 다른 초를 말한다", async () => {
    const m = mockFetchOnce({ status: 204 });
    const timeout = () => Object.assign(new Error("timed out"), { name: "TimeoutError" });
    m.fn.mockRejectedValueOnce(timeout());
    const submitMsg = await submitWebhook({
      mode: "multipart",
      auth: AUTH,
      payload: payload(),
      files: files(),
    }).catch((e) => (e as WebhookError).message);

    m.fn.mockRejectedValueOnce(timeout());
    const testMsg = await testWebhook(AUTH).catch((e) => (e as WebhookError).message);

    expect(submitMsg).toContain("30");
    expect(testMsg).toContain("8");
    expect(testMsg).not.toBe(submitMsg);
  });
});
