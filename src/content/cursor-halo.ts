// 녹화 중 커서 강조용 오버레이 — Shadow DOM에 헤일로 1개 + 클릭마다 리플 1회.
// tabCapture는 페이지 렌더링을 그대로 캡처하므로 이 오버레이가 영상에 함께 찍힌다.
// pointer-events: none → 사용자 클릭 안 막음.

export const HALO_DIAMETER = 36;
const RIPPLE_DURATION_MS = 450;
const RIPPLE_MAX_SCALE = 2;
const HOST_ID = "__bugshot_cursor_halo_host";

export function haloTransform(x: number, y: number, diameter: number): string {
  const offset = diameter / 2;
  return `translate3d(${Math.round(x - offset)}px, ${Math.round(y - offset)}px, 0)`;
}

const CSS = `
  :host { all: initial; }
  .layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483647;
  }
  .halo {
    position: fixed;
    top: 0;
    left: 0;
    width: ${HALO_DIAMETER}px;
    height: ${HALO_DIAMETER}px;
    border-radius: 50%;
    border: 2px solid rgba(0, 0, 0, 0.5);
    outline: 1px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.35);
    box-sizing: border-box;
    pointer-events: none;
    transform: translate3d(-9999px, -9999px, 0);
    will-change: transform;
    opacity: 0;
    transition: opacity 120ms ease-out;
  }
  .halo[data-visible="1"] { opacity: 1; }
  .ripple {
    position: fixed;
    width: ${HALO_DIAMETER}px;
    height: ${HALO_DIAMETER}px;
    border-radius: 50%;
    border: 2px solid rgba(0, 0, 0, 0.5);
    outline: 1px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.35);
    box-sizing: border-box;
    pointer-events: none;
    transform: translate(-50%, -50%) scale(1);
    animation: bugshot-cursor-ripple ${RIPPLE_DURATION_MS}ms ease-out forwards;
  }
  @keyframes bugshot-cursor-ripple {
    from { transform: translate(-50%, -50%) scale(1); opacity: 1; }
    to { transform: translate(-50%, -50%) scale(${RIPPLE_MAX_SCALE}); opacity: 0; }
  }
`;

let host: HTMLDivElement | null = null;
let haloEl: HTMLDivElement | null = null;
let rippleLayer: HTMLDivElement | null = null;
let pendingX = 0;
let pendingY = 0;
let hasMoved = false;
let rafHandle: number | null = null;

function removeOrphan(): void {
  const orphan = document.getElementById(HOST_ID);
  if (orphan) orphan.remove();
}

function applyMove(): void {
  rafHandle = null;
  if (!haloEl) return;
  haloEl.style.transform = haloTransform(pendingX, pendingY, HALO_DIAMETER);
  if (hasMoved && haloEl.dataset.visible !== "1") {
    haloEl.dataset.visible = "1";
  }
}

function onMove(e: MouseEvent): void {
  pendingX = e.clientX;
  pendingY = e.clientY;
  hasMoved = true;
  if (rafHandle !== null) return;
  rafHandle = requestAnimationFrame(applyMove);
}

function onDown(e: MouseEvent): void {
  if (!rippleLayer) return;
  const ripple = document.createElement("div");
  ripple.className = "ripple";
  ripple.style.left = `${e.clientX}px`;
  ripple.style.top = `${e.clientY}px`;
  rippleLayer.appendChild(ripple);
  ripple.addEventListener(
    "animationend",
    () => ripple.remove(),
    { once: true },
  );
}

export function startCursorHalo(): void {
  if (host) return;
  removeOrphan();

  host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = CSS;
  shadow.appendChild(style);

  haloEl = document.createElement("div");
  haloEl.className = "halo";
  shadow.appendChild(haloEl);

  rippleLayer = document.createElement("div");
  rippleLayer.className = "layer";
  shadow.appendChild(rippleLayer);

  document.documentElement.appendChild(host);

  hasMoved = false;
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("mousedown", onDown, true);
}

export function stopCursorHalo(): void {
  if (!host) return;
  window.removeEventListener("mousemove", onMove, true);
  window.removeEventListener("mousedown", onDown, true);
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  host.remove();
  host = null;
  haloEl = null;
  rippleLayer = null;
  hasMoved = false;
}
