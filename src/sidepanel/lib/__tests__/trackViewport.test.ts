import { describe, it, expect } from "vitest";
import { trackViewport } from "../trackViewport";

// getDisplayMedia 스트림의 video track settings에서 해상도를 뽑는 순수 헬퍼.
// 화면 녹화 viewport 메타용 — settings가 width/height를 안 주면 undefined(현재 탭 폴백 금지).
function fakeStream(settings: MediaTrackSettings | null): MediaStream {
  const tracks = settings === null ? [] : [{ getSettings: () => settings }];
  return { getVideoTracks: () => tracks } as unknown as MediaStream;
}

describe("trackViewport", () => {
  it("video track settings의 width/height를 반환", () => {
    expect(trackViewport(fakeStream({ width: 1920, height: 1080 }))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("0 값도 유효 좌표로 통과(누락과 구분)", () => {
    expect(trackViewport(fakeStream({ width: 0, height: 0 }))).toEqual({
      width: 0,
      height: 0,
    });
  });

  it("video track이 없으면 undefined", () => {
    expect(trackViewport(fakeStream(null))).toBeUndefined();
  });

  it("settings에 width/height가 없으면 undefined", () => {
    expect(trackViewport(fakeStream({}))).toBeUndefined();
  });

  it("width만 있고 height가 없으면 undefined", () => {
    expect(trackViewport(fakeStream({ width: 1280 }))).toBeUndefined();
  });
});
