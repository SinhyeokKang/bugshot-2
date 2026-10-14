import { Blob as NodeBlob } from "node:buffer";
import { act, render, cleanup, waitFor } from "@testing-library/react";
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
vi.mock("@/store/settings-ui-store", () => {
  const state = { issueSections: [], attachmentsEnabled: false, locale: "en", bodyLocale: "auto" };
  return { useSettingsUiStore: Object.assign((select: (s: typeof state) => unknown) => select(state), { getState: () => state }) };
});
vi.mock("@/store/issues-store", () => {
  const state = { issues: [{ id: "saved", captureMode: "freeform", draft: { title: "Report", sections: {} } }], patchIssue: vi.fn(), removeIssue: vi.fn() };
  return {
    useIssuesStore: Object.assign((select: (s: typeof state) => unknown) => select(state), { getState: () => state }),
    isSlackPreserved: () => false,
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
    target: { tabId: undefined, url: "https://example.com", title: "Example" },
    draft: { title: "Report", sections: {} }, attachments: [], issueFields: {},
    networkLog: null, consoleLog: null, actionLog: null, logsAttach: true,
    setTargetPlatform: vi.fn(), setIssueFields: vi.fn(), onSubmitted: vi.fn(), reset: vi.fn(),
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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });


import { useSettingsStore } from "@/store/settings-store";
import type { IssueRecord } from "@/store/issues-store";
import { DraftDetailDialog } from "../DraftDetailDialog";
const auth = { kind: "oauth" as const, grantId: "old", accessToken: "A", refreshToken: "RA", expiresAt: 9e15, viewerLogin: "u", grantedAt: 1, scope: "repo", tokenType: "bearer" };
const account = { platform: "github" as const, auth, connectedAt: 1, defaults: {} };
const issue: IssueRecord = { id: "saved", captureMode: "freeform", platform: "github", createdAt: 1, updatedAt: 1, status: "draft", title: "Report", pageUrl: "https://example.com", draft: { title: "Report", sections: {} }, snapshot: { before: false, after: false } };
it.each(["live", "saved"])("%s submission preserves replacement account prefill after a delayed response", async (mode) => {
  let raw: any = { version: 12, state: { accounts: { github: account }, lastSubmitFields: {}, titlePrefix: "" } };
  const tails = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", { userAgent: "Chrome/130", locks: { request: (_n: string, options: any, run?: () => Promise<any>) => {
    const fn = run ?? options; const next = (tails.get(_n) ?? Promise.resolve()).then(fn); tails.set(_n, next.catch(() => {})); return next;
  } } });
  vi.stubGlobal("chrome", { storage: { local: { get: async () => ({ "bugshot-settings": structuredClone(raw) }), set: async (data: any) => { if (data["bugshot-settings"]) raw = structuredClone(data["bugshot-settings"]); } }, session: { get: async () => ({}) } }, runtime: { getManifest: () => ({ version: "1.0.0" }) } });
  await useSettingsStore.persist.rehydrate();

  mocks.loadLogs.mockResolvedValue({ networkLog: null, consoleLog: null, actionLog: null });
  let finish!: (value: unknown) => void;
  mocks.sendBg.mockImplementation(async (request) => {
    if (request.type === "github.uploadFiles") return [];
    if (request.type === "github.submitIssue") return new Promise((resolve) => { finish = resolve; });
    throw Error(request.type);
  });
  if (mode === "live") render(<IssueCreateModal />);
  else render(<DraftDetailDialog issue={issue} open onOpenChange={vi.fn()} />);
  let submitting!: Promise<unknown>;
  act(() => { submitting = mocks.submit!("github", "en"); });
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => {
    useSettingsStore.getState().setAccount("github", { ...account, auth: { ...auth, grantId: "new", accessToken: "B" } });
    useSettingsStore.getState().setLastSubmitFields("github", { owner: "new-owner", repo: "new-repo" });
    await useSettingsStore.persist.flush();
    finish({ number: 1, url: "https://github.com/owner/repo/issues/1" });
    await submitting;
    await useSettingsStore.persist.flush();
  });
  expect(raw.state.lastSubmitFields.github).toEqual({ owner: "new-owner", repo: "new-repo" });
  expect(useSettingsStore.getState().lastSubmitFields.github).toEqual(raw.state.lastSubmitFields.github);
});
