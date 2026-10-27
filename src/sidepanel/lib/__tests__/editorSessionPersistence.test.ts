import { afterEach, expect, it, vi } from "vitest";
import { enqueueEditorSessionWrite, saveEditorSession } from "../editorSessionPersistence";
import type { EditorSnapshot } from "@/store/editor-store";
afterEach(() => vi.unstubAllGlobals());
it("serializes explicit and deferred writes and reads deferred state at execution time", async () => {
  let release!: () => void;
  const order: string[] = [];
  const first = enqueueEditorSessionWrite("a", async () => { await new Promise<void>(r => { release = r; }); order.push("candidate"); });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  let latest = "old";
  vi.stubGlobal("chrome", { storage: { session: { set: vi.fn(async (x) => { order.push(x.a.phase); }) } } });
  const second = saveEditorSession("a", () => ({ phase: latest } as EditorSnapshot));
  latest = "new";
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(["candidate", "new"]);
});
it("never replaces failed element captures with image-free lite snapshots", async () => {
  const set = vi.fn().mockRejectedValue(new Error("quota"));
  vi.stubGlobal("chrome", { storage: { session: { set } } });
  await expect(saveEditorSession("b", () => ({ captureMode: "screenshot", shotSelector: { selector: "A" } } as EditorSnapshot))).rejects.toThrow("quota");
  expect(set).toHaveBeenCalledTimes(1);
});
