import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadImageUrl, imageExtFromDataUrl } from "../downloadCapture";

describe("imageExtFromDataUrl", () => {
  it("webp dataURL → webp", () => {
    expect(imageExtFromDataUrl("data:image/webp;base64,AAAA")).toBe("webp");
  });

  it("png dataURL → png", () => {
    expect(imageExtFromDataUrl("data:image/png;base64,AAAA")).toBe("png");
  });

  it("jpeg → jpg", () => {
    expect(imageExtFromDataUrl("data:image/jpeg;base64,AAAA")).toBe("jpg");
  });

  it("svg+xml → svg", () => {
    expect(imageExtFromDataUrl("data:image/svg+xml,<svg/>")).toBe("svg");
  });

  it("non-image or malformed dataURL falls back to webp", () => {
    expect(imageExtFromDataUrl("not-a-data-url")).toBe("webp");
    expect(imageExtFromDataUrl("data:text/plain,hi")).toBe("webp");
  });

  it("is case-insensitive on the mime subtype", () => {
    expect(imageExtFromDataUrl("data:image/PNG;base64,AAAA")).toBe("png");
  });
});


afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["image/webp", "image/png", "image/jpeg"])("downloads real blob URL bytes with ordinal and %s extension", async (type) => {
  const bytes = new Uint8Array([0, 1, 127, 255]);
  const source = URL.createObjectURL(new Blob([bytes], { type }));
  const downloads: Array<{ filename: string; blob: Promise<Blob> }> = [];
  const anchor = { href: "", download: "", remove() {}, click() {
    downloads.push({ filename: this.download, blob: fetch(this.href).then(response => response.blob()) });
  } };
  vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild() {} } });
  try {
    await downloadImageUrl(source, "screenshot-2");
    expect(downloads).toHaveLength(1);
    expect(downloads[0].filename).toBe(`screenshot-2.${type === "image/jpeg" ? "jpg" : type.split("/")[1]}`);
    const blob = await downloads[0].blob;
    expect(blob.type).toBe(type);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  } finally { URL.revokeObjectURL(source); }
});

it("rejects a revoked source without triggering a download", async () => {
  const source = URL.createObjectURL(new Blob(["gone"], { type: "image/png" }));
  URL.revokeObjectURL(source);
  const create = vi.fn();
  vi.stubGlobal("document", { createElement: create });
  await expect(downloadImageUrl(source)).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});
