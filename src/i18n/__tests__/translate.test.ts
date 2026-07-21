import { afterEach, describe, expect, it } from "vitest";
import { dateBcp47, getLocale, setLocale, t } from "../index";

// locales.test.ts는 ko/en 딕셔너리 "표"만 대조한다 — 실제 번역 함수(치환·로케일 전환)는
// 여태 한 번도 호출되지 않았다. 복제 구현인 log-viewer의 t()는 이미 검증돼 있어 쌍둥이 중
// 원본만 그물이 없던 셈 (감사 🟡 항목).
describe("t — 런타임 번역", () => {
  afterEach(() => {
    setLocale("ko");
  });

  it("등록된 키를 현재 로케일 문자열로 옮긴다", () => {
    setLocale("ko");
    const ko = t("common.cancel");
    setLocale("en");
    const en = t("common.cancel");
    expect(ko).toBeTruthy();
    expect(en).toBeTruthy();
    expect(ko).not.toBe(en);
  });

  it("setLocale/getLocale이 현재 로케일을 왕복한다", () => {
    setLocale("en");
    expect(getLocale()).toBe("en");
    setLocale("ko");
    expect(getLocale()).toBe("ko");
  });

  // {n}·{name} 치환이 깨지면 전 UI에 리터럴 토큰이 그대로 노출된다.
  it("params의 토큰을 값으로 치환한다", () => {
    setLocale("ko");
    const out = t("time.minutesAgo", { n: 5 });
    expect(out).toContain("5");
    expect(out).not.toContain("{n}");
  });

  it("서로 다른 토큰이 여러 개면 모두 치환한다", () => {
    setLocale("ko");
    const out = t("attachment.button", { count: 2, max: 10 });
    expect(out).toContain("2");
    expect(out).toContain("10");
    expect(out).not.toContain("{count}");
    expect(out).not.toContain("{max}");
  });

  // params를 안 주면 치환 자체를 건너뛴다 — 토큰이 그대로 남는 게 현재 계약이다.
  it("params 없이 호출하면 치환하지 않고 원문을 돌려준다", () => {
    setLocale("ko");
    expect(t("time.minutesAgo")).toContain("{n}");
  });

  it("숫자 파라미터를 문자열로 변환해 넣는다", () => {
    setLocale("en");
    expect(t("time.minutesAgo", { n: 12 })).toContain("12");
  });

  it("dateBcp47은 로케일에 맞는 BCP47 태그를 준다", () => {
    setLocale("ko");
    expect(dateBcp47()).toBe("ko-KR");
    setLocale("en");
    expect(dateBcp47()).toBe("en-US");
  });
});
