import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    if (params) {
      let s = key;
      for (const [k, v] of Object.entries(params)) s += ` ${k}=${v}`;
      return s;
    }
    return key;
  },
}));

import { serializePlatformError } from "../platformErrors";
import { JiraError } from "../jira-api";
import { GithubError } from "../github-api";
import { LinearError } from "../linear-api";
import { NotionError } from "../notion-api";
import { GitlabError } from "../gitlab-api";
import { AsanaError } from "../asana-api";
import { ClickupError } from "../clickup-api";
import { SlackError } from "../slack-api";
import { OAuthError } from "../oauth";

describe("serializePlatformError", () => {
  it("status·body를 갖는 7개 플랫폼 에러를 직렬화한다", () => {
    const cases = [
      new JiraError(404, "not found", { errorMessages: [] }),
      new GithubError(422, "unprocessable", { message: "x" }),
      new LinearError(400, "bad request", { errors: [] }),
      new NotionError(401, "unauthorized", { code: "unauthorized" }),
      new GitlabError(403, "forbidden", { message: "x" }),
      new AsanaError(500, "server error", { errors: [] }),
      new ClickupError(429, "rate limited", { err: "x" }),
    ];

    for (const error of cases) {
      const out = serializePlatformError(error);
      expect(out, `${error.name}이 직렬화돼야 한다`).not.toBeNull();
      expect(out?.status).toBe(error.status);
      expect(out?.body).toBe(error.body);
    }
  });

  // Slack만 생성자 순서가 다르고 기본 status가 200이다(HTTP 200 + ok:false 패턴).
  it("SlackError도 status·body를 돌려준다", () => {
    const error = new SlackError("token_revoked", "revoked");
    const out = serializePlatformError(error);

    expect(out).not.toBeNull();
    expect(out?.status).toBe(200);
    expect(out?.body).toEqual({ platform: "slack" });
  });

  // OAuthError는 플랫폼 테이블에 없어야 한다 — 뒤에 남은 OAuth 분기가 받아
  // serializeOAuthError로 내려가는 순서가 load-bearing이다.
  it("OAuthError는 null을 돌려줘 다음 분기로 넘긴다", () => {
    expect(serializePlatformError(new OAuthError("expired", { platform: "jira" }))).toBeNull();
  });

  it("무관한 Error는 null을 돌려준다", () => {
    expect(serializePlatformError(new Error("boom"))).toBeNull();
    expect(serializePlatformError("not an error")).toBeNull();
  });
});
