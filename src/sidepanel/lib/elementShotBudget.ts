import { MESSAGE_BYTES_LIMIT } from "./recordingBudget";

export function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

// The image is sent once directly and once inside base64-encoded logs.html.
export function elementShotMessageBytes(images: readonly string[]): number {
  return images.reduce((sum, image) => sum + Math.ceil(new TextEncoder().encode(image).byteLength * 7 / 3), 0);
}

export function elementShotBudget(input: {
  snapshot: unknown;
  key: string;
  quotaBytes: number;
  otherBytes: number | null;
  images: readonly string[];
  messageLimit?: number;
}): { ok: boolean; sessionBytes: number; messageBytes: number } {
  const sessionBytes = serializedBytes(input.snapshot) + new TextEncoder().encode(input.key).byteLength;
  const messageBytes = elementShotMessageBytes(input.images);
  return {
    ok: input.otherBytes !== null && Number.isFinite(input.otherBytes) && input.otherBytes >= 0
      && input.quotaBytes > 0 && sessionBytes + input.otherBytes <= input.quotaBytes
      && messageBytes <= (input.messageLimit ?? MESSAGE_BYTES_LIMIT) * 0.8,
    sessionBytes,
    messageBytes,
  };
}
