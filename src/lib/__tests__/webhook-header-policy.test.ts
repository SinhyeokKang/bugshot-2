import { describe, expect, it } from "vitest";
import { isSettableHeaderName, isSettableHeaderValue } from "../webhook-header-policy";

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

// 이름 축만 공유 leaf에 있고 값 축은 background 안 인라인 정규식이었다. 그래서 저장 폼이
// 값을 안 봐, 개행이 든 값은 저장은 통과하고 전송 시점에 그 헤더만 조용히 빠졌다 —
// 이 파일 헤더가 막겠다고 선언한 "넣었는데 안 나간다"가 값 축에 그대로 남아 있었다.
describe("isSettableHeaderValue", () => {
  it.each(["Bearer abc", "application/json", "a b c", "ünïcode-latin1"])(
    "보낼 수 있는 값은 통과한다: %s",
    (v) => expect(isSettableHeaderValue(v)).toBe(true),
  );

  it.each([
    ["개행", "abc\ndef"],
    ["캐리지리턴", "abc\rdef"],
    ["CRLF 주입", "abc\r\nX-Evil: 1"],
    ["NUL", "abc\u0000def"],
    ["ByteString 밖(한글)", "토큰"],
  ])("보낼 수 없는 값은 거부한다: %s", (_l, v) => {
    expect(isSettableHeaderValue(v)).toBe(false);
  });

  it("빈 값은 허용한다 — 값 없는 헤더는 유효하다", () => {
    expect(isSettableHeaderValue("")).toBe(true);
  });
});
