import { describe, expect, it } from "vitest";
import { InstanceUrlError, normalizeInstanceUrl } from "../gitlabInstanceUrl";

describe("normalizeInstanceUrl", () => {
  it("빈 값 / 공백 → https://gitlab.com 폴백", () => {
    expect(normalizeInstanceUrl("")).toBe("https://gitlab.com");
    expect(normalizeInstanceUrl("   ")).toBe("https://gitlab.com");
  });

  it("trailing slash 제거", () => {
    expect(normalizeInstanceUrl("https://gitlab.com/")).toBe(
      "https://gitlab.com",
    );
    expect(normalizeInstanceUrl("https://gitlab.example.com///")).toBe(
      "https://gitlab.example.com",
    );
  });

  it("스킴 없는 입력은 https:// 부착", () => {
    expect(normalizeInstanceUrl("gitlab.example.com")).toBe(
      "https://gitlab.example.com",
    );
  });

  it("gitlab.com 변형들은 동일한 canonical 값으로 정규화 (gitlab.com 판별)", () => {
    const canonical = "https://gitlab.com";
    expect(normalizeInstanceUrl("gitlab.com")).toBe(canonical);
    expect(normalizeInstanceUrl("https://gitlab.com")).toBe(canonical);
    expect(normalizeInstanceUrl("https://gitlab.com/")).toBe(canonical);
  });

  it("앞뒤 공백은 trim", () => {
    expect(normalizeInstanceUrl("  https://gitlab.example.com  ")).toBe(
      "https://gitlab.example.com",
    );
  });

  it("호스트 없는 무효 입력은 throw (폼이 catch)", () => {
    expect(() => normalizeInstanceUrl("https://")).toThrow();
  });

  // PAT 평문 전송 방지 — 이 강제가 풀리면 http://gitlab.com이 self-managed로 오분류돼 토큰이 평문으로 나간다.
  it("http://gitlab.com은 https로 강제한다 (PAT 평문 전송 차단)", () => {
    expect(normalizeInstanceUrl("http://gitlab.com")).toBe("https://gitlab.com");
    expect(normalizeInstanceUrl("HTTP://GitLab.com/")).toBe("https://gitlab.com");
  });

  // 사내 self-managed에도 http를 허용하면 `api` 전체 스코프 PAT가 Authorization 헤더에
  // 평문으로 나간다. loopback만 예외(개발용 로컬 인스턴스).
  it("사내 self-managed의 평문 http는 거부한다 (PAT 평문 전송 차단)", () => {
    expect(() => normalizeInstanceUrl("http://gitlab.internal.example")).toThrow(
      InstanceUrlError,
    );
    try {
      normalizeInstanceUrl("http://gitlab.corp");
    } catch (e) {
      expect((e as InstanceUrlError).reason).toBe("insecure");
    }
  });

  it("loopback http는 예외로 허용한다 (로컬 인스턴스)", () => {
    expect(normalizeInstanceUrl("http://localhost:8929")).toBe("http://localhost:8929");
    expect(normalizeInstanceUrl("http://127.0.0.1:8929")).toBe("http://127.0.0.1:8929");
  });

  it("무효 입력은 reason=invalid로 구분된다 (안내 문구가 갈린다)", () => {
    try {
      normalizeInstanceUrl("https://");
    } catch (e) {
      expect((e as InstanceUrlError).reason).toBe("invalid");
    }
  });

  it("호스트 없는 무효 입력은 throw", () => {
    expect(() => normalizeInstanceUrl("https://")).toThrow();
  });
});
