import { loadImage } from "@/sidepanel/capture";
import { sendPickerTop } from "@/sidepanel/picker-control";
import {
  planScrollCapture,
  stitchGeometry,
  tilePixelRect,
  type ScrollPlan,
} from "@/sidepanel/lib/scroll-capture-plan";
import { sendBg } from "@/lib/bg-client";

import type { PageMetrics, PickerMessage, ScrollAck } from "@/types/picker";

export interface TileShot {
  index: number;
  actualY: number;
  dataUrl: string;
}

// 타일을 받는 즉시 캔버스에 그리고 버린다 — 20장을 모아뒀다 한 번에 디코드하면
// 고DPR 대형 뷰포트에서 수백 MB 비트맵이 동시에 살아 사이드패널이 죽는다.
export interface ScrollStitcher {
  add(tile: TileShot): Promise<void>;
  finish(): Promise<string>;
}

export interface ScrollCaptureDeps {
  send: <R>(tabId: number, msg: PickerMessage) => Promise<R | undefined>;
  captureTab: (tabId: number) => Promise<string>;
  isTabActive: (tabId: number) => Promise<boolean>;
  createStitcher: (plan: ScrollPlan, metrics: PageMetrics) => ScrollStitcher;
}

export interface ScrollCaptureResult {
  dataUrl: string;
  viewport: { width: number; height: number };
  truncated: boolean;
}

const defaultDeps: ScrollCaptureDeps = {
  // area select와 마찬가지로 top frame 한정 — broadcast하면 프레임마다 스크롤이 튄다.
  send: sendPickerTop,
  // captureVisibleTab 직접 호출 금지 — background 관문(capture-throttle)만 경유한다.
  captureTab: (tabId) => sendBg<string>({ type: "captureVisibleTab", tabId }),
  isTabActive: async (tabId) => {
    const tab = await chrome.tabs.get(tabId);
    return tab.active === true;
  },
  createStitcher: createCanvasStitcher,
};

export async function runScrollCapture(
  tabId: number,
  opts: {
    onProgress: (done: number, total: number) => void;
    signal: AbortSignal;
    deps?: ScrollCaptureDeps;
  },
): Promise<ScrollCaptureResult> {
  const deps = opts.deps ?? defaultDeps;
  let endSent = false;
  try {
    // begin도 try 안에서 — 세션은 열렸는데 응답만 유실되면 finally 없이는 blocker·스크롤이 잔류한다.
    // content가 throw하면 {ok:false} 응답이라 truthy — metrics 유무로 판정해야 한다.
    const begun = await deps.send<PageMetrics>(tabId, { type: "picker.beginScrollCapture" });
    if (!begun?.viewport) throw new Error("scroll capture unavailable");
    const metrics = begun;
    const plan = planScrollCapture(metrics);
    const stitcher = deps.createStitcher(plan, metrics);
    let done = 0;

    for (const tile of plan.tiles) {
      if (opts.signal.aborted) throw new Error("scroll capture aborted");
      // captureVisibleTab은 창의 현재 보이는 탭을 찍는다 — 탭이 바뀌면 남의 화면이 섞인다.
      if (!(await deps.isTabActive(tabId))) throw new Error("tab is not active");

      const ack = await deps.send<ScrollAck>(tabId, {
        type: "picker.scrollCaptureTo",
        y: tile.scrollY,
        hideFixed: tile.index > 0,
      });
      // content 세션이 사라지면(네비게이션·재주입) 무응답 → 스크롤 안 된 화면을 계속 찍는 대신 중단.
      // content가 동기 구간에서 throw하면 전역 catch가 {ok:false}를 보내고 그건 truthy다 —
      // 통과하면 ack.y가 NaN으로 흘러 drawImage가 무음 no-op이 되고 빈 밴드가 성공으로 스티치된다.
      // begin 경로가 viewport 유무로 판정하는 것과 같은 이유로 shape을 본다.
      if (!ack || typeof ack.y !== "number") throw new Error("scroll capture unavailable");

      const dataUrl = await deps.captureTab(tabId);
      // 스크롤 ack와 실제 캡처 사이엔 캡처 큐 대기(≥500ms)가 있다 — 그 사이 탭이 바뀌었으면
      // 방금 찍은 건 남의 탭 화면이다. 스티치에 넣지 않고 버린다.
      if (opts.signal.aborted) throw new Error("scroll capture aborted");
      if (!(await deps.isTabActive(tabId))) throw new Error("tab is not active");

      await stitcher.add({ index: tile.index, actualY: ack.y, dataUrl });
      done += 1;
      opts.onProgress(done, plan.tiles.length);
    }

    if (opts.signal.aborted) throw new Error("scroll capture aborted");

    // content 워치독 만료는 ack로 안 보인다 — 마지막 타일의 captureTab이 매달렸다 풀리면
    // 이미 원복된 화면이 그 타일의 ack.y 좌표로 스티치되고, 뒤에 남은 타일이 없어 다음
    // scrollCaptureTo의 `ended` 거부가 끊을 기회조차 없다. finish 전에 세션 생존을 확인한다
    // (finally는 아직 안 보냈을 때만 보낸다 — 왕복을 늘리지 않는다).
    const ended = await deps.send<{ expired?: boolean }>(tabId, {
      type: "picker.endScrollCapture",
    });
    endSent = true;
    if (ended?.expired) throw new Error("scroll capture expired");

    return {
      dataUrl: await stitcher.finish(),
      viewport: metrics.viewport,
      truncated: plan.truncated,
    };
  } finally {
    if (!endSent) await deps.send(tabId, { type: "picker.endScrollCapture" });
  }
}

function createCanvasStitcher(plan: ScrollPlan, metrics: PageMetrics): ScrollStitcher {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let geometry: ReturnType<typeof stitchGeometry> | null = null;
  let srcWidth = 0;

  return {
    async add(tile) {
      const img = await loadImage(tile.dataUrl);
      if (!canvas || !ctx || !geometry) {
        geometry = stitchGeometry(plan, metrics.viewport.width, img.naturalWidth);
        srcWidth = img.naturalWidth;
        canvas = document.createElement("canvas");
        canvas.width = geometry.width;
        canvas.height = geometry.height;
        ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d context unavailable");
      }
      // 캡처 중 창 리사이즈·스크롤바 출현으로 타일 폭이 바뀌면 가로로 늘어난 채 조용히 붙는다.
      if (img.naturalWidth !== srcWidth) throw new Error("tile width changed mid-capture");

      const r = tilePixelRect(plan, tile.index, tile.actualY, geometry.srcScale, geometry.destScale);
      ctx.drawImage(img, 0, r.srcY, srcWidth, r.srcHeight, 0, r.destY, canvas.width, r.destHeight);
    },
    async finish() {
      if (!canvas) throw new Error("no tiles captured");
      return canvas.toDataURL("image/webp", 0.92);
    },
  };
}
