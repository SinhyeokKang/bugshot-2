import type { PlatformId } from "@/types/platform";
import type { UserAttachmentMeta } from "@/types/attachment";

const MB = 1024 * 1024;

// 개수·합계는 하드캡(차단) — 대용량 다중 첨부의 base64 변환 메모리 폭발 방지.
export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_TOTAL_ATTACHMENT_SIZE = 50 * MB;

// 플랫폼 단건 한도(bytes). null = 코드상 명시 한도 없음(경고 안 함). 경고만, 차단 아님.
export const PLATFORM_FILE_SIZE_LIMIT: Record<PlatformId, number | null> = {
  jira: null,
  github: null,
  linear: null,
  notion: 5 * MB,
  gitlab: 10 * MB,
  asana: null,
  clickup: null,
  slack: null,
};

export interface AttachmentLimitWarning {
  oversizeIds: string[];
}

export function checkAttachmentLimits(
  attachments: UserAttachmentMeta[],
  platform: PlatformId,
): AttachmentLimitWarning {
  const limit = PLATFORM_FILE_SIZE_LIMIT[platform];
  if (limit == null) return { oversizeIds: [] };
  return { oversizeIds: attachments.filter((a) => a.size > limit).map((a) => a.id) };
}

export interface TakeWithinLimitsResult {
  acceptCount: number;
  droppedCount: number;
  reason?: "count" | "total";
}

// 기존 첨부에 새 파일들을 순차로 채우다 개수/합계 하드캡에 막히면 중단. 막힌 사유를 reason으로.
export function takeWithinLimits(
  existing: UserAttachmentMeta[],
  incoming: { size: number }[],
): TakeWithinLimitsResult {
  let count = existing.length;
  let total = existing.reduce((sum, a) => sum + a.size, 0);
  let acceptCount = 0;
  let reason: "count" | "total" | undefined;
  for (const item of incoming) {
    if (count >= MAX_ATTACHMENT_COUNT) {
      reason = "count";
      break;
    }
    if (total + item.size > MAX_TOTAL_ATTACHMENT_SIZE) {
      reason = "total";
      break;
    }
    count += 1;
    total += item.size;
    acceptCount += 1;
  }
  return { acceptCount, droppedCount: incoming.length - acceptCount, reason };
}
