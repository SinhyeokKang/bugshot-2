export interface CapturedFrame {
  blob: Blob;
  timestamp: number;
}

export const REPLAY_MAX_FRAMES = 60;
export const REPLAY_MAX_DURATION_MS = 30000;

export class FrameBuffer {
  private frames: CapturedFrame[] = [];

  constructor(
    private readonly maxFrames = REPLAY_MAX_FRAMES,
    private readonly maxDurationMs = REPLAY_MAX_DURATION_MS,
  ) {}

  push(blob: Blob, timestamp: number): void {
    this.frames.push({ blob, timestamp });
    if (this.frames.length > this.maxFrames) this.frames.shift();
    const cutoff = timestamp - this.maxDurationMs;
    while (this.frames.length > 0 && this.frames[0].timestamp < cutoff) {
      this.frames.shift();
    }
  }

  snapshot(): CapturedFrame[] {
    return this.frames.slice();
  }

  clear(): void {
    this.frames = [];
  }

  get size(): number {
    return this.frames.length;
  }

  get durationMs(): number {
    if (this.frames.length === 0) return 0;
    return (
      this.frames[this.frames.length - 1].timestamp - this.frames[0].timestamp
    );
  }

  get oldestTimestamp(): number | null {
    return this.frames.length === 0 ? null : this.frames[0].timestamp;
  }
}
