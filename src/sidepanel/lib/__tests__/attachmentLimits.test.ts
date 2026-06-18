import { describe, expect, it } from "vitest";
import type { UserAttachmentMeta } from "@/types/attachment";
import {
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_SIZE,
  PLATFORM_FILE_SIZE_LIMIT,
  checkAttachmentLimits,
  takeWithinLimits,
} from "../attachmentLimits";

const MB = 1024 * 1024;

function att(id: string, size: number): UserAttachmentMeta {
  return { id, filename: `${id}.bin`, contentType: "application/octet-stream", size };
}

describe("attachmentLimits — 상수", () => {
  it("개수 하드캡은 10", () => {
    expect(MAX_ATTACHMENT_COUNT).toBe(10);
  });

  it("합계 용량 하드캡은 50MB", () => {
    expect(MAX_TOTAL_ATTACHMENT_SIZE).toBe(50 * MB);
  });

  it("플랫폼 단건 한도: notion 5MiB, gitlab 10MB, 나머지 null", () => {
    expect(PLATFORM_FILE_SIZE_LIMIT.notion).toBe(5 * MB);
    expect(PLATFORM_FILE_SIZE_LIMIT.gitlab).toBe(10 * MB);
    expect(PLATFORM_FILE_SIZE_LIMIT.jira).toBeNull();
    expect(PLATFORM_FILE_SIZE_LIMIT.github).toBeNull();
    expect(PLATFORM_FILE_SIZE_LIMIT.linear).toBeNull();
    expect(PLATFORM_FILE_SIZE_LIMIT.asana).toBeNull();
  });
});

describe("checkAttachmentLimits — 플랫폼 단건 한도 경고", () => {
  it("한도 null 플랫폼은 아무리 커도 oversizeIds 빈 배열", () => {
    const out = checkAttachmentLimits([att("a", 999 * MB)], "jira");
    expect(out.oversizeIds).toEqual([]);
  });

  it("notion: 5MiB 초과 파일만 oversizeIds에 포함(정확히 한도면 통과)", () => {
    const limit = PLATFORM_FILE_SIZE_LIMIT.notion!;
    const out = checkAttachmentLimits(
      [att("over", limit + 1), att("exact", limit), att("under", limit - 1)],
      "notion",
    );
    expect(out.oversizeIds).toEqual(["over"]);
  });

  it("gitlab: 10MB 초과 파일 식별", () => {
    const out = checkAttachmentLimits([att("big", 11 * MB), att("ok", 9 * MB)], "gitlab");
    expect(out.oversizeIds).toEqual(["big"]);
  });

  it("빈 배열이면 oversizeIds 빈 배열", () => {
    expect(checkAttachmentLimits([], "notion").oversizeIds).toEqual([]);
  });
});

describe("takeWithinLimits — 개수+합계 하드캡", () => {
  it("개수·합계 여유 시 전부 accept(reason 없음)", () => {
    const out = takeWithinLimits([], [{ size: 1 * MB }, { size: 2 * MB }]);
    expect(out).toEqual({ acceptCount: 2, droppedCount: 0, reason: undefined });
  });

  it("개수 상한 초과: 남은 슬롯까지만 accept, reason='count'", () => {
    const existing = Array.from({ length: 8 }, (_, i) => att(`e${i}`, 1));
    const out = takeWithinLimits(existing, [
      { size: 1 },
      { size: 1 },
      { size: 1 },
      { size: 1 },
      { size: 1 },
    ]);
    expect(out).toEqual({ acceptCount: 2, droppedCount: 3, reason: "count" });
  });

  it("합계 50MB 초과: 한도 내까지만 accept, reason='total'", () => {
    const out = takeWithinLimits([], [{ size: 30 * MB }, { size: 30 * MB }]);
    expect(out).toEqual({ acceptCount: 1, droppedCount: 1, reason: "total" });
  });

  it("합계가 정확히 50MB면 accept(경계 포함)", () => {
    const out = takeWithinLimits([], [{ size: 50 * MB }]);
    expect(out).toEqual({ acceptCount: 1, droppedCount: 0, reason: undefined });
  });

  it("개수가 정확히 10이 되는 경계는 accept", () => {
    const existing = Array.from({ length: 9 }, (_, i) => att(`e${i}`, 1));
    const out = takeWithinLimits(existing, [{ size: 1 }]);
    expect(out).toEqual({ acceptCount: 1, droppedCount: 0, reason: undefined });
  });

  it("이미 개수 상한이면 전부 drop(reason='count')", () => {
    const existing = Array.from({ length: 10 }, (_, i) => att(`e${i}`, 1));
    const out = takeWithinLimits(existing, [{ size: 1 }]);
    expect(out).toEqual({ acceptCount: 0, droppedCount: 1, reason: "count" });
  });

  it("기존 합계가 한도에 근접하면 합계 기준으로 컷", () => {
    const out = takeWithinLimits([att("e", 49 * MB)], [{ size: 2 * MB }]);
    expect(out).toEqual({ acceptCount: 0, droppedCount: 1, reason: "total" });
  });
});
