import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  NETWORK_MAX_ENTRIES,
  CONSOLE_MAX_ENTRIES,
  ACTION_MAX_ENTRIES,
} from "../log-merge";

// FIFO 캡 상수는 레코더 3종(MAIN world IIFE)과 sidepanel 수신부에 두 벌 존재한다.
// 중앙화는 **금지**다 — recorders-entry 청크에 외부 static import가 생기는 순간 crxjs가
// 동기 IIFE emit을 포기하고 async loader로 되돌아가 pre-arm 버퍼링이 조용히 죽는다.
// 그래서 복제를 유지하되 값 일치를 이 대조로 잠근다(복제본은 늘 대조 테스트로 묶는다).
const CONTENT = resolve(__dirname, "../../../content");

function readConst(file: string, name: string): number {
  const src = readFileSync(resolve(CONTENT, file), "utf8");
  const m = new RegExp(`const ${name} = (\\d+);`).exec(src);
  if (!m) throw new Error(`${file}에 ${name} 선언이 없다`);
  return Number(m[1]);
}

describe("FIFO 캡 상수 동기화 (레코더 ↔ log-merge)", () => {
  it("network: MAX_REQUEST_ENTRIES === NETWORK_MAX_ENTRIES", () => {
    expect(readConst("network-recorder.ts", "MAX_REQUEST_ENTRIES")).toBe(
      NETWORK_MAX_ENTRIES,
    );
  });

  it("console: MAX_ENTRIES === CONSOLE_MAX_ENTRIES", () => {
    expect(readConst("console-recorder.ts", "MAX_ENTRIES")).toBe(
      CONSOLE_MAX_ENTRIES,
    );
  });

  it("action: MAX_ENTRIES === ACTION_MAX_ENTRIES", () => {
    expect(readConst("action-recorder.ts", "MAX_ENTRIES")).toBe(
      ACTION_MAX_ENTRIES,
    );
  });

  // 파서 자기검증 — 정규식이 헛돌면 위 세 개가 조용히 통과한다.
  it("readConst가 실재하지 않는 상수엔 throw한다", () => {
    expect(() => readConst("console-recorder.ts", "NOPE_MAX")).toThrow();
  });
});
