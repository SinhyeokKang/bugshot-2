import { vi } from "vitest";

// 어댑터 8벌이 각자 로컬 목을 확장하다 갈린 네 축(응답 봉투 / 큐 / URL 라우팅 / text() 유무)을
// 한 곳에 모은 fetch 목. 계약 정본은 `__tests__/fetch-mock.test.ts`다.
// 필드는 실제 소비처가 있는 것만 둔다 — `headers`가 없는 건 어댑터 8파일에 `.headers.get(`이
// 0건이기 때문이고, 요청 헤더는 `callAt().init.headers`로 본다.

export interface MockResponse {
  /** 문자열이면 text()가 원문 그대로, Error면 text()·json()이 그 Error로 reject한다. */
  body?: unknown;
  ok?: boolean;
  status?: number;
  /** linear uploadFileToLinear가 에러 메시지에 싣는다. */
  statusText?: string;
  /** jira probeMediaRedirect가 읽는다. 없으면 요청 URL. */
  url?: string;
}

export interface MockRoute {
  /** URL 부분 문자열 또는 정규식. 먼저 선언한 라우트가 이긴다. */
  match: string | RegExp;
  /** 배열이면 호출마다 앞에서 소비(고갈 후 마지막 값 반복). */
  respond: MockResponse | MockResponse[];
}

export interface MockFetch {
  fn: ReturnType<typeof vi.fn>;
  callAt(n: number): { url: string; init?: RequestInit };
  /** init.body를 JSON.parse. FormData면 안내와 함께 throw */
  jsonBodyAt(n: number): unknown;
  formDataAt(n: number): FormData;
  /** afterEach 전용 — vi.unstubAllGlobals()를 부르므로 it() 안에서 쓰면 안 된다 */
  restore(): void;
}

function toResponse(res: MockResponse, requestUrl: string) {
  // ok를 안 주고 status만 주는 형태가 흔한데, 그때 ok가 true로 남으면 "실패 응답인 줄 알았는데
  // 성공 분기를 탔다"가 무음으로 난다. 명시한 ok가 항상 이긴다.
  const ok = res.ok ?? (res.status === undefined || res.status < 400);
  const body = res.body;
  const read = <T>(value: T) => (body instanceof Error ? Promise.reject(body) : Promise.resolve(value));
  return {
    ok,
    status: res.status ?? (ok ? 200 : 400),
    statusText: res.statusText ?? "",
    url: res.url ?? requestUrl,
    json: () => read(body),
    // 문자열은 그대로 — 무조건 JSON.stringify하면 `<html>500</html>`이 파싱에 성공해
    // readErrorBody의 원문 반환 분기가 영구 미커버가 된다.
    text: () => read(body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)),
  };
}

/** 큐를 앞에서 소비하고 고갈 후에는 마지막 값을 반복한다. */
function queue(respond: MockResponse | MockResponse[]) {
  const list = Array.isArray(respond) ? respond : [respond];
  let cursor = 0;
  return () => list[Math.min(cursor++, list.length - 1)] ?? {};
}

function matches(match: string | RegExp, url: string) {
  return typeof match === "string" ? url.includes(match) : match.test(url);
}

function install(impl: (url: string, init?: RequestInit) => unknown): MockFetch {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);

  const callAt = (n: number) => {
    const call = fn.mock.calls[n] as [string, RequestInit?] | undefined;
    if (!call) throw new Error(`[fetch-mock] ${n}번째 호출이 없다 (총 ${fn.mock.calls.length}회)`);
    return { url: call[0], init: call[1] };
  };

  return {
    fn,
    callAt,
    jsonBodyAt: (n) => {
      const body = callAt(n).init?.body;
      if (body instanceof FormData) {
        throw new Error(`[fetch-mock] ${n}번째 호출 body는 FormData다 — formDataAt(${n})을 써라`);
      }
      // slack은 주 경로 5함수가 URLSearchParams를 보낸다. 안 가리면 JSON.parse의 raw
      // SyntaxError가 나와 "URL이 틀렸다"가 "응답이 틀렸다"로 오진된다.
      if (body instanceof URLSearchParams) {
        throw new Error(
          `[fetch-mock] ${n}번째 호출 body는 URLSearchParams다 — callAt(${n}).init.body로 직접 봐라`,
        );
      }
      return JSON.parse(String(body));
    },
    formDataAt: (n) => {
      const body = callAt(n).init?.body;
      if (!(body instanceof FormData)) {
        throw new Error(`[fetch-mock] ${n}번째 호출 body는 FormData가 아니다 (${typeof body})`);
      }
      return body;
    },
    restore: () => vi.unstubAllGlobals(),
  };
}

export function mockFetchOnce(res: MockResponse | MockResponse[] = {}): MockFetch {
  const next = queue(res);
  return install((url) => Promise.resolve(toResponse(next(), url)));
}

/** 매칭 실패 시 throw — 무음 404를 흘리면 "URL이 틀렸다"가 "응답 파싱이 틀렸다"로 오진된다. */
export function mockFetchRoutes(routes: MockRoute[]): MockFetch {
  const queues = routes.map((r) => queue(r.respond));
  return install((url) => {
    const i = routes.findIndex((r) => matches(r.match, url));
    if (i < 0) throw new Error(`[fetch-mock] 매칭되는 라우트가 없다: ${url}`);
    return Promise.resolve(toResponse(queues[i](), url));
  });
}
