import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ t: (key: string) => key }));

import { assertCredentialSafeBase } from "../credential-url";

describe("assertCredentialSafeBase", () => {
  it("https 주소는 입력 문자열을 그대로 돌려준다", () => {
    expect(assertCredentialSafeBase("https://x.atlassian.net", "jira.workspaceUrl")).toBe(
      "https://x.atlassian.net",
    );
  });

  it("평문 http는 insecure 문구로 거부한다", () => {
    expect(() =>
      assertCredentialSafeBase("http://jira.corp", "jira.workspaceUrl"),
    ).toThrow("jira.workspaceUrl.insecure");
  });

  // loopback은 트래픽이 기기 밖으로 안 나가므로 http를 허용한다(로컬 인스턴스·ollama).
  it("loopback http는 통과한다", () => {
    expect(assertCredentialSafeBase("http://localhost:8929", "gitlab.instanceUrl")).toBe(
      "http://localhost:8929",
    );
    expect(assertCredentialSafeBase("http://127.0.0.1:11434", "llm.baseUrl")).toBe(
      "http://127.0.0.1:11434",
    );
  });

  it("파싱 불가한 문자열은 invalid 문구로 거부한다", () => {
    expect(() => assertCredentialSafeBase("not-a-url", "jira.workspaceUrl")).toThrow(
      "jira.workspaceUrl.invalid",
    );
  });

  it("http·https가 아닌 스킴은 loopback이어도 거부한다", () => {
    expect(() => assertCredentialSafeBase("ftp://localhost", "jira.workspaceUrl")).toThrow(
      "jira.workspaceUrl.insecure",
    );
  });

  it("i18n 접두사가 그대로 키에 반영된다", () => {
    expect(() => assertCredentialSafeBase("http://evil.example", "gitlab.instanceUrl")).toThrow(
      "gitlab.instanceUrl.insecure",
    );
  });
});
