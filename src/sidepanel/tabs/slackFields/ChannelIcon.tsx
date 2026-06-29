import { useState } from "react";
import { Hash, Lock, User, Users } from "lucide-react";
import type { SlackChannel } from "@/types/slack";

// 채널 종류별 앞 비주얼: im(1:1 DM)은 상대 프로필 이미지(로드 실패 시 User 폴백),
// mpim 그룹 DM은 Users, 공개는 #, 비공개는 자물쇠 — DM과 채널을 한눈에 구분.
export function ChannelIcon({ channel }: { channel: SlackChannel }) {
  const [imgError, setImgError] = useState(false);

  if (channel.kind === "im") {
    if (channel.imageUrl && !imgError) {
      return (
        <img
          src={channel.imageUrl}
          alt=""
          className="h-4 w-4 shrink-0 rounded-[4px]"
          onError={() => setImgError(true)}
        />
      );
    }
    return <User className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }

  const Icon =
    channel.kind === "mpim" ? Users : channel.kind === "private" ? Lock : Hash;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />;
}
