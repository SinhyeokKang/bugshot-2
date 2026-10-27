import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/i18n/bg-init", () => ({ initBgLocale: vi.fn() }));
vi.mock("@/lib/pending-log-prune", () => ({ pruneOrphanPendingLogsOncePerSession: vi.fn() }));
vi.mock("../tab-bindings", () => ({ setupTabBindings: vi.fn() }));
vi.mock("../messages", () => ({ handleMessage: vi.fn() }));
vi.mock("../analytics", () => ({ captureEvent: vi.fn() }));
vi.mock("../oauth", () => ({ OAuthError: class extends Error {}, serializeOAuthError: vi.fn() }));

let beforeNavigate: (details: chrome.webNavigation.WebNavigationParentedCallbackDetails) => void;
let committed: (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => void;
const sendMessage = vi.fn().mockResolvedValue(undefined);
const get = vi.fn().mockResolvedValue({});

beforeEach(async () => {
  vi.resetModules();
  sendMessage.mockClear();
  get.mockReset().mockResolvedValue({});
  const event = () => ({ addListener: vi.fn() });
  vi.stubGlobal("chrome", {
    runtime: { onInstalled: event(), onStartup: event(), onConnect: event(), onMessage: event(), sendMessage },
    contextMenus: { onClicked: event() },
    tabs: { get: vi.fn().mockResolvedValue({ url: "https://example.com/old" }), sendMessage: vi.fn().mockResolvedValue(undefined) },
    storage: { session: { get } },
    webNavigation: {
      onBeforeNavigate: { addListener: (fn: typeof beforeNavigate) => { beforeNavigate = fn; } },
      onCommitted: { addListener: (fn: typeof committed) => { committed = fn; } },
    },
  });
  await import("../index");
});

afterEach(() => vi.unstubAllGlobals());

async function navigate(transitionType: string, url = "https://example.com/old", frameId = 0) {
  const details: chrome.webNavigation.WebNavigationParentedCallbackDetails = {
    tabId: 7, frameId, parentFrameId: -1, url, timeStamp: 1,
    frameType: "outermost_frame", documentLifecycle: "active", processId: 1,
  };
  beforeNavigate(details);
  committed({ ...details, transitionType, transitionQualifiers: [] });
  // Drain the actual navigation handlers' promise chains, without wall-clock waits.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

it("clears an idle log-only panel on reload without a persisted editor snapshot", async () => {
  await navigate("reload");
  expect(sendMessage).toHaveBeenCalledWith({ type: "logClear", tabId: 7 });
});

it("clears cross-origin logs without a persisted editor snapshot", async () => {
  await navigate("link", "https://other.example/new");
  expect(sendMessage).toHaveBeenCalledWith({ type: "logClear", tabId: 7 });
});

it("preserves same-origin navigation logs", async () => {
  await navigate("link", "https://example.com/new");
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "frameCommitted", tabId: 7 }));
  expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "logClear" }));
});

it("does not clear top-page logs for an iframe reload", async () => {
  get.mockResolvedValue({ "editor:7": { phase: "idle" } });
  await navigate("reload", "https://example.com/frame", 2);
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "frameCommitted", frameId: 2 }));
  expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "logClear" }));
});
