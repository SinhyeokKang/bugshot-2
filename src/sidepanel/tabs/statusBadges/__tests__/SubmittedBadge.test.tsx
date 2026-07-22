import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubIssueStatus } from "@/types/github";
import type { JiraIssueStatus } from "@/types/jira";
import { SubmittedBadge } from "../SubmittedBadge";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));

const sendBg = vi.fn();
vi.mock("@/types/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/types/messages")>();
  return { ...actual, sendBg: (req: unknown) => sendBg(req) };
});

const patchIssue = vi.fn();
vi.mock("@/store/issues-store", () => ({
  useIssuesStore: (sel: (s: { patchIssue: typeof patchIssue }) => unknown) =>
    sel({ patchIssue }),
}));

const ACCOUNTS = {
  jira: { auth: { kind: "oauth", cloudId: "site-1" } },
  github: { login: "octocat" },
};
vi.mock("@/store/settings-store", () => ({
  useSettingsStore: (sel: (s: { accounts: typeof ACCOUNTS }) => unknown) =>
    sel({ accounts: ACCOUNTS }),
  jiraSiteId: (auth: { cloudId: string }) => auth.cloudId,
}));

const JIRA_STATUS: JiraIssueStatus = {
  name: "진행 중",
  categoryKey: "indeterminate",
  issueTypeName: "Bug",
  summary: "트래커에서 수정된 제목",
};

const GITHUB_STATUS: GithubIssueStatus = {
  number: 42,
  title: "트래커에서 수정된 제목",
  state: "open",
  htmlUrl: "https://github.com/o/r/issues/42",
  labels: [{ name: "bug", color: "d73a4a" }],
};

function renderBadge(props: Partial<Parameters<typeof SubmittedBadge>[0]> = {}) {
  return render(
    <SubmittedBadge
      issueId="issue-1"
      issueKey="BUG-1"
      platform="jira"
      refreshKey={0}
      onLoaded={() => {}}
      {...props}
    />,
  );
}

// 트래커에서 제목이 바뀌면 로컬 이슈 목록이 stale해진다 — 상태 조회 응답의 제목을 함께 반영해야 한다.
//
// 커버 범위 주의: 제목 갱신 로직은 7개 `*SubmittedBadge`(조회) + 7개 `*StatusBadge`(상태 변경)
// 총 14곳에 복제돼 있고, 여기서 태우는 건 필드명이 갈리는 대표 2종(jira=summary, github=title)뿐이다.
// linear/notion/gitlab(title)·asana/clickup(name)과 `*StatusBadge` 7곳은 여전히 무그물 —
// 매핑을 바꾸거나 플랫폼을 추가할 땐 이 파일이 아니라 해당 배지를 직접 확인해야 한다.
describe("SubmittedBadge 제목 동기화", () => {
  beforeEach(() => {
    sendBg.mockReset();
    patchIssue.mockReset();
  });

  it("Jira는 응답의 summary를 title로 반영한다", async () => {
    sendBg.mockResolvedValue(JIRA_STATUS);

    renderBadge();

    await waitFor(() => expect(patchIssue).toHaveBeenCalled());
    expect(patchIssue).toHaveBeenCalledWith(
      "issue-1",
      expect.objectContaining({ title: "트래커에서 수정된 제목" }),
    );
  });

  it("GitHub은 응답의 title을 반영한다", async () => {
    sendBg.mockResolvedValue(GITHUB_STATUS);

    renderBadge({
      platform: "github",
      issueKey: "#42",
      issueUrl: "https://github.com/o/r/issues/42",
      githubOwner: "o",
      githubRepo: "r",
    });

    await waitFor(() => expect(patchIssue).toHaveBeenCalled());
    expect(patchIssue).toHaveBeenCalledWith(
      "issue-1",
      expect.objectContaining({ title: "트래커에서 수정된 제목" }),
    );
  });

  it("조회에 실패하면 title을 건드리지 않는다 (로컬 제목 폴백)", async () => {
    sendBg.mockRejectedValue(new Error("network down"));

    renderBadge();

    await waitFor(() => expect(sendBg).toHaveBeenCalled());
    expect(patchIssue).not.toHaveBeenCalled();
  });

  it("응답 제목이 빈 문자열이면 title을 덮어쓰지 않는다", async () => {
    sendBg.mockResolvedValue({ ...JIRA_STATUS, summary: "" });

    renderBadge();

    await waitFor(() => expect(patchIssue).toHaveBeenCalled());
    expect(patchIssue).toHaveBeenCalledWith(
      "issue-1",
      expect.not.objectContaining({ title: expect.anything() }),
    );
  });

  // Slack 공유는 승격 전까지 로컬 draft — 원격 제목이라는 개념 자체가 없어 조회하지 않는다.
  it("Slack은 상태 조회를 하지 않는다", async () => {
    renderBadge({ platform: "slack" });

    await waitFor(() => expect(patchIssue).not.toHaveBeenCalled());
    expect(sendBg).not.toHaveBeenCalled();
  });
});
