import { objectEntries } from "./recorder-globals";
import { BODY_CAP, beaconStatus, classifyBeaconBody, classifyResponseBody, createPatchedFetch, createPatchedSetRequestHeader, fetchFailureStatus, headersToRecord, maskBody, maskUrl, classifyWsFrameData, maskWsFrame, estimateBodySize, findOldestBodyIndex, reclaimableSize, xhrFailureStatus } from "./network-recorder-helpers";
import type { FetchRecordHook } from "./network-recorder-helpers";
import { createTrailingThrottle, FLUSH_INTERVAL_MS } from "./log-throttle";
import { readPreArmFlag, setPreArmFlag } from "./recorder-prearm";
import { addEventListener, CustomEventCtor, dispatchEvent, randomUUID, removeEventListener } from "./recorder-globals";
import { createSentinelRegistry } from "./sentinel-registry";
import type { NetworkRequestBody, NetworkRequestPhase, NetworkStatusKind, WebSocketFrame, WebSocketFrameDirection, WebSocketMeta } from "@/types/network";

function networkRecorderScript(): void {
  const CTRL_KEY = "__bugshot_net_ctrl__";
  if ((window as any)[CTRL_KEY]) return; // 이미 초기화됨

  const MEMORY_CAP = 50 * 1024 * 1024; // 50 MB
  const MAX_REQUEST_ENTRIES = 5000; // log-merge.ts NETWORK_MAX_ENTRIES와 동일 유지 (sidepanel 번들 격리로 값 동기화)
  const MAX_WS_FRAMES_PER_CONN = 1000; // 연결당 프레임 FIFO 캡
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
    statusKind?: NetworkStatusKind;
    preArm?: boolean;
    webSocket?: WebSocketMeta;
  }

  const buffer: CapturedRequest[] = [];
  let totalSeen = 0;
  let memoryUsed = 0;
  let recording = false;
  // pre-arm: active origin이면 sentinel 전에도 적재(capturing). dispatch는 sentinel 없으면 no-op.
  const preArm = readPreArmFlag();
  let capturing = preArm;
  type NetworkWarning = "MEMORY_CAPPED" | "ENTRY_CAPPED" | "BODY_TRUNCATED" | "WS_FRAMES_CAPPED";
  const warnings = new Set<NetworkWarning>();

  // 페이지가 crypto를 갈아끼워 모든 id를 같게 만들면 사이드패널 log-merge의 id dedup이
  // 로그 전체를 1건으로 접는다 — 스냅샷 경유.
  function genId(): string {
    if (randomUUID) return randomUUID();
    return `nr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function isMaskedHeader(name: string): boolean {
    const lower = name.toLowerCase();
    if (MASKED_HEADERS.has(lower)) return true;
    return MASKED_HEADER_PATTERNS.some((p) => p.test(lower));
  }

  // 이 형태의 단일 출처는 src/lib/masked-header.ts다. 이 파일은 recorders-entry 청크라
  // src/content/ 밖을 import하면 동기 IIFE가 깨져 pre-arm이 죽으므로 리터럴을 복제해 두고,
  // masked-header.test.ts의 소스 대조가 두 벌이 갈라지지 않게 묶는다.
  function maskHeaderValue(value: string): string {
    return `***[len:${value.length}]`;
  }

  // 순회도 스냅샷 경유 — 페이지가 Object.entries를 키를 살짝 바꿔 돌려주는 함수로 갈면
  // isMaskedHeader가 빗나가 Authorization·Cookie 원문이 그대로 로그에 남는다.
  function maskHeaders(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of objectEntries(headers)) {
      result[k] = isMaskedHeader(k) ? maskHeaderValue(v) : v;
    }
    return result;
  }

  // 주의: WebSocket 프레임(webSocket.frames)은 memoryUsed에 합류하지 않는다 — 연결당 프레임 수 캡
  // (MAX_WS_FRAMES_PER_CONN) + ENTRY_CAP으로만 bound(수용된 한계, attachWsRecorder 참조).
  function enforceMemoryCap(): void {
    while (memoryUsed > MEMORY_CAP && buffer.length > 0) {
      const oldestWithBody = findOldestBodyIndex(buffer);
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
  // evict된 in-flight entry가 뒤늦게 settle하며 memoryUsed를 영구 과대계상하지 않도록 표시해 둔다.
  const evictedEntries = new WeakSet<CapturedRequest>();
  function enforceEntryCap(): void {
    while (buffer.length > MAX_REQUEST_ENTRIES) {
      const evicted = buffer.shift();
      if (!evicted) break;
      evictedEntries.add(evicted);
      memoryUsed -= reclaimableSize(evicted);
      warnings.add("ENTRY_CAPPED");
    }
  }

  // console/action의 pushEntry와 맞춘 첫 줄 게이트. 호출부 게이트와 이 게이트 사이에 페이지
  // 코드가 낀다(maskUrl의 URL 생성자·url.toString) — 그 창에서 위조 stop이 capturing을 뒤집으면
  // 여기가 발화하므로 memoryUsed 갱신도 게이트 뒤에 둬야 계측이 버퍼와 갈라지지 않는다.
  function pushEntry(entry: CapturedRequest): void {
    if (!capturing) return;
    memoryUsed += estimateBodySize(entry.requestBody);
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
    if (!capturing) return () => {};

    totalSeen++;
    const startTime = Date.now();
    const url = maskUrl(info.url);

    let requestBody: ReqBody | undefined;
    const requestBodySize = info.requestBodySize;
    if (info.rawBody != null) {
      if (requestBodySize <= BODY_CAP) {
        requestBody = maskBody(info.rawBody, info.contentType);
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
      pageUrl: maskUrl(location.href),
      requestBodySize,
      responseBodySize: 0,
      contentType: "",
      phase: "pending",
    };
    if (!recording) entry.preArm = true;
    pushEntry(entry);
    enforceMemoryCap();
    throttle.schedule();

    return async ({ response, error }) => {
      if (error || !response) {
        // 네트워크 실패·CORS 차단 등도 기록한다 (DevTools와 동일).
        const failure = fetchFailureStatus(error);
        entry.status = 0;
        entry.statusText = failure.statusText;
        entry.statusKind = failure.statusKind;
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
            responseBody = maskBody(body, contentType);
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

      if (!evictedEntries.has(entry)) {
        memoryUsed += estimateBodySize(entry.responseBody);
        enforceMemoryCap();
      }
    };
  };

  window.fetch = createPatchedFetch(originalFetch, recordHook, () => capturing);

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
    const result = (originalOpen as Function).call(this, method, url, ...rest);
    if (!capturing) {
      try { delete (this as any).__bugshot; } catch {}
      return result;
    }
    try {
      (this as any).__bugshot = {
        method,
        url: maskUrl(typeof url === "string" ? url : url.toString()),
        startTime: 0,
        reqHeaders: {} as Record<string, string>,
      };
    } catch { /* recording must not affect the page request */ }
    return result;
  };

  XHR.setRequestHeader = createPatchedSetRequestHeader(
    originalSetRequestHeader,
    (xhr, name, value) => {
      const meta = (xhr as any).__bugshot;
      if (meta) meta.reqHeaders[name.toLowerCase()] = value;
    },
  );

  XHR.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    if (!capturing) {
      return originalSend.call(this, body);
    }
    // 기록 로직 실패가 페이지 XHR을 깨뜨리지 않도록 감싸고, 무슨 일이 있어도 originalSend는 호출한다.
    try {
      recordXhrSend(this, body);
    } catch {
      /* 레코더 오류는 무시 */
    }
    return originalSend.call(this, body);
  };

  function recordXhrSend(
    xhrInstance: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    // arm 직전에 open()된 XHR은 meta가 없다. 그대로 진행하면 url·method가 빈 엔트리가 push되고
    // captureXhr의 meta 가드 때문에 영구 pending으로 남는다 — 아예 만들지 않는 편이 정확하다.
    const meta = (xhrInstance as any).__bugshot;
    if (!meta) return;
    totalSeen++;
    meta.startTime = Date.now();

    let requestBody: ReqBody | undefined;
    let requestBodySize = 0;
    if (typeof body === "string") {
      requestBodySize = body.length;
      const ct = meta.reqHeaders?.["content-type"] || "";
      if (requestBodySize <= BODY_CAP) {
        requestBody = maskBody(body, ct);
      } else {
        requestBody = { kind: "truncated", limit: BODY_CAP, size: requestBodySize };
      }
    }

    // send 시점에 phase="pending" entry를 push하고, 완료/에러 시 같은 entry를 갱신.
    const entry: CapturedRequest = {
      id: genId(),
      url: meta.url,
      method: meta.method,
      status: 0,
      statusText: "",
      startTime: meta.startTime,
      durationMs: 0,
      requestHeaders: maskHeaders(meta.reqHeaders ?? {}),
      responseHeaders: {},
      requestBody,
      pageUrl: maskUrl(location.href),
      requestBodySize,
      responseBodySize: 0,
      contentType: "",
      phase: "pending",
    };
    if (!recording) entry.preArm = true;
    pushEntry(entry);
    enforceMemoryCap();
    throttle.schedule();

    // load / error / abort / timeout이 한 요청에 동시에 발화되는 일은 없지만,
    // race로 두 번 갱신되는 일을 막기 위해 captured 가드를 둔다.
    let captured = false;

    const xhr = xhrInstance;
    function captureXhr(kind: "load" | "error" | "abort" | "timeout"): void {
      if (captured) return;
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
            entry.responseBody = maskBody(text, contentType);
            entry.responseBodySize = text.length;
          }
        } else {
          entry.responseBody = { kind: "binary", contentType, size: 0 };
        }
      } else {
        const failure = xhrFailureStatus(kind);
        entry.status = 0;
        entry.statusText = failure.statusText;
        entry.statusKind = failure.statusKind;
        entry.phase = "error";
      }

      if (!evictedEntries.has(entry)) {
        memoryUsed += estimateBodySize(entry.responseBody);
        enforceMemoryCap();
      }
    }

    // 기록 throw를 페이지 XHR의 리스너 체인으로 흘리지 않는다 — 흘리면 페이지 에러 모니터링이
    // 오염되고, 우리 console 레코더가 그걸 페이지 에러로 되받아 리포트에 허위 신호를 남긴다
    // (무간섭 3원칙 ②, POSTMORTEM 2026-07-23 계열).
    const safeCapture = (kind: "load" | "error" | "abort" | "timeout") => () => {
      try { captureXhr(kind); } catch { /* 레코더 오류는 무시 */ }
    };
    addEventListener(xhr, "load", safeCapture("load"));
    addEventListener(xhr, "error", safeCapture("error"));
    addEventListener(xhr, "abort", safeCapture("abort"));
    addEventListener(xhr, "timeout", safeCapture("timeout"));
  }

  // --- sendBeacon wrap ---
  // GA/Sentry/Datadog 등 분석 도구가 fire-and-forget POST로 사용. 응답은 없으므로 queue 성공 여부만 기록.
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function patchedSendBeacon(url: string | URL, data?: BodyInit | null): boolean {
      const queued = originalSendBeacon(url, data);
      if (!capturing) return queued;
      // sendBeacon은 pagehide 핸들러 안에서 불리는 경우가 많아 여기서 throw하면 페이지의 teardown이
      // 통째로 중단된다. 기록 블록 전체를 격리한다(원본은 이미 호출됨).
      try {
        totalSeen++;
        const startTime = Date.now();
        const urlStr = maskUrl(typeof url === "string" ? url : url.toString());

        const classified = classifyBeaconBody(data);
        let requestBody = classified.body;
        const requestBodySize = classified.size;
        const contentType = classified.contentType;

        if (typeof requestBody === "string") {
          requestBody = maskBody(requestBody, contentType);
        }

        const entry: CapturedRequest = {
          id: genId(),
          url: urlStr,
          method: "POST",
          status: 0,
          ...beaconStatus(queued),
          startTime,
          durationMs: 0,
          requestHeaders: {},
          responseHeaders: {},
          requestBody,
          pageUrl: maskUrl(location.href),
          requestBodySize,
          responseBodySize: 0,
          contentType,
          phase: queued ? "complete" : "error",
        };
        if (!recording) entry.preArm = true;
        pushEntry(entry);
        enforceMemoryCap();
        throttle.schedule();
      } catch {
        /* 레코더 오류는 무시 */
      }
      return queued;
    };
  }

  // --- WebSocket wrap ---
  // 생성자만 Proxy로 가로채고(생성 시점 캡처 불가피), 인스턴스 send는 직접 치환(기존 후킹 컨벤션).
  // 프레임은 webSocket.frames에 적재 — 전역 MEMORY_CAP eviction에는 합류하지 않고(수용된 한계)
  // 연결당 프레임 수 캡 + 본문 BODY_CAP truncate + 연결 엔트리 ENTRY_CAP으로만 bound한다.
  function attachWsRecorder(ws: WebSocket, args: unknown[]): void {
    totalSeen++;
    const startTime = Date.now();
    const rawUrl = ws.url || (typeof args[0] === "string" ? args[0] : String(args[0] ?? ""));
    const frames: WebSocketFrame[] = [];
    const entry: CapturedRequest = {
      id: genId(),
      url: maskUrl(rawUrl),
      method: "WS",
      status: 101,
      statusText: "Switching Protocols",
      startTime,
      durationMs: 0,
      requestHeaders: {},
      responseHeaders: {},
      pageUrl: maskUrl(location.href),
      requestBodySize: 0,
      responseBodySize: 0,
      contentType: "websocket",
      phase: "pending",
      webSocket: { protocol: "", frames, framesTotal: 0 },
    };
    if (!recording) entry.preArm = true;
    pushEntry(entry);
    throttle.schedule();
    const meta = entry.webSocket!;
    let frameSeq = 0;

    function pushFrame(frame: Omit<WebSocketFrame, "seq">): void {
      meta.framesTotal++;
      frames.push({ ...frame, seq: frameSeq++ });
      if (frames.length > MAX_WS_FRAMES_PER_CONN) {
        frames.shift();
        warnings.add("WS_FRAMES_CAPPED");
      }
      throttle.schedule();
    }

    function recordData(direction: Extract<WebSocketFrameDirection, "send" | "receive">, data: unknown): void {
      const classified = classifyWsFrameData(data);
      if (classified === null) {
        meta.framesTotal++; // 바이너리 — 드롭(프레임 미적재), 통계만 반영.
        throttle.schedule();
        return;
      }
      if (typeof classified === "string") {
        pushFrame({ direction, ts: Date.now(), data: maskWsFrame(classified), size: classified.length });
      } else {
        warnings.add("BODY_TRUNCATED");
        pushFrame({ direction, ts: Date.now(), data: classified, size: classified.size });
      }
    }

    addEventListener(ws, "open", () => {
      if (!capturing) return;
      meta.protocol = ws.protocol || "";
      pushFrame({ direction: "open", ts: Date.now(), size: 0 });
    });
    addEventListener(ws, "message", (ev: MessageEvent) => {
      if (!capturing) return;
      recordData("receive", ev.data);
    });
    addEventListener(ws, "close", (close: CloseEvent) => {
      if (!capturing) return;
      pushFrame({
        direction: "close",
        ts: Date.now(),
        size: 0,
        code: close.code,
        reason: close.reason || undefined,
        wasClean: close.wasClean,
      });
      entry.phase = close.wasClean ? "complete" : "error";
      entry.durationMs = Date.now() - startTime;
    });
    // error는 별도 프레임 없음 — close 이벤트가 뒤따라 phase를 전이한다.

    const originalSend = ws.send.bind(ws);
    ws.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (capturing) {
        try { recordData("send", data); } catch { /* 레코더 오류 무시 */ }
      }
      return originalSend(data);
    };
  }

  function patchWebSocket(): void {
    const OriginalWebSocket = window.WebSocket;
    if (typeof OriginalWebSocket !== "function") return;
    window.WebSocket = new Proxy(OriginalWebSocket, {
      construct(target, ctorArgs, newTarget) {
        const ws = Reflect.construct(target, ctorArgs, newTarget) as WebSocket;
        if (capturing) {
          try { attachWsRecorder(ws, ctorArgs); } catch { /* 후킹 실패해도 원본 WebSocket 무간섭 */ }
        }
        return ws;
      },
    });
  }

  // --- Sentinel-bound dispatch ---
  // 다중 등록 — 무엇을 막고 무엇이 남는지는 sentinel-registry.ts 헤더 참조.
  const sentinels = createSentinelRegistry();
  const sentinelHandlers = new Map<string, { stop: () => void; sync: () => void; clear: () => void }>();

  function dispatch(): void {
    const registered = sentinels.list();
    if (!registered.length) return;
    for (const sentinel of registered) {
      // 배열은 sentinel마다 새로 뜬다(공유하면 먼저 등록된 위조 리스너가 비운다). 격리는
      // 배열까지 — 엔트리 객체는 공유 참조다. sentinel-registry.ts 헤더 참조.
      dispatchEvent(
        document,
        new CustomEventCtor("__bugshot_net_data__" + sentinel, {
          detail: {
            sentinel,
            requests: buffer.slice(),
            totalSeen,
            warnings: Array.from(warnings),
          },
        }),
      );
    }
  }

  // recording 게이트를 통과한 pending push 지점에서만 schedule → 최대 FLUSH_INTERVAL_MS마다 실시간 dispatch.
  // 응답 갱신(complete/error in-place)에는 schedule하지 않는다 — 다음 trailing 주기·sync·pagehide에
  // 전체 버퍼로 나가고 mergeLogItems id dedup이 최신본으로 흡수(complete 반영 최대 200ms 지연, 무손실).
  const throttle = createTrailingThrottle(dispatch, FLUSH_INTERVAL_MS);

  // 페이지가 sessionStorage pre-arm 플래그를 위조하면 적재가 무기한 켜진 채 남는다. 정당한
  // pre-arm은 패널이 열린 origin의 reload이고 재arm은 tabs.onUpdated status==="complete"에
  // 걸려 있다 — 즉 상한은 document_start부터 **페이지 load 완료까지**를 덮어야 정상 로그를 안 자른다.
  const PREARM_GRACE_MS = 60000;
  let armedOnce = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  if (preArm) {
    graceTimer = setTimeout(() => {
      graceTimer = null;
      // 해제는 clearTimeout에 의존할 수 없다 — 페이지가 그걸 no-op으로 바꾸면 정당하게
      // arm된 세션이 만료 시점에 죽는다. recording이 아니라 armedOnce를 보는 이유: arm 후
      // stop된 상태에서도 이 타이머가 남의 버퍼를 비우면 안 된다(타이머의 조건은 "arm이
      // 한 번도 안 왔다"이지 "지금 녹화 중이 아니다"가 아니다).
      if (armedOnce) return;
      capturing = false;
      clearBuffer();
      throttle.cancel();
    }, PREARM_GRACE_MS);
  }

  patchWebSocket();

  function clearBuffer(): void {
    buffer.length = 0;
    totalSeen = 0;
    memoryUsed = 0;
    warnings.clear();
  }

  function detachSentinel(sentinel: string): void {
    const handlers = sentinelHandlers.get(sentinel);
    if (!handlers) return;
    sentinelHandlers.delete(sentinel);
    removeEventListener(document, "__bugshot_net_stop__" + sentinel, handlers.stop);
    removeEventListener(document, "__bugshot_net_sync__" + sentinel, handlers.sync);
    removeEventListener(document, "__bugshot_net_clear__" + sentinel, handlers.clear);
  }

  function setSentinel(sentinel: string): void {
    if (sentinels.add(sentinel)) {
      for (const gone of sentinels.evicted()) detachSentinel(gone);
      // stop은 현재 world의 적재·전송을 끈다(capturing=false). sessionStorage 플래그는 유지 —
      // 이후 reload 시 새 world가 플래그를 읽어 pre-arm을 다시 켠다.
      const handlers = {
        stop: () => { recording = false; capturing = false; throttle.flushNow(); },
        sync: () => { throttle.flushNow(); },
        clear: () => { clearBuffer(); throttle.cancel(); },
      };
      sentinelHandlers.set(sentinel, handlers);
      addEventListener(document, "__bugshot_net_stop__" + sentinel, handlers.stop);
      addEventListener(document, "__bugshot_net_sync__" + sentinel, handlers.sync);
      addEventListener(document, "__bugshot_net_clear__" + sentinel, handlers.clear);
    }
    // 재발행(같은 sentinel)에서도 arm 상태는 다시 세운다 — 리스너만 멱등이다.
    armedOnce = true;
    recording = true;
    capturing = true;
    setPreArmFlag(); // 이후 reload/same-origin 네비에서 pre-arm 적재가 켜지도록 active 표시.
    if (graceTimer != null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    if (buffer.length) throttle.schedule(); // pre-arm 초반 버퍼 소급 flush.
  }

  addEventListener(document, SET_SENTINEL_EVENT, (e: Event) => {
    const detail = (e as CustomEvent).detail as { sentinel?: string } | undefined;
    if (detail?.sentinel) setSentinel(detail.sentinel);
  });

  // 풀 네비게이션으로 MAIN world가 파괴되기 직전 버퍼 flush(보조). sentinel 없으면 dispatch no-op.
  addEventListener(window, "pagehide", () => throttle.flushNow());
  // 탭 숨김 직전 최신 꼬리까지 flush(안전망 다중화). hidden 외 상태 변화는 무시.
  addEventListener(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") throttle.flushNow();
  });

  // 함수가 아니라 마커다 — 걸어두면 페이지가 부를 수 있다. 용도는 위쪽 중복 초기화 가드뿐.
  (window as any)[CTRL_KEY] = true;
}

networkRecorderScript();
