import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 이 파일이 잠그는 건 하나다: **재수립은 phase로 막히지 않는다.**
// `decideReestablish`는 phase를 인자로 받지도 않으므로 순수 함수 쪽에서는 검증할 대상이
// 없고(인자로 받아놓고 안 읽으면 그 테스트가 공허해진다), 실제 우회 여부는 오케스트레이터가
// 작성 중에도 device.set을 쏘는지로만 확인된다. 이 계약이 깨지면 drafting 중 handoff에서
// top만 옮겨가고 래퍼는 안 서는데 세그먼트는 폭을 가리키는 무증상 desync가 된다.

const deviceSet = vi.fn(async (_tabId: number, width: number | null) => ({
  ok: true,
  width,
  available: { width: 1512, height: 900 },
}));
const deviceState = vi.fn(async () => ({ width: null, available: { width: 1512, height: 900 } }));

vi.mock("@/i18n", () => ({ t: (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock("../picker-control", () => ({
  deviceSet: (tabId: number, width: number | null) => deviceSet(tabId, width),
  deviceState: () => deviceState(),
  deviceWatch: vi.fn(async () => {}),
  activateRecordersInDeviceTree: vi.fn(async () => true),
  restartPickerInFrame: vi.fn(async () => {}),
  syncAndSettleLogs: vi.fn(async () => {}),
}));
vi.mock("../hooks/usePickerMessages", () => ({
  networkLogPersist: { discard: vi.fn() },
  consoleLogPersist: { discard: vi.fn() },
  actionLogPersist: { discard: vi.fn() },
}));

let phase = "idle";
const editorState = {
  get phase() {
    return phase;
  },
  clearNetworkLog: vi.fn(),
  clearConsoleLog: vi.fn(),
  clearActionLog: vi.fn(),
  reset: vi.fn(),
};
vi.mock("@/store/editor-store", () => ({
  useEditorStore: Object.assign(() => editorState, {
    getState: () => editorState,
    setState: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  }),
}));
vi.mock("@/store/settings-ui-store", () => ({
  useSettingsUiStore: {
    getState: () => ({ deviceModeWarned: true, setDeviceModeWarned: vi.fn() }),
  },
}));
vi.mock("@/types/messages", () => ({ sendBg: vi.fn(async () => ({ all: [], deviceTree: [] })) }));

type Listener = (msg: unknown, sender: chrome.runtime.MessageSender) => void;
let listeners: Listener[] = [];

function emit(msg: unknown): void {
  for (const fn of listeners) fn(msg, {} as chrome.runtime.MessageSender);
}

// 마이크로태스크를 충분히 흘려 await 체인이 device.set까지 도달하게 한다.
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  vi.clearAllMocks();
  listeners = [];
  phase = "idle";
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: (fn: Listener) => listeners.push(fn),
        removeListener: (fn: Listener) => {
          listeners = listeners.filter((l) => l !== fn);
        },
      },
    },
    tabs: {
      get: vi.fn(async () => ({ id: 1, url: "https://b.com/" })),
      update: vi.fn(async () => {}),
    },
  });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const controller = await import("../device-viewport-controller");
  const mode = await import("../lib/device-mode");
  mode.clearDeviceModeState();
  const detach = controller.attachDeviceViewport(1);
  await flush();
  deviceSet.mockClear();
  return { controller, mode, detach };
}

describe("재수립은 phase 잠금을 우회한다", () => {
  for (const busyPhase of ["drafting", "styling", "recording", "previewing"]) {
    it(`phase=${busyPhase}에서도 top 커밋이 재수립을 발사한다`, async () => {
      const { mode, detach } = await setup();
      phase = busyPhase;
      mode.putPending(1, 390);

      emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
      await flush();

      expect(deviceSet).toHaveBeenCalledWith(1, 390);
      detach();
    });
  }

  // 잠금이 두 축(phase || unsupported)이라 뭉뚱그리면 미지원 URL에서도 재수립을 시도한다.
  it("unsupported는 우회하지 않는다 — pending을 버리고 끝낸다", async () => {
    const { controller, mode, detach } = await setup();
    phase = "drafting";
    controller.setDeviceViewportUnsupported(true);
    mode.putPending(1, 390);

    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();

    expect(deviceSet).not.toHaveBeenCalled();
    controller.setDeviceViewportUnsupported(false);
    detach();
  });

  it("pending이 없으면 top 커밋은 아무 일도 하지 않는다", async () => {
    const { detach } = await setup();
    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();
    expect(deviceSet).not.toHaveBeenCalled();
    detach();
  });

  // 래퍼 프레임 커밋은 top 문서 교체가 아니다.
  it("frameId가 0이 아니면 재수립하지 않는다", async () => {
    const { mode, detach } = await setup();
    mode.putPending(1, 390);
    emit({ type: "frameCommitted", tabId: 1, frameId: 7 });
    await flush();
    expect(deviceSet).not.toHaveBeenCalled();
    detach();
  });
});

describe("push 리스너 수명", () => {
  // 세그먼트 행은 작성 플로우에서 언마운트되는데 재수립이 가장 필요한 구간이 거기다 —
  // 리스너를 그 컴포넌트에 매달면 작성 중 handoff가 통째로 유실된다.
  it("attach가 리스너를 걸고 detach가 정확히 그 리스너만 뗀다", async () => {
    const controller = await import("../device-viewport-controller");
    expect(listeners).toHaveLength(0);
    const detach = controller.attachDeviceViewport(1);
    expect(listeners).toHaveLength(1);
    detach();
    expect(listeners).toHaveLength(0);
  });

  it("detach하면 남은 pending도 함께 버려진다", async () => {
    const { mode, detach } = await setup();
    mode.putPending(1, 390);
    detach();
    expect(mode.peekPending(1)).toBeNull();
  });
});
