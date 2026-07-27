import type { CapturedFrame } from "./frame-buffer";

// 트림 대상 영상의 시간축 출처. frames=30s Replay(프레임 배열), recording=탭/화면 녹화(벽시계 선형).
// 런타임 import 0 — trim-math.ts는 mp4-encoder를 value import하므로, 이 타입을 거기 두면
// import type을 빠뜨렸을 때 editor-store로 WebCodecs 그래프가 유입된다. 파일 분리로 그 실수를 막는다.
export type TrimSource =
  | { kind: "frames"; frames: CapturedFrame[] }
  | { kind: "recording"; startedAt: number; endedAt: number };
