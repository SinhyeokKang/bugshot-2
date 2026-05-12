// MAIN world 네트워크 레코더. content_scripts(document_start, world: MAIN)로 모든 페이지에 자동 주입되어
// fetch/XHR을 즉시 wrap한다. 사이드패널이 setSentinel을 보내기 전까지는 wrap만 통과시키고 buffering은 하지 않는다.
export function networkRecorderScript(): void {
  const CTRL_KEY = "__bugshot_net_ctrl__";
  if ((window as any)[CTRL_KEY]) return; // 이미 초기화됨

  const BODY_CAP = 3 * 1024 * 1024; // 3 MB
  const MEMORY_CAP = 50 * 1024 * 1024; // 50 MB
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

  const CONTENT_TYPE_DENYLIST = [
    /^image\//i,
    /^audio\//i,
    /^video\//i,
    /^font\//i,
    /^application\/pdf$/i,
    /^application\/wasm$/i,
    /^application\/octet-stream$/i,
  ];
  const CONTENT_TYPE_ALLOWLIST = [
    /^application\/json/i,
    /^text\//i,
    /^application\/xml/i,
    /^application\/x-www-form-urlencoded/i,
  ];

  type ReqBody = string | { kind: "truncated" | "stream" | "binary" | "omitted" };

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
  }

  const buffer: CapturedRequest[] = [];
  let totalSeen = 0;
  let memoryUsed = 0;
  let bufferingEnabled = false;
  let recording = true;
  const warnings = new Set<string>();

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

  function isDeniedContentType(ct: string): boolean {
    return CONTENT_TYPE_DENYLIST.some((p) => p.test(ct));
  }

  function isAllowedContentType(ct: string): boolean {
    return CONTENT_TYPE_ALLOWLIST.some((p) => p.test(ct));
  }

  function headersToRecord(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((v, k) => { result[k] = v; });
    return result;
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
        entry.responseBody = { kind: "omitted" };
      }
      if (typeof entry.requestBody === "string") {
        memoryUsed -= estimateBodySize(entry.requestBody);
        entry.requestBody = { kind: "omitted" };
      }
      warnings.add("MEMORY_CAPPED");
    }
  }

  async function readBodyStreaming(response: Response): Promise<ReqBody> {
    if (!response.body) return { kind: "stream" };
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
          return { kind: "truncated" };
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
      return { kind: "stream" };
    }
  }

  // --- Fetch wrap ---
  const originalFetch = window.fetch;

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (!recording || !bufferingEnabled) {
      return originalFetch.call(this, input, init);
    }

    totalSeen++;
    const startTime = Date.now();
    const req = new Request(input, init);
    const method = req.method;
    const url = maskUrl(req.url);
    const reqContentType = req.headers.get("content-type") || "";

    let requestBody: ReqBody | undefined;
    let requestBodySize = 0;

    if (init?.body != null && typeof init.body === "string") {
      requestBodySize = init.body.length;
      if (requestBodySize <= BODY_CAP) {
        requestBody = maskRequestBody(init.body, reqContentType);
      } else {
        requestBody = { kind: "truncated" };
      }
    } else if (init?.body instanceof URLSearchParams) {
      const bodyStr = init.body.toString();
      requestBodySize = bodyStr.length;
      if (requestBodySize <= BODY_CAP) {
        requestBody = maskRequestBody(bodyStr, "application/x-www-form-urlencoded");
      } else {
        requestBody = { kind: "truncated" };
      }
    }

    let response: Response;
    try {
      response = await originalFetch.call(this, input, init);
    } catch (err) {
      // 네트워크 실패·CORS 차단 등도 기록한다 (DevTools와 동일).
      const failEntry: CapturedRequest = {
        id: genId(),
        url,
        method,
        status: 0,
        statusText: err instanceof Error ? err.message : "Network Error",
        startTime,
        durationMs: Date.now() - startTime,
        requestHeaders: maskHeaders(headersToRecord(req.headers)),
        responseHeaders: {},
        requestBody,
        pageUrl: location.href,
        requestBodySize,
        responseBodySize: 0,
        contentType: "",
      };
      memoryUsed += estimateBodySize(failEntry.requestBody);
      buffer.push(failEntry);
      enforceMemoryCap();
      throw err;
    }

    const durationMs = Date.now() - startTime;
    const respHeaders = headersToRecord(response.headers);
    const contentType = response.headers.get("content-type") || "";
    const contentLength = parseInt(response.headers.get("content-length") || "", 10);

    let responseBody: ReqBody | undefined;
    let responseBodySize = 0;

    if (isDeniedContentType(contentType)) {
      responseBody = { kind: "binary" };
      responseBodySize = isNaN(contentLength) ? 0 : contentLength;
    } else if (!isNaN(contentLength) && contentLength > BODY_CAP) {
      responseBody = { kind: "truncated" };
      responseBodySize = contentLength;
      warnings.add("BODY_TRUNCATED");
    } else if (isAllowedContentType(contentType)) {
      try {
        const cloned = response.clone();
        const body = await readBodyStreaming(cloned);
        if (typeof body === "string") {
          responseBodySize = body.length;
          responseBody = body;
        } else {
          responseBody = body;
          responseBodySize = isNaN(contentLength) ? 0 : contentLength;
        }
      } catch {
        responseBody = { kind: "stream" };
      }
    } else {
      responseBody = { kind: "binary" };
      responseBodySize = isNaN(contentLength) ? 0 : contentLength;
    }

    const entry: CapturedRequest = {
      id: genId(),
      url,
      method,
      status: response.status,
      statusText: response.statusText,
      startTime,
      durationMs,
      requestHeaders: maskHeaders(headersToRecord(req.headers)),
      responseHeaders: maskHeaders(respHeaders),
      requestBody,
      responseBody,
      pageUrl: location.href,
      requestBodySize,
      responseBodySize,
      contentType,
    };

    memoryUsed += estimateBodySize(entry.requestBody) + estimateBodySize(entry.responseBody);
    buffer.push(entry);
    enforceMemoryCap();

    return response;
  };

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
    if (!recording || !bufferingEnabled) {
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
        requestBody = { kind: "truncated" };
      }
    }

    // load / error / abort / timeout이 한 요청에 동시에 발화되는 일은 없지만,
    // race로 두 번 entry화되는 일을 막기 위해 captured 가드를 둔다.
    let captured = false;

    const xhr = this;
    function captureXhr(kind: "load" | "error" | "abort" | "timeout"): void {
      if (captured || !meta || !bufferingEnabled) return;
      captured = true;
      const durationMs = Date.now() - meta.startTime;
      const contentType = xhr.getResponseHeader("content-type") || "";
      const allHeaders = xhr.getAllResponseHeaders() || "";
      const respHeaders: Record<string, string> = {};
      allHeaders.split("\r\n").forEach((line) => {
        const idx = line.indexOf(":");
        if (idx > 0) {
          respHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      });

      let responseBody: ReqBody | undefined;
      let responseBodySize = 0;
      let status = xhr.status;
      let statusText = xhr.statusText;

      if (kind === "load") {
        if (isDeniedContentType(contentType)) {
          responseBody = { kind: "binary" };
        } else if (xhr.responseType === "" || xhr.responseType === "text") {
          const text = xhr.responseText;
          responseBodySize = text.length;
          if (responseBodySize > BODY_CAP) {
            responseBody = { kind: "truncated" };
            warnings.add("BODY_TRUNCATED");
          } else if (isAllowedContentType(contentType)) {
            responseBody = text;
          } else {
            responseBody = { kind: "binary" };
          }
        } else {
          responseBody = { kind: "binary" };
        }
      } else {
        status = 0;
        statusText =
          kind === "error" ? "Network Error" :
          kind === "abort" ? "Aborted" :
          "Timeout";
      }

      const entry: CapturedRequest = {
        id: genId(),
        url: meta.url,
        method: meta.method,
        status,
        statusText,
        startTime: meta.startTime,
        durationMs,
        requestHeaders: maskHeaders(meta.reqHeaders ?? {}),
        responseHeaders: maskHeaders(respHeaders),
        requestBody,
        responseBody,
        pageUrl: location.href,
        requestBodySize,
        responseBodySize,
        contentType,
      };

      memoryUsed += estimateBodySize(entry.requestBody) + estimateBodySize(entry.responseBody);
      buffer.push(entry);
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
      if (recording && bufferingEnabled) {
        totalSeen++;
        const startTime = Date.now();
        const urlStr = maskUrl(typeof url === "string" ? url : url.toString());

        let requestBody: ReqBody | undefined;
        let requestBodySize = 0;
        let contentType = "";

        if (typeof data === "string") {
          requestBodySize = data.length;
          requestBody = requestBodySize <= BODY_CAP
            ? maskRequestBody(data, "")
            : { kind: "truncated" };
        } else if (data instanceof Blob) {
          requestBodySize = data.size;
          contentType = data.type;
          requestBody = { kind: "binary" };
        } else if (data instanceof URLSearchParams) {
          const str = data.toString();
          requestBodySize = str.length;
          contentType = "application/x-www-form-urlencoded";
          requestBody = requestBodySize <= BODY_CAP
            ? maskRequestBody(str, contentType)
            : { kind: "truncated" };
        } else if (data instanceof FormData) {
          requestBody = { kind: "binary" };
        } else if (data instanceof ArrayBuffer) {
          requestBodySize = data.byteLength;
          requestBody = { kind: "binary" };
        } else if (data && ArrayBuffer.isView(data)) {
          requestBodySize = data.byteLength;
          requestBody = { kind: "binary" };
        }

        const entry: CapturedRequest = {
          id: genId(),
          url: urlStr,
          method: "POST",
          status: queued ? 200 : 0,
          statusText: queued ? "beacon" : "beacon queue full",
          startTime,
          durationMs: 0,
          requestHeaders: {},
          responseHeaders: {},
          requestBody,
          pageUrl: location.href,
          requestBodySize,
          responseBodySize: 0,
          contentType,
        };
        memoryUsed += estimateBodySize(entry.requestBody);
        buffer.push(entry);
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
    bufferingEnabled = true;
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

  (window as any)[CTRL_KEY] = { setSentinel, clearBuffer };
}

networkRecorderScript();
