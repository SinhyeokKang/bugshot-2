import { describe, expect, it } from "vitest";
import { splitSlackText, SLACK_TEXT_LIMIT } from "../splitSlackText";

describe("splitSlackText", () => {
  it("한계 이하면 원문 그대로 1개", () => {
    expect(splitSlackText("short body")).toEqual(["short body"]);
  });

  it("모든 조각이 한계 이하", () => {
    const body = Array.from({ length: 400 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");

    for (const chunk of splitSlackText(body)) {
      expect(chunk.length).toBeLessThanOrEqual(SLACK_TEXT_LIMIT);
    }
  });

  it("라인 경계로 쪼갠다 (라인을 중간에 안 자름)", () => {
    const body = Array.from({ length: 400 }, (_, i) => `line${i}-${"x".repeat(40)}`).join("\n");

    const rejoined = splitSlackText(body).join("\n");

    expect(rejoined).toBe(body);
  });

  it("코드블럭 중간에서 잘리면 앞 조각을 닫고 다음 조각에서 같은 language로 다시 연다", () => {
    const huge = Array.from({ length: 300 }, (_, i) => `  "key${i}": ${i},`).join("\n");
    const body = ["*발생 현상*", "```json", huge, "```", "*재현 과정*"].join("\n");

    const chunks = splitSlackText(body);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].endsWith("```")).toBe(true);
    expect(chunks[1].startsWith("```json")).toBe(true);
    // 각 조각의 펜스 개수가 짝수 = 조각 안에서 코드블럭이 열리고 닫힌다.
    for (const chunk of chunks) {
      expect((chunk.match(/^ {0,3}```/gm) ?? []).length % 2).toBe(0);
    }
  });

  it("language 없는 펜스는 language 없이 재개", () => {
    const huge = Array.from({ length: 300 }, (_, i) => `plain line ${i} ${"y".repeat(20)}`).join("\n");
    const body = ["```", huge, "```"].join("\n");

    const chunks = splitSlackText(body);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].startsWith("```\n")).toBe(true);
  });

  it("펜스 밖 본문은 재개 펜스를 붙이지 않는다", () => {
    const body = Array.from({ length: 400 }, (_, i) => `plain ${i} ${"z".repeat(40)}`).join("\n");

    const chunks = splitSlackText(body);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].startsWith("```")).toBe(false);
  });

  it("한 라인이 한계보다 길면 하드 분할하고 내용을 보존한다", () => {
    const line = "q".repeat(SLACK_TEXT_LIMIT * 2 + 100);

    const chunks = splitSlackText(line);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(SLACK_TEXT_LIMIT);
    }
    expect(chunks.join("")).toBe(line);
  });

  it("빈 문자열은 빈 배열 (전송할 게 없다)", () => {
    expect(splitSlackText("")).toEqual([]);
  });
});
