import { Blob as NodeBlob } from "node:buffer";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EditorState } from "@/store/editor-store";

const mocks = vi.hoisted(() => ({
  state: {} as EditorState,
  submit: undefined as ((platform: "github", locale: "en") => Promise<unknown>) | undefined,
  loadLogs: vi.fn(), sendBg: vi.fn(),
}));
vi.hoisted(() => {
  Object.assign(globalThis, { chrome: { storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}) } }, runtime: { getManifest: () => ({ version: "1.0.0" }) } } });
});
vi.mock("@/store/editor-store", () => ({
  useEditorStore: Object.assign((select: (s: EditorState) => unknown) => select(mocks.state), { getState: () => mocks.state }),
  whenAttachmentBlobsReady: async () => {},
}));
vi.mock("@/store/settings-store", async (original) => {
  const actual = await original<typeof import("@/store/settings-store")>();
  const state = { accounts: { github: { auth: {}, defaults: {} } }, lastSubmitFields: {}, setLastSubmitFields: vi.fn(), setLastSubmittedPlatform: vi.fn() };
  return { ...actual, useSettingsStore: Object.assign((select: (s: typeof state) => unknown) => select(state), { getState: () => state }) };
});
vi.mock("@/store/settings-ui-store", () => {
  const state = { issueSections: [], attachmentsEnabled: false, locale: "en", bodyLocale: "auto" };
  return { useSettingsUiStore: Object.assign((select: (s: typeof state) => unknown) => select(state), { getState: () => state }) };
});
vi.mock("@/store/issues-store", () => {
  const state = { issues: [{ id: "saved", captureMode: "freeform", draft: { title: "Report", sections: {} } }], patchIssue: vi.fn() };
  return {
    useIssuesStore: Object.assign((select: (s: typeof state) => unknown) => select(state), { getState: () => state }),
    withIssueSubmitGuard: async (_id: string, run: () => Promise<unknown>) => run(),
  };
});
vi.mock("@/store/blob-db", () => ({
  pruneOrphanInlineImages: async () => {}, dataUrlToBlob: () => new Blob(),
  blobToDataUrl: async (blob: Blob) => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`,
}));
vi.mock("@/sidepanel/lib/submissionRecovery", () => ({
  loadSubmissionLogs: mocks.loadLogs,
  expectedSubmissionSources: () => [], assertSubmissionSources: async () => {},
  prepareSubmissionRecovery: async () => ({ files: [] }),
  runSubmissionRecovery: async (_prepared: unknown, run: (progress: unknown) => Promise<unknown>) => run({}),
  withSubmissionProgress: (args: unknown) => args,
}));
vi.mock("@/lib/bg-client", () => ({ sendBg: mocks.sendBg }));
vi.mock("@/sidepanel/hooks/usePlatformFields", () => ({ usePlatformFields: () => ({ ghFields: { owner: "owner", repo: "repo" } }) }));
vi.mock("@/sidepanel/tabs/SubmitFieldsDialog", () => ({ SubmitFieldsDialog: (props: { onSubmit: typeof mocks.submit }) => { mocks.submit = props.onSubmit; return null; } }));
import { IssueCreateModal } from "../IssueCreateModal";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {
    captureMode: "freeform", phase: "previewing", currentIssueId: "saved",
    target: { tabId: 7, url: "https://example.com", title: "Example" },
    draft: { title: "Report", sections: {} }, attachments: [], issueFields: {},
    networkLog: null, consoleLog: null, actionLog: null, logsAttach: true,
    setTargetPlatform: vi.fn(), setIssueFields: vi.fn(), onSubmitted: vi.fn(),
  } as unknown as EditorState;
  vi.stubGlobal("Blob", NodeBlob);
  mocks.sendBg.mockImplementation(async (request) => {
    if (request.type === "github.uploadFiles") return request.files.map((file: { fileId: string; filename: string }) => ({
      fileId: file.fileId, filename: file.filename, ok: true, href: `https://example.com/${file.filename}`,
    }));
    if (request.type === "github.submitIssue") return { number: 1, url: "https://github.com/owner/repo/issues/1" };
    throw new Error(`Unexpected request: ${request.type}`);
  });
});

afterEach(() => vi.unstubAllGlobals());

it.each([
  { captureMode: "screenshot", logsAttach: true },
  { captureMode: "video", logsAttach: true },
  { captureMode: "freeform", logsAttach: true },
  { captureMode: "screenshot", logsAttach: false },
  { captureMode: "video", logsAttach: false },
  { captureMode: "freeform", logsAttach: false },
  { captureMode: "element", logsAttach: true },
] as const)("submits recovered $captureMode logs with logsAttach=$logsAttach", async ({ captureMode, logsAttach }) => {
  mocks.state = { ...mocks.state, captureMode, logsAttach,
    selection: { selector: "button", tagName: "button", hasParent: true, hasChild: false, classList: [], specifiedStyles: {}, computedStyles: {}, propSources: {}, text: "", viewport: { width: 800, height: 600 }, capturedAt: 1 },
    styleEdits: { classList: [], inlineStyle: {}, text: "" }, bufferedElements: [], tokens: [],
  };
  const common = { id: "saved", startedAt: 0, endedAt: 1, captured: 1, totalSeen: 1 };
  const logs = {
    consoleLog: { ...common, entries: [{ id: "c", level: "error", args: "recovered", timestamp: 0, pageUrl: "https://example.com" }] },
    networkLog: { ...common, warnings: [], requests: [{ id: "n", url: "https://example.com/recovered", method: "GET", status: 500, statusText: "Failed", startTime: 0, durationMs: 1, requestHeaders: {}, responseHeaders: {}, pageUrl: "https://example.com", requestBodySize: 0, responseBodySize: 0, contentType: "text/plain", phase: "complete" }] },
    actionLog: { ...common, entries: [] },
  };
  mocks.loadLogs.mockImplementation(async () => {
    mocks.state = { ...mocks.state, currentIssueId: "new-session", consoleLog: null, networkLog: null, actionLog: null };
    return logs;
  });
  render(<IssueCreateModal />);
  await act(async () => { await mocks.submit!("github", "en"); });
  const uploadCall = mocks.sendBg.mock.calls.find(([request]) => request.type === "github.uploadFiles");
  expect(uploadCall, "resumed logs must be uploaded").toBeDefined();
  const upload = uploadCall![0];
  const submitted = mocks.sendBg.mock.calls.find(([request]) => request.type === "github.submitIssue")![0].payload;
  if (!logsAttach || captureMode === "element") {
    expect(upload.files.some((file: { filename: string }) => file.filename === "logs.html")).toBe(false);
    expect(submitted.body).not.toContain("Console: 1 logs");
    expect(submitted.body).not.toContain("Network: 1 requests");
    expect(submitted.body).not.toContain("User actions: 1");
    return;
  }
  const htmlFile = upload.files.find((file: { filename: string }) => file.filename === "logs.html");
  expect(htmlFile).toBeDefined();
  const html = Buffer.from(htmlFile.dataUrl.split(",")[1], "base64").toString();
  const encoded = html.match(/<script id="__BUGSHOT_DATA__" type="application\/gzip-base64">([\s\S]*?)<\/script>/)![1];
  const { base64ToGunzip } = await import("@/lib/gzip-base64");
  const payload = JSON.parse(await base64ToGunzip(encoded));
  expect(payload.consoleLog).toEqual(logs.consoleLog);
  expect(payload.networkLog).toEqual(logs.networkLog);
  expect(payload.actionLog).toEqual(logs.actionLog);
  expect(submitted.body).toContain("Console: 1 logs (1 errors, 0 warnings)");
  expect(submitted.body).toContain("Network: 1 requests (1 errors)");
  expect(submitted.body).toContain("User actions: 1");
  expect(mocks.state.consoleLog).toBeNull();
  expect(mocks.state.currentIssueId).toBe("new-session");
});
