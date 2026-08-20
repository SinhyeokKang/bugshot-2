// 확장자가 `.tsx`인 이유: blobToDataUrl은 FileReader 래퍼라 DOM 전역이 필요한데,
// vitest.config.ts의 environmentMatchGlobs가 `**/*.test.tsx`만 jsdom으로 분기한다
// (React 렌더는 이 파일에 없다). 대안으로 파일 상단에 `// @vitest-environment jsdom`
// docblock을 달고 `.test.ts`를 유지할 수도 있지만, 저장소 관례인 확장자 분기를 따랐다.
import { describe, expect, it } from "vitest";
import { blobToDataUrl, dataUrlToBlob } from "../blob-db";

describe("blobToDataUrl", () => {
  it("텍스트 Blob → base64 data URL", async () => {
    const url = await blobToDataUrl(new Blob(["hello"], { type: "text/plain" }));
    expect(url).toBe("data:text/plain;base64,aGVsbG8=");
  });

  it("빈 Blob도 base64 세그먼트 없이 data URL을 만든다", async () => {
    const url = await blobToDataUrl(new Blob([], { type: "image/png" }));
    expect(url).toBe("data:image/png;base64,");
  });
});

describe("blobToDataUrl ↔ dataUrlToBlob 왕복", () => {
  it("dataUrlToBlob → blobToDataUrl이 원본 문자열을 복원한다", async () => {
    const original = "data:text/plain;base64,aGVsbG8=";
    expect(await blobToDataUrl(dataUrlToBlob(original))).toBe(original);
  });

  it("바이너리 바이트가 왕복에서 보존된다", async () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const original = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
    const url = await blobToDataUrl(dataUrlToBlob(original));
    expect(url).toBe("data:image/png;base64,AAEC/f7/");
    expect(url).toBe(original);
    const out = new Uint8Array(await dataUrlToBlob(url).arrayBuffer());
    expect([...out]).toEqual([0, 1, 2, 253, 254, 255]);
  });
});
