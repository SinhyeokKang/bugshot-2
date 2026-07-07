import { describe, expect, it } from "vitest";
import { parseBoxModel } from "../boxModel";

const full = {
  "margin-top": "1px",
  "margin-right": "2px",
  "margin-bottom": "3px",
  "margin-left": "4px",
  "border-top-width": "5px",
  "border-right-width": "6px",
  "border-bottom-width": "7px",
  "border-left-width": "8px",
  "padding-top": "9px",
  "padding-right": "10px",
  "padding-bottom": "11px",
  "padding-left": "12px",
  width: "100px",
  height: "34px",
};

describe("parseBoxModel", () => {
  it("전 필드 px를 숫자로 파싱", () => {
    const box = parseBoxModel(full);
    expect(box.margin).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(box.border).toEqual({ top: 5, right: 6, bottom: 7, left: 8 });
    expect(box.padding).toEqual({ top: 9, right: 10, bottom: 11, left: 12 });
    expect(box.content).toEqual({ width: 100, height: 34 });
  });

  it("contentLabel은 width×height 원문(정수)", () => {
    expect(parseBoxModel(full).contentLabel).toBe("100×34");
  });

  it("소수 width/height를 보존", () => {
    const box = parseBoxModel({ ...full, width: "100.273px", height: "34.5px" });
    expect(box.content).toEqual({ width: 100.273, height: 34.5 });
    expect(box.contentLabel).toBe("100.273×34.5");
  });

  it("auto·비px 값은 0으로 처리", () => {
    const box = parseBoxModel({ ...full, "margin-left": "auto", "margin-right": "auto" });
    expect(box.margin.left).toBe(0);
    expect(box.margin.right).toBe(0);
  });

  it("키가 없는(부분 누락) computed는 0으로 안전", () => {
    const box = parseBoxModel({ width: "50px", height: "20px" });
    expect(box.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(box.border).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(box.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(box.content).toEqual({ width: 50, height: 20 });
  });

  it("빈 computed는 전부 0 + 0×0 라벨", () => {
    const box = parseBoxModel({});
    expect(box.content).toEqual({ width: 0, height: 0 });
    expect(box.contentLabel).toBe("0×0");
  });
});
