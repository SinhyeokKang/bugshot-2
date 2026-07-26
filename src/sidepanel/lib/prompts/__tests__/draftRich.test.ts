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
