import "fake-indexeddb/auto";
import { describe, expect, it, vi, beforeEach } from "vitest";

// prune은 chrome.storage에서 활성 refId를 모은다 — 스토리지는 비었다고 가정(넘긴 activeRefIds만 활성).
vi.stubGlobal("chrome", {
  storage: {
    session: { get: vi.fn(async () => ({})) },
    local: { get: vi.fn(async () => ({})) },
  },
});

import {
  saveInlineOrigin,
  getInlineOrigin,
  hasInlineOrigin,
  deleteInlineOrigins,
  getInlineOriginKeys,
  saveInlineImage,
  getInlineImage,
  clearInlineImages,
  pruneOrphanInlineImages,
} from "../blob-db";

beforeEach(async () => {
  vi.mocked(chrome.storage.session.get).mockImplementation(async () => ({}));
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({}));
  // 각 테스트 격리: origin·image store를 비운다.
  await deleteInlineOrigins(await getInlineOriginKeys());
  await clearInlineImages();
});

describe("inlineImageOrigins store", () => {
  it("saveInlineOrigin → getInlineOrigin 왕복(내용 보존)", async () => {
    await saveInlineOrigin("ref1", new Blob(["hello"], { type: "image/png" }));
    const got = await getInlineOrigin("ref1");
    expect(got).not.toBeNull();
    expect(await got!.text()).toBe("hello");
    expect(got!.type).toBe("image/png");
  });

  it("hasInlineOrigin: 저장 전 false, 저장 후 true", async () => {
    expect(await hasInlineOrigin("ref2")).toBe(false);
    await saveInlineOrigin("ref2", new Blob(["x"]));
    expect(await hasInlineOrigin("ref2")).toBe(true);
  });

  it("deleteInlineOrigins: 삭제 후 has=false, keys에서 제거", async () => {
    await saveInlineOrigin("ref3", new Blob(["x"]));
    await deleteInlineOrigins(["ref3"]);
    expect(await hasInlineOrigin("ref3")).toBe(false);
    expect(await getInlineOriginKeys()).not.toContain("ref3");
  });
});

describe("pruneOrphanInlineImages — origin 동반 정리", () => {
  it("markdown 미참조 refId의 image·origin을 함께 지우고, 참조 중 refId는 둘 다 보존", async () => {
    await saveInlineImage("keep", new Blob(["a"]));
    await saveInlineImage("drop", new Blob(["b"]));
    await saveInlineOrigin("keep", new Blob(["a-orig"]));
    await saveInlineOrigin("drop", new Blob(["b-orig"]));

    // "keep"만 활성 → "drop"은 orphan.
    await pruneOrphanInlineImages(["keep"]);

    expect(await getInlineImage("keep")).not.toBeNull();
    expect(await getInlineImage("drop")).toBeNull();
    expect(await hasInlineOrigin("keep")).toBe(true);
    expect(await hasInlineOrigin("drop")).toBe(false);
  });

  it("active ref 스캔이 실패하면 image·origin을 삭제하지 않는다", async () => {
    await saveInlineImage("keep", new Blob(["a"]));
    await saveInlineOrigin("keep", new Blob(["a-orig"]));
    vi.mocked(chrome.storage.session.get).mockRejectedValueOnce(new Error("unavailable"));

    await pruneOrphanInlineImages([]);

    expect(await getInlineImage("keep")).not.toBeNull();
    expect(await hasInlineOrigin("keep")).toBe(true);
  });
});
