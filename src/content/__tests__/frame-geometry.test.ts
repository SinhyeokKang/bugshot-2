import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ViewportRect } from "@/types/picker";
import {
  announceFrameToParent,
  composeTopRect,
  installFrameOffsetResponder,
  isRegisteredChildFrame,
  rectIntersectsViewport,
  requestFrameOffset,
  setFrameToken,
} from "../frame-geometry";

/* ------------------------------------------------------------------ */
/*  composeTopRect — iframe 내부 rect를 top-frame 좌표로 변환 (순수)      */
/* ------------------------------------------------------------------ */

describe("composeTopRect — iframe inner rect → top 좌표 변환", () => {
  it("inner rect에 offset을 더해 top 좌표로 옮긴다", () => {
    const inner: ViewportRect = { x: 10, y: 20, width: 100, height: 50 };

    const result = composeTopRect(inner, { x: 200, y: 300 });

    expect(result).toEqual({ x: 210, y: 320, width: 100, height: 50 });
  });

  it("offset이 0,0이면 inner를 그대로 반환한다 (top 프레임 no-op)", () => {
    const inner: ViewportRect = { x: 40, y: 60, width: 12, height: 8 };

    const result = composeTopRect(inner, { x: 0, y: 0 });

    expect(result).toEqual({ x: 40, y: 60, width: 12, height: 8 });
  });

  it("스크롤된 부모로 음수 offset도 정상 합산한다", () => {
    const inner: ViewportRect = { x: 5, y: 5, width: 30, height: 30 };

    const result = composeTopRect(inner, { x: -15, y: -40 });

    expect(result).toEqual({ x: -10, y: -35, width: 30, height: 30 });
  });

  it("width·height는 offset 영향 없이 보존된다", () => {
    const inner: ViewportRect = { x: 0, y: 0, width: 640, height: 480 };

    const result = composeTopRect(inner, { x: 100, y: 100 });

    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
  });
});

describe("rectIntersectsViewport — top 뷰포트 교차 판정 (순수)", () => {
  const vp = { width: 1200, height: 800 };

  it("뷰포트 내부 rect는 true", () => {
    expect(rectIntersectsViewport({ x: 10, y: 10, width: 100, height: 50 }, vp)).toBe(true);
  });

  it("부분 겹침(경계 걸침)도 true", () => {
    expect(rectIntersectsViewport({ x: -50, y: -20, width: 100, height: 50 }, vp)).toBe(true);
    expect(rectIntersectsViewport({ x: 1150, y: 750, width: 100, height: 100 }, vp)).toBe(true);
  });

  it("뷰포트 아래/오른쪽으로 완전히 벗어나면 false (iframe 스크롤 아웃)", () => {
    expect(rectIntersectsViewport({ x: 10, y: 900, width: 100, height: 50 }, vp)).toBe(false);
    expect(rectIntersectsViewport({ x: 1300, y: 10, width: 100, height: 50 }, vp)).toBe(false);
  });

  it("뷰포트 위/왼쪽으로 완전히 벗어나면 false", () => {
    expect(rectIntersectsViewport({ x: 10, y: -60, width: 100, height: 50 }, vp)).toBe(false);
    expect(rectIntersectsViewport({ x: -200, y: 10, width: 100, height: 50 }, vp)).toBe(false);
  });

  it("경계에 정확히 맞닿기만 하면(겹침 0) false", () => {
    expect(rectIntersectsViewport({ x: 1200, y: 0, width: 100, height: 50 }, vp)).toBe(false);
    expect(rectIntersectsViewport({ x: -100, y: 0, width: 100, height: 50 }, vp)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  postMessage 핸드셰이크 — 스푸핑 방어 + arm 게이트 (window/document 스텁) */
/* ------------------------------------------------------------------ */

type Listener = (e: unknown) => void;

// node env — frame-geometry가 만지는 표면(add/removeEventListener, parent, top,
// setTimeout)만 가진 최소 페이크 window.
function makeFakeWindow() {
  const listeners = new Set<Listener>();
  const win = {
    parent: { postMessage: vi.fn() },
    top: {} as unknown,
    addEventListener: (_t: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_t: string, fn: Listener) => listeners.delete(fn),
    setTimeout: globalThis.setTimeout.bind(globalThis) as typeof setTimeout,
    dispatch: (event: unknown) => {
      for (const fn of [...listeners]) fn(event);
    },
  };
  return win;
}

describe("requestFrameOffset — 자식 측 위조 방어", () => {
  let win: ReturnType<typeof makeFakeWindow>;

  beforeEach(() => {
    win = makeFakeWindow(); // top !== win → iframe 프레임
    vi.stubGlobal("window", win);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentToken(): string {
    return (win.parent.postMessage.mock.calls[0][0] as { token: string }).token;
  }

  it("부모가 보낸 token 매칭 응답을 수용한다", async () => {
    const p = requestFrameOffset(1000);
    const offset = { x: 10, y: 20, topViewport: { width: 800, height: 600 } };
    win.dispatch({
      source: win.parent,
      data: { type: "__bugshot_frame_offset_res__", token: sentToken(), offset },
    });

    await expect(p).resolves.toEqual(offset);
  });

  it("event.source가 부모가 아니면 무시한다 (형제 프레임 위조)", async () => {
    const p = requestFrameOffset(30);
    win.dispatch({
      source: { not: "parent" },
      data: {
        type: "__bugshot_frame_offset_res__",
        token: sentToken(),
        offset: { x: 1, y: 1, topViewport: { width: 1, height: 1 } },
      },
    });

    await expect(p).resolves.toBeNull(); // 위조 무시 → 타임아웃 폴백
  });

  it("token 불일치 응답을 무시한다", async () => {
    const p = requestFrameOffset(30);
    win.dispatch({
      source: win.parent,
      data: {
        type: "__bugshot_frame_offset_res__",
        token: "forged-token",
        offset: { x: 1, y: 1, topViewport: { width: 1, height: 1 } },
      },
    });

    await expect(p).resolves.toBeNull();
  });

  it("응답이 없으면 타임아웃 null (hidden 탭 폴백)", async () => {
    await expect(requestFrameOffset(30)).resolves.toBeNull();
  });

  it("offset 필드가 숫자가 아니면 null (NaN이 크롭 rect로 흘러들지 않게)", async () => {
    const p = requestFrameOffset(1000);
    win.dispatch({
      source: win.parent,
      data: {
        type: "__bugshot_frame_offset_res__",
        token: sentToken(),
        offset: { x: "10", y: 20, topViewport: { width: 800, height: 600 } },
      },
    });

    await expect(p).resolves.toBeNull();
  });

  it("topViewport 누락 offset도 null", async () => {
    const p = requestFrameOffset(1000);
    win.dispatch({
      source: win.parent,
      data: {
        type: "__bugshot_frame_offset_res__",
        token: sentToken(),
        offset: { x: 10, y: 20 },
      },
    });

    await expect(p).resolves.toBeNull();
  });

  it("top 프레임에서는 즉시 null (요청 자체 미발송)", async () => {
    win.top = win; // window === window.top
    await expect(requestFrameOffset(30)).resolves.toBeNull();
    expect(win.parent.postMessage).not.toHaveBeenCalled();
  });
});

describe("installFrameOffsetResponder — 부모(top) 측 arm 게이트", () => {
  let win: ReturnType<typeof makeFakeWindow>;
  let childWindow: { postMessage: ReturnType<typeof vi.fn> };
  let iframeEl: {
    contentWindow: typeof childWindow;
    getBoundingClientRect: () => { left: number; top: number };
    clientLeft: number;
    clientTop: number;
  };

  beforeEach(() => {
    win = makeFakeWindow();
    win.top = win; // top 프레임
    childWindow = { postMessage: vi.fn() };
    iframeEl = {
      contentWindow: childWindow,
      getBoundingClientRect: () => ({ left: 100, top: 50 }),
      clientLeft: 2,
      clientTop: 3,
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {
      querySelectorAll: () => [iframeEl],
    });
    setFrameToken("session-token");
  });

  afterEach(() => {
    setFrameToken(null);
    vi.unstubAllGlobals();
  });

  function registerChild(): void {
    win.dispatch({
      source: childWindow,
      data: { type: "__bugshot_frame_present__", token: "session-token" },
    });
  }

  it("미arm 상태의 offset 요청은 무응답 (임의 iframe 스크립트의 top 부작용 차단)", () => {
    const prep = vi.fn(() => ({ width: 1200, height: 800 }));
    installFrameOffsetResponder({
      onChildCapturePrep: prep,
      consumeArm: () => false,
    });
    registerChild();

    win.dispatch({
      source: childWindow,
      data: { type: "__bugshot_frame_offset_req__", token: "t1" },
    });

    expect(childWindow.postMessage).not.toHaveBeenCalled();
    expect(prep).not.toHaveBeenCalled();
  });

  it("arm이 소비될 때만 offset 응답 + prep 호출 (border 보정·topViewport 포함)", () => {
    let armed = true;
    installFrameOffsetResponder({
      onChildCapturePrep: () => ({ width: 1200, height: 800 }),
      consumeArm: () => {
        if (!armed) return false;
        armed = false;
        return true;
      },
    });
    registerChild();

    win.dispatch({
      source: childWindow,
      data: { type: "__bugshot_frame_offset_req__", token: "t1" },
    });
    // 두 번째 요청은 arm이 이미 소비돼 무응답 (1회성)
    win.dispatch({
      source: childWindow,
      data: { type: "__bugshot_frame_offset_req__", token: "t2" },
    });

    expect(childWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(childWindow.postMessage).toHaveBeenCalledWith(
      {
        type: "__bugshot_frame_offset_res__",
        token: "t1",
        offset: { x: 102, y: 53, topViewport: { width: 1200, height: 800 } },
      },
      "*",
    );
  });

  it("registry 미등록 프레임의 offset 요청은 arm을 소비하지 않고 무응답 (arm 선점·geometry 유출 차단)", () => {
    const consumeArm = vi.fn(() => true);
    installFrameOffsetResponder({
      onChildCapturePrep: () => ({ width: 1200, height: 800 }),
      consumeArm,
    });
    // registerChild() 생략 — 미등록 상태

    win.dispatch({
      source: childWindow,
      data: { type: "__bugshot_frame_offset_req__", token: "t1" },
    });

    expect(consumeArm).not.toHaveBeenCalled();
    expect(childWindow.postMessage).not.toHaveBeenCalled();
  });

  it("token 매칭 present 등록으로 isRegisteredChildFrame이 true가 된다", () => {
    installFrameOffsetResponder({
      onChildCapturePrep: () => ({ width: 1, height: 1 }),
      consumeArm: () => false,
    });
    expect(isRegisteredChildFrame(iframeEl as unknown as Element)).toBe(false);

    registerChild();

    expect(isRegisteredChildFrame(iframeEl as unknown as Element)).toBe(true);
  });

  it("token 불일치/누락 present는 등록 거부 (무인증 postMessage 위조 차단)", () => {
    installFrameOffsetResponder({
      onChildCapturePrep: () => ({ width: 1, height: 1 }),
      consumeArm: () => false,
    });

    win.dispatch({
      source: childWindow,
      data: { type: "__bugshot_frame_present__" },
    });
    win.dispatch({
      source: childWindow,
      data: { type: "__bugshot_frame_present__", token: "forged" },
    });

    expect(isRegisteredChildFrame(iframeEl as unknown as Element)).toBe(false);
  });

  it("token 미설정(picker.start 이전) 상태에선 어떤 present도 등록 안 됨", () => {
    installFrameOffsetResponder({
      onChildCapturePrep: () => ({ width: 1, height: 1 }),
      consumeArm: () => false,
    });
    setFrameToken(null);

    win.dispatch({
      source: childWindow,
      data: { type: "__bugshot_frame_present__", token: "session-token" },
    });

    expect(isRegisteredChildFrame(iframeEl as unknown as Element)).toBe(false);
  });

  it("자식 announce가 top의 token 설정보다 선착하면 보류 → setFrameToken 시점에 등록 (broadcast 순서 비보장)", () => {
    installFrameOffsetResponder({
      onChildCapturePrep: () => ({ width: 1, height: 1 }),
      consumeArm: () => false,
    });
    setFrameToken(null);

    win.dispatch({
      source: childWindow,
      data: { type: "__bugshot_frame_present__", token: "session-token" },
    });
    expect(isRegisteredChildFrame(iframeEl as unknown as Element)).toBe(false);

    setFrameToken("session-token");

    expect(isRegisteredChildFrame(iframeEl as unknown as Element)).toBe(true);
  });

  it("보류된 위조 token announce는 setFrameToken 재평가에서도 등록 안 됨", () => {
    installFrameOffsetResponder({
      onChildCapturePrep: () => ({ width: 1, height: 1 }),
      consumeArm: () => false,
    });
    setFrameToken(null);

    win.dispatch({
      source: childWindow,
      data: { type: "__bugshot_frame_present__", token: "forged" },
    });
    setFrameToken("session-token");

    expect(isRegisteredChildFrame(iframeEl as unknown as Element)).toBe(false);
  });
});

describe("announceFrameToParent — 자식 측 등록 알림", () => {
  let win: ReturnType<typeof makeFakeWindow>;

  beforeEach(() => {
    win = makeFakeWindow();
    win.top = win.parent; // 1-depth: parent === top
    vi.stubGlobal("window", win);
  });

  afterEach(() => {
    setFrameToken(null);
    vi.unstubAllGlobals();
  });

  it("token을 실어 부모에 present를 보낸다", () => {
    setFrameToken("session-token");
    announceFrameToParent();

    expect(win.parent.postMessage).toHaveBeenCalledWith(
      { type: "__bugshot_frame_present__", token: "session-token" },
      "*",
    );
  });

  it("token 미보유(picker.start에 token 없음)면 알리지 않는다 — 등록 불가 announce 억제", () => {
    setFrameToken(null);
    announceFrameToParent();

    expect(win.parent.postMessage).not.toHaveBeenCalled();
  });

  it("중첩 프레임(부모가 top이 아님)은 알리지 않는다 (1-depth 한정)", () => {
    setFrameToken("session-token");
    win.top = {}; // parent !== top
    announceFrameToParent();

    expect(win.parent.postMessage).not.toHaveBeenCalled();
  });
});
