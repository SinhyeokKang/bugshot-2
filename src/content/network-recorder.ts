import { BODY_CAP, classifyBeaconBody, classifyResponseBody, createPatchedFetch, headersToRecord } from "./network-recorder-helpers";
import type { FetchRecordHook } from "./network-recorder-helpers";
import type { NetworkRequestBody, NetworkRequestPhase } from "@/types/network";

function networkRecorderScript(): void {
  const CTRL_KEY = "__bugshot_net_ctrl__";
  if ((window as any)[CTRL_KEY]) return; // 이미 초기화됨

  const MEMORY_CAP = 50 * 1024 * 1024; // 50 MB
  const MAX_REQUEST_ENTRIES = 5000;
  const SET_SENTINEL_EVENT = "__bugshot_net_setSentinel__";

  const MASKED_HEADERS = new Set([
    "authorization",
    "cookie",
    "set-cookie",
    "proxy-authorization",
    "x-auth-token",
    "x-api-key",
    "x-csrf-token",
    "x-xsrf-token",
  ]);
  const MASKED_HEADER_PATTERNS = [
    /^x-.*-token$/i,
    /^x-.*-key$/i,
    /^x-.*-secret$/i,
  ];
  const MASKED_QUERY_KEYS = new Set([
    "token",
    "access_token",
    "id_token",
    "refresh_token",
    "api_key",
    "apikey",
    "key",
    "secret",
    "password",
    "pwd",
    "auth",
  ]);
  const MASKED_BODY_KEYS = new Set(MASKED_QUERY_KEYS);

  type ReqBody = NetworkRequestBody;
  type ReqPhase = NetworkRequestPhase;

  interface CapturedRequest {
    id: string;
    url: string;
    method: string;
    status: number;
    statusText: string;
    startTime: number;
    durationMs: number;
    requestHeaders: Record<string, string>;
    responseHeaders: Record<string, string>;
    requestBody?: ReqBody;
    responseBody?: ReqBody;
    pageUrl: string;
    requestBodySize: number;
    responseBodySize: number;
    contentType: string;
    phase: ReqPhase;
  }

  const buffer: CapturedRequest[] = [];
  let totalSeen = 0;
  let memoryUsed = 0;
  let recording = true;
  type NetworkWarning = "MEMORY_CAPPED" | "ENTRY_CAPPED" | "BODY_TRUNCATED";
  const warnings = new Set<NetworkWarning>();

  function genId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `nr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function isMaskedHeader(name: string): boolean {
    const lower = name.toLowerCase();
    if (MASKED_HEADERS.has(lower)) return true;
    return MASKED_HEADER_PATTERNS.some((p) => p.test(lower));
  }

  function maskHeaderValue(value: string): string {
    return `***[len:${value.length}]`;
  }

  function maskHeaders(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      result[k] = isMaskedHeader(k) ? maskHeaderValue(v) : v;
    }
    return result;
  }

  function maskUrl(url: string): string {
    try {
      const u = new URL(url);
      const params = new URLSearchParams(u.search);
      let changed = false;
      for (const key of params.keys()) {
        if (MASKED_QUERY_KEYS.has(key.toLowerCase())) {
          params.set(key, "***");
          changed = true;
        }
      }
      if (changed) {
        u.search = params.toString();
        return u.toString();
      }
    } catch { /* invalid URL, return as-is */ }
    return url;
  }

  function maskJsonBody(val: unknown, depth: number): unknown {
    if (depth > 10) return val;
    if (Array.isArray(val)) {
      return val.map((item) => maskJsonBody(item, depth + 1));
    }
    if (val && typeof val === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (MASKED_BODY_KEYS.has(k.toLowerCase())) {
          result[k] = "***";
        } else {
          result[k] = maskJsonBody(v, depth + 1);
        }
      }
      return result;
    }
    return val;
  }

  function maskRequestBody(body: string, contentType: string): string {
    if (/^application\/json/i.test(contentType)) {
      try {
        const parsed = JSON.parse(body);
        return JSON.stringify(maskJsonBody(parsed, 0));
      } catch { return body; }
    }
    if (/^application\/x-www-form-urlencoded/i.test(contentType)) {
      try {
        const params = new URLSearchParams(body);
        let changed = false;
        for (const key of params.keys()) {
          if (MASKED_BODY_KEYS.has(key.toLowerCase())) {
            params.set(key, "***");
            changed = true;
          }
        }
        return changed ? params.toString() : body;
      } catch { return body; }
    }
    return body;
  }

  function estimateBodySize(body: ReqBody | undefined): number {
    if (!body || typeof body !== "string") return 0;
    return body.length * 2;
  }

  function enforceMemoryCap(): void {
    while (memoryUsed > MEMORY_CAP && buffer.length > 0) {
      let oldestWithBody = -1;
      for (let i = 0; i < buffer.length; i++) {
        if (typeof buffer[i].responseBody === "string" || typeof buffer[i].requestBody === "string") {
          oldestWithBody = i;
          break;
        }
      }
      if (oldestWithBody === -1) break;
      const entry = buffer[oldestWithBody];
      if (typeof entry.responseBody === "string") {
        memoryUsed -= estimateBodySize(entry.responseBody);
        entry.responseBody = { kind: "omitted", reason: "memory-cap" };
      }
      if (typeof entry.requestBody === "string") {
        memoryUsed -= estimateBodySize(entry.requestBody);
        entry.requestBody = { kind: "omitted", reason: "memory-cap" };
      }
      warnings.add("MEMORY_CAPPED");
    }
  }

  // FIFO eviction — body 없는 요청(HEAD/204/binary)이 폭증해도 buffer 자체 길이가 무한해지지 않도록.
  // 버그 재현 시나리오에서 가치 있는 신호는 후반부이므로 oldest를 버린다.
  function enforceEntryCap(): void {
    while (buffer.length > MAX_REQUEST_ENTRIES) {
      const evicted = buffer.shift();
      if (!evicted) break;
      memoryUsed -= estimateBodySize(evicted.requestBody);
      memoryUsed -= estimateBodySize(evicted.responseBody);
      warnings.add("ENTRY_CAPPED");
    }
  }

  function pushEntry(entry: CapturedRequest): void {
    buffer.push(entry);
    enforceEntryCap();
  }

  async function readBodyStreaming(response: Response, contentType: string): Promise<ReqBody> {
    if (!response.body) return { kind: "stream", contentType };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > BODY_CAP) {
          reader.cancel().catch(() => {});
          warnings.add("BODY_TRUNCATED");
          return { kind: "truncated", limit: BODY_CAP, size: total };
        }
        chunks.push(value);
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(merged);
    } catch {
      return { kind: "stream", contentType };
    }
  }

  // --- Fetch wrap ---
  const originalFetch = window.fetch;

  const recordHook: FetchRecordHook = (info) => {
    if (!recording) return () => {};

    totalSeen++;
    const startTime = Date.now();
    const url = maskUrl(info.url);

    let requestBody: ReqBody | undefined;
    const requestBodySize = info.requestBodySize;
    if (info.rawBody != null) {
      if (requestBodySize <= BODY_CAP) {
        requestBody = maskRequestBody(info.rawBody, info.contentType);
      } else {
        requestBody = { kind: "truncated", limit: BODY_CAP, size: requestBodySize };
      }
    }

    // send 시점에 phase="pending" entry push — in-flight·중단된 요청도 가시화.
    const entry: CapturedRequest = {
      id: genId(),
      url,
      method: info.method,
      status: 0,
      statusText: "",
      startTime,
      durationMs: 0,
      requestHeaders: maskHeaders(info.requestHeaders),
      responseHeaders: {},
      requestBody,
      pageUrl: location.href,
      requestBodySize,
      responseBodySize: 0,
      contentType: "",
      phase: "pending",
    };
    memoryUsed += estimateBodySize(entry.requestBody);
    pushEntry(entry);
    enforceMemoryCap();

    return async ({ response, error }) => {
      if (error || !response) {
        // 네트워크 실패·CORS 차단 등도 기록한다 (DevTools와 동일).
        entry.status = 0;
        entry.statusText = error instanceof Error ? error.message : "Network Error";
        entry.durationMs = Date.now() - startTime;
        entry.phase = "error";
        return;
      }

      entry.durationMs = Date.now() - startTime;
      entry.status = response.status;
      entry.statusText = response.statusText;
      const respHeaders = headersToRecord(response.headers);
      const contentType = response.headers.get("content-type") || "";
      const contentLength = parseInt(response.headers.get("content-length") || "", 10);
      entry.contentType = contentType;
      entry.responseHeaders = maskHeaders(respHeaders);

      let responseBody: ReqBody | undefined;
      let responseBodySize = 0;

      const classified = classifyResponseBody({ contentType, contentLength });
      if (classified !== null) {
        responseBody = classified;
        responseBodySize = classified.kind === "binary" || classified.kind === "truncated" ? classified.size : 0;
        if (classified.kind === "truncated") warnings.add("BODY_TRUNCATED");
      } else {
        try {
          const cloned = response.clone();
          const body = await readBodyStreaming(cloned, contentType);
          if (typeof body === "string") {
            responseBodySize = body.length;
            responseBody = body;
          } else if (body.kind === "truncated") {
            responseBody = body;
            responseBodySize = body.size;
          } else {
            responseBody = body;
            responseBodySize = isNaN(contentLength) ? 0 : contentLength;
          }
        } catch {
          responseBody = { kind: "stream", contentType };
        }
      }

      entry.responseBody = responseBody;
      entry.responseBodySize = responseBodySize;
      entry.phase = "complete";

      memoryUsed += estimateBodySize(entry.responseBody);
      enforceMemoryCap();
    };
  };

  window.fetch = createPatchedFetch(originalFetch, recordHook);

  // --- XHR wrap ---
  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;
  const originalSetRequestHeader = XHR.setRequestHeader;

  XHR.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    (this as any).__bugshot = {
      method,
      url: maskUrl(typeof url === "string" ? url : url.toString()),
      startTime: 0,
      reqHeaders: {} as Record<string, string>,
    };
    return (originalOpen as Function).call(this, method, url, ...rest);
  };

  XHR.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const meta = (this as any).__bugshot;
    if (meta) {
      meta.reqHeaders[name.toLowerCase()] = value;
    }
    return originalSetRequestHeader.call(this, name, value);
  };

  XHR.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    if (!recording) {
      return originalSend.call(this, body);
    }

    totalSeen++;
    const meta = (this as any).__bugshot;
    if (meta) meta.startTime = Date.now();

    let requestBody: ReqBody | undefined;
    let requestBodySize = 0;
    if (typeof body === "string") {
      requestBodySize = body.length;
      const ct = meta?.reqHeaders?.["content-type"] || "";
      if (requestBodySize <= BODY_CAP) {
        requestBody = maskRequestBody(body, ct);
      } else {
        requestBody = { kind: "truncated", limit: BODY_CAP, size: requestBodySize };
      }
    }

    // send 시점에 phase="pending" entry를 push하고, 완료/에러 시 같은 entry를 갱신.
    const entry: CapturedRequest = {
      id: genId(),
      url: meta?.url ?? "",
      method: meta?.method ?? "",
      status: 0,
      statusText: "",
      startTime: meta?.startTime ?? Date.now(),
      durationMs: 0,
      requestHeaders: maskHeaders(meta?.reqHeaders ?? {}),
      responseHeaders: {},
      requestBody,
      pageUrl: location.href,
      requestBodySize,
      responseBodySize: 0,
      contentType: "",
      phase: "pending",
    };
    memoryUsed += estimateBodySize(entry.requestBody);
    pushEntry(entry);
    enforceMemoryCap();

    // load / error / abort / timeout이 한 요청에 동시에 발화되는 일은 없지만,
    // race로 두 번 갱신되는 일을 막기 위해 captured 가드를 둔다.
    let captured = false;

    const xhr = this;
    function captureXhr(kind: "load" | "error" | "abort" | "timeout"): void {
      if (captured || !meta) return;
      captured = true;
      entry.durationMs = Date.now() - meta.startTime;
      const contentType = xhr.getResponseHeader("content-type") || "";
      const allHeaders = xhr.getAllResponseHeaders() || "";
      const respHeaders: Record<string, string> = {};
      allHeaders.split("\r\n").forEach((line) => {
        const idx = line.indexOf(":");
        if (idx > 0) {
          respHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      });
      entry.responseHeaders = maskHeaders(respHeaders);
      entry.contentType = contentType;

      if (kind === "load") {
        entry.status = xhr.status;
        entry.statusText = xhr.statusText;
        entry.phase = "complete";

        if (xhr.responseType === "" || xhr.responseType === "text") {
          const text = xhr.responseText;
          const classified = classifyResponseBody({
            contentType,
            contentLength: text.length,
          });
          if (classified !== null) {
            entry.responseBody = classified;
            if (classified.kind === "truncated") {
              entry.responseBodySize = classified.size;
              warnings.add("BODY_TRUNCATED");
            } else if (classified.kind === "binary") {
              entry.responseBodySize = classified.size;
            }
          } else {
            entry.responseBody = text;
            entry.responseBodySize = text.length;
          }
        } else {
          entry.responseBody = { kind: "binary", contentType, size: 0 };
        }
      } else {
        entry.status = 0;
        entry.statusText =
          kind === "error" ? "Network Error" :
          kind === "abort" ? "Aborted" :
          "Timeout";
        entry.phase = "error";
      }

      memoryUsed += estimateBodySize(entry.responseBody);
      enforceMemoryCap();
    }

    this.addEventListener("load", () => captureXhr("load"));
    this.addEventListener("error", () => captureXhr("error"));
    this.addEventListener("abort", () => captureXhr("abort"));
    this.addEventListener("timeout", () => captureXhr("timeout"));

    return originalSend.call(this, body);
  };

  // --- sendBeacon wrap ---
  // GA/Sentry/Datadog 등 분석 도구가 fire-and-forget POST로 사용. 응답은 없으므로 queue 성공 여부만 기록.
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function patchedSendBeacon(url: string | URL, data?: BodyInit | null): boolean {
      const queued = originalSendBeacon(url, data);
      if (recording) {
        totalSeen++;
        const startTime = Date.now();
        const urlStr = maskUrl(typeof url === "string" ? url : url.toString());

        const classified = classifyBeaconBody(data);
        let requestBody = classified.body;
        const requestBodySize = classified.size;
        const contentType = classified.contentType;

        if (typeof requestBody === "string") {
          requestBody = maskRequestBody(requestBody, contentType);
        }

        const entry: CapturedRequest = {
          id: genId(),
          url: urlStr,
          method: "POST",
          status: 0,
          statusText: queued ? "Queued" : "Queue Full",
          startTime,
          durationMs: 0,
          requestHeaders: {},
          responseHeaders: {},
          requestBody,
          pageUrl: location.href,
          requestBodySize,
          responseBodySize: 0,
          contentType,
          phase: queued ? "complete" : "error",
        };
        memoryUsed += estimateBodySize(entry.requestBody);
        pushEntry(entry);
        enforceMemoryCap();
      }
      return queued;
    };
  }

  // --- Sentinel-bound dispatch ---
  let currentSentinel: string | null = null;
  let stopHandler: (() => void) | null = null;
  let syncHandler: (() => void) | null = null;
  let clearHandler: (() => void) | null = null;

  function dispatch(): void {
    if (!currentSentinel) return;
    document.dispatchEvent(
      new CustomEvent("__bugshot_net_data__" + currentSentinel, {
        detail: {
          sentinel: currentSentinel,
          requests: buffer.slice(),
          totalSeen,
          warnings: Array.from(warnings),
        },
      }),
    );
  }

  function clearBuffer(): void {
    buffer.length = 0;
    totalSeen = 0;
    memoryUsed = 0;
    warnings.clear();
  }

  function detachSentinelListeners(): void {
    if (!currentSentinel) return;
    if (stopHandler) document.removeEventListener("__bugshot_net_stop__" + currentSentinel, stopHandler);
    if (syncHandler) document.removeEventListener("__bugshot_net_sync__" + currentSentinel, syncHandler);
    if (clearHandler) document.removeEventListener("__bugshot_net_clear__" + currentSentinel, clearHandler);
  }

  function setSentinel(sentinel: string): void {
    detachSentinelListeners();
    currentSentinel = sentinel;
    recording = true;
    stopHandler = () => { recording = false; dispatch(); };
    syncHandler = () => { dispatch(); };
    clearHandler = () => { clearBuffer(); };
    document.addEventListener("__bugshot_net_stop__" + sentinel, stopHandler);
    document.addEventListener("__bugshot_net_sync__" + sentinel, syncHandler);
    document.addEventListener("__bugshot_net_clear__" + sentinel, clearHandler);
  }

  document.addEventListener(SET_SENTINEL_EVENT, (e: Event) => {
    const detail = (e as CustomEvent).detail as { sentinel?: string } | undefined;
    if (detail?.sentinel) setSentinel(detail.sentinel);
  });

  // 풀 네비게이션으로 MAIN world가 파괴되기 직전 버퍼 flush(보조). sentinel 없으면 dispatch no-op.
  window.addEventListener("pagehide", () => dispatch());

  (window as any)[CTRL_KEY] = { setSentinel, clearBuffer };
}

networkRecorderScript();
