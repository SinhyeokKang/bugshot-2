import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
// 아직 미구현 모듈 — import 실패가 첫 red (interface 모드).
import { AI_LOGS_MANUAL } from "../aiLogsManual";
import { pickVideoRecorderMime } from "../video-mime";
// content 레코더 헬퍼를 직접 부른다. 그 파일들의 헤더는 "사이드패널·background가 import하면
// pre-arm 청크가 무력화된다"고 경고하지만 그건 **번들 그래프**(런타임 edge) 얘기이고 테스트는
// 그 그래프에 없다 — trailing-throttle.test.ts가 같은 근거로 이미 그렇게 한다.
import {
  maskBody,
  maskWsFrame,
  type NetworkBodyOmission,
} from "@/content/network-recorder-helpers";
import { ARG_CAP, serializeArgs } from "@/content/console-recorder-helpers";
import type { NetworkStatusKind } from "@/types/network";
import type { LogViewerData } from "@/types/log-viewer";

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

  // 배열 리터럴이면 키가 늘어도 컴파일러가 안 잡는다 — statusKind 케이스와 같은 형태로
  // 타입에서 전수를 강제한다(ARCHITECTURE.md가 "키가 늘면 무음이다"라고 경고하는 그 축).
  it("최상위 데이터 키를 모두 설명한다", () => {
    // 압축 blob은 Omit<…,"meta">다(buildLogsHtml) — meta는 평문 __BUGSHOT_META__ 태그로
    // 따로 나가고 매뉴얼도 그렇게 설명한다. 그 분리를 타입으로 함께 고정한다.
    const ALL_KEYS: Record<keyof Omit<LogViewerData, "meta">, true> = {
      report: true,
      consoleLog: true,
      networkLog: true,
      actionLog: true,
      video: true,
      screenshot: true,
    };
    for (const key of Object.keys(ALL_KEYS)) {
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
  // "raw wire string"으로 못 박으려다 되물렀다 — application/json 본문은 민감 키 히트 여부와
  // 무관하게 maskJsonBody를 거쳐 **재직렬화**되므로 wire 원문과 바이트 동일이 아니다. 계약은
  // "파싱 안 된 문자열이라 한 번 더 parse해야 한다"이지 "바이트 충실"이 아니다.
  it("인라인 바디가 파싱 안 된 문자열임을 명시한다", () => {
    // "JSON.parse" 존재 검사만으론 공허하다 — 상단 Node 디코드 레시피에 이미 있어서,
    // 지키려는 문장을 통째로 지워도 통과한다. 그 문장 자체를 잡는다.
    const claim = AI_LOGS_MANUAL.split("\n")
      .join(" ")
      .match(/an\s+inlined body is a string[^]*?formatting is ours\./)?.[0];
    expect(claim).toBeTruthy();
    expect(claim).toContain("never a parsed object");
    expect(claim).toContain("JSON.parse");
    expect(claim).toMatch(/re-serializes/i);
  });

  // logToCodeBlock.ts: pretty-print한 뒤 16384자에서 자른다(들여쓰기가 예산을 먹어 원본의
  // 절반 이하만 남는다). 그런데 매뉴얼은 그 절삭된 표면(report.copy.markdown)을 읽으라고
  // 권하고 있었다 — 권유와 함정이 같은 문단에 있던 셈이다.
  it("본문 섹션 코드블럭 절삭과 원본 위치를 안내한다", () => {
    // 두 키 토큰은 최상위 키 목록에 원래부터 있어 존재 검사만으로는 공허하다 — 경고 문단
    // 자체를 잡아 그 안에서 둘을 다 짚는지 본다.
    const caution = AI_LOGS_MANUAL.split("\n")
      .join(" ")
      .match(/Caution: a log code block[^]*?authoritative\./)?.[0];
    expect(caution).toBeTruthy();
    expect(caution).toContain("…(truncated)");
    expect(caution).toContain("networkLog.requests[]");
    expect(caution).toContain("consoleLog.entries[]");
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
  it("마스킹 두 형식을 안내한다", () => {
    expect(AI_LOGS_MANUAL).toContain("***[len:N]");
    expect(AI_LOGS_MANUAL).toContain("masked: true");
    // masked 플래그는 액션 value 축에만 붙는다(accessibleName·fieldLabel은 플래그 없이 ***)
    // — 부재를 "진짜 값"으로 읽으면 안 된다.
    expect(/absence does not make/i.test(AI_LOGS_MANUAL)).toBe(true);
  });

  // 여기부터는 **문구가 아니라 동작을 재고**, 그 결과와 매뉴얼 문장을 함께 단언한다.
  // 이 파일의 나머지 단언은 전부 문자열 존재 검사라 구현이 갈려도 green이다 — 실제로 이
  // 매뉴얼을 정정하는 과정에서 세 라운드 연속으로 틀린 문장이 새로 들어갔고, 매번 그물이
  // 아니라 사람 리뷰가 잡았다. statusKind 케이스(아래)가 이 파일에서 유일하게 구현에 묶인
  // 선례였고, 이 describe가 그 형태를 마스킹·영상 축으로 넓힌다.
  describe("매뉴얼의 주장을 구현으로 검증한다", () => {
    it("바디 마스킹 범위: JSON은 content-type 없이도, form-encoded는 선언될 때만", () => {
      // 매뉴얼: "any payload that parses as JSON, or a form-encoded one that declares
      // its content type". 세 경로 중 하나라도 지우거나 넓히면 여기서 갈린다.
      expect(maskBody('{"token":"abc"}', "text/plain")).toContain("***");
      expect(maskBody('{"token":"abc"}', "application/json")).toContain("***");
      expect(maskBody("token=abc", "application/x-www-form-urlencoded")).toContain("***");
      expect(maskBody("token=abc", "text/plain")).toBe("token=abc");
      expect(/parses as JSON/i.test(AI_LOGS_MANUAL)).toBe(true);
      expect(/declares its content type/i.test(AI_LOGS_MANUAL)).toBe(true);
    });

    it("WebSocket 텍스트 프레임도 같은 마스킹을 거친다", () => {
      expect(maskWsFrame('{"token":"abc"}')).toContain("***");
      expect(/WebSocket text frames/i.test(AI_LOGS_MANUAL)).toBe(true);
    });

    // 매뉴얼이 "nested up to ten levels"라고 상한을 밝힌다 — maskJsonBody가 depth > 10에서
    // 서브트리를 그대로 통과시키므로 그 밖의 token은 원문으로 남는다.
    // 경계값으로 재야 한다 — nest(3)/nest(12)로는 guard의 **존재**만 잡히고 상한을 5나 15로
    // 바꿔도 green이라, 매뉴얼이 말하는 "ten"은 아무것에도 안 묶인다(POSTMORTEM 2026-08-16
    // "상수로 바꿨을 때 여전히 통과하면 그 축은 안 재고 있다").
    it("중첩 마스킹 상한이 문구가 말하는 열 단계와 같다", () => {
      const nest = (depth: number): unknown =>
        depth === 0 ? { token: "abc" } : { a: nest(depth - 1) };
      const masked = (depth: number) =>
        maskBody(JSON.stringify(nest(depth)), "application/json");
      expect(masked(10)).toContain("***");
      expect(masked(11)).toContain("abc");
      expect(/ten levels/i.test(AI_LOGS_MANUAL)).toBe(true);
    });

    // 30s 리플레이만 항상 MP4다 — 탭·화면 녹화는 브라우저가 mp4를 못 muxing하면 webm으로
    // 떨어진다. 매뉴얼이 "MP4 (H.264)"로 단정하던 걸 이 폴백이 거짓으로 만든다.
    it("녹화 컨테이너가 webm으로 떨어질 수 있음을 밝힌다", () => {
      expect(pickVideoRecorderMime((m) => m.startsWith("video/mp4"))).toContain("mp4");
      expect(pickVideoRecorderMime((m) => m.startsWith("video/webm"))).toContain("webm");
      expect(/WebM/i.test(AI_LOGS_MANUAL)).toBe(true);
      expect(/data: prefix/i.test(AI_LOGS_MANUAL)).toBe(true);
    });

    // console args는 캡처 시점에 ARG_CAP으로 잘리고 ConsoleLog엔 그걸 알리는 필드가 없다.
    // 코드블럭 캡(MAX_CHARS)보다 작아서 "코드블럭만 잘린다"는 서술이 console엔 거짓이다.
    // 매뉴얼이 AI에게 "이 리터럴을 찾아라"라고 지시하는 가장 실행적인 주장인데, 생산자를
    // 안 묶으면 마커를 바꾸는 순간 매뉴얼만 거짓이 된다. MAX_CHARS는 미export라 소스를 읽는다
    // (log-cap-sync.test.ts가 같은 형태로 복제 상수를 대조한다).
    it("절삭 마커가 생산자와 같은 문자열이다", () => {
      const src = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "logToCodeBlock.ts"),
        "utf8",
      );
      expect(src).toContain("export function serializeNetworkRequest");
      const marker = src.match(/\$\{s\.slice\(0, MAX_CHARS\)\}(.+?)`/)?.[1];
      expect(marker).toBe("…(truncated)");
      expect(AI_LOGS_MANUAL).toContain(marker!);
    });

    // 닫힌 union을 손열거한 자리는 statusKind처럼 컴파일러가 전수를 강제하게 한다 —
    // 다섯 번째 variant가 늘면 매뉴얼만 조용히 갈린다.
    it("body 변종 4종을 빠짐없이 열거한다", () => {
      const ALL: Record<NetworkBodyOmission["kind"], true> = {
        truncated: true,
        binary: true,
        stream: true,
        omitted: true,
      };
      for (const kind of Object.keys(ALL)) {
        expect(AI_LOGS_MANUAL).toContain(`\"${kind}\"`);
      }
    });

    it("console args가 캡처 시점에 잘린다는 사실이 문구와 맞다", () => {
      // 매뉴얼은 "캡처 시점에 잘리고 ...로 끝난다"만 주장한다. 코드블럭 캡(MAX_CHARS)과의
      // 대소는 주장 밖이라 여기서 재지 않는다 — 그 숫자를 적어두면 미export 상수의 복제본이 된다.
      expect(serializeArgs(["x".repeat(ARG_CAP + 100)]).endsWith("...")).toBe(true);
      expect(/capped at\s*capture time/i.test(AI_LOGS_MANUAL.replace(/\n/g, " "))).toBe(
        true,
      );
    });
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
