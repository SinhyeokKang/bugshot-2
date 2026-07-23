import { describe, it, expect } from "vitest";
import { digestResponseShape } from "../responseDigest";
import type { NetworkRequestBody } from "@/types/network";

const JSON_CT = "application/json";

describe("digestResponseShape — shape 다이제스트 (키·타입, 값 제외)", () => {
  it("최상위 객체 → key:type 나열, 값 없음", () => {
    const d = digestResponseShape('{"items":[],"total":0,"order_status":"SHIPPED"}', JSON_CT);
    expect(d).toBeDefined();
    expect(d).toContain("items:arr[0]");
    expect(d).toContain("total:num");
    expect(d).toContain("order_status:str");
    expect(d).not.toContain("SHIPPED"); // 값 부재
  });

  it("null 값 → null 타입 표기", () => {
    const d = digestResponseShape('{"coupon":null}', JSON_CT);
    expect(d).toContain("coupon:null");
  });

  it("중첩 객체/배열 → obj / arr[N] 축약 (depth 1)", () => {
    const d = digestResponseShape('{"user":{"a":1,"b":2},"tags":["x","y","z"]}', JSON_CT);
    expect(d).toContain("user:obj");
    expect(d).toContain("tags:arr[3]");
    expect(d).not.toContain("x"); // 중첩 값 부재
  });

  it("최상위 배열 → arr[N]", () => {
    const d = digestResponseShape('[1,2,3]', JSON_CT);
    expect(d).toBe("arr[3]");
  });

  it("마스킹된 json({\"token\":\"***\"}) → 파싱 성공, 타입 str", () => {
    const d = digestResponseShape('{"token":"***"}', JSON_CT);
    expect(d).toContain("token:str");
  });

  it("스키마성 키(식별자)는 등장하나 값은 절대 등장하지 않음 (프라이버시 잠금)", () => {
    const d = digestResponseShape('{"secret":"p@ssw0rd-XYZ","email":"a@b.com"}', JSON_CT);
    expect(d).toContain("secret:str"); // secret·email은 식별자 패턴 → 스키마 키로 유지
    expect(d).toContain("email:str");
    expect(d).not.toContain("p@ssw0rd");
    expect(d).not.toContain("a@b.com");
  });

  it("데이터성 키(이메일·UUID·공백)는 <key>로 redact — 맵형 응답 PII 방어", () => {
    const d = digestResponseShape(
      '{"john@corp.com":1,"550e8400-e29b-41d4-a716-446655440000":2,"a b":3}',
      JSON_CT,
    );
    expect(d).not.toContain("john@corp.com");
    expect(d).not.toContain("550e8400");
    expect(d).toContain("<key>:num"); // 타입은 유지, 키는 가림
  });

  it("스키마 키(order_id·orderStatus)는 그대로 인쇄", () => {
    const d = digestResponseShape('{"order_id":1,"orderStatus":"X"}', JSON_CT);
    expect(d).toContain("order_id:num");
    expect(d).toContain("orderStatus:str");
  });

  it("최상위 primitive(top-level true/123/\"OK\") → undefined", () => {
    expect(digestResponseShape("123", JSON_CT)).toBeUndefined();
    expect(digestResponseShape("true", JSON_CT)).toBeUndefined();
    expect(digestResponseShape('"OK"', JSON_CT)).toBeUndefined();
  });

  it("비-json contentType → undefined", () => {
    expect(digestResponseShape('{"a":1}', "text/html")).toBeUndefined();
    expect(digestResponseShape('{"a":1}', "")).toBeUndefined();
  });

  it("omission 변종(binary/truncated/stream/omitted) → undefined", () => {
    const variants: NetworkRequestBody[] = [
      { kind: "binary", contentType: "image/png", size: 100 },
      { kind: "truncated", limit: 10, size: 999 },
      { kind: "stream", contentType: JSON_CT },
      { kind: "omitted", reason: "memory-cap" },
    ];
    for (const v of variants) {
      expect(digestResponseShape(v, JSON_CT)).toBeUndefined();
    }
    expect(digestResponseShape(undefined, JSON_CT)).toBeUndefined();
  });

  it("파싱 실패(비정형 본문) → undefined (크래시 없음)", () => {
    expect(digestResponseShape("{not json", JSON_CT)).toBeUndefined();
    expect(digestResponseShape("", JSON_CT)).toBeUndefined();
  });

  it("대형 객체(수백 키) → 캡 발동으로 bounded 출력", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 300; i++) obj[`field_${i}`] = i;
    const d = digestResponseShape(JSON.stringify(obj), JSON_CT);
    expect(d).toBeDefined();
    expect(d!.length).toBeLessThan(600); // 무한 팽창 방지 (정확한 캡값은 구현 재량)
  });
});
