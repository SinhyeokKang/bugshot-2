import { describe, expect, it } from "vitest";
import { dataUrlToBlob } from "../blob-db";

// blobToDataUrl은 FileReader 래퍼라 DOM 없는 node 테스트 env에서 실행 불가 — 파싱 로직인
// dataUrlToBlob만 단위 검증한다.

describe("dataUrlToBlob", () => {
  it("base64 data URL → Blob (mime + 텍스트 보존)", async () => {
    const blob = dataUrlToBlob("data:text/plain;base64," + btoa("hello"));
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("hello");
  });

  it("바이너리 바이트를 정확히 복원", async () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const b64 = btoa(String.fromCharCode(...bytes));
    const blob = dataUrlToBlob(`data:application/octet-stream;base64,${b64}`);
    const out = new Uint8Array(await blob.arrayBuffer());
    expect([...out]).toEqual([...bytes]);
  });

  it("data URL 형식이 아니면 throw", () => {
    expect(() => dataUrlToBlob("not-a-data-url")).toThrow("Invalid data URL");
    // base64 세그먼트가 없으면 매칭 실패
    expect(() => dataUrlToBlob("data:text/plain,plaintext")).toThrow("Invalid data URL");
  });
});
