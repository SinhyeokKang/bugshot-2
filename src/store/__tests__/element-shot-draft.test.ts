import "fake-indexeddb/auto";
import { IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockWebLocks } from "@/test/web-locks";
import { saveElementShotDraft, useIssuesStore, type IssueRecord } from "../issues-store";
import { getImageBlob } from "../blob-db";
const shot = (id: string, text = id) => ({ id, selector: "A", tagName: "DIV", viewport: { width: 1, height: 2 }, capturedAt: 1, raw: `data:image/webp;base64,${btoa(text)}`, annotated: null });
const record: IssueRecord = { id: "shots", status: "draft", title: "title", createdAt: 1, updatedAt: 1, pageUrl: "https://example.com", platform: "github", captureMode: "screenshot", draft: { title: "title", sections: {} }, snapshot: { before: true, after: false } };
let local: Record<string, unknown>;
beforeEach(() => {
  local = {};
  vi.stubGlobal("chrome", { storage: { local: { get: vi.fn(async () => local), set: vi.fn(async values => { Object.assign(local, values); }) }, session: { get: vi.fn(async () => ({})) } } });
  mockWebLocks();
  useIssuesStore.setState({ issues: [] });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("uses immutable versions and reuses unchanged bytes", async () => {
  await saveElementShotDraft(record, [shot("a"), shot("b")]);
  const before = useIssuesStore.getState().issues[0];
  await saveElementShotDraft(record, [shot("a", "edited"), shot("b")]);
  const after = useIssuesStore.getState().issues[0];
  expect(after.elementShots?.[0].imageSlot).not.toBe(before.elementShots?.[0].imageSlot);
  expect(after.elementShots?.[1].imageSlot).toBe(before.elementShots?.[1].imageSlot);
  expect(after.elementShotsRevision).not.toBe(before.elementShotsRevision);
  expect(await (await getImageBlob("shots", after.elementShots![0].imageSlot))?.text()).toBe("edited");
});
it("leaves previous metadata and bytes intact if metadata commit fails", async () => {
  await saveElementShotDraft(record, [shot("a"), shot("b")]);
  const previous = useIssuesStore.getState().issues[0];
  vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error("quota"));
  await expect(saveElementShotDraft(record, [shot("a", "changed"), shot("b")])).rejects.toThrow("quota");
  expect(useIssuesStore.getState().issues[0]).toBe(previous);
  expect(await (await getImageBlob("shots", previous.elementShots![0].imageSlot))?.text()).toBe("a");
});
it("rejects missing images before changing the stored record", async () => {
  await expect(saveElementShotDraft(record, [{ ...shot("missing"), raw: null }])).rejects.toThrow();
  expect(useIssuesStore.getState().issues).toHaveLength(0);
});
it("does not publish new metadata before its durable write resolves", async () => {
  await saveElementShotDraft(record, [shot("a")]);
  const previous = useIssuesStore.getState().issues[0];
  let release!: () => void;
  vi.mocked(chrome.storage.local.set).mockImplementationOnce(async values => {
    await new Promise<void>(resolve => { release = resolve; });
    Object.assign(local, values);
  });
  const saving = saveElementShotDraft(record, [shot("a", "new")]);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(useIssuesStore.getState().issues[0]).toBe(previous);
  release();
  await saving;
  expect(useIssuesStore.getState().issues[0].elementShotsRevision).not.toBe(previous.elementShotsRevision);
});
it("restores durable metadata when the editor is replaced during its commit", async () => {
  await saveElementShotDraft(record, [shot("a")]);
  const previous = useIssuesStore.getState().issues[0];
  let current = true;
  vi.mocked(chrome.storage.local.set).mockImplementationOnce(async values => { Object.assign(local, values); current = false; });
  await expect(saveElementShotDraft(record, [shot("a", "stale")], () => current)).rejects.toThrow("Stale");
  expect(useIssuesStore.getState().issues[0]).toBe(previous);
  expect(JSON.parse(String(local["bugshot-issues"])).state.issues[0].elementShotsRevision).toBe(previous.elementShotsRevision);
});
it("retains an unrelated draft edited during a media metadata commit", async () => {
  await saveElementShotDraft(record, [shot("a")]);
  let release!: () => void;
  vi.mocked(chrome.storage.local.set).mockImplementationOnce(async values => {
    await new Promise<void>(resolve => { release = resolve; });
    Object.assign(local, values);
  });
  const saving = saveElementShotDraft(record, [shot("a", "new")]);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  useIssuesStore.getState().saveDraft({ ...record, id: "other", title: "keep other" });
  release();
  await saving;
  await vi.waitFor(() => expect(JSON.parse(String(local["bugshot-issues"])).state.issues).toHaveLength(2));
  const stored = JSON.parse(String(local["bugshot-issues"])).state.issues;
  expect(stored.find((r: IssueRecord) => r.id === "other").title).toBe("keep other");
  expect(stored.find((r: IssueRecord) => r.id === "shots").elementShotsRevision).toBe(useIssuesStore.getState().issues.find(r => r.id === "shots")?.elementShotsRevision);
});

it("preserves all old bytes if a later image write fails", async () => {
  await saveElementShotDraft(record, [shot("a"), shot("b")]);
  const previous = useIssuesStore.getState().issues[0];
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
    if (String(key).startsWith("shots:shot-b-")) throw new Error("second image failed");
    return put.call(this, value, key);
  });
  await expect(saveElementShotDraft(record, [shot("a", "changed a"), shot("b", "changed b")])).rejects.toThrow("second image");
  expect(useIssuesStore.getState().issues[0]).toBe(previous);
  expect(await (await getImageBlob("shots", previous.elementShots![0].imageSlot))?.text()).toBe("a");
  expect(await (await getImageBlob("shots", previous.elementShots![1].imageSlot))?.text()).toBe("b");
});
it("prepares ancillary blobs inside the issue operation lock", async () => {
  const prepare = vi.fn(async () => {
    await expect(saveElementShotDraft(record, [shot("b")])).rejects.toThrow();
  });
  await saveElementShotDraft(record, [shot("a")], () => true, prepare);
  expect(prepare).toHaveBeenCalledTimes(1);
});
