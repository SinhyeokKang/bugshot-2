import { describe, expect, it, vi } from "vitest";

// Node 환경에서 FileReader가 없어 실제 blob-db 구현을 Node-호환으로 mock한다 (실제 round-trip 필요).
vi.mock("@/store/blob-db", () => ({
  blobToDataUrl: async (blob: Blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return `data:${blob.type || "application/octet-stream"};base64,${btoa(bin)}`;
  },
  dataUrlToBlob: (dataUrl: string) => {
    const m = /^data:(.*?);base64,(.+)$/.exec(dataUrl);
    if (!m) throw new Error("Invalid data URL");
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  },
}));

import { blobToDataUrl } from "@/store/blob-db";
import { zipLogsHtml } from "../zipLogsHtml";

async function makeDataUrl(content: string, mime: string): Promise<string> {
  return blobToDataUrl(new Blob([content], { type: mime }));
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function u16le(b: Uint8Array, off: number): number {
  return b[off] | (b[off + 1] << 8);
}
function u32le(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("zipLogsHtml — Cloudflare WAF 우회용 DEFLATE-mode zip 래퍼", () => {
  it("logs.html dataUrl을 deflate-mode .zip으로 래핑 (filename logs.zip)", async () => {
    // WAF 패턴 매칭에 걸릴 만한 평문(스택트레이스 같은 구조) 포함.
    const html = '<!doctype html><script>console.error("at fetch (a.js:10) UNION SELECT")</script>'.repeat(20);
    const input = await makeDataUrl(html, "text/html");
    const out = await zipLogsHtml("logs.html", input);

    expect(out.filename).toBe("logs.zip");
    expect(out.contentType).toBe("application/zip");
    expect(out.dataUrl.startsWith("data:application/zip;base64,")).toBe(true);

    const bytes = base64ToBytes(out.dataUrl.split(",")[1]);

    // Local file header signature: PK\x03\x04
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);

    // Compression method @ offset 8: 8 (deflate)
    expect(u16le(bytes, 8)).toBe(8);

    // 내부 파일명
    const fnLen = u16le(bytes, 26);
    expect(new TextDecoder().decode(bytes.subarray(30, 30 + fnLen))).toBe("logs.html");

    const uncSize = u32le(bytes, 22);
    const compSize = u32le(bytes, 18);
    const expected = new TextEncoder().encode(html);
    expect(uncSize).toBe(expected.length);
    // 반복 패턴이라 압축 효과 확인 (deflate가 실제로 동작)
    expect(compSize).toBeLessThan(uncSize);

    // 압축 데이터를 inflate해서 원본 일치 확인
    const compressedData = bytes.subarray(30 + fnLen, 30 + fnLen + compSize);
    const decompressed = await inflateRaw(compressedData);
    expect(new TextDecoder().decode(decompressed)).toBe(html);

    // EOCD signature
    const eocdStart = bytes.length - 22;
    expect(bytes[eocdStart]).toBe(0x50);
    expect(bytes[eocdStart + 1]).toBe(0x4b);
    expect(bytes[eocdStart + 2]).toBe(0x05);
    expect(bytes[eocdStart + 3]).toBe(0x06);
    expect(u16le(bytes, eocdStart + 10)).toBe(1);
  });

  it("내부 파일명은 입력 그대로, 외부는 .html→.zip 치환", async () => {
    const input = await makeDataUrl("xx", "text/html");
    const out = await zipLogsHtml("foo.html", input);
    expect(out.filename).toBe("foo.zip");

    const bytes = base64ToBytes(out.dataUrl.split(",")[1]);
    const fnLen = u16le(bytes, 26);
    expect(new TextDecoder().decode(bytes.subarray(30, 30 + fnLen))).toBe("foo.html");
  });

  it("바이너리 안전: 0x00·0xff 포함해도 round-trip 동일", async () => {
    const bytes = new Uint8Array([0, 1, 2, 0xff, 0xfe, 0, 0xab, 0xcd]);
    const input = await blobToDataUrl(new Blob([bytes], { type: "text/html" }));
    const out = await zipLogsHtml("a.html", input);
    const zipBytes = base64ToBytes(out.dataUrl.split(",")[1]);
    const fnLen = u16le(zipBytes, 26);
    const compSize = u32le(zipBytes, 18);
    const compData = zipBytes.subarray(30 + fnLen, 30 + fnLen + compSize);
    const decoded = await inflateRaw(compData);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });
});
