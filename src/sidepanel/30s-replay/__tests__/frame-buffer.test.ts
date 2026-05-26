import { describe, expect, it } from "vitest";
import { FrameBuffer } from "../frame-buffer";

const blob = () => new Blob(["x"], { type: "image/jpeg" });

describe("FrameBuffer", () => {
  describe("push — maxFrames 순환", () => {
    it("기본 maxFrames(60)까지 채우면 size=60", () => {
      const fb = new FrameBuffer();
      for (let i = 0; i < 60; i++) fb.push(blob(), i);
      expect(fb.size).toBe(60);
    });

    it("maxFrames 초과 push 시 oldest 제거 (size 유지)", () => {
      const fb = new FrameBuffer();
      for (let i = 0; i < 61; i++) fb.push(blob(), i);
      expect(fb.size).toBe(60);
    });

    it("oldest 제거 시 가장 먼저 들어온 프레임이 빠진다", () => {
      const fb = new FrameBuffer(3, 30000);
      fb.push(blob(), 10);
      fb.push(blob(), 20);
      fb.push(blob(), 30);
      fb.push(blob(), 40); // 10 제거
      const frames = fb.snapshot();
      expect(frames.map((f) => f.timestamp)).toEqual([20, 30, 40]);
    });
  });

  describe("push — maxDurationMs 시간 기반 제거", () => {
    it("현재 timestamp - maxDurationMs보다 오래된 프레임 제거", () => {
      const fb = new FrameBuffer(100, 1000);
      fb.push(blob(), 0);
      fb.push(blob(), 500);
      fb.push(blob(), 1200); // 임계값 200 → t=0 제거, t=500 유지
      expect(fb.snapshot().map((f) => f.timestamp)).toEqual([500, 1200]);
    });

    it("정확히 cutoff와 같은 timestamp 프레임은 유지 (strict <)", () => {
      const fb = new FrameBuffer(100, 1000);
      fb.push(blob(), 200);
      fb.push(blob(), 1200); // cutoff = 200 → t=200은 < 아님 → 유지
      expect(fb.snapshot().map((f) => f.timestamp)).toEqual([200, 1200]);
    });
  });

  describe("push — maxFrames + maxDurationMs 동시 적용", () => {
    it("duration 내라도 maxFrames 초과 시 oldest 제거", () => {
      const fb = new FrameBuffer(3, 30000);
      fb.push(blob(), 0);
      fb.push(blob(), 100);
      fb.push(blob(), 200);
      fb.push(blob(), 300); // 30s 이내지만 4개 → maxFrames(3)로 t=0 제거
      expect(fb.snapshot().map((f) => f.timestamp)).toEqual([100, 200, 300]);
    });

    it("maxFrames 내라도 duration 초과 프레임은 제거", () => {
      const fb = new FrameBuffer(60, 1000);
      fb.push(blob(), 0);
      fb.push(blob(), 1500); // cutoff = 500 → t=0 제거
      expect(fb.snapshot().map((f) => f.timestamp)).toEqual([1500]);
    });
  });

  describe("snapshot", () => {
    it("버퍼를 유지한 채 모든 프레임을 복사 반환", () => {
      const fb = new FrameBuffer();
      fb.push(blob(), 1);
      fb.push(blob(), 2);
      const snap = fb.snapshot();
      expect(snap).toHaveLength(2);
      expect(fb.size).toBe(2);
    });

    it("반환 배열을 변형해도 내부 버퍼에 영향 없음", () => {
      const fb = new FrameBuffer();
      fb.push(blob(), 1);
      const snap = fb.snapshot();
      snap.pop();
      expect(fb.size).toBe(1);
    });
  });

  describe("clear", () => {
    it("버퍼를 비운다", () => {
      const fb = new FrameBuffer();
      fb.push(blob(), 1);
      fb.clear();
      expect(fb.size).toBe(0);
    });
  });

  describe("durationMs", () => {
    it("마지막 timestamp - 첫 timestamp", () => {
      const fb = new FrameBuffer();
      fb.push(blob(), 1000);
      fb.push(blob(), 3500);
      expect(fb.durationMs).toBe(2500);
    });

    it("빈 버퍼는 0", () => {
      const fb = new FrameBuffer();
      expect(fb.durationMs).toBe(0);
    });
  });
});
