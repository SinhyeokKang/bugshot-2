import { ANNOTATION_HOST_ID } from "./annotation";
import { HOST_ID } from "./overlay";

import type { PageMetrics, ScrollAck } from "@/types/picker";

interface HiddenFixed {
  el: HTMLElement;
  prevValue: string;
  prevPriority: string;
}

export interface PositionedElementMetrics {
  position: string;
  rectTop: number;
  rectBottom: number;
  flowTop: number;
  flowBottom: number;
  scrollY: number;
  viewportHeight: number;
  topInset: number;
  bottomInset: number;
}

export interface ScrollCaptureSession {
  originalScroll: { x: number; y: number };
  // fixed·이미 붙은 sticky를 누적 — 캡처 종료 시 원래 visibility를 모두 복원한다.
  hiddenFixed: HiddenFixed[] | null;
  positionedCandidates: HTMLElement[] | null;
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
      positionedCandidates: null,
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
      if (hideFixed) {
        session.positionedCandidates ??= collectPositionedCandidates();
        session.hiddenFixed = hideRepeatedElements(
          session.positionedCandidates,
          session.hiddenFixed ?? [],
        );
      }
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
  session.positionedCandidates = null;
  window.scrollTo({
    top: session.originalScroll.y,
    left: session.originalScroll.x,
    behavior: "instant",
  });
}

// display:none이 아니라 visibility — 레이아웃이 바뀌면 이미 계획한 타일 좌표가 어긋난다.
// 페이지의 `visibility: visible !important`에 지지 않도록 important로 덮고 원값을 저장한다.
// sticky 전체를 미리 숨기면 아직 첫 등장하지 않은 섹션 헤더가 결과에서 유실되므로,
// 각 타일에서 실제로 붙었고 원래 위치를 지난 요소만 누적해서 숨긴다.
function collectPositionedCandidates(): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("*")) {
    if (el === document.documentElement || el === document.body) continue;
    if (el.id === HOST_ID || el.id === ANNOTATION_HOST_ID) continue;
    const position = getComputedStyle(el).position;
    if (position === "fixed" || position === "sticky") candidates.push(el);
  }
  return candidates;
}

function hideRepeatedElements(
  candidates: HTMLElement[],
  hidden: HiddenFixed[],
): HiddenFixed[] {
  const alreadyHidden = new Set(hidden.map(({ el }) => el));
  const toHide: HTMLElement[] = [];
  for (const el of candidates) {
    if (alreadyHidden.has(el)) continue;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const flowTop = documentOffsetTop(el);
    if (
      !isRepeatedPositionedElement({
        position: style.position,
        rectTop: rect.top,
        rectBottom: rect.bottom,
        flowTop,
        flowBottom: flowTop + el.offsetHeight,
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        topInset: Number.parseFloat(style.top),
        bottomInset: Number.parseFloat(style.bottom),
      })
    ) {
      continue;
    }
    toHide.push(el);
  }

  for (const el of toHide) {
    hidden.push({
      el,
      prevValue: el.style.getPropertyValue("visibility"),
      prevPriority: el.style.getPropertyPriority("visibility"),
    });
    el.style.setProperty("visibility", "hidden", "important");
  }
  return hidden;
}

export function isRepeatedPositionedElement(metrics: PositionedElementMetrics): boolean {
  if (metrics.position === "fixed") return true;
  if (metrics.position !== "sticky") return false;

  const tolerance = 1;
  const stuckTop =
    Number.isFinite(metrics.topInset) &&
    Math.abs(metrics.rectTop - metrics.topInset) <= tolerance &&
    metrics.flowTop < metrics.scrollY + metrics.topInset &&
    metrics.flowBottom <= metrics.scrollY + metrics.topInset;
  const stuckBottom =
    Number.isFinite(metrics.bottomInset) &&
    Math.abs(metrics.viewportHeight - metrics.rectBottom - metrics.bottomInset) <= tolerance &&
    metrics.rectTop >= -tolerance &&
    metrics.flowBottom > metrics.scrollY + metrics.viewportHeight - metrics.bottomInset;
  return stuckTop || stuckBottom;
}

function documentOffsetTop(el: HTMLElement): number {
  let top = 0;
  let current: HTMLElement | null = el;
  while (current) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return top;
}
