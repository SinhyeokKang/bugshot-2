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
// actionLog에 남은 실패 응답 *이전*의 성공 토스트를 결과로 읽은 것. 사람이 지라에서
// "실패 알림"으로 고쳐야 했다 — 시점 앵커가 프롬프트에 없으면 재발한다.
describe("제목 결과 판정의 시점 앵커", () => {
  it("rich: 실패 응답 이후 관측만 결과로 판정하라는 지시가 있다", () => {
    expect(buildRichDraftPrompt(ctx())).toContain("after the failing response");
  });

  it("compact: 같은 앵커를 싣는다 (스타일 간 대칭)", () => {
    expect(buildCompactDraftPrompt(ctx({ caps: NANO_CAPABILITIES }))).toContain(
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

  it("ko: 정상 동작과 실패 시 오류 안내를 별도 줄로 쓰라고 지시한다", () => {
    expect(withExpected({ locale: "ko" })).toContain("각각 별도 줄로");
  });

  it("en: 같은 지시를 영문 로케일에서도 싣는다", () => {
    expect(withExpected({ locale: "en" })).toContain("on separate lines");
  });

  // MODE_HINTS가 expectedResult 뒤에 " (desired 값 기준으로 작성)"을 붙인다.
  // base 문장이 길어져도 suffix가 밀려나거나 잘리지 않아야 한다.
  it("element 모드: desired suffix와 분리 지시가 공존한다", () => {
    const p = withExpected({ locale: "ko", captureMode: "element" });
    expect(p).toContain("각각 별도 줄로");
    expect(p).toContain("desired 값 기준으로 작성");
  });
});
