import { describe, expect, it } from "vitest";
import { WebhookUrlError, normalizeWebhookUrl } from "../webhook-url-policy";

function reject(input: string): string {
  try {
    normalizeWebhookUrl(input);
  } catch (e) {
    return (e as WebhookUrlError).reason;
  }
  throw new Error(`거부돼야 하는데 통과함: ${input}`);
}

describe("normalizeWebhookUrl", () => {
  describe("https", () => {
    it("path·query를 보존한다 — GitLab normalizeInstanceUrl처럼 origin만 남기면 안 된다", () => {
      const v = normalizeWebhookUrl("https://bugs.acme.io/intake?x=1");
      expect(v.url).toBe("https://bugs.acme.io/intake?x=1");
      expect(v.plaintext).toBe(false);
    });

    it("스킴이 없으면 https를 보정한다", () => {
      expect(normalizeWebhookUrl("bugs.acme.io/intake").url).toBe("https://bugs.acme.io/intake");
    });

    it("대문자 스킴·앞뒤 공백을 정규화한다", () => {
      expect(normalizeWebhookUrl("  HTTPS://bugs.acme.io/intake  ").url)
        .toBe("https://bugs.acme.io/intake");
    });

    it("포트를 보존한다", () => {
      expect(normalizeWebhookUrl("https://bugs.acme.io:8443/intake").url)
        .toBe("https://bugs.acme.io:8443/intake");
    });
  });

  describe("http — 네트워크 경계 안만 허용", () => {
    it.each([
      "http://192.168.1.50:8080/intake",
      "http://10.0.0.5",
      "http://172.16.0.1",
      "http://172.31.255.254",
      "http://169.254.1.1",
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://[::1]",
      "http://tracker.internal",
      "http://tracker.local",
      "http://tracker",
    ])("%s 는 통과하고 평문 표식이 붙는다", (input) => {
      expect(normalizeWebhookUrl(input).plaintext).toBe(true);
    });

    it.each([
      "http://bugs.acme.io/intake",
      "http://172.15.0.1",
      "http://172.32.0.1",
      "http://11.0.0.1",
      "http://8.8.8.8",
    ])("%s 는 공인망 평문이라 거부한다", (input) => {
      expect(reject(input)).toBe("insecure-public");
    });
  });

  describe("IPv6 사설 대역", () => {
    it.each(["http://[fd00::1]/hook", "http://[fc00::5]", "http://[fe80::1]"])(
      "%s 는 사내망이라 통과한다",
      (input) => {
        expect(normalizeWebhookUrl(input).plaintext).toBe(true);
      },
    );

    it("공인 IPv6 평문은 거부한다", () => {
      expect(reject("http://[2001:db8::1]/hook")).toBe("insecure-public");
    });
  });

  describe("거부", () => {
    it.each([
      "https://user:pass@bugs.acme.io/intake",
      "https://user@bugs.acme.io/intake",
    ])("%s — URL에 박힌 자격증명은 거부한다", (input) => {
      // 통과시키면 Request 생성자가 TypeError를 던져 원인 불명 "network" 실패가 되고,
      // 비밀번호가 저장소에 URL 문자열로 남는다.
      expect(reject(input)).toBe("credentials");
    });

    it.each(["ftp://x", "javascript:alert(1)", "data:text/plain,x", "file:///etc/passwd"])(
      "%s 는 지원 스킴이 아니다",
      (input) => {
        expect(["scheme", "invalid"]).toContain(reject(input));
      },
    );

    it.each(["", "   ", "https://", "http://"])("%j 는 URL로 성립하지 않는다", (input) => {
      expect(["invalid", "scheme"]).toContain(reject(input));
    });
  });
});
