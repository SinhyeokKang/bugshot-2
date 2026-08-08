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
const activateRecordersInDeviceTree = vi.fn<() => Promise<"ok" | "startFailed" | "notReached">>(
  async () => "ok",
);
const fetchDeviceTree = vi.fn<() => Promise<string[] | null>>(async () => []);
const sendBg = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
const deviceWatch = vi.fn(async (_tabId: number, _on: boolean) => {});

vi.mock("@/i18n", () => ({ t: (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("../picker-control", () => ({
  deviceSet: (tabId: number, width: number | null) => deviceSet(tabId, width),
  deviceState: () => deviceState(),
  deviceWatch: (tabId: number, on: boolean) => deviceWatch(tabId, on),
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
  activateRecordersInDeviceTree.mockResolvedValue("ok");
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

    expect(mode.peekPending(1)).toBe(390);
    expect(respond).toHaveBeenCalledWith({ ok: true });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    // 채널을 안 잡으면 sendResponse가 무시돼 background가 매번 ACK 상한까지 헛기다린다.
    expect(kept).toContain(true);
    detach();
  });

  // 만료 다이얼로그의 마운트 지점은 `IssueTab`뿐인데, capturing은 콘솔·네트워크 서브탭이
  // 열려 있는 phase다(hideSubTabs에도 logTabsLocked에도 없다). 서브탭을 켜면 Radix가
  // IssueTab을 언마운트하므로, phase만 보고 sessionExpired를 켜면 통보가 0건인 채
  // 플래그만 래치된다 — 내리는 건 reset()뿐이라 세션 저장도 함께 멈춘다.
  it("IssueTab이 언마운트돼 있으면 capturing이어도 토스트로 통보한다", async () => {
    const { toast } = await import("sonner");
    vi.mocked(toast.info).mockClear();
    const { controller, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    phase = "capturing";
    controller.setDeviceViewportIssueMounted(false);

    emit(
      { type: "device.handoff", tabId: 1, url: "https://b.com/", expiresAt: Date.now() + 500 },
      vi.fn(),
    );
    await flush();

    expect(toast.info).toHaveBeenCalledWith("issue.device.handoffToast");
    expect(controller.useDeviceViewportStore.getState().expiredByHandoff).toBe(false);
    controller.setDeviceViewportIssueMounted(true);
    detach();
  });

  it("IssueTab이 마운트돼 있으면 capturing은 다이얼로그로 간다", async () => {
    const { toast } = await import("sonner");
    vi.mocked(toast.info).mockClear();
    const { controller, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    phase = "capturing";
    controller.setDeviceViewportIssueMounted(true);

    emit(
      { type: "device.handoff", tabId: 1, url: "https://b.com/", expiresAt: Date.now() + 500 },
      vi.fn(),
    );
    await flush();

    expect(toast.info).not.toHaveBeenCalled();
    expect(controller.useDeviceViewportStore.getState().expiredByHandoff).toBe(true);
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
      return "ok";
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
    expect(mode.peekPending(1)).toBe(390);

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

  // pending은 인메모리라 패널 문서가 죽으면 사라지는데, 정상 상태(래퍼·binding 모두 살아
  // 있음)의 재부착이 그걸 다시 안 세우면 이후 첫 top 커밋에서 재수립이 안 걸린다 —
  // 래퍼는 사라지는데 스토어 width는 남는 desync가 굳는다.
  it("래퍼가 살아 있는 재부착도 pending을 세운다", async () => {
    deviceState.mockResolvedValueOnce({ width: 390, available: { width: 1512, height: 900 } });
    fetchDeviceTree.mockResolvedValueOnce(["doc-1"]);
    const { mode, detach } = await setup(false);

    // 엇갈림이 아니므로 복구용 device.set(null)은 안 나간다.
    expect(deviceSet).not.toHaveBeenCalled();
    expect(mode.peekPending(1)).toBe(390);

    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();
    expect(deviceSet).toHaveBeenCalledWith(1, 390);
    detach();
  });

  // 재부착 조회는 두 왕복(device.state → device.documents)을 거친다 — 그 사이 사용자가
  // `전체`를 눌렀으면 그쪽이 이미 pending을 버렸고, 뒤늦게 옛 폭으로 되살리면 이어지는
  // reload의 top 커밋이 그걸 소비해 방금 끈 모드가 다시 켜진다.
  // 형제 분기(엇갈림 복구)도 같은 창을 갖는다 — 여기만 무조건 putPending이면 방금 끈 모드가
  // OFF의 reload 커밋에서 되살아난다.
  it("엇갈림 복구 조회 중에 전체를 눌러도 되살리지 않는다", async () => {
    deviceState.mockResolvedValueOnce({ width: 390, available: { width: 1512, height: 900 } });
    const gate = deferred();
    fetchDeviceTree.mockImplementationOnce(async () => {
      await gate.promise;
      return [];
    });

    const controller = await import("../device-viewport-controller");
    const mode = await import("../lib/device-mode");
    mode.clearDeviceModeState();
    const detach = controller.attachDeviceViewport(1);
    await flush();

    await controller.selectDeviceWidth(null);
    await flush();
    gate.resolve();
    await flush();

    expect(mode.peekPending(1)).toBeNull();
    detach();
  });

  it("조회 중에 사용자가 전체를 누르면 pending을 되살리지 않는다", async () => {
    deviceState.mockResolvedValueOnce({ width: 390, available: { width: 1512, height: 900 } });
    const gate = deferred();
    fetchDeviceTree.mockImplementationOnce(async () => {
      await gate.promise;
      return ["doc-1"];
    });

    const controller = await import("../device-viewport-controller");
    const mode = await import("../lib/device-mode");
    mode.clearDeviceModeState();
    const detach = controller.attachDeviceViewport(1);
    await flush();

    await controller.selectDeviceWidth(null);
    await flush();
    gate.resolve();
    await flush();

    expect(mode.peekPending(1)).toBeNull();
    detach();
  });
});

describe("resize(ON→ON) 전이의 소유권", () => {
  // off-to-on만 토큰으로 지키면 resize 창에 도착한 강등이 응답의 set({width})·putPending에
  // 되덮인다 — 같은 desync가 다른 문으로 그대로 돌아온다.
  it("resize 중에 온 만료 강등을 되덮지 않는다", async () => {
    const { controller, mode, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    const gate = deferred();
    deviceSet.mockImplementationOnce(async (_tabId, width) => {
      await gate.promise;
      return { ok: true, width, available: { width: 1512, height: 900 } };
    });

    const selecting = controller.selectDeviceWidth(768);
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

  // OFF의 결과는 정의상 Full이다 — 응답의 width를 채택하면 이 창에 도착한 handoff 강등이
  // 방금 내린 null을 되살릴 여지가 생긴다. 폭 0/옛 폭이 실린 응답을 줘서 그걸 고정한다.
  it("on-to-off는 응답의 width를 채택하지 않는다", async () => {
    const { controller, mode, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    deviceSet.mockImplementationOnce(async () => ({
      ok: true,
      width: 390,
      available: { width: 1512, height: 900 },
    }));

    await controller.selectDeviceWidth(null);
    await flush();

    expect(controller.useDeviceViewportStore.getState().width).toBeNull();
    expect(mode.peekPending(1)).toBeNull();
    detach();
  });
});

describe("레코더 재무장 실패", () => {
  // 래퍼는 정상 로드됐고 레코더는 다음 inject 트리거에서 스스로 재무장한다 — 여기서 롤백하면
  // unmount + reload라 **정상 동작 중인 페이지의 스크롤·입력값을 날린다**. 경고 하나로 끝낸다.
  it("모드를 롤백하지 않고 경고 토스트만 띄운다", async () => {
    const { toast } = await import("sonner");
    const { controller, mode, detach } = await setup();
    activateRecordersInDeviceTree.mockResolvedValueOnce("startFailed");

    const selecting = controller.selectDeviceWidth(390);
    await flush();
    emit({ type: "device.frameLoaded", tabId: 1, frameId: 7 });
    await selecting;
    await flush();

    expect(toast.warning).toHaveBeenCalled();
    expect(deviceSet).not.toHaveBeenCalledWith(1, null);
    expect(controller.useDeviceViewportStore.getState().width).toBe(390);
    expect(mode.peekPending(1)).toBe(390);
    detach();
  });

  // 열거에 실패해 stop ACK에 닿지도 못한 갈래는 숨은 top이 무장된 채 남아 로그가 2벌이 되고,
  // 재주입 트리거로 스스로 낫지 않는다 — "잠시 뒤 자동으로 복구됩니다"를 말하면 안 된다.
  it("stop ACK에 닿지 못한 갈래는 자동 복구를 약속하지 않는다", async () => {
    const { toast } = await import("sonner");
    const { controller, detach } = await setup();
    activateRecordersInDeviceTree.mockResolvedValueOnce("notReached");

    const selecting = controller.selectDeviceWidth(390);
    await flush();
    emit({ type: "device.frameLoaded", tabId: 1, frameId: 7 });
    await selecting;
    await flush();

    expect(toast.warning).toHaveBeenCalledWith("issue.device.recordersStuck");
    expect(toast.warning).not.toHaveBeenCalledWith("issue.device.recordersDegraded");
    detach();
  });
});

describe("busy 거부 이어받기", () => {
  // busy 거부는 pending을 되돌려놓지만, 그 소비자는 top 커밋 하나뿐이다 — 거부를 유발한
  // 커밋은 이미 지나갔으므로 아무도 안 집는다. 전이가 끝나는 시점에 한 번 이어받아야
  // "래퍼는 사라졌는데 store width는 그대로"가 안 굳는다.
  it("전이 중에 거부된 재수립을 전이 종료 후 이어받는다", async () => {
    const { controller, mode, detach } = await setup();
    const gate = deferred();
    deviceSet.mockImplementationOnce(async (_tabId, width) => {
      await gate.promise;
      return { ok: true, width, available: { width: 1512, height: 900 } };
    });

    const selecting = controller.selectDeviceWidth(390);
    await flush();
    // 전이가 busy인 동안 top 커밋이 온다 → reestablish가 busy로 거부되고 pending만 되돌린다.
    mode.putPending(1, 390);
    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();

    deviceSet.mockClear();
    gate.resolve();
    emit({ type: "device.frameLoaded", tabId: 1, frameId: 7 });
    await selecting;
    await flush();
    await flush();

    expect(deviceSet).toHaveBeenCalledWith(1, 390);
    detach();
  });
});

describe("가용 폭 구독", () => {
  // 리스너는 top 문서에 붙는데 deviceWatch는 refcount 0→1에서만 나간다 — top이 갈리면
  // 재전송 지점이 없어 그 패널 세션 내내 availableWidth가 고정된다.
  it("top 커밋마다 구독을 다시 건다", async () => {
    const { controller, detach } = await setup();
    const release = controller.watchAvailableWidth(1);
    await flush();
    deviceWatch.mockClear();

    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();

    expect(deviceWatch).toHaveBeenCalledWith(1, true);
    release();
    detach();
  });

  // 두 호출이 겹치면 각자 ensureContentScript를 앞세워 true가 false보다 늦게 도착할 수 있다 —
  // 그러면 해제 지점이 사라져 페이지에 resize 리스너가 남는다. 보낼 값은 체인 안에서 읽는다.
  it("구독자가 없어진 뒤의 재발사는 off로 나간다", async () => {
    const { controller, detach } = await setup();
    const release = controller.watchAvailableWidth(1);
    await flush();
    deviceWatch.mockClear();

    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    release();
    await flush();

    expect(deviceWatch.mock.calls.at(-1)).toEqual([1, false]);
    detach();
  });
});

describe("전이가 노리는 폭", () => {
  // Bar 테스트는 훅을 통째로 mock해 busyWidth를 주입하므로 생산자를 고정하지 못한다.
  // 생산자에서 빠지면 spinnerKey가 FULL로 접혀 390→768에서 스피너가 `전체`에 뜬다.
  it("resize 중에는 가려는 폭이 busyWidth에 실린다", async () => {
    const { controller, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    const gate = deferred();
    deviceSet.mockImplementationOnce(async (_tabId, width) => {
      await gate.promise;
      return { ok: true, width, available: { width: 1512, height: 900 } };
    });

    const selecting = controller.selectDeviceWidth(768);
    await flush();
    expect(controller.useDeviceViewportStore.getState().busyWidth).toBe(768);

    gate.resolve();
    await selecting;
    await flush();
    expect(controller.useDeviceViewportStore.getState().busyWidth).toBeNull();
    detach();
  });

  it("전체로 되돌리는 중에는 null이다", async () => {
    const { controller, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    const gate = deferred();
    deviceSet.mockImplementationOnce(async () => {
      await gate.promise;
      return { ok: true, width: null, available: { width: 1512, height: 900 } };
    });

    const selecting = controller.selectDeviceWidth(null);
    await flush();
    const snap = controller.useDeviceViewportStore.getState();
    expect(snap.busy).toBe(true);
    expect(snap.busyWidth).toBeNull();

    gate.resolve();
    await selecting;
    detach();
  });
});

describe("재수립 전제 확인 창의 소유권", () => {
  // 게이트(busy 확인)와 래치(set busy:true) 사이에 await가 있으면 그 창에서 사용자 전이가
  // 시작돼 전이 2개가 동시에 돈다 — 사용자 조작이 무음 폐기되고, 진 쪽 finally가 이긴 쪽의
  // busy를 놓아 세 번째 전이까지 열린다.
  it("전제 확인 중에는 사용자 전이가 시작되지 않는다", async () => {
    const { controller, mode, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    const gate = deferred();
    deviceState.mockImplementationOnce(async () => {
      await gate.promise;
      return { width: null, available: { width: 1512, height: 900 } };
    });

    mode.putPending(1, 390);
    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();
    // 재수립이 전제 확인에 멈춰 있는 동안 busy가 이미 잡혀 있어야 한다.
    expect(controller.useDeviceViewportStore.getState().busy).toBe(true);

    deviceSet.mockClear();
    await controller.selectDeviceWidth(768);
    await flush();
    expect(deviceSet).not.toHaveBeenCalledWith(1, 768);

    gate.resolve();
    await flush();
    detach();
  });

  // demoteToFull(만료 handoff·미지원)이 내린 width:null을 이 창이 되살리면 안 된다.
  it("전제 확인 중에 온 강등을 되돌리지 않는다", async () => {
    const { controller, mode, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    const gate = deferred();
    deviceState.mockImplementationOnce(async () => {
      await gate.promise;
      return { width: 390, available: { width: 1512, height: 900 } };
    });

    mode.putPending(1, 390);
    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();

    emit(
      { type: "device.handoff", tabId: 1, url: "https://b.com/", expiresAt: Date.now() - 1 },
      vi.fn(),
    );
    await flush();
    gate.resolve();
    await flush();
    await flush();

    expect(controller.useDeviceViewportStore.getState().width).toBeNull();
    expect(mode.peekPending(1)).toBeNull();
    detach();
  });
});

describe("이어받기 슬롯 수명", () => {
  // **이어받기가 device.set을 또 보내면 안 되는 경우가 있다.** resize는 arm을 안 하므로 그
  // device.set이 새 top 문서에 래퍼를 만들어버리고, 이어받기가 같은 폭으로 한 번 더 보내면
  // 재로드가 안 생겨 무신호 → armTimeout → 롤백 + 페이지 재로드로 끝난다.
  // 재수립은 "래퍼가 없다"를 코드로 확인하고, 이미 그 폭이면 상태만 맞춘다.
  it("이어받기가 이미 선 래퍼에 device.set을 다시 보내지 않는다", async () => {
    const { controller, mode, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    const gate = deferred();
    deviceSet.mockImplementationOnce(async (_tabId, width) => {
      await gate.promise;
      return { ok: true, width, available: { width: 1512, height: 900 } };
    });
    // 이어받기 시점의 페이지 사실: 래퍼가 이미 768로 서 있다.
    deviceState.mockResolvedValue({ width: 768, available: { width: 1512, height: 900 } });

    const selecting = controller.selectDeviceWidth(768);
    await flush();
    mode.putPending(1, 768);
    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();

    deviceSet.mockClear();
    gate.resolve();
    await selecting;
    await flush();
    await flush();

    expect(deviceSet).not.toHaveBeenCalled();
    expect(controller.useDeviceViewportStore.getState().width).toBe(768);
    expect(mode.peekPending(1)).toBe(768);
    detach();
  });

  // 래퍼가 정말 없으면(= top이 갈렸다) 이어받기는 그대로 전이를 돈다.
  it("래퍼가 없으면 이어받기가 전이를 돈다", async () => {
    const { controller, mode, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    const gate = deferred();
    deviceSet.mockImplementationOnce(async (_tabId, width) => {
      await gate.promise;
      return { ok: true, width, available: { width: 1512, height: 900 } };
    });
    deviceState.mockResolvedValue({ width: null, available: { width: 1512, height: 900 } });

    const selecting = controller.selectDeviceWidth(768);
    await flush();
    mode.putPending(1, 768);
    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();

    deviceSet.mockClear();
    gate.resolve();
    await selecting;
    await flush();
    await flush();

    expect(deviceSet).toHaveBeenCalledWith(1, 768);
    detach();
  });

  // OFF는 device.set보다 먼저 dropPending을 한다 — 그래서 drain이 집을 수 있는 건 그 뒤
  // await 창에서 handoff가 새로 세운 pending(= **방금 끈 폭**)뿐이다. 그걸 이어받으면
  // `전체`를 누른 직후 모드가 그 폭으로 되살아나며 래퍼가 다시 선다.
  it("전체로 되돌리는 경로는 이어받지 않고 슬롯만 버린다", async () => {
    const { controller, mode, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    const gate = deferred();
    deviceSet.mockImplementationOnce(async () => {
      await gate.promise;
      return { ok: true, width: null, available: { width: 1512, height: 900 } };
    });

    const selecting = controller.selectDeviceWidth(null);
    await flush();
    // OFF 왕복 중 handoff가 옛 폭으로 pending을 세우고, 뒤이은 top 커밋이 busy로 거부된다.
    emit(
      { type: "device.handoff", tabId: 1, url: "https://b.com/", expiresAt: Date.now() + 500 },
      vi.fn(),
    );
    await flush();
    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();

    deviceSet.mockClear();
    gate.resolve();
    await selecting;
    await flush();
    await flush();

    expect(deviceSet).not.toHaveBeenCalled();
    expect(controller.useDeviceViewportStore.getState().width).toBeNull();
    expect(mode.peekPending(1)).toBeNull();
    detach();
  });

  // 남은 슬롯이 다음 성공 전이의 finally에서 뒤늦게 터지면, 이미 그 폭으로 선 래퍼에
  // device.set을 또 보내 재로드가 안 생기고 → 무신호 → armTimeout → 롤백으로
  // **방금 켠 모드가 3초 뒤 스스로 꺼지며 페이지를 새로고침한다.**
  it("detach가 이어받기 슬롯도 비운다", async () => {
    const { controller, mode, detach } = await setup();
    controller.useDeviceViewportStore.setState({ width: 390 });
    const gate = deferred();
    deviceSet.mockImplementationOnce(async (_tabId, width) => {
      await gate.promise;
      return { ok: true, width, available: { width: 1512, height: 900 } };
    });
    const selecting = controller.selectDeviceWidth(768);
    await flush();
    mode.putPending(1, 768);
    emit({ type: "frameCommitted", tabId: 1, frameId: 0 });
    await flush();
    detach();
    gate.resolve();
    await selecting;
    await flush();

    // 새 부착에서 성공 전이가 남긴 pending을 옛 슬롯이 집어가면 안 된다.
    const detach2 = controller.attachDeviceViewport(1);
    await flush();
    deviceSet.mockClear();
    const second = controller.selectDeviceWidth(390);
    await flush();
    emit({ type: "device.frameLoaded", tabId: 1, frameId: 7 });
    await second;
    await flush();
    await flush();

    expect(deviceSet).toHaveBeenCalledTimes(1);
    expect(mode.peekPending(1)).toBe(390);
    detach2();
  });
});

// `chrome.tabs.sendMessage`에는 타임아웃이 없고 content 리스너는 페이지 메인 스레드에서
// 디스패치된다 — 대상 탭이 alert()·동기 무한루프에 걸리면(BugShot이 겨냥하는 바로 그 페이지)
// 응답이 영영 안 와 전이가 `finally`에 못 닿고 세그먼트가 그 패널 세션 내내 잠긴다.
//
// **상한을 메시지에 걸면 안 된다** — 상한이 만든 `undefined`를 컨트롤러가 "차단"·"래퍼 없음"
// 으로 읽어 정상 페이지를 롤백·새로고침한다. 대신 전이가 소유권을 놓게 해, 늦게 깨어난
// 왕복이 토큰 검사에 걸려 아무것도 안 건드리게 만든다.
describe("전이 워치독", () => {
  it("응답이 영영 안 와도 busy가 풀리고 세그먼트가 다시 눌린다", async () => {
    const { controller, detach } = await setup();
    vi.useFakeTimers();
    deviceSet.mockImplementationOnce(() => new Promise(() => {}));

    void controller.selectDeviceWidth(390);
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.useDeviceViewportStore.getState().busy).toBe(true);

    await vi.advanceTimersByTimeAsync(controller.TRANSITION_WATCHDOG_MS);
    expect(controller.useDeviceViewportStore.getState().busy).toBe(false);
    vi.useRealTimers();
    detach();
  });

  // 늦게 도착한 응답이 폭을 되살리면 "래퍼는 없는데 UI만 ON"인 desync가 그대로 굳는다.
  it("워치독 이후 늦게 깨어난 왕복은 아무것도 안 건드린다", async () => {
    const { controller, mode, detach } = await setup();
    vi.useFakeTimers();
    let release: (() => void) | null = null;
    deviceSet.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () => r({ ok: true, width: 390, available: { width: 1512, height: 900 } });
        }),
    );

    void controller.selectDeviceWidth(390);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(controller.TRANSITION_WATCHDOG_MS);

    (release as (() => void) | null)?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.useDeviceViewportStore.getState().width).toBeNull();
    expect(mode.peekPending(1)).toBeNull();
    vi.useRealTimers();
    detach();
  });
});

describe("재부착 경계", () => {
  // 경고 다이얼로그가 탭 재바인딩을 넘어 살아남으면 [계속]이 새 탭 id에 옛 폭으로 돈다.
  it("attach가 이전 탭의 경고 상태를 비운다", async () => {
    const { controller, detach } = await setup();
    controller.useDeviceViewportStore.setState({ warningWidth: 390, loopWarning: true });
    detach();

    const detach2 = controller.attachDeviceViewport(2);
    await flush();
    expect(controller.useDeviceViewportStore.getState().warningWidth).toBeNull();
    expect(controller.useDeviceViewportStore.getState().loopWarning).toBe(false);
    detach2();
  });

  // 무한 재로드는 멈춰야 하지만, 사용자가 쓰던 제목·본문·캡처까지 날릴 이유는 없다.
  // 루프 경고는 "모드를 못 유지한다"는 사실 보고이지 세션 종료 사유가 아니다.
  it("루프 경고 닫기가 작성 중 draft를 파기하지 않는다", async () => {
    const { controller, detach } = await setup();
    controller.useDeviceViewportStore.setState({ loopWarning: true });

    controller.dismissDeviceLoopWarning();

    expect(controller.useDeviceViewportStore.getState().loopWarning).toBe(false);
    expect(editorState.reset).not.toHaveBeenCalled();
    detach();
  });

  // 다이얼로그 왕복 사이에 phase가 바뀌면 select()의 잠금이 이미 지나간 뒤다.
  it("경고 [계속]이 잠금·가용 폭을 다시 확인한다", async () => {
    const { controller, detach } = await setup();
    controller.useDeviceViewportStore.setState({ warningWidth: 390 });
    phase = "drafting";

    controller.confirmDeviceWarning();
    await flush();

    expect(deviceSet).not.toHaveBeenCalled();
    detach();
  });

  it("detach가 루프 카운터도 되돌린다", async () => {
    const { mode, detach } = await setup();
    mode.noteReestablish(1);
    mode.noteReestablish(1);
    detach();
    expect(mode.noteReestablish(1)).toBe("ok");
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
