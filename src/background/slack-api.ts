import { t } from "@/i18n";
import type {
  SlackAuth,
  SlackChannel,
  SlackPostMessagePayload,
  SlackPostResult,
  SlackUploadResult,
  SlackUser,
} from "@/types/slack";

const API_BASE = "https://slack.com/api";

// Slack은 HTTP 200 + { ok:false, error } 패턴이라 status 기반 분류(ClickUp 패턴)와 다르다.
// body의 platform은 index.ts 직렬화용 메타(ClickupError와 동형) — revoke 시 사용자에겐
// messageForSlackError 토스트가 노출된다(clickup과 동일, 자동 재연결 배너는 refresh 토큰
// 모델 전용이라 Slack 비대상).
export class SlackError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 200,
    public body: { platform: "slack" } = { platform: "slack" },
  ) {
    super(message);
    this.name = "SlackError";
  }
}

export function messageForSlackError(code: string): string {
  switch (code) {
    case "token_revoked":
    case "invalid_auth":
    case "account_inactive":
      return t("slack.oauthRevoked");
    case "not_in_channel":
      return t("slack.error.notInChannel");
    case "channel_not_found":
      return t("slack.error.channelNotFound");
    case "ratelimited":
      return t("slack.error.rateLimited");
    default:
      return t("slack.error.generic", { code });
  }
}

type FetchParams = Record<string, string | number | boolean | undefined>;

// 모든 Web API 메서드가 form-urlencoded를 지원하므로 통일한다 (json 미지원 read 메서드 회피).
async function slackFetch<T>(
  auth: SlackAuth,
  method: string,
  params: FetchParams,
): Promise<T> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) form.set(k, String(v));
  }
  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: form,
  });
  // 429(rate limit) 등 HTTP 에러는 비-JSON body가 올 수 있어 res.json() 전에 분기한다.
  if (!res.ok) {
    const code = res.status === 429 ? "ratelimited" : "unknown_error";
    throw new SlackError(code, messageForSlackError(code), res.status);
  }
  const data = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!data.ok) {
    const code = data.error ?? "unknown_error";
    throw new SlackError(code, messageForSlackError(code), res.status);
  }
  return data;
}

export function normalizeChannel(raw: Record<string, unknown>): SlackChannel {
  const r = raw as {
    id: string;
    name?: string;
    user?: string;
    is_im?: boolean;
    is_mpim?: boolean;
    is_private?: boolean;
  };
  if (r.is_im) return { id: r.id, name: r.user ?? r.id, kind: "im" };
  if (r.is_mpim) return { id: r.id, name: r.name ?? r.id, kind: "mpim" };
  return {
    id: r.id,
    name: `#${r.name ?? ""}`,
    kind: r.is_private ? "private" : "public",
  };
}

export async function getMyself(
  auth: SlackAuth,
): Promise<{ id: string; name: string; teamId: string; teamName: string }> {
  const data = await slackFetch<{
    user_id: string;
    user: string;
    team_id: string;
    team: string;
  }>(auth, "auth.test", {});
  return { id: data.user_id, name: data.user, teamId: data.team_id, teamName: data.team };
}

export async function listMembers(auth: SlackAuth): Promise<SlackUser[]> {
  const members: SlackUser[] = [];
  let cursor: string | undefined;
  do {
    const data = await slackFetch<{
      members: Array<{
        id: string;
        name?: string;
        deleted?: boolean;
        is_bot?: boolean;
        profile?: { display_name?: string; real_name?: string };
      }>;
      response_metadata?: { next_cursor?: string };
    }>(auth, "users.list", { limit: 200, cursor });
    for (const m of data.members) {
      if (m.deleted || m.is_bot || m.id === "USLACKBOT") continue;
      members.push({
        id: m.id,
        name: m.profile?.display_name || m.profile?.real_name || m.name || m.id,
      });
    }
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return members;
}

export async function listChannels(auth: SlackAuth): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;
  do {
    const data = await slackFetch<{
      channels: Array<Record<string, unknown>>;
      response_metadata?: { next_cursor?: string };
    }>(auth, "users.conversations", {
      types: "public_channel,private_channel,im,mpim",
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    channels.push(...data.channels.map(normalizeChannel));
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  // im/mpim은 이름이 없어 user id 폴백 상태 → users.list 1회로 id→name 일괄 매핑(N+1 회피).
  if (channels.some((c) => c.kind === "im")) {
    const nameById = new Map((await listMembers(auth)).map((u) => [u.id, u.name]));
    for (const c of channels) {
      if (c.kind === "im") c.name = nameById.get(c.name) ?? c.name;
    }
  }
  return channels;
}

export async function postMessage(
  auth: SlackAuth,
  p: SlackPostMessagePayload,
): Promise<SlackPostResult> {
  const data = await slackFetch<{ ts: string }>(auth, "chat.postMessage", {
    channel: p.channelId,
    text: p.text,
    thread_ts: p.threadTs,
    unfurl_links: false,
    unfurl_media: false,
  });
  return { ts: data.ts };
}

export async function getPermalink(
  auth: SlackAuth,
  channelId: string,
  ts: string,
): Promise<string> {
  const data = await slackFetch<{ permalink: string }>(auth, "chat.getPermalink", {
    channel: channelId,
    message_ts: ts,
  });
  return data.permalink;
}

// files 2-step 업로드: getUploadURLExternal → POST bytes → completeUploadExternal(thread_ts).
export async function uploadFiles(
  auth: SlackAuth,
  channelId: string,
  threadTs: string,
  files: Array<{ filename: string; blob: Blob }>,
): Promise<SlackUploadResult[]> {
  const results: SlackUploadResult[] = [];
  const uploaded: Array<{ id: string; title: string }> = [];

  for (const f of files) {
    try {
      const u = await slackFetch<{ upload_url: string; file_id: string }>(
        auth,
        "files.getUploadURLExternal",
        { filename: f.filename, length: f.blob.size },
      );
      const form = new FormData();
      form.append("file", f.blob, f.filename);
      const put = await fetch(u.upload_url, { method: "POST", body: form });
      if (!put.ok) throw new Error(`upload failed: ${put.status}`);
      uploaded.push({ id: u.file_id, title: f.filename });
      results.push({ filename: f.filename, ok: true });
    } catch {
      results.push({ filename: f.filename, ok: false });
    }
  }

  if (uploaded.length > 0) {
    try {
      await slackFetch(auth, "files.completeUploadExternal", {
        files: JSON.stringify(uploaded),
        channel_id: channelId,
        thread_ts: threadTs,
      });
    } catch {
      // complete 실패 시 첨부가 채널에 안 붙으므로 전부 실패 처리.
      return results.map((r) => ({ ...r, ok: false }));
    }
  }
  return results;
}
