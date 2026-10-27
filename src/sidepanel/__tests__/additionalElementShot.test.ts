import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startAdditionalElementShot } from "../picker-control";
const { state, start, cancel, unavailable } = vi.hoisted(() => {
  const start = vi.fn();
  const cancel = vi.fn();
  return { state: { phase: "drafting", target: { tabId: 7, url: "https://example.com/a" }, elementShotPick: null as { requestId: string } | null, startAdditionalElementShot: start, cancelElementShotPick: cancel }, start, cancel, unavailable: vi.fn() };
});
vi.mock("@/store/editor-store", () => ({ useEditorStore: { getState: () => state }, settleOrphanElementPhase: vi.fn() }));
vi.mock("@/store/settings-ui-store", () => ({ useSettingsUiStore: { getState: () => ({ theme: "light" }) } }));
vi.mock("@/lib/app-events", () => ({ onPickerUnavailable: { fire: unavailable }, onPickerPermissionExpired: { fire: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  state.phase = "drafting";
  state.elementShotPick = null;
  start.mockImplementation(async () => { state.phase = "picking"; state.elementShotPick = { requestId: "request" }; return "request"; });
  cancel.mockImplementation(() => { state.phase = "drafting"; state.elementShotPick = null; });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("chrome", { tabs: { get: vi.fn(async () => ({ id: 7, url: "https://example.com/a" })), sendMessage: vi.fn(async () => ({})) }, runtime: { getManifest: () => ({ content_scripts: [{ js: ["picker.js"] }] }) }, scripting: { executeScript: vi.fn(async () => {}) } });
});
afterEach(() => vi.unstubAllGlobals());
it("waits for durable append state before sending any picker messages", async () => {
  let release!: () => void;
  start.mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { release = resolve; });
    state.phase = "picking"; state.elementShotPick = { requestId: "request" }; return "request";
  });
  const pending = startAdditionalElementShot(7);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  release();
  expect(await pending).toBe("started");
});
it("returns to drafting if reinjection fails, without replacing report state", async () => {
  vi.mocked(chrome.tabs.sendMessage).mockRejectedValue(new Error("no content script"));
  vi.mocked(chrome.scripting.executeScript).mockRejectedValue(new Error("permission denied"));
  expect(await startAdditionalElementShot(7)).toBe("failed");
  expect(cancel).toHaveBeenCalledWith("request");
  expect(state.phase).toBe("drafting");
  expect(unavailable).toHaveBeenCalledTimes(1);
});
it("does not inject for a changed page or failed durable start", async () => {
  vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ url: "https://example.com/b" } as chrome.tabs.Tab);
  expect(await startAdditionalElementShot(7)).toBe("page-changed");
  expect(start).not.toHaveBeenCalled();
  start.mockResolvedValueOnce(null);
  expect(await startAdditionalElementShot(7)).toBe("failed");
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
});
