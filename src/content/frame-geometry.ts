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

// 자식(iframe) → 부모: picker 시작 시 자기 존재를 알린다. 부모가 event.source로
// 매칭되는 <iframe>을 registry에 등록해 blocker 핸드오프 대상으로 삼는다.
// 1-depth 한정 — 중첩(부모가 top이 아님)은 등록하지 않아 클릭이 거부 경로(안내 다이얼로그)로 간다.
export function announceFrameToParent(): void {
  if (window === window.top) return;
  if (window.parent !== window.top) return;
  window.parent.postMessage({ type: PRESENT_TYPE }, "*");
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
      const iframe = findChildIframe(event.source);
      if (iframe) childFrames.add(iframe);
      return;
    }

    if (data.type === OFFSET_REQ_TYPE) {
      if (typeof data.token !== "string") return;
      const iframe = findChildIframe(event.source);
      if (!iframe?.contentWindow) return;
      // 미arm 요청은 무응답 — 자식은 타임아웃 폴백(rect null, 캡처 실패 경로).
      if (!hooks.consumeArm()) return;
      // onChildCapturePrep(=beginCapturePrep)이 top overlay 숨김 + top 뷰포트 반환.
      // 복원은 사이드패널의 picker.endCapture broadcast가 담당.
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
      if (event.source !== window.parent) return;
      const data = event.data as {
        type?: string;
        token?: string;
        offset?: FrameOffset | null;
      } | null;
      if (!data || typeof data !== "object") return;
      if (data.type !== OFFSET_RES_TYPE || data.token !== token) return;
      finish(data.offset ?? null);
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.parent.postMessage({ type: OFFSET_REQ_TYPE, token }, "*");
  });
}
