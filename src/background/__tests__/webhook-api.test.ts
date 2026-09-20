import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetchOnce } from "@/test/fetch-mock";
import {
  WEBHOOK_BODY_MAX_BYTES,
  WebhookError,
  normalizeWebhookResult,
  submitWebhook,
  testWebhook,
} from "../webhook-api";
import type { WebhookSubmitPayload } from "@/types/webhook";

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
    const m = mockFetchOnce({ body: { key: "K", url: "u" } });
    await submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: files() });

    const form = m.formDataAt(0);
    const sent = JSON.parse(String(form.get("payload"))) as WebhookSubmitPayload;
    const refs = [...sent.body.matchAll(/cid:([^\s)"'\]]+)/g)].map((x) => x[1]);
    for (const ref of refs) expect(form.get(ref)).toBeInstanceOf(Blob);
    for (const entry of sent.media) expect(refs).toContain(entry.part);
  });

  it("Content-Type을 직접 세팅하지 않는다 — fetch가 boundary를 붙여야 한다", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "u" } });
    await submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: files() });

    const headers = m.callAt(0).init?.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("content-type");
  });

  it("사용자가 넣은 Content-Type도 multipart 모드에선 제거한다", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "u" } });
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
    const m = mockFetchOnce({ body: { key: "K", url: "u" } });
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
    const m = mockFetchOnce({ body: { key: "K", url: "u" } });
    await submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: files() });

    const init = m.callAt(0).init;
    expect(init?.redirect).toBe("manual");
    expect(init?.credentials).toBe("omit");
  });

  it("멱등 키가 요청에 실리고, 같은 payload 재전송은 같은 키를 쓴다", async () => {
    const m = mockFetchOnce([{ body: { key: "K", url: "u" } }, { body: { key: "K", url: "u" } }]);
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
    ["url만", { body: { url: "u" } }],
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

  it("바디가 하드캡을 넘으면 fetch 전에 중단한다 — multipart 조립분도 같은 캡을 받는다", async () => {
    const m = mockFetchOnce({ body: { key: "K", url: "u" } });
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
    const m = mockFetchOnce({ body: { key: "K", url: "u" } });
    const huge = payload({ body: "x".repeat(WEBHOOK_BODY_MAX_BYTES + 10) });
    await expect(
      submitWebhook({ mode: "multipart", auth: AUTH, payload: huge, files: [] }),
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
    const m = mockFetchOnce({ body: { key: "K", url: "u" } });
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
});

describe("submitWebhook — 전송 시점 2층 방어", () => {
  it.each([
    ["file:///etc/passwd", "file 스킴"],
    ["http://bugs.acme.io/intake", "공인망 평문"],
    ["https://u:p@bugs.acme.io/hook", "URL 자격증명"],
  ])("%s (%s)는 저장소가 조작돼도 fetch에 닿지 않는다", async (url) => {
    const m = mockFetchOnce({ body: { key: "K", url: "u" } });
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
    mockFetchOnce({ body: { key: "K", url: "u" } });
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
    const m = mockFetchOnce({ body: { key: "K", url: "u" } });
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
    mockFetchOnce({ body: { key: "K", url: "u" } });
    const input = files();
    await submitWebhook({ mode: "multipart", auth: AUTH, payload: payload(), files: input });
    expect(input.map((f) => f.dataUrl)).toEqual(["", ""]);
  });
});

describe("normalizeWebhookResult", () => {
  it("key·url 후보를 순서대로 찾는다", () => {
    expect(normalizeWebhookResult({ key: "A", id: "B", url: "u1", html_url: "u2" })).toEqual({
      key: "A",
      url: "u1",
    });
  });

  it("둘 중 하나라도 없으면 빈 값을 남긴다 — throw 판정은 호출부가 한다", () => {
    expect(normalizeWebhookResult({ key: "A" })).toEqual({ key: "A", url: undefined });
    expect(normalizeWebhookResult(null)).toEqual({ key: undefined, url: undefined });
  });
});
