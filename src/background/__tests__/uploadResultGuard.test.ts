import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// per-file 격리 업로드 핸들러 3개는 `{ok:true}`를 세우기 전에 locator(url·gid)가 실제로
// 있는지 봐야 한다. 타입은 `string`이라 컴파일은 통과하지만 값은 **미검증 API 응답**이고,
// 비면 소비처가 `href: undefined`·`gid: undefined`를 이슈 본문에 문자열로 박는다
// (gitlab만 이 가드가 없어 `body.split(old).join(undefined)`가 "undefined"를 남겼다).
//
// 이 그물이 소스 스캔인 이유: 핸들러는 `chrome.runtime.onMessage` 라우터 안이라 유닛으로
// 못 부르고, 소비처(`submitToX`) 테스트는 background가 무엇을 세웠는지 못 본다. 겨냥하는
// 것은 로직이 아니라 **호출부 누락**이다(connect-reason-coverage.test.ts와 같은 형태).
const SOURCE = readFileSync(
  join(process.cwd(), "src/background/messages.ts"),
  "utf8",
);

// locator를 실은 성공 push. 새 플랫폼이 per-file 격리 업로드를 추가하면 여기에 잡힌다.
const OK_PUSH_RE = /results\.push\(\{\s*ok:\s*true,[^}]*\}\)/g;

describe("업로드 결과 판별자 — locator 없는 성공 금지", () => {
  const okPushes = [...SOURCE.matchAll(OK_PUSH_RE)].map((m) => m[0]);

  // 스캔 대상이 비면 아래 검사가 항진명제다(POSTMORTEM 2026-08-19).
  it("스캔이 성공 push를 실제로 찾는다 (앵커)", () => {
    expect(okPushes.length).toBeGreaterThanOrEqual(3);
  });

  it("모든 성공 push가 locator 가드 뒤에 온다", () => {
    const unguarded = okPushes.filter((push) => {
      const at = SOURCE.indexOf(push);
      // 같은 줄 앞부분만 본다 — 세 핸들러 모두 `if (locator) results.push(...)` 한 줄 형태다.
      const lineStart = SOURCE.lastIndexOf("\n", at) + 1;
      return !/\bif\s*\(\s*\w+\s*\)\s*$/.test(SOURCE.slice(lineStart, at));
    });

    expect(unguarded).toEqual([]);
  });

  it("catch 분기도 ok:false를 push한다 (결과 배열의 1:1 순서 불변식)", () => {
    // 소비처가 결과 배열을 **입력 files와 같은 인덱스**로 읽는다(submitToAsana의
    // userAttachmentStart 경계가 그 위에 서 있다). 예외 분기가 push를 빠뜨리면 결과가
    // 한 칸 밀려 사용자 첨부가 캡처 자리로 들어가고, 그건 어느 유닛 테스트에도 안 걸린다.
    const catchPushes =
      SOURCE.match(/\}\s*catch\s*\{\s*results\.push\(\{\s*ok:\s*false,/g) ?? [];
    expect(catchPushes.length).toBe(okPushes.length);
  });

  it("가드 실패 분기가 ok:false를 남긴다 (무음 누락 금지)", () => {
    // `if (locator) push(ok:true)`만 있고 else가 없으면 그 파일이 결과 배열에서 통째로
    // 사라져 소비처의 per-file 대응이 어긋난다.
    const elseFalse = SOURCE.match(/else results\.push\(\{\s*ok:\s*false,/g) ?? [];
    expect(elseFalse.length).toBe(okPushes.length);
  });
});
