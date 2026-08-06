import type { ViewportRect } from "@/types/picker";

export const DEVICE_FRAME_ID = "__bugshot_device_frame__";
export const DEVICE_STYLE_ID = "__bugshot_device_style__";

// 은닉은 스타일시트 한 장이다 — 개별 요소의 인라인 스타일을 저장·복원하지 않으므로 복원이
// 무손실이고, 캡처 중 DOM이 바뀌어도 규칙이 계속 적용된다.
//
// 여백 색은 --muted다(어노테이션 캔버스와 같은 토큰이고 "캡처 이미지의 여백"이라는 역할도 같다).
// content script는 CSS 변수를 import할 수 없어 hsl() 리터럴 복제이고, 이 파일이 토큰 표의
// 네 번째 사본이다 — src/styles/__tests__/tokens.test.ts가 globals.css와 대조해 드리프트를 막는다.
// visibility가 아니라 display:none인 이유: 레이아웃이 살아 있으면 원본 문서의 옵저버·측정
// 코드가 계속 돌아 유령 로그가 늘어난다.
const FRAME_CSS = `
html { overflow: hidden !important; }
body { margin: 0 !important; padding: 0 !important; height: 100vh !important;
       overflow: hidden !important; background: hsl(210 40% 96.1%) !important;
       display: flex !important; justify-content: center !important; }
body > *:not(#${DEVICE_FRAME_ID}) { display: none !important; }
#${DEVICE_FRAME_ID} { border: 0 !important; display: block !important; height: 100% !important; }

@media (prefers-color-scheme: dark) {
  body { background: hsl(0 0% 14.9%) !important; }
}
`;

function frameEl(): HTMLIFrameElement | null {
  return document.getElementById(DEVICE_FRAME_ID) as HTMLIFrameElement | null;
}

/** 현재 래퍼 폭. 없으면 null. 모드의 단일 출처다. */
export function currentDeviceWidth(): number | null {
  const el = frameEl();
  if (!el) return null;
  const width = Number.parseFloat(el.style.width);
  return Number.isFinite(width) ? width : null;
}

/** 래퍼의 top 좌표계 rect. 없으면 null. area-select가 화면 캡처 rect로 쓴다. */
export function deviceFrameRect(): ViewportRect | null {
  const el = frameEl();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/**
 * 가용 폭·높이. innerWidth가 아니라 documentElement.clientWidth를 쓴다 —
 * 세로 스크롤바 15~17px을 빼지 않으면 래퍼가 가용 폭에 딱 맞을 때 가로 스크롤이 생긴다.
 */
export function availableViewport(): { width: number; height: number } {
  return {
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  };
}

/**
 * 래퍼를 만든다. 이미 있으면 폭만 갱신한다(노드 유지 = 재로드 없음 — 스크롤 위치·입력값이 산다).
 * **로드 판정을 전혀 하지 않는다** — XFO/CSP 판정 주체는 background 하나다. content가 href를
 * 비교해 스스로 롤백하면 정상 redirect를 차단으로 오판하고, iframe "load"를 신호로 올리는
 * 안도 초기 about:blank의 load에 걸려 정상 사이트를 차단으로 오판했다.
 */
export function mountDeviceFrame(width: number): void {
  if (!document.getElementById(DEVICE_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = DEVICE_STYLE_ID;
    style.textContent = FRAME_CSS;
    document.head.appendChild(style);
  }
  let frame = frameEl();
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = DEVICE_FRAME_ID;
    // src는 반드시 location.href다. srcdoc·about:blank는 <all_urls> 미매치라 content script가
    // 안 붙어 로그·picker가 통째로 죽는다(e2e/GOTCHAS.md).
    frame.src = location.href;
    // document.body 직속이다. shadow root 안에 넣으면 frame-geometry의 findChildIframe이
    // document.querySelectorAll("iframe")만 훑으므로 미등록이 되고, elementFromPoint가
    // shadow retargeting으로 host를 돌려줘 안내조차 없이 shadow host가 선택된다.
    document.body.appendChild(frame);
  }
  frame.style.width = `${width}px`;
}

/** 래퍼·스타일을 제거한다. 멱등. */
export function unmountDeviceFrame(): void {
  frameEl()?.remove();
  document.getElementById(DEVICE_STYLE_ID)?.remove();
}

/** 드래그 rect를 래퍼 영역 안으로 클램핑. 래퍼가 없으면 rect 그대로. */
export function clampToDeviceFrame(
  rect: ViewportRect,
  frame: ViewportRect | null,
): ViewportRect {
  if (!frame) return rect;
  const left = Math.max(rect.x, frame.x);
  const top = Math.max(rect.y, frame.y);
  const right = Math.min(rect.x + rect.width, frame.x + frame.width);
  const bottom = Math.min(rect.y + rect.height, frame.y + frame.height);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * 이 문서가 래퍼 자신인가. 래퍼는 언제나 top과 same-origin이라는 불변식 덕에 frameElement가
 * 항상 유효하다 — cross-origin 문서에서는 명세상 null이라 일반 iframe은 자연히 false가 된다.
 * try는 그 명세를 안 따르는 임베더(sandbox 조합 등)에서 접근이 throw할 때의 안전망이고,
 * 그 경우도 "래퍼가 아니다"로 접는 게 맞다.
 */
export function isDeviceFrame(): boolean {
  try {
    return (window.frameElement as HTMLElement | null)?.id === DEVICE_FRAME_ID;
  } catch {
    return false;
  }
}

/**
 * element 컨텍스트 확장 판정을 돌려도 되는 문서인가.
 * 원래 iframe을 제외한 논거("게이트가 자기 뷰포트 기준이라 top 좌표에서의 완전 포함을
 * 보장할 수 없다")는 래퍼에는 성립하지 않는다 — 래퍼는 height:100%로 top 뷰포트를 세로로
 * 꽉 채우고 가로는 자기 폭 그대로라 top 뷰포트에 항상 완전히 든다.
 */
export function allowsContextExpansion(): boolean {
  return window === window.top || isDeviceFrame();
}
