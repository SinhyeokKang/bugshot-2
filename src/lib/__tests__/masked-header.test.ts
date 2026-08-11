import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isMaskedHeaderValue } from "../masked-header";

describe("isMaskedHeaderValue", () => {
  it("마스킹 sentinel을 양성으로 판정한다", () => {
    expect(isMaskedHeaderValue("***[len:12]")).toBe(true);
    expect(isMaskedHeaderValue("***[len:0]")).toBe(true);
  });

  it("앞이 ***가 아니면 음성이다", () => {
    expect(isMaskedHeaderValue("Bearer ***abc")).toBe(false);
  });

  // 종전 판정은 startsWith("***")라 이런 실제 헤더 값도 마스킹으로 봤다.
  // 새 판정은 sentinel 형태를 요구하므로 음성이고, 그 변화가 의도임을 여기서 고정한다.
  it("***로 시작하지만 sentinel 형태가 아니면 음성이다", () => {
    expect(isMaskedHeaderValue("***stars in a real header value")).toBe(false);
    expect(isMaskedHeaderValue("***")).toBe(false);
    expect(isMaskedHeaderValue("***[len:]")).toBe(false);
    expect(isMaskedHeaderValue("***[len:abc]")).toBe(false);
  });

  it("빈 문자열은 음성이다", () => {
    expect(isMaskedHeaderValue("")).toBe(false);
  });
});

// 생산자는 recorders-entry 청크라 src/content/ 밖을 import할 수 없다(동기 IIFE 제약).
// 그래서 리터럴을 복제한 채 두고, 두 벌이 갈라지지 않는지를 이 대조가 지킨다.
describe("생산자 리터럴 대조", () => {
  it("network-recorder.ts가 sentinel 리터럴을 여전히 갖는다", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(here, "../../content/network-recorder.ts"),
      "utf8",
    );
    expect(source).toContain("***[len:${value.length}]");
  });
});
