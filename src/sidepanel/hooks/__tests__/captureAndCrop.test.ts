import { beforeEach, describe, expect, it, vi } from "vitest";

const cropImage = vi.fn(async (..._args: unknown[]) => "data:image/png;base64,cropped");
const getTopViewport =
  vi.fn<(tabId: number) => Promise<{ width: number; height: number } | null>>(async () => null);
const onAreaCaptured = vi.fn();

vi.mock("@/sidepanel/capture", () => ({
  cropImage: (...args: unknown[]) => cropImage(...(args as [])),
  captureElementSnapshot: vi.fn(),
}));
vi.mock("@/types/messages", async () => {
  const actual = await vi.importActual<typeof import("@/types/messages")>("@/types/messages");
  return { ...actual, sendBg: vi.fn(async () => "data:image/png;base64,full") };
});
vi.mock("@/sidepanel/picker-control", async () => {
  const actual =
    await vi.importActual<typeof import("@/sidepanel/picker-control")>("@/sidepanel/picker-control");
  return { ...actual, getTopViewport: (tabId: number) => getTopViewport(tabId) };
});

const storeState = {
  phase: "capturing",
  target: { tabId: 1, url: "https://a.com/", title: "" },
  onAreaCaptured,
  reset: vi.fn(),
};

vi.mock("@/store/editor-store", () => ({
  useEditorStore: Object.assign(() => storeState, {
    getState: () => storeState,
    setState: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  }),
}));

const RECT = { x: 0, y: 0, width: 390, height: 768 };
const CROP_VIEWPORT = { width: 1512, height: 768 };

beforeEach(() => {
  vi.clearAllMocks();
  cropImage.mockResolvedValue("data:image/png;base64,cropped");
  storeState.phase = "capturing";
});

// 크롭은 top 기준이어야 정확하고(img.naturalWidth / viewport.width) 메타는 디바이스 폭이어야
// 한다. 지금은 picker.areaSelected의 msg.viewport 하나가 둘 다를 맡고 있어 분리가 필요하다.
describe("captureAndCrop — 크롭 배율 viewport와 메타 viewport 분리", () => {
  it("cropImage는 cropViewport(top)를 받는다", async () => {
    getTopViewport.mockResolvedValue({ width: 390, height: 768 });
    const { captureAndCrop } = await import("../usePickerMessages");
    await captureAndCrop(RECT, CROP_VIEWPORT);
    expect(cropImage).toHaveBeenCalledWith(expect.any(String), RECT, CROP_VIEWPORT);
  });

  it("onAreaCaptured에 넘어가는 값은 metaViewport(디바이스 폭)다", async () => {
    getTopViewport.mockResolvedValue({ width: 390, height: 768 });
    const { captureAndCrop } = await import("../usePickerMessages");
    await captureAndCrop(RECT, CROP_VIEWPORT);
    expect(onAreaCaptured).toHaveBeenCalledWith(expect.any(String), {
      width: 390,
      height: 768,
    });
  });

  it("getTopViewport가 null이면 cropViewport로 폴백한다", async () => {
    getTopViewport.mockResolvedValue(null);
    const { captureAndCrop } = await import("../usePickerMessages");
    await captureAndCrop(RECT, CROP_VIEWPORT);
    expect(onAreaCaptured).toHaveBeenCalledWith(expect.any(String), CROP_VIEWPORT);
  });

  it("모드 OFF에서는 두 값이 같아 결과가 이전과 동일하다", async () => {
    getTopViewport.mockResolvedValue(CROP_VIEWPORT);
    const { captureAndCrop } = await import("../usePickerMessages");
    await captureAndCrop(RECT, CROP_VIEWPORT);
    expect(cropImage).toHaveBeenCalledWith(expect.any(String), RECT, CROP_VIEWPORT);
    expect(onAreaCaptured).toHaveBeenCalledWith(expect.any(String), CROP_VIEWPORT);
  });

  it("캡처 도중 세션이 바뀌면 결과를 버린다 (기존 규약 유지)", async () => {
    getTopViewport.mockImplementation(async () => {
      storeState.phase = "idle";
      return { width: 390, height: 768 };
    });
    const { captureAndCrop } = await import("../usePickerMessages");
    await captureAndCrop(RECT, CROP_VIEWPORT);
    expect(onAreaCaptured).not.toHaveBeenCalled();
  });
});
