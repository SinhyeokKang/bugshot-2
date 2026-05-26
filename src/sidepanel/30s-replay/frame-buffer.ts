export interface CapturedFrame {
  blob: Blob;
  timestamp: number;
}

export class FrameBuffer {
  private frames: CapturedFrame[] = [];

  constructor(
    private readonly maxFrames = 60,
    private readonly maxDurationMs = 30000,
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
}
