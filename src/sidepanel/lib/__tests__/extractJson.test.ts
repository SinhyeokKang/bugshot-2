import { describe, it, expect } from "vitest";
import { extractJson } from "../extractJson";

describe("extractJson", () => {
  it("순수 JSON 객체 그대로 반환", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("markdown json 펜스 제거", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("언어 없는 펜스 제거", () => {
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("앞뒤 잡설이 있어도 중괄호 범위만 추출", () => {
    expect(extractJson('here is the result: {"a":1} done')).toBe('{"a":1}');
  });

  it("중첩 객체는 마지막 } 까지 포함", () => {
    expect(extractJson('{"a":{"b":2}}')).toBe('{"a":{"b":2}}');
  });

  it("중괄호 없으면 null", () => {
    expect(extractJson("no json at all")).toBeNull();
  });

  it("닫는 중괄호가 여는 것보다 앞이면 null", () => {
    expect(extractJson("} {")).toBeNull();
  });
});
