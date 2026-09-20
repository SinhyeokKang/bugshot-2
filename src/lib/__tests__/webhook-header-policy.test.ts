import { describe, expect, it } from "vitest";
import { isSettableHeaderName } from "../webhook-header-policy";

describe("isSettableHeaderName", () => {
  // 브라우저가 거부하는 헤더는 fetch가 조용히 드롭한다(문법 오류만 TypeError).
  // declarativeNetRequest 권한이 없어 우회 수단도 없으므로 저장 시점 거부가 유일한 방어다.
  it.each([
    "Cookie",
    "Cookie2",
    "Host",
    "Content-Length",
    "Origin",
    "Connection",
    "Referer",
    "Date",
    "Via",
    "Proxy-Authorization",
    "Sec-Fetch-Mode",
    "Accept-Encoding",
    "Keep-Alive",
    "Transfer-Encoding",
    "Upgrade",
    "TE",
  ])("%s 는 브라우저가 드롭하므로 거부한다", (name) => {
    expect(isSettableHeaderName(name)).toBe(false);
  });

  it.each(["Authorization", "X-Api-Key", "X-BugShot-Test", "Accept", "X-Tenant"])(
    "%s 는 통과한다",
    (name) => {
      expect(isSettableHeaderName(name)).toBe(true);
    },
  );

  it.each(["cookie", "COOKIE", "cOoKiE", "proxy-authorization", "SEC-FETCH-DEST"])(
    "%s — 대소문자를 무시한다",
    (name) => {
      expect(isSettableHeaderName(name)).toBe(false);
    },
  );

  // 그대로 두면 Headers 생성자가 TypeError를 던져 요청 전체가 죽는다.
  it.each([
    "X Api Key",
    "X-Api:Key",
    "X-Api-Key\n",
    "X-Api-Key\t",
    "한글헤더",
    "",
    "   ",
  ])("%j — 문법 위반 이름은 거부한다", (name) => {
    expect(isSettableHeaderName(name)).toBe(false);
  });

  it("Content-Type은 통과시킨다 — multipart에서 제거하는 책임은 background에 있다", () => {
    expect(isSettableHeaderName("Content-Type")).toBe(true);
  });
});
