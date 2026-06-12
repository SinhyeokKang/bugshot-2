import { describe, it, expect } from "vitest";
import { adfMediaNode, adfMediaSingle } from "../adf-media";

describe("adfMediaNode", () => {
  it("builds a file media node without dims", () => {
    expect(adfMediaNode({ kind: "media", mediaId: "abc" })).toEqual({
      type: "media",
      attrs: { type: "file", id: "abc", collection: "" },
    });
  });

  it("builds an external media node without dims", () => {
    expect(adfMediaNode({ kind: "external", url: "https://x/y.png" })).toEqual({
      type: "media",
      attrs: { type: "external", url: "https://x/y.png" },
    });
  });

  it("injects width/height when both provided", () => {
    expect(
      adfMediaNode({ kind: "media", mediaId: "abc" }, { width: 400, height: 900 }),
    ).toEqual({
      type: "media",
      attrs: { type: "file", id: "abc", collection: "", width: 400, height: 900 },
    });
  });

  it("omits dims when only one side is present", () => {
    expect(adfMediaNode({ kind: "media", mediaId: "abc" }, { width: 400 })).toEqual({
      type: "media",
      attrs: { type: "file", id: "abc", collection: "" },
    });
    expect(adfMediaNode({ kind: "media", mediaId: "abc" }, { height: 900 })).toEqual({
      type: "media",
      attrs: { type: "file", id: "abc", collection: "" },
    });
  });

  it("omits dims when values are non-positive", () => {
    expect(
      adfMediaNode({ kind: "external", url: "u" }, { width: 0, height: 100 }),
    ).toEqual({
      type: "media",
      attrs: { type: "external", url: "u" },
    });
  });
});

describe("adfMediaSingle", () => {
  it("omits width when the media carries original dims (avoids full-width stretch)", () => {
    const media = adfMediaNode({ kind: "media", mediaId: "abc" }, { width: 40, height: 40 });
    const wrapped = adfMediaSingle(media);
    expect(wrapped).toEqual({
      type: "mediaSingle",
      attrs: { layout: "align-start" },
      content: [media],
    });
    expect((wrapped.attrs as Record<string, unknown>).width).toBeUndefined();
  });

  it("falls back to width: 100 when the media has no dims (avoids tiny render)", () => {
    const media = adfMediaNode({ kind: "media", mediaId: "abc" });
    const wrapped = adfMediaSingle(media);
    expect(wrapped).toEqual({
      type: "mediaSingle",
      attrs: { layout: "align-start", width: 100 },
      content: [media],
    });
  });
});
