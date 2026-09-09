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

  // 아래 4건은 매뉴얼이 **실제 데이터 형태와 어긋나 있던** 자리를 못 박는다. 이 상수는 타입
  // 파생이 아니라 손유지 미러라(ARCHITECTURE.md:304 "키가 늘면 무음이다") 코드가 앞서가면
  // 조용히 거짓이 되고, logs.html에 박히고 나면 소급 수정이 안 된다.

  // types/network.ts: NetworkRequestBody = string | { kind: … }. 인라인된 쪽은 파싱 안 된
  // 원문이라 소비자가 봉투를 푼 뒤 JSON.parse를 한 번 더 해야 하는데 그 말이 없었다.
  it("인라인 바디가 raw 문자열임을 명시한다", () => {
    expect(AI_LOGS_MANUAL).toContain("JSON.parse");
    expect(/raw wire string/i.test(AI_LOGS_MANUAL)).toBe(true);
  });

  // logToCodeBlock.ts: pretty-print한 뒤 16384자에서 자른다(들여쓰기가 예산을 먹어 원본의
  // 절반 이하만 남는다). 그런데 매뉴얼은 그 절삭된 표면(report.copy.markdown)을 읽으라고
  // 권하고 있었다 — 권유와 함정이 같은 문단에 있던 셈이다.
  it("본문 섹션 코드블럭 절삭과 원본 위치를 안내한다", () => {
    expect(AI_LOGS_MANUAL).toContain("(truncated)");
    expect(AI_LOGS_MANUAL).toContain("networkLog.requests[]");
  });

  // buildCaptureFiles.ts: video 키는 captureMode "video" 공용이고 그건 탭 녹화·화면 녹화·
  // 30s 리플레이 3경로다. "30s screen replay"로 단정하면 AI가 30초 경계를 가정해 시간축을 틀린다.
  it("video가 탭·화면 녹화까지 포함함을 밝힌다 (30s 단정 금지)", () => {
    expect(/tab recording/i.test(AI_LOGS_MANUAL)).toBe(true);
    expect(/screen recording/i.test(AI_LOGS_MANUAL)).toBe(true);
  });

  // 마스킹은 헤더·바디·액션값·URL 4면인데 헤더 형식만 적혀 있었다. 바디의 "token": "***"를
  // 서버가 리터럴 ***를 반환한 버그로 오진하는 경로가 열려 있었다(privacy 문서는 이미 정확 —
  // 사용자에겐 고지됐는데 logs.html을 읽는 AI에게만 안 알려주던 상태).
  it("마스킹 면과 두 형식을 안내한다", () => {
    expect(AI_LOGS_MANUAL).toContain("***[len:N]");
    expect(AI_LOGS_MANUAL).toContain("masked: true");
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
