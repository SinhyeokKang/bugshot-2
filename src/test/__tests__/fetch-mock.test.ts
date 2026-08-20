import { afterEach, describe, expect, it } from "vitest";

import {
  mockFetchOnce,
  mockFetchRoutes,
  type MockFetch,
  type MockResponse,
  type MockRoute,
} from "../fetch-mock";

// 이 파일이 `@/test/fetch-mock`의 계약 정본이다. 어댑터 8벌이 각자 로컬 목을 확장하다
// 갈린 축(응답 봉투 / 큐 / URL 라우팅 / text() 유무)을 여기서 한 번만 고정한다.
//
// restore()는 vi.unstubAllGlobals()라 fetch만 되돌리지 않는다(jira 테스트의 chrome 스텁까지
// 날린다). 그래서 it() 안이 아니라 afterEach에서만 부른다 — 소비처가 따라야 할 규칙이라
// 이 파일이 먼저 그 형태를 보인다.
let mf: MockFetch | undefined;

afterEach(() => {
  mf?.restore();
  mf = undefined;
});

const blobText = (b: Blob) => b.text();

describe("mockFetchOnce — 응답 구성", () => {
  it("인자 없이 부르면 200 OK 빈 응답을 주고 globalThis.fetch를 대체한다", async () => {
    mf = mockFetchOnce();

    expect(globalThis.fetch).toBe(mf.fn);

    const res = await globalThis.fetch("https://api.example.com/ping");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeUndefined();
  });

  it("ok:false의 기본 status는 400이고, status를 주면 그쪽이 이긴다", async () => {
    mf = mockFetchOnce([{ ok: false }, { ok: false, status: 503 }]);

    const first = await mf.fn("https://api.example.com/a");
    expect(first.ok).toBe(false);
    expect(first.status).toBe(400);

    const second = await mf.fn("https://api.example.com/a");
    expect(second.ok).toBe(false);
    expect(second.status).toBe(503);
  });

  it("ok를 안 주고 status만 주면 status에서 ok를 파생한다", async () => {
    // {status:500}만 쓰는 형태가 흔한데 ok가 true로 남으면 실패 케이스가 무음으로 성공 분기를 탄다.
    mf = mockFetchOnce([{ status: 500 }, { status: 204 }, { ok: true, status: 500 }]);

    expect((await mf.fn("https://x/a")).ok).toBe(false);
    expect((await mf.fn("https://x/b")).ok).toBe(true);
    // 명시한 ok는 status와 어긋나도 이긴다.
    expect((await mf.fn("https://x/c")).ok).toBe(true);
  });

  it("statusText·url을 응답에 싣는다", async () => {
    // linear uploadFileToLinear는 putRes.statusText를 에러 메시지에 싣고,
    // jira probeMediaRedirect는 res.url을 읽는다. 목이 이 둘을 못 주면 그 경로가 미검증으로 남는다.
    mf = mockFetchOnce({
      ok: false,
      status: 413,
      statusText: "Payload Too Large",
      url: "https://uploads.linear.app/final",
    });

    const res = await mf.fn("https://uploads.linear.app/signed");
    expect(res.statusText).toBe("Payload Too Large");
    expect(res.url).toBe("https://uploads.linear.app/final");
  });
});

describe("mockFetchOnce — 큐", () => {
  it("배열을 주면 호출마다 앞에서 소비한다", async () => {
    mf = mockFetchOnce([{ body: { n: 1 } }, { body: { n: 2 } }, { body: { n: 3 } }]);

    expect(await (await mf.fn("https://x/1")).json()).toEqual({ n: 1 });
    expect(await (await mf.fn("https://x/2")).json()).toEqual({ n: 2 });
    expect(await (await mf.fn("https://x/3")).json()).toEqual({ n: 3 });
  });

  it("큐가 고갈되면 마지막 값을 반복한다", async () => {
    // 커서 페이지네이션 테스트가 종료 응답 하나만 두고 여분 호출을 흘리는 형태에 필요하다.
    mf = mockFetchOnce([{ body: { page: 1 } }, { body: { page: "last" } }]);

    await mf.fn("https://x/1");
    expect(await (await mf.fn("https://x/2")).json()).toEqual({ page: "last" });
    expect(await (await mf.fn("https://x/3")).json()).toEqual({ page: "last" });
  });
});

describe("mockFetchOnce — text()", () => {
  it("문자열 body는 원문 그대로 돌려준다 (JSON 이중 인코딩 금지)", async () => {
    // readErrorBody가 JSON.parse 실패 시 원문을 반환하는 분기를 갖는데, 목이 무조건
    // JSON.stringify하면 "<html>500</html>"이 `"\"<html>500</html>\""`로 파싱 성공해
    // 그 catch 분기가 영구 미커버가 된다.
    mf = mockFetchOnce({ ok: false, status: 500, body: "<html>500</html>" });

    const res = await mf.fn("https://x/err");
    expect(await res.text()).toBe("<html>500</html>");
  });

  it("객체 body는 text()가 JSON 문자열, json()이 객체다", async () => {
    const payload: MockResponse = { ok: false, status: 400, body: { errorMessages: ["bad"] } };
    mf = mockFetchOnce([payload, payload]);

    expect(await (await mf.fn("https://x/err")).text()).toBe('{"errorMessages":["bad"]}');
    expect(await (await mf.fn("https://x/err")).json()).toEqual({ errorMessages: ["bad"] });
  });

  it("body가 Error면 text()가 그 Error로 reject한다 (read 자체 실패 표현)", async () => {
    // readErrorBody의 바깥 catch(본문 읽기가 실패하는 경로)는 text()가 reject해야만 도달한다.
    // 새 필드를 늘리지 않고 body의 Error 인스턴스로 표현한다.
    const boom = new Error("stream closed");
    mf = mockFetchOnce({ ok: false, status: 500, body: boom });

    const res = await mf.fn("https://x/err");
    expect(res.status).toBe(500);
    await expect(res.text()).rejects.toBe(boom);
  });
});

describe("mockFetchRoutes — 매칭", () => {
  it("먼저 선언한 라우트가 이긴다", async () => {
    const routes: MockRoute[] = [
      { match: "/issue", respond: { body: { from: "first" } } },
      { match: "/issue", respond: { body: { from: "second" } } },
    ];
    mf = mockFetchRoutes(routes);

    expect(await (await mf.fn("https://jira/rest/api/3/issue")).json()).toEqual({ from: "first" });
  });

  it("RegExp는 정규식으로 판정한다 ($ 앵커가 prefix 충돌을 가른다)", async () => {
    // /rest/api/3/issue 와 /rest/api/3/issue/createmeta 는 substring으로 못 가른다.
    mf = mockFetchRoutes([
      { match: /\/rest\/api\/3\/issue$/, respond: { body: { hit: "exact" } } },
      { match: "/rest/api/3/issue", respond: { body: { hit: "prefix" } } },
    ]);

    expect(await (await mf.fn("https://jira/rest/api/3/issue")).json()).toEqual({ hit: "exact" });
    expect(await (await mf.fn("https://jira/rest/api/3/issue/createmeta")).json()).toEqual({
      hit: "prefix",
    });
  });

  it("라우트마다 큐가 독립으로 소비된다", async () => {
    mf = mockFetchRoutes([
      { match: "/upload", respond: [{ body: { step: "create" } }, { body: { step: "send" } }] },
      { match: "/page", respond: { body: { id: "p1" } } },
    ]);

    expect(await (await mf.fn("https://n/upload")).json()).toEqual({ step: "create" });
    expect(await (await mf.fn("https://n/page")).json()).toEqual({ id: "p1" });
    expect(await (await mf.fn("https://n/upload")).json()).toEqual({ step: "send" });
  });

  it("매칭되는 라우트가 없으면 URL을 담아 throw한다 (무음 404 금지)", async () => {
    mf = mockFetchRoutes([{ match: "/known", respond: { body: {} } }]);

    // 동기 throw·rejected promise 어느 구현이든 같은 계약으로 본다 — 호출부는 await하므로
    // 둘의 차이가 관측되지 않는다. 중요한 건 "무음으로 404를 흘리지 않는다"다.
    const call = Promise.resolve().then(() => mf!.fn("https://api.example.com/missing"));
    await expect(call).rejects.toThrow(/https:\/\/api\.example\.com\/missing/);
  });
});

describe("호출 기록", () => {
  it("callAt(n)이 url과 init을 호출 순서대로 노출한다", async () => {
    mf = mockFetchOnce({ body: {} });

    await mf.fn("https://jira/rest/api/3/issue", {
      method: "POST",
      headers: { "X-Atlassian-Token": "no-check" },
    });
    await mf.fn("https://jira/rest/api/3/myself");

    expect(mf.callAt(0).url).toBe("https://jira/rest/api/3/issue");
    expect(mf.callAt(0).init?.method).toBe("POST");
    expect(mf.callAt(0).init?.headers).toEqual({ "X-Atlassian-Token": "no-check" });
    expect(mf.callAt(1).url).toBe("https://jira/rest/api/3/myself");
    expect(mf.callAt(1).init).toBeUndefined();
  });

  it("jsonBodyAt이 init.body를 파싱한다", async () => {
    mf = mockFetchOnce({ body: {} });

    await mf.fn("https://gh/repos/o/r/issues", {
      method: "POST",
      body: JSON.stringify({ title: "t", labels: ["bug"] }),
    });

    expect(mf.jsonBodyAt(0)).toEqual({ title: "t", labels: ["bug"] });
  });

  it("jsonBodyAt은 FormData면 formDataAt을 안내하며 throw한다", async () => {
    mf = mockFetchOnce({ body: {} });

    const fd = new FormData();
    fd.append("file", new Blob(["x"]), "a.png");
    await mf.fn("https://jira/attachments", { method: "POST", body: fd });

    expect(() => mf!.jsonBodyAt(0)).toThrow(/formDataAt/);
  });

  it("jsonBodyAt은 URLSearchParams면 callAt을 안내하며 throw한다", async () => {
    // slack의 주 경로 5함수가 URLSearchParams를 보낸다. 안 가리면 JSON.parse의 raw SyntaxError가
    // 나와 "URL이 틀렸다"가 "응답이 틀렸다"로 오진된다.
    mf = mockFetchOnce({ body: {} });

    await mf.fn("https://slack/chat.postMessage", {
      method: "POST",
      body: new URLSearchParams({ channel: "C1", text: "hi" }),
    });

    expect(() => mf!.jsonBodyAt(0)).toThrow(/callAt\(0\)\.init\.body/);
    expect((mf.callAt(0).init?.body as URLSearchParams).get("channel")).toBe("C1");
  });

  it("formDataAt이 보낸 FormData를 그대로 돌려준다 (필드·파일명 왕복)", async () => {
    mf = mockFetchOnce({ body: {} });

    const fd = new FormData();
    fd.append("channels", "C123");
    fd.append("file", new Blob(["shot"], { type: "image/png" }), "before-0.png");
    await mf.fn("https://slack/files.upload", { method: "POST", body: fd });

    const sent = mf.formDataAt(0);
    expect(sent.get("channels")).toBe("C123");
    const file = sent.get("file") as File;
    expect(file.name).toBe("before-0.png");
    expect(await blobText(file)).toBe("shot");
  });

  it("raw Blob body는 callAt().init.body로 직접 본다", async () => {
    // linear uploadFileToLinear는 FormData도 JSON도 아닌 raw Blob을 PUT한다.
    mf = mockFetchOnce({ ok: true });

    const blob = new Blob(["binary"], { type: "image/png" });
    await mf.fn("https://uploads.linear.app/signed", { method: "PUT", body: blob });

    const body = mf.callAt(0).init?.body;
    expect(body).toBeInstanceOf(Blob);
    expect((body as Blob).type).toBe("image/png");
    expect(await blobText(body as Blob)).toBe("binary");
  });
});

describe("타입 계약", () => {
  it("MockResponse는 body 없이도 성립한다", async () => {
    const res: MockResponse = { ok: false, status: 404, statusText: "Not Found" };
    mf = mockFetchOnce(res);

    const got = await mf.fn("https://x/none");
    expect(got.ok).toBe(false);
    expect(got.status).toBe(404);
  });
});
