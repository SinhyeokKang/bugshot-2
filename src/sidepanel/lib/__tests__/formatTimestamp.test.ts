import { describe, expect, it, vi, beforeEach } from "vitest";

// dateBcp47을 로케일 가변으로 — 케이스별로 로케일을 바꿔 ko 회귀를 재현한다.
const localeRef = vi.hoisted(() => ({ current: "en-US" }));
vi.mock("@/i18n", () => ({
  dateBcp47: () => localeRef.current,
}));

import { formatTimestamp } from "../formatTimestamp";

describe("formatTimestamp", () => {
  beforeEach(() => {
    localeRef.current = "en-US";
  });

  it("숫자 타임스탬프를 사람이 읽을 수 있는 문자열로 변환", () => {
    const result = formatTimestamp(1700000000000);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("연/월/일/시/분/초를 포함", () => {
    const d = new Date(2024, 0, 15, 10, 30, 45);
    const result = formatTimestamp(d.getTime());
    expect(result).toContain("2024");
    expect(result).toContain("15");
    expect(result).toContain("30");
    expect(result).toContain("45");
  });

  // 24시간제 — 오후 7시가 "07:..PM"이 아니라 "19:.."로 렌더, AM/PM 접미사 없음.
  it("24시간제로 렌더 — AM/PM 없이 0–23시", () => {
    const d = new Date(2024, 0, 15, 19, 22, 14);
    const result = formatTimestamp(d.getTime());
    expect(result).toContain("19:22:14");
    expect(result).not.toMatch(/[AP]M/);
  });

  // h23 — 자정이 24:xx로 새지 않고 00:xx.
  it("자정을 00시로 렌더 (h23 — 24시 표기 아님)", () => {
    const d = new Date(2024, 0, 15, 0, 5, 30);
    const result = formatTimestamp(d.getTime());
    expect(result).toContain("00:05:30");
    expect(result).not.toContain("24:05");
  });

  // 회귀: 글로벌 팀이 Captured 시각의 타임존을 판독할 수 있어야 한다.
  // 리포터 브라우저 로컬 TZ의 GMT 오프셋이 출력에 포함(실행 환경 TZ 무관 — UTC면 "GMT",
  // 그 외 "GMT+9" 등. 하드코딩 로컬시각 비교는 환경 TZ 의존이라 금지).
  it("리포터 로컬 타임존 오프셋(GMT)을 포함한다", () => {
    const result = formatTimestamp(1700000000000);
    expect(result).toMatch(/GMT/);
  });

  // 회귀: timeZoneName을 toLocaleString 옵션에 넣으면 ko-KR에서 ICU가 시간 패턴을
  // 콜론(09:01:50)에서 한글 스켈레톤(09시 1분 50초)으로 바꿔 분 패딩까지 깨진다.
  // 오프셋은 옵션이 아니라 suffix로 붙여 콜론 포맷을 유지해야 한다. (en은 무영향.)
  it("ko 로케일 — 콜론 시간 유지 + GMT, 한글 시/분/초 스켈레톤 전환 없음", () => {
    localeRef.current = "ko-KR";
    const result = formatTimestamp(1752624110000);
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/); // 콜론 시간 유지
    expect(result).not.toMatch(/[시분초]/); // 한글 스켈레톤 미전환
    expect(result).toMatch(/GMT/); // 오프셋 유지
  });
});
