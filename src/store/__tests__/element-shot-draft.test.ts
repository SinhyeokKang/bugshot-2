import "fake-indexeddb/auto";
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
afterEach(() => vi.unstubAllGlobals());
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
