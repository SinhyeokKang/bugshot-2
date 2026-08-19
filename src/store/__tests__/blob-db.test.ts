import { describe, expect, it } from "vitest";
import { dataUrlToBlob } from "../blob-db";

// blobToDataUrl은 FileReader 래퍼라 DOM 없는 node 테스트 env에서 실행 불가 — 파싱 로직인
// dataUrlToBlob만 단위 검증한다(블롭 왕복은 jsdom 판본 blob-db-datauri.test.tsx).

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

// 저장소에 dataUrlToBlob 판본이 둘이다 — 여기(store/blob-db.ts:735, /^data:(.*?);base64,(.+)$/)와
// background/notion-api.ts:294(/^data:([^;,]+)(?:;([^,]*))?,(.*)$/, 비-base64 payload도 처리).
// 아래 3케이스가 두 판본이 갈리는 지점이다 — 호출부를 바꿔 끼울 때 무음 회귀가 나는 자리.
describe("dataUrlToBlob — notion 판본과 갈리는 입력", () => {
  it("mime 없는 data URL: 여기는 type:\"\"로 성공 (notion 판본은 throw)", async () => {
    const blob = dataUrlToBlob("data:;base64,QUJD");
    expect(blob.type).toBe("");
    expect(await blob.text()).toBe("ABC");
  });

  it("payload가 빈 data URL: 여기는 throw (notion 판본은 빈 Blob으로 성공)", () => {
    expect(() => dataUrlToBlob("data:text/plain;base64,")).toThrow("Invalid data URL");
  });

  it("charset이 섞인 mime: type에 charset이 그대로 붙는다 (notion 판본은 text/plain)", async () => {
    const blob = dataUrlToBlob("data:text/plain;charset=utf-8;base64,aGk=");
    expect(blob.type).toBe("text/plain;charset=utf-8");
    expect(await blob.text()).toBe("hi");
  });
});
