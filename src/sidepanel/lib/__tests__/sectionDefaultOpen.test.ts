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
