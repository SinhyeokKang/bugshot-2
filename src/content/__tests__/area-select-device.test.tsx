import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewportRect } from "@/types/picker";

const deviceFrameRect = vi.fn<() => ViewportRect | null>(() => null);

vi.mock("../device-frame", async () => {
  const actual = await vi.importActual<typeof import("../device-frame")>("../device-frame");
  return { ...actual, deviceFrameRect: () => deviceFrameRect() };
});

import { selectFullViewport, startAreaSelect } from "../area-select";

const FRAME: ViewportRect = { x: 317, y: 0, width: 390, height: 768 };

function harness() {
  const onSelected = vi.fn();
  const handle = startAreaSelect({
    shadow: document.createElement("div").attachShadow({ mode: "open" }),
    onBlockerRequest: () => {},
    onSelected,
    onCancelled: () => {},
  });
  return { handle, onSelected };
}

function drag(handle: ReturnType<typeof harness>["handle"], from: [number, number], to: [number, number]) {
  handle._onMouseDown(
    new MouseEvent("mousedown", { button: 0, clientX: from[0], clientY: from[1] }),
  );
  handle._onMouseUp(new MouseEvent("mouseup", { clientX: to[0], clientY: to[1] }));
}

// settleAfterPaint가 rAF×2 뒤에 확정한다.
const settle = () => new Promise((r) => setTimeout(r, 60));

beforeEach(() => {
  deviceFrameRect.mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("selectFullViewport — 화면(뷰포트) 캡처 rect", () => {
  it("모드 OFF에서 rect가 {0,0,innerWidth,innerHeight}로 이전과 동일하다", async () => {
    const { handle, onSelected } = harness();
    selectFullViewport(handle);
    await settle();
    expect(onSelected).toHaveBeenCalledWith(
      { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
  });

  // 래퍼가 justify-content:center로 놓이므로 x 오프셋이 0이 아니다 — {x:0,y:0,...viewport}
  // 스프레드를 풀지 않으면 좌우 여백이 결과에 그대로 찍힌다.
  it("모드 ON에서 rect가 래퍼 rect와 일치하고 x > 0이다", async () => {
    deviceFrameRect.mockReturnValue(FRAME);
    const { handle, onSelected } = harness();
    selectFullViewport(handle);
    await settle();
    expect(onSelected.mock.calls[0][0]).toEqual(FRAME);
    expect(onSelected.mock.calls[0][0].x).toBeGreaterThan(0);
  });

  // viewport는 크롭 배율 기준이라 바꾸면 크롭이 ~3.9배 어긋난다.
  it("onSelected에 넘기는 viewport는 모드와 무관하게 항상 top이다", async () => {
    deviceFrameRect.mockReturnValue(FRAME);
    const { handle, onSelected } = harness();
    selectFullViewport(handle);
    await settle();
    expect(onSelected.mock.calls[0][1]).toEqual({
      width: window.innerWidth,
      height: window.innerHeight,
    });
  });
});

describe("드래그 확정 rect — 클램핑", () => {
  it("모드 OFF에서는 클램핑 없이 이전과 동일하다", async () => {
    const { handle, onSelected } = harness();
    drag(handle, [10, 20], [210, 220]);
    await settle();
    expect(onSelected.mock.calls[0][0]).toEqual({ x: 10, y: 20, width: 200, height: 200 });
  });

  it("모드 ON에서 래퍼 밖 여백까지 드래그한 rect가 래퍼 영역으로 클램핑된다", async () => {
    deviceFrameRect.mockReturnValue(FRAME);
    const { handle, onSelected } = harness();
    drag(handle, [10, 100], [900, 400]);
    await settle();
    const rect = onSelected.mock.calls[0][0] as ViewportRect;
    expect(rect.x).toBeGreaterThanOrEqual(FRAME.x);
    expect(rect.x + rect.width).toBeLessThanOrEqual(FRAME.x + FRAME.width);
  });

  it("모드 ON에서도 viewport는 top 그대로다", async () => {
    deviceFrameRect.mockReturnValue(FRAME);
    const { handle, onSelected } = harness();
    drag(handle, [10, 100], [900, 400]);
    await settle();
    expect(onSelected.mock.calls[0][1]).toEqual({
      width: window.innerWidth,
      height: window.innerHeight,
    });
  });
});
