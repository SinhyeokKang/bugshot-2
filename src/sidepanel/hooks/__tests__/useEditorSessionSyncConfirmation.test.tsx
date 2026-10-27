import "fake-indexeddb/auto";
import { Blob } from "node:buffer";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockWebLocks } from "@/test/web-locks";
import { useEditorStore, type EditorSnapshot } from "@/store/editor-store";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { getImageBlob } from "@/store/blob-db";
import { onSessionSaveExhausted } from "@/lib/app-events";
import { snapshotFromState, useEditorSessionSync } from "../useEditorSessionSync";

vi.mock("@/sidepanel/picker-control", () => ({ cancelAreaSelect: vi.fn(), clearPicker: vi.fn(), rebindStylingSession: vi.fn() }));

let session: Record<string, EditorSnapshot>;
let local: Record<string, unknown>;
beforeEach(() => {
  session = {};
  local = {};
  vi.stubGlobal("Blob", Blob);
  const listeners = { addListener: vi.fn(), removeListener: vi.fn() };
  vi.stubGlobal("chrome", {
    storage: {
      session: { get: vi.fn(async () => structuredClone(session)), set: vi.fn(async values => { Object.assign(session, structuredClone(values)); }) },
      local: { get: vi.fn(async () => structuredClone(local)), set: vi.fn(async values => { Object.assign(local, structuredClone(values)); }) },
      onChanged: listeners,
    },
    tabs: { onUpdated: listeners },
  });
  mockWebLocks();
  useIssuesStore.setState({ issues: [] });
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useEditorStore.setState({
    phase: "drafting", captureMode: "screenshot", targetPlatform: "github",
    target: { tabId: 7, url: "https://example.com", title: "Example" },
    draft: { title: "Keep report", sections: { description: "Keep body" } },
    elementShots: ["a", "b"].map(id => ({ id, selector: id, tagName: "DIV", viewport: { width: 20, height: 30 }, capturedAt: 1,
      raw: `data:image/webp;base64,${btoa(id)}`, annotated: null })),
  });
  session["editor:7"] = structuredClone(snapshotFromState());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, true])("keeps durable identity and images after final session failure (persistent=%s)", async persistent => {
  const mounted = renderHook(() => useEditorSessionSync(7));
  await waitFor(() => expect(mounted.result.current).toBe(true));
  const failure = vi.spyOn(onSessionSaveExhausted, "fire");
  const phases: string[] = [];
  const unsubscribe = useEditorStore.subscribe(state => phases.push(state.phase));
  let rejected = false;
  const storedIssues = (): IssueRecord[] => JSON.parse(String(local["bugshot-issues"])).state.issues;
  vi.mocked(chrome.storage.session.set).mockImplementation(async values => {
    const next = (values as Record<string, EditorSnapshot>)["editor:7"];
    if (next?.phase === "previewing" || (persistent && rejected)) {
      expect(storedIssues()).toHaveLength(1);
      rejected = true;
      throw new Error("session quota");
    }
    Object.assign(session, structuredClone(values));
  });
  let confirmed: boolean | undefined;
  await act(async () => { confirmed = await useEditorStore.getState().confirmElementShotDraft(); });
  unsubscribe();
  expect(rejected).toBe(true);
  expect(confirmed).toBe(false);
  expect(phases).not.toContain("previewing");
  expect(failure).toHaveBeenCalledTimes(1);
  expect(useEditorStore.getState().phase).toBe("drafting");
  const saved = storedIssues()[0];
  expect(session["editor:7"]).toMatchObject({ phase: "drafting", currentIssueId: saved.id });
  expect(session["editor:7"].elementShots).toHaveLength(2);
  for (const item of saved.elementShots!) expect(await (await getImageBlob(saved.id, item.imageSlot))?.text()).toBe(item.id);
  act(() => window.dispatchEvent(new Event("pagehide")));
  mounted.unmount();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  const reopened = renderHook(() => useEditorSessionSync(7));
  await waitFor(() => expect(reopened.result.current).toBe(true));
  expect(useEditorStore.getState().currentIssueId).toBe(saved.id);
  if (persistent) {
    const writes = vi.mocked(chrome.storage.session.set).mock.calls.length;
    await act(async () => { expect(await useEditorStore.getState().confirmElementShotDraft()).toBe(false); });
    expect(vi.mocked(chrome.storage.session.set).mock.calls.length - writes).toBeLessThanOrEqual(2);
    expect(storedIssues().map(issue => issue.id)).toEqual([saved.id]);
    expect(useEditorStore.getState().phase).toBe("drafting");
  }
  vi.mocked(chrome.storage.session.set).mockImplementation(async values => { Object.assign(session, structuredClone(values)); });
  await act(async () => { expect(await useEditorStore.getState().confirmElementShotDraft()).toBe(true); });
  expect(storedIssues().map(issue => issue.id)).toEqual([saved.id]);
  expect(storedIssues()[0].elementShots).toEqual(saved.elementShots);
  expect(session["editor:7"]).toMatchObject({ phase: "previewing", currentIssueId: saved.id });
  for (const item of saved.elementShots!) expect(await (await getImageBlob(saved.id, item.imageSlot))?.text()).toBe(item.id);
});
