import { sendBg } from "@/types/messages";

// permalink: https://<ws>.slack.com/archives/<CHANNEL>/p<ts> → "<CHANNEL>"
// archives 세그먼트(뒤 트레일링 포함)가 없으면 null. /client/ 포맷은 미지원.
export function parseSlackChannelId(permalink: string): string | null {
  const m = permalink.match(/\/archives\/([^/]+)\//);
  return m ? m[1] : null;
}

// 원 슬랙 메시지 스레드에 트래커 백링크 댓글을 best-effort로 남긴다.
// channel 파싱 실패 시 즉시 return, 모든 예외를 삼켜 항상 resolve(승격 흐름 비차단).
export async function postSlackPromotionReply(args: {
  permalink: string;
  ts: string;
  text: string;
}): Promise<void> {
  try {
    const channelId = parseSlackChannelId(args.permalink);
    if (!channelId) return;
    await sendBg({
      type: "slack.postMessage",
      payload: { channelId, text: args.text, threadTs: args.ts },
    });
  } catch {
    // best-effort — 조용히 drop
  }
}
