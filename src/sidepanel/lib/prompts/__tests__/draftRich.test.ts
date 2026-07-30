import { describe, it, expect } from "vitest";
import { buildRichDraftPrompt } from "../draftRich";
import { buildCompactDraftPrompt } from "../draftCompact";
import { BYOK_CAPABILITIES, NANO_CAPABILITIES } from "../../ai-provider";
import type { AiDraftSessionContext } from "../../buildAiDraftPrompt";
import type { NetworkRequest } from "@/types/network";

function makeReq(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: "r1",
    url: "https://shop.example.com/api/orders?page=1",
    method: "GET",
    status: 200,
    statusText: "OK",
    startTime: 1000,
    durationMs: 20,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: "",
    requestBodySize: 0,
    responseBodySize: 0,
    contentType: "application/json",
    phase: "complete",
    responseBody: '{"orderStatus":"SHIPPED","items":[]}',
    ...overrides,
  };
}

function ctx(overrides: Partial<AiDraftSessionContext> = {}): AiDraftSessionContext {
  return {
    caps: BYOK_CAPABILITIES,
    captureMode: "freeform",
    locale: "ko",
    url: "https://shop.example.com/orders",
    pageTitle: "Orders",
    userPrompt: "주문 목록에서 orderStatus 매핑이 이상해요",
    requests: [makeReq()],
    enabledSections: [{ id: "description" }],
    ...overrides,
  };
}

describe("buildRichDraftPrompt — 매칭 200 섹션", () => {
  it("matched 있으면 'Possibly related requests' 섹션 + m1 줄 + digest 인쇄", () => {
    const p = buildRichDraftPrompt(ctx());
    expect(p).toContain("Possibly related requests");
    expect(p).toContain("[m1] GET /api/orders → 200");
    expect(p).toContain("orderStatus:str"); // digest
    expect(p).toContain('(matched "orderstatus")');
  });

  it("matched 인용 시 산문 설명 강제 지시문 포함", () => {
    const p = buildRichDraftPrompt(ctx());
    expect(p).toContain("explain in the description prose");
  });

  it("logRefs 예시에 m1 포함", () => {
    const p = buildRichDraftPrompt(ctx());
    expect(p).toMatch(/"logRefs".*m1/);
  });

  it("compact 프롬프트엔 매칭 섹션 미등장", () => {
    const p = buildCompactDraftPrompt(ctx({ caps: NANO_CAPABILITIES }));
    expect(p).not.toContain("Possibly related requests");
  });

  // CTO 게이트 회귀: description 섹션이 꺼지면 logRefs 자체가 없으므로(hasLogRefs=false),
  // 산문-잠금 지시문(logRefs·description 참조)이 잔여 지시로 남으면 안 된다.
  it("description 섹션 OFF → 산문-잠금 지시문·logRefs 키 미인쇄 (섹션 컨텍스트는 유지)", () => {
    const p = buildRichDraftPrompt(ctx({ enabledSections: [{ id: "stepsToReproduce" }] }));
    expect(p).toContain("Possibly related requests"); // 컨텍스트 섹션은 유지
    expect(p).not.toContain("explain in the description prose"); // 잔여 지시문 없음
    expect(p).not.toContain('"logRefs"'); // 스키마 키 없음
  });
});

// draftCompact는 전용 테스트가 없었다. compact의 불변식(JSON 규칙 미포함·이미지 언급 0·
// 로케일 반영)이 풀려도 아무도 안 잡던 자리.
describe("buildCompactDraftPrompt — compact 불변식", () => {
  it("페이지 주소·제목을 싣는다", () => {
    const p = buildCompactDraftPrompt(ctx({ caps: NANO_CAPABILITIES }));
    expect(p).toContain("https://shop.example.com/orders");
    expect(p).toContain("Orders");
  });

  it("응답 언어를 로케일로 지시한다", () => {
    expect(buildCompactDraftPrompt(ctx({ caps: NANO_CAPABILITIES, locale: "ko" }))).toContain("Korean");
    expect(buildCompactDraftPrompt(ctx({ caps: NANO_CAPABILITIES, locale: "en" }))).toContain("English");
  });

  // responseConstraint가 구조를 강제하므로 본문에 JSON 규칙을 넣지 않는다(형태는 few-shot이 잡는다).
  it("JSON 형식 지시문을 본문에 넣지 않는다", () => {
    const p = buildCompactDraftPrompt(ctx({ caps: NANO_CAPABILITIES }));
    expect(p).not.toContain("Respond in JSON");
  });

  // compact는 이미지를 못 받으므로 스크린샷 언급이 새면 없는 첨부를 참조하는 초안이 나온다.
  it("이미지·스크린샷을 언급하지 않는다", () => {
    const p = buildCompactDraftPrompt(ctx({ caps: NANO_CAPABILITIES })).toLowerCase();
    expect(p).not.toContain("screenshot");
    expect(p).not.toContain("image");
  });

  it("사실 범위를 컨텍스트로 제한하는 지시가 있다 (환각 억제)", () => {
    expect(buildCompactDraftPrompt(ctx({ caps: NANO_CAPABILITIES }))).toContain(
      "Use only facts stated in the context.",
    );
  });

  it("rich와 다른 본문을 낸다 (분기 실효)", () => {
    const c = ctx({ caps: NANO_CAPABILITIES });
    expect(buildCompactDraftPrompt(c)).not.toBe(buildRichDraftPrompt(c));
  });
});

// 실사례 회귀: 자동 생성 제목이 "…403 오류 발생 및 **성공** 알림 표시"로 나왔다.
// 실패 응답 *이전*에 기록된 성공 토스트를 결과로 읽은 것. 사람이 지라에서 "실패 알림"으로
// 고쳐야 했다 — 시점 앵커가 프롬프트에 없으면 재발한다.
describe("제목 결과 판정의 시점 앵커", () => {
  const withNetError = {
    networkLogSummary: {
      captured: 1,
      errorCount: 1,
      errors: [
        { id: "e1", method: "PATCH", path: "/api/posts/10886", status: 403, statusText: "Forbidden" },
      ],
    },
  };

  it("rich: 실패 응답 이후 관측만 결과로 판정하라는 지시가 있다", () => {
    expect(buildRichDraftPrompt(ctx(withNetError))).toContain("after the failing response");
  });

  // 스코프는 일부러 다르다 — rich는 Rules 블록(전 섹션), compact은 title 줄 접합(토큰 최소).
  it("compact: 같은 문구를 싣는다", () => {
    expect(
      buildCompactDraftPrompt(ctx({ caps: NANO_CAPABILITIES, ...withNetError })),
    ).toContain("after the failing response");
  });

  // 앵커는 인쇄된 실패 응답을 기준점으로 지목한다. 후보가 0건이면(예산 절삭 level≥1이
  // 요약을 전부 떨구는 경로 포함) 존재하지 않는 것을 가리키는 dangling 지시가 된다.
  it("실패 응답 후보가 없으면 양쪽 모두 앵커를 붙이지 않는다", () => {
    expect(buildRichDraftPrompt(ctx())).not.toContain("after the failing response");
    expect(buildCompactDraftPrompt(ctx({ caps: NANO_CAPABILITIES }))).not.toContain(
      "after the failing response",
    );
  });
});

// 실사례 회귀: expectedResult가 "정상 동작 + 실패 시 오류 메시지"를 한 문장에 뭉쳐서
// API만 고쳐지고 FE 오류 UX는 미처리인 채 티켓이 닫혔다. 두 요구를 별도 줄로 분리시킨다.
// compact은 대상이 아니다 — 소형 모델용 SECTION_DESC는 의도적으로 짧게 유지한다.
describe("expectedResult 요구 분리 지시", () => {
  function withExpected(overrides: Partial<AiDraftSessionContext> = {}) {
    return buildRichDraftPrompt(
      ctx({ enabledSections: [{ id: "expectedResult" }], ...overrides }),
    );
  }

  it("en 로케일에서도 싣는다", () => {
    expect(withExpected({ locale: "en" })).toContain("on separate lines");
  });

  // 모드 전수 — 한 모드에서 hint가 빠져도 green이 되는 구멍을 막는다. 새 CaptureMode를
  // 추가하면 이 표가 컴파일 에러로 결정을 요구한다(HAS_FAILURE_PATH와 짝).
  const EXPECT_SPLIT: Record<AiDraftSessionContext["captureMode"], boolean> = {
    element: false,
    screenshot: true,
    video: true,
    freeform: true,
  };
  const MODES = Object.entries(EXPECT_SPLIT) as [
    AiDraftSessionContext["captureMode"],
    boolean,
  ][];

  for (const [mode, expected] of MODES) {
    it(`${mode} 모드: 분리 지시 ${expected ? "붙는다" : "안 붙는다"}`, () => {
      expect(withExpected({ locale: "ko", captureMode: mode }).includes("각각 별도 줄로")).toBe(
        expected,
      );
    });
  }

  it("element 모드: 분리 지시가 빠져도 기존 desired suffix는 유지된다", () => {
    expect(withExpected({ locale: "ko", captureMode: "element" })).toContain(
      "desired 값 기준으로 작성",
    );
  });

  // compact 제외를 주석으로만 남기면 나중에 "대칭 맞추기"로 조용히 유입된다.
  it("compact: 분리 지시를 싣지 않는다 (의도된 비대칭)", () => {
    const p = buildCompactDraftPrompt(
      ctx({ caps: NANO_CAPABILITIES, enabledSections: [{ id: "expectedResult" }] }),
    );
    expect(p).not.toContain("각각 별도 줄로");
    expect(p).not.toContain("on separate lines");
  });
});
