import { describe, it, expect } from "vitest";
import { resolvePageUrl } from "../pageUrl";

// 재현 환경의 Page 값이 어느 URL을 가리키는가의 단일 출처.
// freeform은 산출물이 없고 로그가 네비게이션을 넘어 누적되므로 "지금 보고 있는 페이지"를,
// 캡처 3모드는 스크린샷·영상이 그 페이지의 것이므로 "찍은 페이지"를 가리켜야 한다.
describe("resolvePageUrl — freeform은 추적, 캡처는 동결", () => {
  const TARGET = "https://app.example.com/projects";
  const LIVE = "https://app.example.com/invite/tok?e=email-mismatch";

  it("freeform + 이동함 → 현재 URL을 따라간다", () => {
    expect(
      resolvePageUrl({
        captureMode: "freeform",
        targetUrl: TARGET,
        livePageUrl: LIVE,
      }),
    ).toBe(LIVE);
  });

  // 패널 마운트 직후 tabs.get이 아직 해석되기 전 구간. 여기서 ""를 내면 Page 행이
  // 잠깐 "-"로 깜빡이고, 그 순간 confirmDraft가 불리면 빈 pageUrl이 저장된다.
  it("freeform + livePageUrl null → targetUrl로 폴백", () => {
    expect(
      resolvePageUrl({
        captureMode: "freeform",
        targetUrl: TARGET,
        livePageUrl: null,
      }),
    ).toBe(TARGET);
  });

  it("freeform + livePageUrl 빈 문자열 → targetUrl로 폴백", () => {
    expect(
      resolvePageUrl({
        captureMode: "freeform",
        targetUrl: TARGET,
        livePageUrl: "",
      }),
    ).toBe(TARGET);
  });

  // 동결 축 — 3모드 전부. 하나라도 빠지면 그 모드에서 스크린샷과 Page가 어긋나는
  // 회귀가 무음으로 들어온다(이미지는 /projects인데 Page는 /invite).
  it.each(["element", "screenshot", "video"] as const)(
    "%s는 livePageUrl이 있어도 targetUrl로 동결",
    (captureMode) => {
      expect(
        resolvePageUrl({ captureMode, targetUrl: TARGET, livePageUrl: LIVE }),
      ).toBe(TARGET);
    },
  );

  // null·undefined는 `?? ""` 하나가 함께 처리해 항상 같이 죽는다 — 한 건이면 충분.
  it.each([null, undefined])("targetUrl이 %s면 빈 문자열 (표시 폴백은 호출부 책임)", (targetUrl) => {
    expect(
      resolvePageUrl({ captureMode: "screenshot", targetUrl, livePageUrl: null }),
    ).toBe("");
  });

  // target이 아직 없는 freeform 세션에서도 live가 있으면 그걸 쓴다 — 폴백 방향이
  // 반대로 박히면(live 있어도 target 우선) 이 케이스가 ""로 샌다.
  it("freeform은 targetUrl이 비어도 livePageUrl이 있으면 그걸 쓴다", () => {
    expect(
      resolvePageUrl({
        captureMode: "freeform",
        targetUrl: null,
        livePageUrl: LIVE,
      }),
    ).toBe(LIVE);
  });
});
