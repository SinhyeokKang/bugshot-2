import { formatElementName } from "@/lib/element-label";

import {
  createBlockerPassthrough,
  isScrollIntent,
  type BlockerPassthrough,
} from "./blocker-state";
import {
  createHoverShield,
  type HoverShield,
  type HoverShieldReason,
} from "./hover-shield";

import type { InspectorInfo } from "./css-resolve";

export interface OverlayHandle {
  hostEl: HTMLDivElement;
  shadow: ShadowRoot;
  blockerEl: HTMLDivElement;
}

interface OverlayInternal extends OverlayHandle {
  bannerEl: HTMLDivElement;
  labelEl: HTMLDivElement;
  marginEl: SVGPathElement;
  paddingEl: SVGPathElement;
  gapEl: SVGPathElement;
  boxLabelsEl: SVGGElement;
  borderEl: SVGRectElement;
  previewEl: SVGRectElement;
  _setScrollYield: (enabled: boolean) => void;
  _cancelScrollYield: () => void;
  _passthrough: BlockerPassthrough;
  _hoverShield: HoverShield;
  _onResize: () => void;
  _cleanup: () => void;
}

export const HOST_ID = "__bugshot_picker_host";
// 휠 뒤 blocker가 스크롤에 양보하는 시간.
const SCROLL_YIELD_MS = 120;
// 마지막 휠로부터 이 시간 안의 마우스 이동은 스크롤의 일부로 본다. **`SCROLL_YIELD_MS`보다
// 짧아야 한다** — 같거나 길면 회수 경로가 통째로 죽는다(회수할 양보가 이미 만료).
const SCROLL_INTENT_MS = 60;
// selection-commit 이유가 단독으로 버티는 상한. 사이드패널 왕복(picker.selected →
// prepareCapture)보다 넉넉하되, 캡처가 아예 안 오는 경로에서 페이지를 붙잡고 있는
// 시간이므로 짧게 잡는다.
const HOVER_SHIELD_EXPIRE_MS = 1500;
// 방패가 서 있는 동안 window capture에서 끊을 hover 계열. **mouse 계열만** 담는다 —
// action-recorder는 pointer·click·drag·key만 document capture로 듣고 mouse 이동 계열은
// 안 들으므로 여기서 끊어도 액션 로그가 비지 않는다(POSTMORTEM 2026-08-01 (2)).
const SHIELDED_WINDOW_EVENTS = ["mouseover", "mouseout", "mousemove"] as const;
// 방패 자신의 버블에서 끊을 pointer 계열. window capture로 끊으면 그보다 뒤 단계인
// action-recorder의 document capture가 죽는다 — 버블은 그쪽이 이미 지난 뒤라 안전하다.
const SHIELDED_BUBBLE_EVENTS = ["pointerover", "pointerout", "pointermove"] as const;
const SVG_NS = "http://www.w3.org/2000/svg";

// createHoverShield의 apply가 매 상태 변화마다 호출되므로 add/remove가 짝을 맞추려면
// 리스너 참조가 안정적이어야 한다 — 인라인 화살표로 바꾸면 리스너가 무한 누적된다.
function stopEventPropagation(e: Event): void {
  e.stopPropagation();
}

const OVERLAY_CSS = `
  :host { all: initial; }
  .banner {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.85);
    color: white;
    padding: 6px 12px;
    border-radius: 6px;
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: none;
  }
  .interaction-blocker {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2147483646;
    pointer-events: auto;
    cursor: crosshair;
  }
  .hover-shield {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    /* blocker(2147483646)보다 한 단 아래 — 둘 다 서 있으면 blocker가 hit target을 가져가야
       picking 중 휠 양보·클릭 커밋이 그대로 산다. */
    z-index: 2147483645;
    pointer-events: auto;
    background: transparent;
    /* host가 캡처 직전 visibility:hidden으로 숨어도 이 레이어만은 hit target으로 남는다.
       완전 투명이라 살아남아도 스크린샷에는 찍히지 않는다. */
    visibility: visible;
  }
  .picker-label {
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
    display: none;
    opacity: 1;
    transition: opacity 120ms ease;
  }
  .picker-label[data-mode="badge"] {
    background: #2563eb;
    color: white;
    padding: 2px 6px;
    border-radius: 3px;
    font: 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    white-space: nowrap;
  }
  .picker-label[data-mode="inspector"] {
    /* globals.css :root 실값과 일치시킨다 — content script라 CSS 변수를 import할 수 없어
       사본은 불가피하지만 값이 갈리면 인스펙터 카드만 다른 색이 된다(tokens.test.ts가 대조). */
    --popover: hsl(0 0% 100%);
    --popover-foreground: hsl(222.2 84% 4.9%);
    --muted-foreground: hsl(215.4 16.3% 46.9%);
    --border: hsl(214.3 31.8% 91.4%);
    background: var(--popover);
    color: var(--popover-foreground);
    border: 1px solid var(--border);
    padding: 8px;
    border-radius: 12px;
    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    min-width: 260px;
    max-width: 300px;
    box-sizing: border-box;
    outline: none;
  }
  .picker-label[data-mode="inspector"] .pl-selector {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding-bottom: 8px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }
  .picker-label[data-mode="inspector"] .pl-selector-text {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 14px;
    font-weight: 600;
    word-break: break-all;
  }
  .picker-label[data-mode="inspector"] .pl-selector-size {
    flex: 0 0 auto;
    color: var(--muted-foreground);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    padding-top: 3px;
  }
  .picker-label[data-mode="inspector"] .pl-extra {
    color: var(--muted-foreground);
    font-weight: 500;
  }
  .picker-label[data-mode="inspector"] .pl-row {
    display: flex;
    align-items: center;
    gap: 12px;
    line-height: 1.5;
    font-size: 12px;
  }
  .picker-label[data-mode="inspector"] .pl-row + .pl-row {
    margin-top: 4px;
  }
  .picker-label[data-mode="inspector"] .pl-key {
    color: var(--muted-foreground);
    flex: 0 0 64px;
  }
  .picker-label[data-mode="inspector"] .pl-val {
    color: var(--popover-foreground);
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .picker-label[data-mode="inspector"] .pl-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker-label[data-mode="inspector"] .pl-swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    border: 1px solid var(--border);
    flex: 0 0 auto;
  }
  /* OS 선호가 아니라 앱 theme 설정을 따른다(picker.start가 data-theme으로 실어온다).
     미설정 = 라이트라 위 기본 블록이 그대로 남는다. 다크는 neutral(채도 0) — DESIGN §2,
     globals.css .dark 실값. 이 블록은 라이트 블록보다 뒤에 있어야 한다(tokens.test.ts의
     parseOverlayTokens가 이 셀렉터로 영역을 가른다). */
  .picker-label[data-theme="dark"][data-mode="inspector"] {
    --popover: hsl(0 0% 3.9%);
    --popover-foreground: hsl(0 0% 98%);
    --muted-foreground: hsl(0 0% 63.9%);
    --border: hsl(0 0% 14.9%);
  }
  .box-label {
    font: 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: none;
  }
  .box-label-margin { fill: #b45309; }
  .box-label-padding { fill: #15803d; }
  .box-label-gap { fill: #7c3aed; }
  .area-dim {
    position: fixed;
    background: rgba(0, 0, 0, 0.4);
    pointer-events: none;
  }
  .area-select-rect {
    position: fixed;
    border: 2px solid #2563eb;
    background: transparent;
    pointer-events: none;
    display: none;
  }
  .area-size-label {
    position: fixed;
    background: rgba(0, 0, 0, 0.85);
    color: white;
    padding: 2px 8px;
    border-radius: 4px;
    font: 11px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: none;
    display: none;
    white-space: nowrap;
  }
`;

export function createOverlay(): OverlayHandle {
  const hostEl = document.createElement("div");
  hostEl.id = HOST_ID;
  Object.assign(hostEl.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
  });
  const shadow = hostEl.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);

  const shieldEl = document.createElement("div");
  shieldEl.className = "hover-shield";
  shieldEl.style.display = "none";
  shadow.appendChild(shieldEl);
  const hoverShield = createHoverShield((on) => {
    shieldEl.style.display = on ? "" : "none";
    // hit target을 가져오는 것만으론 CSS `:hover`밖에 못 막는다 — 페이지가 위임으로 만든
    // hover UI(툴팁·메가메뉴)는 방패와 무관하게 반응해 그 상태로 캡처에 굳는다.
    for (const type of SHIELDED_WINDOW_EVENTS) {
      if (on) window.addEventListener(type, stopEventPropagation, true);
      else window.removeEventListener(type, stopEventPropagation, true);
    }
  }, HOVER_SHIELD_EXPIRE_MS);
  for (const type of SHIELDED_BUBBLE_EVENTS) {
    shieldEl.addEventListener(type, stopEventPropagation);
  }
  // blocker의 휠 양보와 같은 문제 — 전면 레이어는 커서 밑 스크롤 컨테이너를 가린다. 다만
  // 커밋 방패는 양보가 아니라 포기다: 스크롤하면 hover는 어차피 무효가 되고, 뒤이을 캡처는
  // capture-prep이 따로 지킨다. 진행 중인 캡처(capture-prep)는 건드리지 않는다.
  function releaseOnWheel() {
    hoverShield.setReason("selection-commit", false);
  }
  shieldEl.addEventListener("wheel", releaseOnWheel, { passive: true });

  const blockerEl = document.createElement("div");
  blockerEl.className = "interaction-blocker";
  blockerEl.style.display = "none";
  shadow.appendChild(blockerEl);

  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollYieldEnabled = true;
  let lastWheelAt = 0;
  const passthrough = createBlockerPassthrough((value) => {
    blockerEl.style.pointerEvents = value;
  });
  // scroll-yield는 이유와 타이머를 함께 소유한다 — 이유만 끄면 타이머가 살아남아 소유권이
  // 다시 갈린다. 그래서 이 이유는 밖으로 열지 않고 이 함수로만 만진다.
  function setScrollYield(on: boolean) {
    if (!on && scrollTimer) {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }
    passthrough.setReason("scroll-yield", on);
  }
  function yieldToScroll() {
    // 스크롤 캡처 중에는 양보하지 않는다 — 휠이 페이지로 새면 캡처 큐 대기(≥500ms) 사이에
    // 스크롤이 밀려 해당 타일이 어긋난 오프셋으로 스티칭된다(검출 수단 없음).
    if (!scrollYieldEnabled) return;
    lastWheelAt = performance.now();
    setScrollYield(true);
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      setScrollYield(false);
    }, SCROLL_YIELD_MS);
  }
  // 양보가 꺼진 동안(스크롤 캡처)은 기본 동작까지 막아야 페이지가 안 밀린다 — pointerEvents만
  // 유지하면 wheel이 document로 체이닝돼 그대로 스크롤된다. 그래서 passive:false 리스너를 따로 둔다.
  function blockScroll(e: Event) {
    if (!scrollYieldEnabled) e.preventDefault();
  }
  blockerEl.addEventListener("wheel", yieldToScroll, { passive: true });
  blockerEl.addEventListener("touchmove", yieldToScroll, { passive: true });
  blockerEl.addEventListener("wheel", blockScroll, { passive: false });
  blockerEl.addEventListener("touchmove", blockScroll, { passive: false });

  function cleanupOverlay() {
    blockerEl.removeEventListener("wheel", yieldToScroll);
    blockerEl.removeEventListener("touchmove", yieldToScroll);
    blockerEl.removeEventListener("wheel", blockScroll);
    blockerEl.removeEventListener("touchmove", blockScroll);
    if (scrollTimer) {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }
    for (const type of SHIELDED_BUBBLE_EVENTS) {
      shieldEl.removeEventListener(type, stopEventPropagation);
    }
    shieldEl.removeEventListener("wheel", releaseOnWheel);
    // 이유를 비우며 window 리스너와 만료 타이머까지 회수한다.
    hoverShield.clearReasons();
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  Object.assign(svg.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  });

  const marginEl = document.createElementNS(SVG_NS, "path");
  marginEl.setAttribute("fill", "rgba(246, 178, 107, 0.35)");
  marginEl.setAttribute("fill-rule", "evenodd");
  marginEl.style.display = "none";
  svg.appendChild(marginEl);

  const paddingEl = document.createElementNS(SVG_NS, "path");
  paddingEl.setAttribute("fill", "rgba(147, 196, 125, 0.4)");
  paddingEl.setAttribute("fill-rule", "evenodd");
  paddingEl.style.display = "none";
  svg.appendChild(paddingEl);

  const gapEl = document.createElementNS(SVG_NS, "path");
  // violet-500 — gap 라벨(.box-label-gap #7c3aed)과 계열을 맞춘다. margin은 amber, padding은
  // green으로 채움·라벨이 이미 짝인데 gap만 분홍이라 3축 중 하나가 라벨과 갈려 있었다.
  gapEl.setAttribute("fill", "rgba(139, 92, 246, 0.3)");
  gapEl.style.display = "none";
  svg.appendChild(gapEl);

  const boxLabelsEl = document.createElementNS(SVG_NS, "g");
  svg.appendChild(boxLabelsEl);

  const borderEl = document.createElementNS(SVG_NS, "rect");
  borderEl.setAttribute("fill", "none");
  borderEl.setAttribute("stroke", "#2563eb");
  borderEl.setAttribute("stroke-width", "1");
  borderEl.style.display = "none";
  svg.appendChild(borderEl);

  const previewEl = document.createElementNS(SVG_NS, "rect");
  previewEl.setAttribute("fill", "rgba(251, 146, 60, 0.2)");
  previewEl.setAttribute("stroke", "#f97316");
  previewEl.setAttribute("stroke-width", "2");
  previewEl.setAttribute("stroke-dasharray", "4 2");
  previewEl.style.display = "none";
  svg.appendChild(previewEl);

  shadow.appendChild(svg);

  const labelEl = document.createElement("div");
  labelEl.className = "picker-label";
  labelEl.dataset.mode = "badge";
  shadow.appendChild(labelEl);

  const bannerEl = document.createElement("div");
  bannerEl.className = "banner";
  bannerEl.textContent = `${window.innerWidth} × ${window.innerHeight}`;
  shadow.appendChild(bannerEl);

  const handle: OverlayInternal = {
    hostEl,
    shadow,
    blockerEl,
    bannerEl,
    labelEl,
    marginEl,
    paddingEl,
    gapEl,
    boxLabelsEl,
    borderEl,
    previewEl,
    _setScrollYield: (enabled: boolean) => {
      scrollYieldEnabled = enabled;
      if (!enabled) setScrollYield(false);
    },
    _cancelScrollYield: () => {
      if (isScrollIntent(performance.now(), lastWheelAt, SCROLL_INTENT_MS)) return;
      setScrollYield(false);
    },
    _passthrough: passthrough,
    _hoverShield: hoverShield,
    _onResize: () => updateBanner(handle),
    _cleanup: cleanupOverlay,
  };

  window.addEventListener("resize", handle._onResize);
  document.documentElement.appendChild(hostEl);
  return handle;
}

export function destroyOverlay(h: OverlayHandle): void {
  const o = h as OverlayInternal;
  window.removeEventListener("resize", o._onResize);
  o._cleanup();
  o.hostEl.remove();
}

export function updateBanner(h: OverlayHandle): void {
  const o = h as OverlayInternal;
  o.bannerEl.textContent = `${window.innerWidth} × ${window.innerHeight}`;
  o.bannerEl.style.display = "";
}

export function hideBanner(h: OverlayHandle): void {
  const o = h as OverlayInternal;
  o.bannerEl.style.display = "none";
}

// 인스펙터 카드의 다크 전환은 OS(prefers-color-scheme)가 아니라 사이드패널이 실어보낸 앱
// theme을 따른다 — 미설정이면 기본 블록(라이트)이 남는다.
export function setOverlayTheme(h: OverlayHandle, theme: "light" | "dark"): void {
  const o = h as OverlayInternal;
  o.labelEl.dataset.theme = theme;
}

// 스크롤 캡처 동안 blocker의 휠 양보(yieldToScroll)를 끈다 — 페이지가 밀리면 타일이 어긋난다.
export function setBlockerScrollYield(h: OverlayHandle, enabled: boolean): void {
  (h as OverlayInternal)._setScrollYield(enabled);
}

export function setBlockerVisible(
  h: OverlayHandle,
  visible: boolean,
  cursor?: string,
): void {
  const o = h as OverlayInternal;
  h.blockerEl.style.display = visible ? "" : "none";
  if (visible) {
    // 모드 전환은 새 세션이다 — 이전 모드의 투과 이유(양보·핸드오프)를 이월하지 않는다.
    // 직전 휠 직후면 양보 타이머는 살아남지만, 깨어나 하는 일이 이미 끝난 해제뿐이라 무해하다.
    o._cancelScrollYield();
    o._passthrough.clearReasons();
    // 방패도 같이 걷는다 — blocker가 다시 서는 모드(picking·스크롤 캡처)에 방패가 남아
    // 있으면 hit target을 두고 둘이 경쟁한다. 방패는 blocker가 없는 창에만 유효하다.
    o._hoverShield.clearReasons();
    if (cursor) h.blockerEl.style.cursor = cursor;
  }
}

// 등록 iframe 위에서 blocker를 투과시켜 안쪽 picker가 이벤트를 받게 한다.
export function setBlockerHandoff(h: OverlayHandle, on: boolean): void {
  (h as OverlayInternal)._passthrough.setReason("handoff", on);
}

// 진행 중인 스크롤 양보를 회수한다(이유 + 타이머 함께).
export function cancelBlockerScrollYield(h: OverlayHandle): void {
  (h as OverlayInternal)._cancelScrollYield();
}

// blocker가 물러나는 창(선택 커밋·캡처 준비) 동안 커서 밑 페이지 요소가 :hover를 되찾지
// 못하게 투명 레이어를 세운다. 이유별 소유이므로 한쪽을 내려도 남은 이유는 유지된다.
export function setHoverShield(
  h: OverlayHandle,
  reason: HoverShieldReason,
  on: boolean,
): void {
  (h as OverlayInternal)._hoverShield.setReason(reason, on);
}

// 두 레이어를 함께 비켜세운다 — blocker만 내리면 서 있는 방패가 hit target을 가져가
// elementFromPoint가 우리 host를 돌려주고, 호출부는 그걸 "내 UI"로 읽어 조기 return한다
// (=picking이 조용히 죽는다).
export function withBlockerHitTest<T>(h: OverlayHandle, fn: () => T): T {
  const o = h as OverlayInternal;
  return o._hoverShield.withHitTest(() => o._passthrough.withHitTest(fn));
}

export function renderOutline(
  h: OverlayHandle,
  target: Element,
  opts: { hideBoxModel?: boolean } = {},
): void {
  const o = h as OverlayInternal;
  const rect = target.getBoundingClientRect();
  const bl = rect.left;
  const bt = rect.top;
  const bw = rect.width;
  const bh = rect.height;

  o.borderEl.setAttribute("x", bl.toString());
  o.borderEl.setAttribute("y", bt.toString());
  o.borderEl.setAttribute("width", bw.toString());
  o.borderEl.setAttribute("height", bh.toString());
  o.borderEl.style.display = "";

  clearBoxLabels(o);

  if (opts.hideBoxModel) {
    o.marginEl.style.display = "none";
    o.paddingEl.style.display = "none";
    o.gapEl.style.display = "none";
    return;
  }

  const cs = window.getComputedStyle(target);
  const mt = parseFloat(cs.marginTop) || 0;
  const mr = parseFloat(cs.marginRight) || 0;
  const mb = parseFloat(cs.marginBottom) || 0;
  const ml = parseFloat(cs.marginLeft) || 0;
  const pt = parseFloat(cs.paddingTop) || 0;
  const pr = parseFloat(cs.paddingRight) || 0;
  const pb = parseFloat(cs.paddingBottom) || 0;
  const pl = parseFloat(cs.paddingLeft) || 0;

  if (mt || mr || mb || ml) {
    const ox = bl - ml;
    const oy = bt - mt;
    const ow = bw + ml + mr;
    const oh = bh + mt + mb;
    o.marginEl.setAttribute(
      "d",
      `M${ox},${oy} h${ow} v${oh} h${-ow} Z ` +
        `M${bl},${bt} h${bw} v${bh} h${-bw} Z`,
    );
    o.marginEl.style.display = "";
    addBoxLabel(o.boxLabelsEl, "margin", mt, bl + bw / 2, bt - mt / 2);
    addBoxLabel(o.boxLabelsEl, "margin", mr, bl + bw + mr / 2, bt + bh / 2);
    addBoxLabel(o.boxLabelsEl, "margin", mb, bl + bw / 2, bt + bh + mb / 2);
    addBoxLabel(o.boxLabelsEl, "margin", ml, bl - ml / 2, bt + bh / 2);
  } else {
    o.marginEl.style.display = "none";
  }

  if (pt || pr || pb || pl) {
    const iw = Math.max(0, bw - pl - pr);
    const ih = Math.max(0, bh - pt - pb);
    o.paddingEl.setAttribute(
      "d",
      `M${bl},${bt} h${bw} v${bh} h${-bw} Z ` +
        `M${bl + pl},${bt + pt} h${iw} v${ih} h${-iw} Z`,
    );
    o.paddingEl.style.display = "";
    addBoxLabel(o.boxLabelsEl, "padding", pt, bl + bw / 2, bt + pt / 2);
    addBoxLabel(o.boxLabelsEl, "padding", pr, bl + bw - pr / 2, bt + bh / 2);
    addBoxLabel(o.boxLabelsEl, "padding", pb, bl + bw / 2, bt + bh - pb / 2);
    addBoxLabel(o.boxLabelsEl, "padding", pl, bl + pl / 2, bt + bh / 2);
  } else {
    o.paddingEl.style.display = "none";
  }

  updateGap(o, target, cs, {
    contentLeft: bl + pl,
    contentRight: bl + bw - pr,
    contentTop: bt + pt,
    contentBottom: bt + bh - pb,
  });
}

export function renderBadge(h: OverlayHandle, target: Element): void {
  const o = h as OverlayInternal;
  o.labelEl.textContent = formatElementName({
    tag: target.tagName.toLowerCase(),
    classList: Array.from(target.classList),
  });
  o.labelEl.dataset.mode = "badge";
  placeLabel(o, target);
}

export function renderInspector(
  h: OverlayHandle,
  target: Element,
  info: InspectorInfo,
): void {
  const o = h as OverlayInternal;
  o.labelEl.dataset.mode = "inspector";
  o.labelEl.innerHTML = buildInspectorHtml(info);
  placeLabel(o, target);
}

function placeLabel(o: OverlayInternal, target: Element): void {
  const labelEl = o.labelEl;
  const wasHidden = labelEl.style.display !== "block";

  if (wasHidden) {
    labelEl.style.transition = "none";
    labelEl.style.opacity = "0";
  }
  labelEl.style.visibility = "hidden";
  labelEl.style.display = "block";
  labelEl.style.top = "0px";
  labelEl.style.left = "0px";
  const labelRect = labelEl.getBoundingClientRect();
  const lw = labelRect.width;
  const lh = labelRect.height;

  const rect = target.getBoundingClientRect();
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const gap = 2;
  const margin = 8;

  let top = rect.top - lh - gap;
  if (top < margin) {
    const below = rect.bottom + gap;
    top = below + lh > vpH - margin ? margin : below;
  }

  let left = rect.left;
  if (left + lw > vpW - margin) left = rect.right - lw;
  if (left < margin) left = margin;
  if (left + lw > vpW - margin) left = vpW - margin - lw;

  labelEl.style.top = `${top}px`;
  labelEl.style.left = `${left}px`;
  labelEl.style.visibility = "";

  if (wasHidden) {
    void labelEl.offsetWidth;
    labelEl.style.transition = "";
    labelEl.style.opacity = "1";
  }
}

export function hideLabel(h: OverlayHandle): void {
  const o = h as OverlayInternal;
  o.labelEl.style.display = "none";
}

export function hideOutline(h: OverlayHandle): void {
  const o = h as OverlayInternal;
  o.marginEl.style.display = "none";
  o.paddingEl.style.display = "none";
  o.gapEl.style.display = "none";
  clearBoxLabels(o);
  o.borderEl.style.display = "none";
  o.labelEl.style.display = "none";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(key: string, valHtml: string): string {
  return `<div class="pl-row"><span class="pl-key">${key}</span><span class="pl-val">${valHtml}</span></div>`;
}

function textVal(text: string): string {
  return `<span class="pl-text">${escapeHtml(text)}</span>`;
}

function colorRow(key: string, label: string, swatch: string): string {
  return row(
    key,
    `<span class="pl-swatch" style="background:${escapeHtml(swatch)}"></span>${textVal(label)}`,
  );
}

function buildInspectorHtml(info: InspectorInfo): string {
  const w = info.width.toFixed(2).replace(/\.?0+$/, "");
  const h = info.height.toFixed(2).replace(/\.?0+$/, "");
  const dims = `${w} × ${h}`;
  const fontParts = [info.fontSize, info.fontWeight, info.fontFamily].filter(Boolean);

  const rows: string[] = [];
  rows.push(colorRow("color", info.color, info.colorValue));
  if (info.backgroundColor && info.backgroundColorValue) {
    rows.push(colorRow("bg-color", info.backgroundColor, info.backgroundColorValue));
  }
  rows.push(row("font", textVal(fontParts.join(" / "))));
  if (info.padding) rows.push(row("padding", textVal(info.padding)));
  if (info.borderRadius) rows.push(row("radius", textVal(info.borderRadius)));

  return `<div class="pl-selector"><div class="pl-selector-text">${selectorHtml(info)}</div><div class="pl-selector-size">${escapeHtml(dims)}</div></div>${rows.join("")}`;
}

function selectorHtml(info: InspectorInfo): string {
  // pl-tag/pl-class는 현재 OVERLAY_CSS에 규칙이 없다 — 태그·클래스를 나중에 색으로 구분할
  // 훅으로 유지한다(지우면 평문이 되어 훅 자체가 사라진다).
  const tag = `<span class="pl-tag">${escapeHtml(info.tag)}</span>`;
  const classes = info.classes
    .map((c) => `<span class="pl-class">.${escapeHtml(c)}</span>`)
    .join("");
  const extra =
    info.classOverflow > 0
      ? `<span class="pl-extra">+${info.classOverflow}</span>`
      : "";
  return `${tag}${classes}${extra}`;
}

export function renderPreview(h: OverlayHandle, selector: string): void {
  const o = h as OverlayInternal;
  let target: Element | null = null;
  try {
    target = document.querySelector(selector);
  } catch {
    target = null;
  }
  if (!target) {
    o.previewEl.style.display = "none";
    return;
  }
  const rect = target.getBoundingClientRect();
  o.previewEl.setAttribute("x", rect.left.toString());
  o.previewEl.setAttribute("y", rect.top.toString());
  o.previewEl.setAttribute("width", rect.width.toString());
  o.previewEl.setAttribute("height", rect.height.toString());
  o.previewEl.style.display = "";
}

export function clearPreview(h: OverlayHandle): void {
  (h as OverlayInternal).previewEl.style.display = "none";
}

/* ── box labels ──────────────────────────────────── */

function clearBoxLabels(o: OverlayInternal): void {
  const g = o.boxLabelsEl;
  while (g.firstChild) g.removeChild(g.firstChild);
}

type BoxLabelType = "margin" | "padding" | "gap";

function addBoxLabel(g: SVGGElement, type: BoxLabelType, px: number, x: number, y: number): void {
  const rounded = Math.round(px);
  if (rounded === 0) return;
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", x.toString());
  text.setAttribute("y", y.toString());
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "central");
  text.setAttribute("class", `box-label box-label-${type}`);
  text.textContent = `${rounded}px`;
  g.appendChild(text);
}

/* ── internal ────────────────────────────────────── */

interface Band {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function groupByAxis(rects: DOMRect[], axis: "row" | "col"): Band[] {
  const sorted = [...rects].sort((a, b) =>
    axis === "row" ? a.top - b.top : a.left - b.left,
  );
  const bands: Band[] = [];
  for (const r of sorted) {
    const last = bands[bands.length - 1];
    const overlap =
      last &&
      (axis === "row" ? r.top < last.bottom - 0.5 : r.left < last.right - 0.5);
    if (overlap) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
      last.left = Math.min(last.left, r.left);
      last.right = Math.max(last.right, r.right);
    } else {
      bands.push({
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
      });
    }
  }
  return bands;
}

function updateGap(
  o: OverlayInternal,
  target: Element,
  cs: CSSStyleDeclaration,
  content: {
    contentLeft: number;
    contentRight: number;
    contentTop: number;
    contentBottom: number;
  },
): void {
  const display = cs.display;
  const isFlex = display === "flex" || display === "inline-flex";
  const isGrid = display === "grid" || display === "inline-grid";
  if (!isFlex && !isGrid) {
    o.gapEl.style.display = "none";
    return;
  }
  const rowGap = parseFloat(cs.rowGap) || 0;
  const colGap = parseFloat(cs.columnGap) || 0;
  if (!rowGap && !colGap) {
    o.gapEl.style.display = "none";
    return;
  }

  const rects = (Array.from(target.children) as HTMLElement[])
    .map((c) => c.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  if (rects.length < 2) {
    o.gapEl.style.display = "none";
    return;
  }

  const parts: string[] = [];
  const { contentLeft, contentRight, contentTop, contentBottom } = content;

  if (rowGap) {
    const rows = groupByAxis(rects, "row");
    for (let i = 0; i < rows.length - 1; i++) {
      const y = rows[i].bottom;
      const h = rows[i + 1].top - y;
      if (h <= 0.5) continue;
      const w = contentRight - contentLeft;
      if (w <= 0) continue;
      parts.push(`M${contentLeft},${y} h${w} v${h} h${-w} Z`);
      addBoxLabel(o.boxLabelsEl, "gap", h, (contentLeft + contentRight) / 2, y + h / 2);
    }
  }

  if (colGap) {
    const cols = groupByAxis(rects, "col");
    for (let i = 0; i < cols.length - 1; i++) {
      const x = cols[i].right;
      const w = cols[i + 1].left - x;
      if (w <= 0.5) continue;
      const h = contentBottom - contentTop;
      if (h <= 0) continue;
      parts.push(`M${x},${contentTop} h${w} v${h} h${-w} Z`);
      addBoxLabel(o.boxLabelsEl, "gap", w, x + w / 2, (contentTop + contentBottom) / 2);
    }
  }

  if (!parts.length) {
    o.gapEl.style.display = "none";
    return;
  }

  o.gapEl.setAttribute("d", parts.join(" "));
  o.gapEl.style.display = "";
}
