import { describe, it, expect } from "vitest";
import { MESSAGE_BYTES_LIMIT, worstCaseSubmitBytes } from "../recordingBudget";
import { VIDEO_BITRATE_BPS, getMaxDuration } from "../../video-recorder";

// 제출은 영상과 logs.html을 **한 sendBg 요청**에 싣는다(submitToJira.ts:34-36 → :52).
// logs.html은 그 영상을 base64로 통째로 다시 품으므로(buildCaptureFiles.ts:65-88) 전송량은
// 영상 바이트의 약 2.33배가 된다. Chromium은 확장 메시지를 64MiB로 자른다.
describe("worstCaseSubmitBytes", () => {
  it("영상 바이트를 base64 팽창 + logs.html 재임베드까지 계산한다", () => {
    // 1MB 영상 → base64 4/3MB(첨부) + 그걸 품은 html을 다시 base64 16/9MB(로그)
    const bytes = worstCaseSubmitBytes(1_000_000);
    expect(bytes).toBeGreaterThan(3_000_000);
    expect(bytes).toBeLessThan(3_200_000);
  });

  it("길이·비트레이트에 선형으로 늘어난다", () => {
    expect(worstCaseSubmitBytes(2_000_000)).toBeCloseTo(worstCaseSubmitBytes(1_000_000) * 2, -3);
  });
});

// 이 테스트가 red면 녹화 상한이나 비트레이트를 올린 쪽이 전송 한도를 깬 것이다.
// 둘 중 하나를 되돌리거나, logs.html의 영상 재임베드를 먼저 떼야 한다.
describe("녹화 설정이 확장 메시지 한도 안에 있다", () => {
  const worstVideoBytes = (getMaxDuration() * VIDEO_BITRATE_BPS) / 8;

  it("최악 길이·비트레이트 녹화의 제출 페이로드가 64MiB를 넘지 않는다", () => {
    expect(worstCaseSubmitBytes(worstVideoBytes)).toBeLessThan(MESSAGE_BYTES_LIMIT);
  });

  // 한도에 붙어 있으면 로그·첨부가 조금만 붙어도 넘는다. 여유를 함께 고정한다.
  it("한도의 80% 아래로 여유를 남긴다", () => {
    expect(worstCaseSubmitBytes(worstVideoBytes)).toBeLessThan(MESSAGE_BYTES_LIMIT * 0.8);
  });
});
