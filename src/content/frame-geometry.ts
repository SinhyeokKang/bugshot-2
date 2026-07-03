import type { ViewportRect } from "@/types/picker";

// iframe picker와 부모 프레임 사이의 postMessage 핸드셰이크.
// (a) 자식 picker 존재 등록(registry — blocker 핸드오프 게이팅의 진실 소스)
// (b) 캡처용 top-frame 좌표 offset 응답 (1-depth 한정 — 중첩은 미지원 응답)
// (c) offset 응답 시 top overlay 숨김(onChildCapturePrep 훅 — 캡처에 안 찍히게)

export interface FrameOffset {
  x: number;
  y: number;
  // 크롭 scale 기준은 반드시 top 뷰포트 — iframe 뷰포트를 쓰면 크롭이 어긋난다.
  topViewport: { width: number; height: number };
}

const PRESENT_TYPE = "__bugshot_frame_present__";
const OFFSET_REQ_TYPE = "__bugshot_frame_offset_req__";
const OFFSET_RES_TYPE = "__bugshot_frame_offset_res__";

export function composeTopRect(
  inner: ViewportRect,
  offset: { x: number; y: number },
): ViewportRect {
  return {
    x: inner.x + offset.x,
    y: inner.y + offset.y,
    width: inner.width,
    height: inner.height,
  };
}

// top 뷰포트와 한 픽셀이라도 겹치는가 — iframe 자체가 top 밖으로 스크롤된 상태의
// 캡처는 빈 화면 조각이 되므로 호출부가 rect null(캡처 실패) 폴백에 쓴다. 순수.
export function rectIntersectsViewport(
  rect: ViewportRect,
  viewport: { width: number; height: number },
): boolean {
  return (
    rect.x < viewport.width &&
    rect.y < viewport.height &&
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0
  );
}

// PRESENT/announce 공유 token — 사이드패널이 picker.start(chrome 경로, 페이지 위조 불가)에
// 실어 전 프레임에 broadcast한 값. 자식은 announce에 싣고 top은 등록 검증에 쓴다.
// 임의 iframe 스크립트의 무인증 postMessage 등록(→ blocker 핸드오프 위조 개방)을 차단.
let frameToken: string | null = null;

// picker.start broadcast의 프레임 간 도착 순서는 비보장(cross-origin은 별도 프로세스) —
// 자식 announce가 top의 setFrameToken보다 선착하면 검증 불가이므로 보류해 두고 token 설정
// 시점에 재평가한다(미보류 시 조용한 drop → 그 세션 내내 등록 영구 거부). source당 1개로
// 상한 — 임의 iframe이 위조 token으로 남의 슬롯을 밀어내지 못한다.
const pendingPresents: { source: MessageEventSource; token: string }[] = [];
const PENDING_PRESENT_MAX = 50;

function holdPendingPresent(source: MessageEventSource, token: string): void {
  const idx = pendingPresents.findIndex((p) => p.source === source);
  if (idx >= 0) {
    pendingPresents[idx] = { source, token };
    return;
  }
  if (pendingPresents.length >= PENDING_PRESENT_MAX) pendingPresents.shift();
  pendingPresents.push({ source, token });
}

export function setFrameToken(token: string | null): void {
  frameToken = token;
  const held = pendingPresents.splice(0, pendingPresents.length);
  if (!token) return;
  for (const p of held) {
    if (p.token !== token) continue;
    const iframe = findChildIframe(p.source);
    if (iframe) childFrames.add(iframe);
  }
}

// 자식(iframe) → 부모: picker 시작 시 자기 존재를 알린다. 부모가 event.source로
// 매칭되는 <iframe>을 registry에 등록해 blocker 핸드오프 대상으로 삼는다.
// 1-depth 한정 — 중첩(부모가 top이 아님)은 등록하지 않아 클릭이 거부 경로(안내 다이얼로그)로 간다.
export function announceFrameToParent(): void {
  if (window === window.top) return;
  if (window.parent !== window.top) return;
  if (!frameToken) return;
  window.parent.postMessage({ type: PRESENT_TYPE, token: frameToken }, "*");
}

// 등록된 자식 iframe element — WeakSet이라 iframe 제거 시 자동 해제.
const childFrames = new WeakSet<Element>();

export function isRegisteredChildFrame(el: Element): boolean {
  return childFrames.has(el);
}

// cross-origin에서도 contentWindow === event.source 비교는 허용된다.
function findChildIframe(
  source: MessageEventSource | null,
): HTMLIFrameElement | null {
  if (!source) return null;
  for (const el of Array.from(document.querySelectorAll("iframe"))) {
    if (el.contentWindow === source) return el;
  }
  return null;
}

// 부모(top) 측 리스너 — 모든 프레임에서 1회 설치되지만 top에서만 반응한다.
// OFFSET_REQ는 무인증 postMessage라 임의 iframe 스크립트가 쏠 수 있다 — consumeArm
// (사이드패널이 picker.armFrameOffset chrome 메시지로 1회성 arm, 페이지 위조 불가)이
// 소비될 때만 응답해 top overlay 임의 숨김·captureInflight 오염·geometry 유출을 차단.
export function installFrameOffsetResponder(hooks: {
  onChildCapturePrep: () => { width: number; height: number };
  consumeArm: () => boolean;
}): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (window !== window.top) return;
    const data = event.data as { type?: string; token?: string } | null;
    if (!data || typeof data !== "object") return;

    if (data.type === PRESENT_TYPE) {
      if (typeof data.token !== "string" || !event.source) return;
      // token 불일치는 등록 거부(무인증 postMessage 위조 차단). token 미설정(선착 announce)
      // 이거나 불일치면 보류 — setFrameToken에서 재평가(도착 순서 비보장 대비).
      if (!frameToken || data.token !== frameToken) {
        holdPendingPresent(event.source, data.token);
        return;
      }
      const iframe = findChildIframe(event.source);
      if (iframe) childFrames.add(iframe);
      return;
    }

    if (data.type === OFFSET_REQ_TYPE) {
      if (typeof data.token !== "string") return;
      const iframe = findChildIframe(event.source);
      if (!iframe?.contentWindow) return;
      // registry 미등록 프레임의 요청은 arm 소비 전에 거부 — 미등록 iframe 스팸이
      // 정상 캡처의 arm을 선점(타임아웃 실패)하거나 geometry를 얻는 것을 차단.
      if (!childFrames.has(iframe)) return;
      // 미arm 요청은 무응답 — 자식은 타임아웃 폴백(rect null, 캡처 실패 경로).
      if (!hooks.consumeArm()) return;
      // onChildCapturePrep(=beginCapturePrep)이 top overlay 숨김 + top 뷰포트 반환.
      // 복원은 사이드패널의 picker.endCapture(캡처 프레임 + frame 0 타깃 send)가 담당.
      const topViewport = hooks.onChildCapturePrep();
      const rect = iframe.getBoundingClientRect();
      const offset: FrameOffset = {
        x: rect.left + iframe.clientLeft,
        y: rect.top + iframe.clientTop,
        topViewport,
      };
      iframe.contentWindow.postMessage(
        { type: OFFSET_RES_TYPE, token: data.token, offset },
        "*",
      );
    }
  });
}

// 응답 offset 형태 검증 — 비숫자/NaN이 크롭 rect 계산에 흘러들지 않게 null(안전 실패) 처리.
function isValidOffset(value: unknown): value is FrameOffset {
  if (!value || typeof value !== "object") return false;
  const o = value as FrameOffset;
  return (
    Number.isFinite(o.x) &&
    Number.isFinite(o.y) &&
    !!o.topViewport &&
    Number.isFinite(o.topViewport.width) &&
    Number.isFinite(o.topViewport.height)
  );
}

// 자식 측: 부모에 offset 요청 → token 매칭 응답 대기. 타임아웃/중첩 미지원이면 null
// (호출부는 rect null — 캡처 실패 폴백. prepareCaptureBySelector 500ms 폴백 선례).
export function requestFrameOffset(timeoutMs = 500): Promise<FrameOffset | null> {
  if (window === window.top) return Promise.resolve(null);
  const token = crypto.randomUUID();
  return new Promise((resolve) => {
    const finish = (value: FrameOffset | null): void => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (event: MessageEvent): void => {
      // 위조 방어: 부모 window에서 온 token 매칭 응답만 수용(offset 스푸핑 → 크롭 rect 조작 방지).
      // 부모 origin까지 확인(ancestorOrigins) — source 통과 후 남는 부모 페이지 스크립트
      // 위조와는 무관하지만(동일 origin) design 스펙 준수 차원의 이중 확인.
      if (event.source !== window.parent) return;
      const parentOrigin = window.location?.ancestorOrigins?.[0];
      if (parentOrigin && event.origin !== parentOrigin) return;
      const data = event.data as {
        type?: string;
        token?: string;
        offset?: FrameOffset | null;
      } | null;
      if (!data || typeof data !== "object") return;
      if (data.type !== OFFSET_RES_TYPE || data.token !== token) return;
      finish(isValidOffset(data.offset) ? data.offset : null);
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.parent.postMessage({ type: OFFSET_REQ_TYPE, token }, "*");
  });
}
