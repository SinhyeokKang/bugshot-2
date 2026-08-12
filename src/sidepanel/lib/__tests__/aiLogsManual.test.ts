import { describe, expect, it } from "vitest";
// 아직 미구현 모듈 — import 실패가 첫 red (interface 모드).
import { AI_LOGS_MANUAL } from "../aiLogsManual";
import type { NetworkStatusKind } from "@/types/network";

describe("AI_LOGS_MANUAL", () => {
  it("비어있지 않은 문자열", () => {
    expect(typeof AI_LOGS_MANUAL).toBe("string");
    expect(AI_LOGS_MANUAL.length).toBeGreaterThan(0);
  });

  it("리터럴 </script 미포함 — script 태그 조기 종료 방지 (대소문자 무시)", () => {
    expect(AI_LOGS_MANUAL.toLowerCase()).not.toContain("</script");
  });

  it("데이터 위치·디코드 핵심 토큰 포함", () => {
    for (const token of [
      "__BUGSHOT_DATA__",
      "__BUGSHOT_META__",
      "base64",
      "epoch",
    ]) {
      expect(AI_LOGS_MANUAL).toContain(token);
    }
  });

  it("gzip 해제를 안내한다 (gzip 또는 gunzip)", () => {
    expect(/gzip|gunzip/i.test(AI_LOGS_MANUAL)).toBe(true);
  });

  it("최상위 데이터 키를 모두 설명한다", () => {
    for (const key of [
      "report",
      "consoleLog",
      "networkLog",
      "actionLog",
      "video",
      "screenshot",
    ]) {
      expect(AI_LOGS_MANUAL).toContain(key);
    }
  });

  it("self-match 회피: 레시피가 base64 문자셋 앵커를 쓴다", () => {
    // 매뉴얼은 데이터(<body>)보다 앞(<head>)에 있고 본문에 레시피 텍스트를 포함하므로
    // 첫-매치 정규식이면 매뉴얼 자신을 잡아 실패한다 → base64 문자셋으로 캡처해야 함.
    expect(AI_LOGS_MANUAL).toContain("[A-Za-z0-9+/=");
  });

  it("self-match 회피: 첫-매치 캡처 패턴([^<]*)을 쓰지 않는다", () => {
    expect(AI_LOGS_MANUAL).not.toContain("([^<]*)");
  });

  it("코드 실행 불가 AI용 fallback 안내 포함", () => {
    expect(AI_LOGS_MANUAL.toLowerCase()).toContain("ask the user");
  });

  it("로그 캡(truncation) 신호를 안내한다", () => {
    expect(AI_LOGS_MANUAL).toContain("warnings");
    expect(/totalSeen|captured/.test(AI_LOGS_MANUAL)).toBe(true);
  });

  it("createdAt이 ISO 문자열(epoch 아님)임을 명시한다", () => {
    expect(AI_LOGS_MANUAL).toContain("createdAt");
    expect(/ISO/i.test(AI_LOGS_MANUAL)).toBe(true);
  });

  it("출력 언어를 사용자 언어로 위임한다", () => {
    expect(AI_LOGS_MANUAL.toLowerCase()).toContain("user's language");
  });

  // 이 매뉴얼은 닫힌 enum을 전부 열거하는 관례다. 값을 손으로 적어둔 문자열이라 union이 늘면
  // 조용히 갈리는데, logs.html에 박히고 나면 소급 수정이 안 된다.
  it("statusKind 값 5종을 빠짐없이 열거한다", () => {
    // 배열 리터럴이면 union이 늘어도 컴파일러가 안 잡는다 — Record로 전수를 강제한다.
    const ALL_KINDS: Record<NetworkStatusKind, true> = {
      networkError: true,
      aborted: true,
      timeout: true,
      queued: true,
      queueFull: true,
    };
    const kinds = Object.keys(ALL_KINDS) as NetworkStatusKind[];
    expect(AI_LOGS_MANUAL).toContain("statusKind");
    for (const kind of kinds) expect(AI_LOGS_MANUAL).toContain(kind);
  });
});
