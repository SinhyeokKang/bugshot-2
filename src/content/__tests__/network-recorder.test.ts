import { describe, it, expect, vi } from "vitest";
import { createPatchedFetch } from "../network-recorder-helpers";

// 회귀: patchedFetch가 `new Request(input, init)`로 본문을 소비한 뒤
// 원본 input/init을 originalFetch에 재전달해 "body already used"로 요청이 실패하던 버그.
// (GitHub 업로드 POST /upload/policies/assets 등 Request 객체·스트림 body 요청이 깨짐)
// 기대: originalFetch는 소비되지 않은 요청을 받고 본문이 보존되어야 한다.

// originalFetch가 실제로 받은 요청을 기록만 하는 mock (throw 안 함).
function makeRecordingFetch() {
  const calls: { bodyUsed: boolean; text: string }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const sent = input instanceof Request ? input : new Request(input, init);
    const bodyUsed = sent.bodyUsed;
    let text: string;
    try {
      text = await sent.clone().text();
    } catch {
      text = "__CONSUMED__";
    }
    calls.push({ bodyUsed, text });
    return new Response("ok", { status: 200 });
  });
  return { fn, calls };
}

// 실제 브라우저 fetch처럼 소비된 요청을 받으면 throw하는 mock.
function makeStrictFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const sent = input instanceof Request ? input : new Request(input, init);
    if (sent.bodyUsed) {
      throw new TypeError("Failed to execute 'fetch': Request body is already used");
    }
    return new Response("ok", { status: 200 });
  });
}

describe("createPatchedFetch — 요청 본문 비소비 회귀", () => {
  it("string url + body 요청을 originalFetch로 그대로 전달하고 응답을 반환한다", async () => {
    const { fn, calls } = makeRecordingFetch();
    const patched = createPatchedFetch(fn);

    const res = await patched("https://example.com/api", {
      method: "POST",
      body: "hello",
      headers: { "content-type": "text/plain" },
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(calls[0].text).toBe("hello");
  });

  it("input이 Request 객체일 때 originalFetch는 소비되지 않은 요청을 받는다", async () => {
    const { fn, calls } = makeRecordingFetch();
    const patched = createPatchedFetch(fn);

    const body = JSON.stringify({ name: "logs.html", size: 123 });
    await patched(
      new Request("https://github.com/upload/policies/assets", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(calls[0].bodyUsed).toBe(false);
    expect(calls[0].text).toBe(body);
  });

  it("input이 Request 객체여도 throw 없이 응답을 반환한다 (실제 fetch 실패 모사)", async () => {
    const strict = makeStrictFetch();
    const patched = createPatchedFetch(strict);

    const res = await patched(
      new Request("https://github.com/upload/policies/assets", {
        method: "POST",
        body: "payload",
      }),
    );

    expect(res.status).toBe(200);
  });
});
