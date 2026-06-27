import { describe, expect, it } from "vitest";
import { sectionDefaultOpen } from "../sectionDefaultOpen";

describe("sectionDefaultOpen", () => {
  it("specified에 섹션 prop이 있으면 펼친다 (값이 기본값이어도 — author 명시)", () => {
    expect(sectionDefaultOpen(["padding-top"], { "padding-top": "0px" }, {})).toBe(
      true,
    );
  });

  it("섹션 prop이 specified엔 없고 computed가 기본값이면 접는다", () => {
    expect(
      sectionDefaultOpen(
        ["padding-top", "padding-bottom"],
        { color: "red" },
        { "padding-top": "0px", "padding-bottom": "0px" },
      ),
    ).toBe(false);
  });

  it("섹션 prop computed가 non-default면 펼친다 (specified 없어도)", () => {
    expect(
      sectionDefaultOpen(["padding-top"], { color: "red" }, { "padding-top": "8px" }),
    ).toBe(true);
  });

  it("specified 전무 + computed가 기본값뿐이면 접는다", () => {
    expect(sectionDefaultOpen(["padding-top"], {}, { "padding-top": "0px" })).toBe(
      false,
    );
  });

  it("specified 전무 + computed non-default면 펼친다 (cross-origin fallback)", () => {
    expect(sectionDefaultOpen(["padding-top"], {}, { "padding-top": "8px" })).toBe(
      true,
    );
  });

  it("border shorthand 기본값(0px none …)은 접는다", () => {
    expect(
      sectionDefaultOpen(["border"], {}, { border: "0px none rgb(0, 0, 0)" }),
    ).toBe(false);
  });

  // 회귀: border가 없는데 border-color만 currentColor resolve값(rgb(45,49,54))으로
  // 노출돼 border 섹션이 잘못 펼쳐지던 버그.
  it("테두리 없고 border-color만 유령색이면 접는다", () => {
    expect(
      sectionDefaultOpen(
        [
          "border-top-width",
          "border-top-style",
          "border-top-color",
          "border-bottom-width",
          "border-bottom-style",
          "border-bottom-color",
        ],
        {},
        {
          "border-top-width": "0px",
          "border-top-style": "none",
          "border-top-color": "rgb(45, 49, 54)",
          "border-bottom-width": "0px",
          "border-bottom-style": "none",
          "border-bottom-color": "rgb(45, 49, 54)",
        },
      ),
    ).toBe(false);
  });

  it("실제 테두리가 있으면 펼친다 (유령색 가드가 진짜 border를 가리지 않음)", () => {
    expect(
      sectionDefaultOpen(
        ["border-bottom-width", "border-bottom-style", "border-bottom-color"],
        {},
        {
          "border-bottom-width": "1px",
          "border-bottom-style": "solid",
          "border-bottom-color": "rgb(45, 49, 54)",
        },
      ),
    ).toBe(true);
  });

  it("author가 border-color를 명시했으면 유령이어도 펼친다", () => {
    expect(
      sectionDefaultOpen(
        ["border-top-color"],
        { "border-top-color": "rgb(45, 49, 54)" },
        {
          "border-top-width": "0px",
          "border-top-style": "none",
          "border-top-color": "rgb(45, 49, 54)",
        },
      ),
    ).toBe(true);
  });

  it("computed 빈 문자열 / 키 없음 / 전무는 접는다", () => {
    expect(sectionDefaultOpen(["padding-top"], {}, { "padding-top": "" })).toBe(
      false,
    );
    expect(sectionDefaultOpen(["padding-top"], {}, { color: "red" })).toBe(false);
    expect(sectionDefaultOpen(["padding-top"], {}, {})).toBe(false);
  });

  // KNOWN_DEFAULTS에 기본값이 없는 prop(display 등)은 computed가 항상 non-default로
  // 취급돼 펼쳐진다 — 의도된 한계(그 prop 포함 섹션은 사실상 늘 펼침).
  it("known-default 미정의 prop(display)은 computed로 펼친다", () => {
    expect(sectionDefaultOpen(["display"], {}, { display: "block" })).toBe(true);
  });
});
