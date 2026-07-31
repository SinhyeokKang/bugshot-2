import { describe, expect, it } from "vitest";
import {
  evaluateCssDraft,
  hasUnappliedCssDrafts,
  isCssDraftUnapplied,
} from "../cssDraftStatus";

const selector = ".target";
const specified = { color: "red", "margin-left": "5px" };

describe("evaluateCssDraft", () => {
  it.each([
    `${selector} {\ncolor:\n}`,
    `${selector} {\ncolor: blue;\ncolor: green;\n}`,
  ])("미완성·중복 draft는 unapplied", (cssText) => {
    expect(evaluateCssDraft(cssText, specified)).toMatchObject({
      status: "unapplied",
    });
  });

  it("지원하지 않는 값은 unapplied", () => {
    expect(
      evaluateCssDraft(
        `${selector} {\ncolor: not-a-color;\nmargin-left: 5px;\n}`,
        specified,
        () => false,
      ),
    ).toMatchObject({ status: "unapplied" });
  });

  it("baseline 행 삭제는 원복 후 canonical 재표시", () => {
    const result = evaluateCssDraft(
      `${selector} {\nmargin-left: 5px;\n}`,
      specified,
    );
    expect(result).toEqual({
      status: "applied",
      overrides: {},
      cssText: `${selector} {\ncolor: red;\nmargin-left: 5px;\n}`,
      canonicalized: true,
    });
  });

  it("유효한 formatting과 주석은 보존", () => {
    const cssText = `${selector} {\n/* keep */ color: blue;\nmargin-left: 5px;\n}`;
    expect(evaluateCssDraft(cssText, specified)).toEqual({
      status: "applied",
      overrides: { color: "blue" },
      cssText,
      canonicalized: false,
    });
  });

  it("raw와 last-applied model이 다르면 진행 불가 상태", () => {
    const cssText = `${selector} {\ncolor: blue;\nmargin-left: 5px;\n}`;
    expect(isCssDraftUnapplied(cssText, specified, { color: "green" })).toBe(true);
    expect(isCssDraftUnapplied(cssText, specified, { color: "blue" })).toBe(false);
  });

  it("버퍼 중 하나라도 unapplied raw면 진행 불가", () => {
    expect(
      hasUnappliedCssDrafts([
        {
          cssText: `${selector} {\ncolor:\n}`,
          specifiedStyles: specified,
          inlineStyle: { color: "blue" },
        },
      ]),
    ).toBe(true);
  });
});
