import { describe, it, expect } from "vitest";
import { aiLoadingSurface, aiLoadingPhraseKey } from "../aiLoadingPhrases";

describe("aiLoadingSurface", () => {
  it("아무 로딩도 아니면 null", () => {
    expect(aiLoadingSurface({ styling: false, draft: false, repro: false })).toBeNull();
  });

  it("styling이 켜지면 styling", () => {
    expect(aiLoadingSurface({ styling: true, draft: false, repro: false })).toBe("styling");
  });

  it("draft만 켜지면 draft", () => {
    expect(aiLoadingSurface({ styling: false, draft: true, repro: false })).toBe("draft");
  });

  it("repro만 켜지면 repro", () => {
    expect(aiLoadingSurface({ styling: false, draft: false, repro: true })).toBe("repro");
  });

  it("동시 로딩이면 styling > draft > repro 우선순위", () => {
    expect(aiLoadingSurface({ styling: true, draft: true, repro: true })).toBe("styling");
    expect(aiLoadingSurface({ styling: false, draft: true, repro: true })).toBe("draft");
  });
});

describe("aiLoadingPhraseKey", () => {
  it("styling step 0/1/2 → loading1/2/3", () => {
    expect(aiLoadingPhraseKey("styling", 0)).toBe("aiStyling.loading1");
    expect(aiLoadingPhraseKey("styling", 1)).toBe("aiStyling.loading2");
    expect(aiLoadingPhraseKey("styling", 2)).toBe("aiStyling.loading3");
  });

  it("draft step 0/1/2 → loading1/2/3", () => {
    expect(aiLoadingPhraseKey("draft", 0)).toBe("aiDraft.loading1");
    expect(aiLoadingPhraseKey("draft", 1)).toBe("aiDraft.loading2");
    expect(aiLoadingPhraseKey("draft", 2)).toBe("aiDraft.loading3");
  });

  it("repro step 0/1/2 → loading1/2/3", () => {
    expect(aiLoadingPhraseKey("repro", 0)).toBe("aiRepro.loading1");
    expect(aiLoadingPhraseKey("repro", 1)).toBe("aiRepro.loading2");
    expect(aiLoadingPhraseKey("repro", 2)).toBe("aiRepro.loading3");
  });

  it("step 3/4는 loading4/5", () => {
    expect(aiLoadingPhraseKey("styling", 3)).toBe("aiStyling.loading4");
    expect(aiLoadingPhraseKey("styling", 4)).toBe("aiStyling.loading5");
  });

  it("step 5 이상은 처음으로 되돌아 무한 루프(5개 주기)", () => {
    expect(aiLoadingPhraseKey("styling", 5)).toBe("aiStyling.loading1");
    expect(aiLoadingPhraseKey("draft", 6)).toBe("aiDraft.loading2");
    expect(aiLoadingPhraseKey("repro", 10)).toBe("aiRepro.loading1");
    expect(aiLoadingPhraseKey("styling", 12)).toBe("aiStyling.loading3");
  });

  it("음수 step은 첫 문구로 clamp", () => {
    expect(aiLoadingPhraseKey("styling", -1)).toBe("aiStyling.loading1");
    expect(aiLoadingPhraseKey("draft", -5)).toBe("aiDraft.loading1");
  });
});
