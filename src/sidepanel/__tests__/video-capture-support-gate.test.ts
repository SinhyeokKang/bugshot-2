import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 회귀 테스트: 영상 캡처 2종은 캡처 6종 중 유일하게 지원 여부 게이트가 없었다. 미지원 페이지에서
// 패널이 살아나게 되면서 렌더 게이트(mode-record 미노출)가 단일 방어선이 됐고, 판정이 아직
// false인 전이 창에 버튼이 눌리면 tabCapture 실패 → getDisplayMedia 폴백으로 실제 녹화가
// 시작되고 url: "" 인 이슈가 트래커에 등록된다(design.md 대안 E 기각 근거).
//
// gesture 지뢰: POSTMORTEM 2026-06-28 — 스트림 획득은 핸들러의 첫 await여야 getDisplayMedia
// 폴백이 산다. 그래서 게이트는 (1) await 없는 동기 사전 판정과 (2) 스트림 획득 뒤 이미 존재하는
// chrome.tabs.get 결과로 하는 재확인 두 겹이고, 첫 await 앞에는 어떤 await도 넣지 않는다.

const startTabStream = vi.fn();
const beginTabRecording = vi.fn();
const startScreenRecording = vi.fn();
vi.mock("../video-recorder", () => ({
  startTabStream: (id: number) => startTabStream(id),
  beginTabRecording: (...a: unknown[]) => beginTabRecording(...a),
  startScreenRecording: (...a: unknown[]) => startScreenRecording(...a),
  isRecording: () => false,
}));

const startRecording = vi.fn();
const cancelRecording = vi.fn();
vi.mock("@/store/editor-store", () => ({
  useEditorStore: { getState: () => ({ startRecording, cancelRecording }) },
}));

vi.mock("@/store/blob-db", () => ({
  deleteNetworkLog: vi.fn(() => Promise.resolve()),
  deleteConsoleLog: vi.fn(() => Promise.resolve()),
  deleteActionLog: vi.fn(() => Promise.resolve()),
  deleteVideoBlob: vi.fn(() => Promise.resolve()),
}));
vi.mock("../picker-control", () => ({
  activateNetworkRecorder: vi.fn(() => Promise.resolve()),
  activateConsoleRecorder: vi.fn(() => Promise.resolve()),
  activateActionRecorder: vi.fn(() => Promise.resolve()),
}));
// rest로 포워딩해야 호출 인자 개수가 보존된다 — 명시 전달하면 안 준 opts가 undefined로
// 기록돼 "플래그를 싣지 않았다"를 인자 개수로 못 센다.
type ClearActionArgs = [tabId: number, opts?: { resupplyEntryNav?: boolean }];
const clearActionRecorder = vi.fn((..._a: ClearActionArgs) => Promise.resolve());
vi.mock("../recorder-control", () => ({
  clearNetworkRecorder: vi.fn(() => Promise.resolve()),
  clearConsoleRecorder: vi.fn(() => Promise.resolve()),
  clearActionRecorder: (...a: ClearActionArgs) => clearActionRecorder(...a),
}));
vi.mock("../annotation-control", () => ({ showAnnotation: vi.fn() }));

const pickerUnavailableFire = vi.fn();
vi.mock("@/lib/app-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/app-events")>();
  return {
    ...actual,
    onPickerUnavailable: { fire: () => pickerUnavailableFire(), subscribe: () => () => {} },
  };
});

import { startVideoCapture, startScreenCapture } from "../video-capture";

let tabUrl: string | undefined;
let getDisplayMedia: ReturnType<typeof vi.fn>;
const tracks = [{ stop: vi.fn() }];

function fakeStream() {
  return { getTracks: () => tracks } as unknown as MediaStream;
}

beforeEach(() => {
  vi.clearAllMocks();
  tracks[0].stop.mockClear();
  tabUrl = "https://example.com/page";
  startTabStream.mockResolvedValue(fakeStream());
  getDisplayMedia = vi.fn(() => Promise.resolve(fakeStream()));

  vi.stubGlobal("chrome", {
    tabs: { get: vi.fn(() => Promise.resolve({ url: tabUrl, title: "t" })) },
    storage: { session: { get: vi.fn(() => Promise.resolve({})), remove: vi.fn(() => Promise.resolve()) } },
  });
  vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startVideoCapture — 지원 여부 게이트", () => {
  it("지원 페이지면 녹화를 시작한다 (회귀 방지)", async () => {
    await startVideoCapture(1);
    expect(startRecording).toHaveBeenCalledTimes(1);
    expect(beginTabRecording).toHaveBeenCalledTimes(1);
  });

  it("사전 판정이 미지원이면 스트림을 아예 요청하지 않는다", async () => {
    await startVideoCapture(1, { unsupported: true });
    expect(startTabStream).not.toHaveBeenCalled();
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(startRecording).not.toHaveBeenCalled();
    expect(pickerUnavailableFire).toHaveBeenCalledTimes(1);
  });

  // 전이 창: 패널 판정은 아직 false인데 실제 탭은 이미 미지원이다.
  it("사전 판정이 통과해도 tab.url이 미지원이면 녹화를 시작하지 않고 스트림을 정리한다", async () => {
    tabUrl = "chrome://settings";
    await startVideoCapture(1);
    expect(startRecording).not.toHaveBeenCalled();
    expect(beginTabRecording).not.toHaveBeenCalled();
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(pickerUnavailableFire).toHaveBeenCalledTimes(1);
  });

  it("tab.url이 비어도(판독 불가) 녹화를 시작하지 않는다 — url 없는 이슈 방지", async () => {
    tabUrl = undefined;
    await startVideoCapture(1);
    expect(startRecording).not.toHaveBeenCalled();
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it("웹스토어에서도 차단한다 (스킴은 https지만 정책 차단 호스트)", async () => {
    tabUrl = "https://chromewebstore.google.com/detail/bugshot/abc";
    await startVideoCapture(1);
    expect(startRecording).not.toHaveBeenCalled();
  });
});

describe("startScreenCapture — 지원 여부 게이트", () => {
  it("지원 페이지면 녹화를 시작한다 (회귀 방지)", async () => {
    await startScreenCapture(1);
    expect(startRecording).toHaveBeenCalledTimes(1);
    expect(startScreenRecording).toHaveBeenCalledTimes(1);
  });

  it("사전 판정이 미지원이면 getDisplayMedia 피커를 띄우지 않는다", async () => {
    await startScreenCapture(1, { unsupported: true });
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(startRecording).not.toHaveBeenCalled();
    expect(pickerUnavailableFire).toHaveBeenCalledTimes(1);
  });

  it("사전 판정이 통과해도 tab.url이 미지원이면 녹화를 시작하지 않고 스트림을 정리한다", async () => {
    tabUrl = "chrome://settings";
    await startScreenCapture(1);
    expect(startRecording).not.toHaveBeenCalled();
    expect(startScreenRecording).not.toHaveBeenCalled();
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(pickerUnavailableFire).toHaveBeenCalledTimes(1);
  });
});

// 탭 녹화가 tabCapture 실패로 화면 녹화로 폴백하는 경로에서도 게이트가 유지돼야 한다 —
// 이 폴백이 정확히 미지원 페이지에서 발화하는 경로다(<all_urls>는 tabCapture를 커버하지 못함).
describe("탭 → 화면 폴백 경로", () => {
  it("지원 페이지에서 tabCapture가 막히면 화면 녹화로 폴백한다 (회귀 방지)", async () => {
    startTabStream.mockRejectedValue(new Error("Extension has not been invoked for the current page"));
    await startVideoCapture(1);
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(startScreenRecording).toHaveBeenCalledTimes(1);
  });

  it("미지원 페이지면 폴백조차 녹화를 시작하지 않는다", async () => {
    tabUrl = "chrome://settings";
    startTabStream.mockRejectedValue(new Error("Chrome pages cannot be captured"));
    await startVideoCapture(1);
    expect(startRecording).not.toHaveBeenCalled();
    expect(startScreenRecording).not.toHaveBeenCalled();
  });
});

// prepareRecorders는 activate → clear 순서라 clear 시점에 이미 armed다. 그 뒤 녹화 중 탭 전환
// 복귀가 visibilitychange → inject로 **같은 문서를 재arm**하므로, 이 clear가 진입 항목 래치를
// 내리면 보충이 한 번 더 돌아 "일어나지도 않은 새로고침"을 녹화 중간 시각으로 단언하는 유령
// 항목이 생긴다. MAIN 핸들러 본문은 유닛 불가라 발신자 쪽 의도를 여기서 고정한다.
describe("prepareRecorders — 진입 항목 보충 의도를 주지 않는다", () => {
  it("녹화 준비 clear는 resupplyEntryNav를 싣지 않는다 (유령 항목 회귀 방지)", async () => {
    await startVideoCapture(1);

    expect(clearActionRecorder).toHaveBeenCalledWith(1);
    for (const call of clearActionRecorder.mock.calls) {
      expect(call[1]).toBeUndefined();
    }
  });
});
