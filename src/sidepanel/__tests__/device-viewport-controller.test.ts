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
const deviceState = vi.fn<
  () => Promise<{ width: number | null; available: { width: number; height: number } }>
>(async () => ({ width: null, available: { width: 1512, height: 900 } }));
const activateRecordersInDeviceTree = vi.fn(async () => true);
const fetchDeviceTree = vi.fn<() => Promise<string[] | null>>(async () => []);
const sendBg = vi.fn(async (..._args: unknown[]) => ({ ok: true }));

vi.mock("@/i18n", () => ({ t: (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock("../picker-control", () => ({
  deviceSet: (tabId: number, width: number | null) => deviceSet(tabId, width),
  deviceState: () => deviceState(),
  deviceWatch: vi.fn(async () => {}),
  activateRecordersInDeviceTree: () => activateRecordersInDeviceTree(),
  fetchDeviceTree: () => fetchDeviceTree(),
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
vi.mock("@/types/messages", () => ({ sendBg }));

type Listener = (
  msg: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (value?: unknown) => void,
) => boolean | void;
let listeners: Listener[] = [];

// 반환값을 그대로 돌려준다 — `return true`(비동기 응답 채널 유지)를 버리면 그 계약이
// 테스트에서 사라져, 지워도 green인 채로 매 handoff가 ACK 상한까지 지연된다.
function emit(
  msg: unknown,
  sendResponse: (value?: unknown) => void = () => {},
): Array<boolean | void> {
  return listeners.map((fn) => fn(msg, {} as chrome.runtime.MessageSender, sendResponse));
}

// 마이크로태스크를 충분히 흘려 await 체인이 device.set까지 도달하게 한다.
const flush = () => new Promise((r) => setTimeout(r, 0));

// 전이를 특정 await에 세워두고 그 창에 push를 밀어넣기 위한 게이트.
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.clearAllMocks();
  activateRecordersInDeviceTree.mockResolvedValue(true);
  deviceState.mockResolvedValue({ width: null, available: { width: 1512, height: 900 } });
  fetchDeviceTree.mockResolvedValue([]);
  sendBg.mockResolvedValue({ ok: true });
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

async function setup(clearDeviceSet = true) {
  const controller = await import("../device-viewport-controller");
  const mode = await import("../lib/device-mode");
  mode.clearDeviceModeState();
  const detach = controller.attachDeviceViewport(1);
  await flush();
  if (clearDeviceSet) deviceSet.mockClear();
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

describe("handoff 준비 ACK", () => {
  it("pending을 세운 뒤 ACK하고 top 이동은 background에 맡긴다", async () => {
    const { controller, mode, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    const respond = vi.fn();

    const kept = emit(
      { type: "device.handoff", tabId: 1, url: "https://b.com/", expiresAt: Date.now() + 500 },
      respond,
    );
    await flush();

    expect(mode.peekPending(1)?.width).toBe(390);
    expect(respond).toHaveBeenCalledWith({ ok: true });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    // 채널을 안 잡으면 sendResponse가 무시돼 background가 매번 ACK 상한까지 헛기다린다.
    expect(kept).toContain(true);
    detach();
  });

  it("ACK 처리 중 예외가 나도 응답을 돌려준다", async () => {
    const { toast } = await import("sonner");
    vi.mocked(toast.info).mockImplementationOnce(() => {
      throw new Error("toast unavailable");
    });
    const { controller, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    phase = "recording";
    const respond = vi.fn();

    emit(
      { type: "device.handoff", tabId: 1, url: "https://b.com/", expiresAt: Date.now() + 500 },
      respond,
    );
    await flush();

    expect(respond).toHaveBeenCalledWith({ ok: false });
    detach();
  });

  // 페이지 쪽 Full 복귀는 background가 소유한다(래퍼 제거 + reload). 패널이 device.set을
  // 또 부르면 이중 reload가 되지만, **폭은 내려야 한다** — 안 내리면 페이지는 Full인데
  // UI만 ON으로 남아 같은 폭 재선택이 noop으로 죽는다.
  it("unsupported 롤백은 device.set 중복 없이 폭만 강등한다", async () => {
    const { controller, mode, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    mode.putPending(1, 390);
    const respond = vi.fn();

    emit({ type: "device.handoff", tabId: 1, url: "blob:https://a.com/id", expiresAt: Date.now() + 500 }, respond);
    await flush();

    expect(deviceSet).not.toHaveBeenCalled();
    expect(controller.useDeviceViewportStore.getState().width).toBeNull();
    expect(mode.peekPending(1)).toBeNull();
    expect(respond).toHaveBeenCalledWith({ ok: true });
    detach();
  });

  // 만료 분기는 pending만 안 남기는 게 아니라 **Full로 강등까지** 해야 한다. background는
  // 응답값을 안 보고 top을 옮기므로, width를 390으로 둔 채 끝내면 래퍼는 없는데 UI만 ON인
  // desync가 탭 세션 내내 굳는다(390 재선택은 noop, 페이지 전체 캡처는 영구 차단).
  it("ACK 기한이 지난 handoff는 유령 pending 없이 Full로 강등한다", async () => {
    const { controller, mode, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    mode.putPending(1, 390);
    const respond = vi.fn();

    emit(
      { type: "device.handoff", tabId: 1, url: "https://b.com/", expiresAt: Date.now() - 1 },
      respond,
    );
    await flush();

    expect(mode.peekPending(1)).toBeNull();
    expect(controller.useDeviceViewportStore.getState().width).toBeNull();
    expect(respond).toHaveBeenCalledWith({ ok: false });
    detach();
  });

  // 강등이 `await deviceSet` 창 안에 도착하면 그 응답의 set({width})가 방금 내린 폭을
  // 되살려 desync가 그대로 복구된다 — 소유권 토큰으로 인플라이트 전이를 무효화해야 한다.
  it("인플라이트 전이가 만료 강등을 되덮지 않는다", async () => {
    const { controller, mode, detach } = await setup();
    const gate = deferred();
    deviceSet.mockImplementationOnce(async (_tabId, width) => {
      await gate.promise;
      return { ok: true, width, available: { width: 1512, height: 900 } };
    });

    const selecting = controller.selectDeviceWidth(390);
    await flush();
    emit(
      { type: "device.handoff", tabId: 1, url: "https://b.com/", expiresAt: Date.now() - 1 },
      vi.fn(),
    );
    await flush();
    gate.resolve();
    await selecting;
    await flush();

    expect(controller.useDeviceViewportStore.getState().width).toBeNull();
    expect(mode.peekPending(1)).toBeNull();
    detach();
  });

  // 판정이 ok로 풀린 뒤 finishActivation(백그라운드 왕복·ACK 재시도)이 도는 창도 같은 문제다 —
  // 그 뒤의 putPending이 방금 버린 pending을 되살리면 "만료 = 재수립 안 함"이 뒤집힌다.
  it("finishActivation 창에서 온 만료 강등도 pending을 되살리지 않는다", async () => {
    const { controller, mode, detach } = await setup();
    const gate = deferred();
    activateRecordersInDeviceTree.mockImplementationOnce(async () => {
      await gate.promise;
      return true;
    });

    const selecting = controller.selectDeviceWidth(390);
    await flush();
    emit({ type: "device.frameLoaded", tabId: 1, frameId: 7 });
    await flush();
    emit(
      { type: "device.handoff", tabId: 1, url: "https://b.com/", expiresAt: Date.now() - 1 },
      vi.fn(),
    );
    await flush();
    gate.resolve();
    await selecting;
    await flush();

    expect(mode.peekPending(1)).toBeNull();
    expect(controller.useDeviceViewportStore.getState().width).toBeNull();
    detach();
  });
});

describe("확장 reload 재수립", () => {
  it("기존 래퍼를 제거해 top commit을 만든 뒤 같은 폭으로 재수립한다", async () => {
    deviceState.mockResolvedValueOnce({ width: 390, available: { width: 1512, height: 900 } });
    const { mode, detach } = await setup(false);

    expect(deviceSet).toHaveBeenCalledWith(1, null);
    expect(mode.peekPending(1)?.width).toBe(390);

    deviceSet.mockClear();
    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();
    expect(deviceSet).toHaveBeenCalledWith(1, 390);
    detach();
  });

  // 열거 실패를 "엇갈림"으로 읽으면 래퍼가 멀쩡한데도 device.set(null) → location.reload()로
  // 정상 동작 중인 페이지의 스크롤·입력값을 날린다. 판정 불가는 아무것도 하지 않는다.
  it("문서 열거가 실패하면 복구를 발사하지 않는다", async () => {
    deviceState.mockResolvedValueOnce({ width: 390, available: { width: 1512, height: 900 } });
    fetchDeviceTree.mockResolvedValueOnce(null);
    const { mode, detach } = await setup(false);

    expect(deviceSet).not.toHaveBeenCalled();
    expect(mode.peekPending(1)).toBeNull();
    detach();
  });
});

// 판정 push는 fire-and-forget이고, device.set 왕복과 래퍼 커밋은 동시에 진행된다 —
// 캐시된 페이지처럼 커밋이 빠르면 push가 대기 등록보다 먼저 도착한다. 그걸 흘리면
// 3초를 헛기다린 끝에 "차단"으로 접어 정상 로드된 래퍼를 롤백한다(사용자에겐 "가끔
// 폭을 눌러도 아무 일이 안 일어난다"로 보인다).
describe("판정 push 유실 방지", () => {
  it("device.set 왕복 중에 도착한 frameLoaded로도 활성화까지 간다", async () => {
    const { mode, detach } = await setup();
    deviceSet.mockImplementationOnce(async (_tabId, width) => {
      emit({ type: "device.frameLoaded", tabId: 1, frameId: 7 });
      return { ok: true, width, available: { width: 1512, height: 900 } };
    });
    mode.putPending(1, 390);

    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();

    expect(activateRecordersInDeviceTree).toHaveBeenCalled();
    detach();
  });

  it("이른 frameBlocked도 유실되지 않는다 (3초를 헛기다리지 않는다)", async () => {
    const { mode, detach } = await setup();
    deviceSet.mockImplementationOnce(async (_tabId, width) => {
      emit({ type: "device.frameBlocked", tabId: 1 });
      return { ok: true, width, available: { width: 1512, height: 900 } };
    });
    mode.putPending(1, 390);

    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();

    // 차단이면 활성화로 가지 않고 즉시 롤백(device.set(null))이 나간다.
    expect(activateRecordersInDeviceTree).not.toHaveBeenCalled();
    expect(deviceSet).toHaveBeenCalledWith(1, null);
    detach();
  });

  // 걸어둔 판정이 다음 전이로 새면 방금 시작한 전이가 남의 결과로 끝난다.
  it("앞선 전이의 판정이 다음 전이로 새지 않는다", async () => {
    const { mode, detach } = await setup();
    emit({ type: "device.frameBlocked", tabId: 1 });
    await flush();

    deviceSet.mockImplementationOnce(async (_tabId, width) => {
      emit({ type: "device.frameLoaded", tabId: 1, frameId: 7 });
      return { ok: true, width, available: { width: 1512, height: 900 } };
    });
    mode.putPending(1, 390);
    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();

    expect(activateRecordersInDeviceTree).toHaveBeenCalled();
    detach();
  });
});
