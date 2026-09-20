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

    it("루트 경로의 후행 슬래시를 떼어낸다 — 입력값과 저장값이 갈리지 않게", () => {
      expect(normalizeWebhookUrl("https://bugs.acme.io").url).toBe("https://bugs.acme.io");
      expect(normalizeWebhookUrl("https://bugs.acme.io/").url).toBe("https://bugs.acme.io");
    });

    it("query·hash가 있으면 후행 슬래시를 건드리지 않는다 — 값 안의 슬래시가 잘린다", () => {
      expect(normalizeWebhookUrl("https://bugs.acme.io/?path=a/").url)
        .toBe("https://bugs.acme.io/?path=a/");
      expect(normalizeWebhookUrl("https://bugs.acme.io/#a/").url)
        .toBe("https://bugs.acme.io/#a/");
    });

    it("루트가 아닌 경로의 슬래시는 사용자가 쓴 그대로 둔다", () => {
      expect(normalizeWebhookUrl("https://bugs.acme.io/intake/").url)
        .toBe("https://bugs.acme.io/intake/");
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

// 아래 둘은 실제 입력에서 걸린 축이다. 실패 방향이 전부 "거부"라 보안 구멍은 아니지만,
// 사용자가 정당하게 쓰는 주소가 저장조차 안 되는 기능 제약으로 나온다.
describe("normalizeWebhookUrl — 스킴 추론과 사설망 판정의 사각", () => {
  it.each([
    ["bugs.acme.io:8443/intake", "https://bugs.acme.io:8443/intake"],
    ["192.168.1.50:8080/intake", "http://192.168.1.50:8080/intake"],
  ])("스킴 없는 host:port를 스킴으로 오인하지 않는다: %s", (input, _expected) => {
    // `/^[a-z][a-z0-9+.-]*:/`는 `bugs.acme.io:`를 스킴으로 읽어 scheme 거부를 냈다.
    // 스킴 판정에는 `//`가 따라와야 한다.
    expect(() => normalizeWebhookUrl(input)).not.toThrow();
  });

  it("스킴 없는 host:port는 https로 보정된다", () => {
    const v = normalizeWebhookUrl("bugs.acme.io:8443/intake");
    expect(v.url).toBe("https://bugs.acme.io:8443/intake");
    expect(v.plaintext).toBe(false);
  });

  it.each(["javascript:alert(1)", "data:text/html,x"])(
    "`//`가 없는 위험 스킴은 여전히 거부한다: %s",
    (input) => {
      expect(["invalid", "scheme"]).toContain(reject(input));
    },
  );

  it.each([
    ["http://0.0.0.0:3000/hook", "0.0.0.0/8 — 로컬 바인드 주소"],
    ["http://100.64.0.1/hook", "CGNAT 100.64/10 — 사내망에서 쓰인다"],
    ["http://localhost./hook", "후행 점이 붙은 localhost"],
    ["http://[::ffff:127.0.0.1]/hook", "IPv4-mapped IPv6 루프백"],
  ])("사설·로컬로 봐야 하는 평문 호스트를 통과시킨다: %s (%s)", (input) => {
    const v = normalizeWebhookUrl(input);
    expect(v.plaintext).toBe(true);
  });

  it("공인망 평문은 여전히 거부한다 (위 확장이 구멍을 내지 않았다)", () => {
    expect(reject("http://bugs.acme.io/intake")).toBe("insecure-public");
    expect(reject("http://100.128.0.1/hook")).toBe("insecure-public");
    expect(reject("http://1.0.0.1/hook")).toBe("insecure-public");
  });
});
