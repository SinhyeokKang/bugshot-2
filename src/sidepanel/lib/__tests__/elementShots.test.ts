import { describe, expect, it } from "vitest";
import { resolveElementShots, elementShotImage, joinElementShotSelectors, elementShotManifest } from "../elementShots";
const shot = (id: string, selector = "A") => ({ id, selector, tagName: "DIV", viewport: { width: 20, height: 30 }, capturedAt: 1, raw: id, annotated: null });
describe("element shots", () => {
  it("preserves repeated selectors and logical IDs when removing items", () => {
    const shots = [shot("1"), shot("2", "B"), shot("3")];
    expect(joinElementShotSelectors(shots)).toBe("A, B, A");
    const kept = shots.filter(s => s.id !== "2");
    expect(resolveElementShots({ elementShots: kept })).toEqual(kept);
    expect(joinElementShotSelectors(kept)).toBe("A, A");
  });
  it("prefers annotations and distinguishes missing images", () => {
    expect(elementShotImage({ ...shot("a"), annotated: "edited" })).toBe("edited");
    expect(elementShotImage(shot("raw"))).toBe("raw");
    expect(elementShotImage({ ...shot("a"), raw: null })).toBeNull();
  });
  it("normalizes legacy once and never merges with the current array", () => {
    const legacy = { shotSelector: { selector: "A", tagName: "DIV" }, screenshotRaw: "raw", screenshotAnnotated: "edited", screenshotViewport: { width: 2, height: 3 }, screenshotCapturedAt: 4 };
    expect(resolveElementShots(legacy)).toEqual([{ id: "legacy", selector: "A", tagName: "DIV", raw: "raw", annotated: "edited", viewport: { width: 2, height: 3 }, capturedAt: 4 }]);
    expect(resolveElementShots({ ...legacy, elementShots: [shot("new")] })).toEqual([shot("new")]);
    expect(resolveElementShots({ screenshotRaw: "ordinary" })).toEqual([]);
    expect(resolveElementShots({ ...legacy, screenshotRaw: null, screenshotAnnotated: null })[0].raw).toBeNull();
  });
  it("keeps file IDs and immutable slots while numbering filenames by display order", () => {
    const saved = ["a", "b"].map(id => ({ ...shot(id), imageSlot: `shot-${id}-v-1` as const, hasImage: true }));
    expect(elementShotManifest(saved.slice(1))).toEqual([{ id: "capture:shot-b", shotId: "b", imageSlot: "shot-b-v-1", filename: "screenshot-1.webp", hasImage: true }]);
  });
});
