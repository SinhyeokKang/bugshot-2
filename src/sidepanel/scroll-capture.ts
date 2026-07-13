import { loadImage } from "@/sidepanel/capture";
import { sendPickerTop } from "@/sidepanel/picker-control";
import {
  planScrollCapture,
  tilePixelRect,
  type ScrollPlan,
} from "@/sidepanel/lib/scroll-capture-plan";
import { sendBg } from "@/types/messages";

import type {
  BeginScrollCaptureResponse,
  PageMetrics,
  PickerMessage,
  ScrollAck,
} from "@/types/picker";

// 스티치 결과는 chrome.storage.session(10MB 쿼터)에 dataURL로 그대로 직렬화된다 — 쿼터를
// 넘기면 lite 스냅샷(screenshotRaw: null)으로 조용히 강등돼 패널 재오픈 시 캡처가 사라진다.
// webp 0.92 + base64(×1.33)가 그 안에 들어오도록 출력 픽셀을 제한한다.
const MAX_OUTPUT_PIXELS = 8_000_000;

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
  try {
    // begin도 try 안에서 — 세션은 열렸는데 응답만 유실되면 finally 없이는 blocker·스크롤이 잔류한다.
    const begun = await deps.send<BeginScrollCaptureResponse>(tabId, {
      type: "picker.beginScrollCapture",
    });
    if (!begun) throw new Error("scroll capture unavailable");
    const metrics = begun.metrics;
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
      if (!ack) throw new Error("scroll capture unavailable");

      await stitcher.add({
        index: tile.index,
        actualY: ack.y,
        dataUrl: await deps.captureTab(tabId),
      });
      done += 1;
      opts.onProgress(done, plan.tiles.length);
    }

    return {
      dataUrl: await stitcher.finish(),
      viewport: metrics.viewport,
      truncated: plan.truncated,
    };
  } finally {
    await deps.send(tabId, { type: "picker.endScrollCapture" });
  }
}

function createCanvasStitcher(plan: ScrollPlan, metrics: PageMetrics): ScrollStitcher {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let scale = 1;
  let output = 1;

  return {
    async add(tile) {
      const img = await loadImage(tile.dataUrl);
      if (!canvas || !ctx) {
        // 캡처 이미지 폭 / CSS 뷰포트 폭 = 실제 배율(DPR × 줌을 한 번에 흡수).
        scale = metrics.viewport.width > 0 ? img.naturalWidth / metrics.viewport.width : 1;
        const fullWidth = metrics.viewport.width * scale;
        const fullHeight = plan.totalHeight * scale;
        output = Math.min(1, Math.sqrt(MAX_OUTPUT_PIXELS / Math.max(1, fullWidth * fullHeight)));
        canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(fullWidth * output));
        canvas.height = Math.max(1, Math.round(fullHeight * output));
        ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d context unavailable");
      }
      const r = tilePixelRect(plan, tile.index, tile.actualY, scale, scale * output);
      ctx.drawImage(
        img,
        0,
        r.srcY,
        img.naturalWidth,
        r.srcHeight,
        0,
        r.destY,
        canvas.width,
        r.destHeight,
      );
    },
    async finish() {
      if (!canvas) throw new Error("no tiles captured");
      return canvas.toDataURL("image/webp", 0.92);
    },
  };
}
