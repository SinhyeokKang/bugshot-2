import type { PlatformAccountBase } from "./platform";

export interface SlackOAuthAuth {
  kind: "oauth";
  accessToken: string; // xoxp- user token. 만료 없음(rotation 미사용) → refresh/expiresAt 없음
  grantedAt: number;
  viewerId: string; // Slack user id (Uxxxx)
  viewerName: string; // display_name 또는 real_name
}

export type SlackAuth = SlackOAuthAuth; // OAuth 전용 (BYOK 없음)

export interface SlackDefaults {
  channelId?: string;
  channelName?: string;
}

export interface SlackAccount extends PlatformAccountBase<"slack"> {
  auth: SlackAuth;
  teamId: string;
  teamName: string;
  defaults: SlackDefaults;
}

export interface SlackOAuthResult {
  auth: SlackOAuthAuth;
  teamId: string;
  teamName: string;
}

export type SlackChannelKind = "public" | "private" | "im" | "mpim";

export interface SlackChannel {
  id: string;
  name: string; // "#general" | DM 상대 이름 | 그룹 DM 라벨
  kind: SlackChannelKind;
  imageUrl?: string; // im(1:1 DM)만 — 상대 프로필 이미지 (채널과 시각 구분용)
}

export interface SlackUser {
  id: string; // Uxxxx
  name: string; // display_name || real_name
  image?: string; // profile.image_48
}

export interface SlackPostMessagePayload {
  channelId: string;
  text: string; // mrkdwn
  threadTs?: string; // 있으면 스레드 답글
}

export interface SlackPostResult {
  ts: string; // 메시지 timestamp (= 식별자)
}

export interface SlackUploadResult {
  filename: string;
  ok: boolean;
}

export interface SlackPermalinkResult {
  permalink: string;
}
