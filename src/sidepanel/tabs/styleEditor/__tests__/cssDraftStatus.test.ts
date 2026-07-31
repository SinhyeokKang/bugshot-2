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

  it("baseline 행 삭제는 initial 원복으로 canonical 재표시", () => {
    const result = evaluateCssDraft(
      `${selector} {\nmargin-left: 5px;\n}`,
      specified,
    );
    expect(result).toEqual({
      status: "applied",
      overrides: { color: "initial" },
      cssText: `${selector} {\ncolor: initial;\nmargin-left: 5px;\n}`,
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

  // CodeMirror onChange는 디바운스가 없어 키스트로크마다 평가된다. 마지막 줄은 사용자가
  // 지금 치고 있는 것이라, 그걸로 경고를 띄우면 속성명 한 글자마다 배너·잠금이 깜빡인다.
  it("마지막 줄만 미완성이면(타이핑 중) 경고하지 않는다", () => {
    expect(
      isCssDraftUnapplied(
        `${selector} {\ncolor: blue;\nmargin-left: 5px;\nbackground\n}`,
        specified,
        { color: "blue" },
      ),
    ).toBe(false);
    expect(
      isCssDraftUnapplied(`${selector} {\ncolor: blue;\nmargin-left: 5px;\nbackground:\n}`, specified, {
        color: "blue",
      }),
    ).toBe(false);
  });

  it("앞선 줄이 미완성이면 여전히 경고한다", () => {
    expect(
      isCssDraftUnapplied(
        `${selector} {\nbackground\ncolor: blue;\nmargin-left: 5px;\n}`,
        specified,
        { color: "blue" },
      ),
    ).toBe(true);
  });

  it("중복 선언은 마지막 줄이어도 경고한다 (fallback 순서 손실)", () => {
    expect(
      isCssDraftUnapplied(
        `${selector} {\ndisplay: -webkit-box;\ndisplay: flex;\n}`,
        specified,
        {},
      ),
    ).toBe(true);
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
