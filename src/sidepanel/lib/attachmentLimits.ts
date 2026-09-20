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
  // 단건 한도 없음 — 총량은 바디 크기 캡(WEBHOOK_BODY_MAX_BYTES, 25MB)이 따로 본다.
  // 이 축에 25MB를 적어 미리 경고하고 싶어지지만 틀린 자리다: 여긴 **단건** 한도라
  // 20MB 두 개는 통과하고 전송에서 실패한다. 반대로 정확한 총량은 첨부 시점에 알 수 없다
  // (영상·스크린샷·logs.html이 나중에 붙고 base64가 4/3로 부푼다). 전송 시점 캡이
  // 유일하게 정확한 판정이라 그쪽에 두고, 문구가 무엇을 줄일지 알려준다.
  webhook: null,
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
