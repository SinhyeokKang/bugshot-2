import { ANNOTATION_HOST_ID } from "./annotation";
import { HOST_ID } from "./overlay";

import type { PageMetrics, ScrollAck } from "@/types/picker";

interface HiddenFixed {
  el: HTMLElement;
  prevValue: string;
  prevPriority: string;
}

export interface ScrollCaptureSession {
  originalScroll: { x: number; y: number };
  // 첫 hideFixed 호출에서 1회만 수집 — 타일마다 전수 순회하면 강제 리플로우 비용이 반복된다.
  hiddenFixed: HiddenFixed[] | null;
}

// hidden 탭에서는 rAF가 발화하지 않아 응답이 매달린다(prepareCaptureBySelector 선례).
const SCROLL_SETTLE_FALLBACK_MS = 500;

export function beginScrollCapture(): {
  session: ScrollCaptureSession;
  metrics: PageMetrics;
} {
  // quirks mode에서 scrollingElement가 null.
  const root = document.scrollingElement ?? document.documentElement;
  return {
    session: {
      originalScroll: { x: window.scrollX, y: window.scrollY },
      hiddenFixed: null,
    },
    metrics: {
      scrollHeight: root.scrollHeight,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio || 1,
    },
  };
}

export function scrollCaptureTo(
  session: ScrollCaptureSession,
  y: number,
  hideFixed: boolean,
): Promise<ScrollAck> {
  // 2-arg scrollTo는 페이지 CSS `scroll-behavior: smooth`에 밀려 애니메이션이 남는다.
  window.scrollTo({ top: y, left: session.originalScroll.x, behavior: "instant" });
  return new Promise((resolve) => {
    let done = false;
    let fallback: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      if (done) return;
      done = true;
      if (fallback) clearTimeout(fallback);
      // 스크롤한 뒤에 수집한다 — "스크롤하면 헤더를 fixed로 바꾸는" 사이트가 흔해
      // 스크롤 전에 훑으면 그 헤더를 못 잡고 모든 타일에 반복 인쇄된다.
      if (hideFixed && !session.hiddenFixed) session.hiddenFixed = hideFixedElements();
      resolve({ y: window.scrollY });
    };
    requestAnimationFrame(() => requestAnimationFrame(settle));
    fallback = setTimeout(settle, SCROLL_SETTLE_FALLBACK_MS);
  });
}

export function endScrollCapture(session: ScrollCaptureSession): void {
  for (const { el, prevValue, prevPriority } of session.hiddenFixed ?? []) {
    if (prevValue) el.style.setProperty("visibility", prevValue, prevPriority);
    else el.style.removeProperty("visibility");
  }
  session.hiddenFixed = null;
  window.scrollTo({
    top: session.originalScroll.y,
    left: session.originalScroll.x,
    behavior: "instant",
  });
}

// display:none이 아니라 visibility — 레이아웃이 바뀌면 이미 계획한 타일 좌표가 어긋난다.
// 페이지의 `visibility: visible !important`에 지지 않도록 important로 덮고 원값을 저장한다.
// sticky는 제외 — 문서 흐름 안의 실제 콘텐츠(사이드바·표 헤더)라 숨기면 그 자리가 빈다.
// 반복 인쇄(아티팩트)보다 콘텐츠 소실이 나쁘다.
function hideFixedElements(): HiddenFixed[] {
  const hidden: HiddenFixed[] = [];
  // body 아래만 훑으면 <html> 직속 fixed를 놓친다. shadow DOM·iframe 내부는 여전히 미탐(한계).
  for (const el of document.querySelectorAll<HTMLElement>("*")) {
    // html·body 자신이 fixed인 페이지(iOS 스크롤락 관용구)를 숨기면 타일이 통째로 백지가 된다.
    if (el === document.documentElement || el === document.body) continue;
    if (el.id === HOST_ID || el.id === ANNOTATION_HOST_ID) continue;
    if (getComputedStyle(el).position !== "fixed") continue;
    hidden.push({
      el,
      prevValue: el.style.getPropertyValue("visibility"),
      prevPriority: el.style.getPropertyPriority("visibility"),
    });
    el.style.setProperty("visibility", "hidden", "important");
  }
  return hidden;
}
