import type { PlatformId } from "@/types/platform";
import { JiraError } from "./jira-api";
import { GithubError } from "./github-api";
import { LinearError } from "./linear-api";
import { NotionError } from "./notion-api";
import { GitlabError } from "./gitlab-api";
import { AsanaError } from "./asana-api";
import { ClickupError } from "./clickup-api";
import { SlackError } from "./slack-api";

interface PlatformErrorShape {
  status: number;
  body?: unknown;
}

// `satisfies Record<PlatformId, …>`라 플랫폼을 추가하면 컴파일러가 여기를 채우라고 한다.
// 나열식 instanceof 분기였을 땐 9번째 플랫폼을 빠뜨려도 조용히 friendlyError로 떨어져,
// isOAuthCancelled·getOAuthErrorPlatform 판독이 무음으로 실패했다.
const PLATFORM_ERROR_CTORS = {
  jira: JiraError,
  github: GithubError,
  linear: LinearError,
  notion: NotionError,
  gitlab: GitlabError,
  asana: AsanaError,
  clickup: ClickupError,
  slack: SlackError,
} satisfies Record<PlatformId, new (...args: never[]) => Error & PlatformErrorShape>;

// 플랫폼 API 에러면 {status, body}를, 아니면 null. null은 "다음 분기가 처리하라"는 뜻이라
// OAuthError도 여기서 null이어야 한다 — 호출부에서 OAuth 분기가 뒤에 온다.
export function serializePlatformError(error: unknown): PlatformErrorShape | null {
  for (const Ctor of Object.values(PLATFORM_ERROR_CTORS)) {
    if (error instanceof Ctor) {
      const e = error as Error & PlatformErrorShape;
      return { status: e.status, body: e.body };
    }
  }
  return null;
}
