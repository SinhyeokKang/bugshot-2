import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraAdfDoc, JiraAuth } from "@/types/jira";

const api = vi.hoisted(() => ({
  ensureFreshAuth: vi.fn(async (auth: unknown) => auth),
  createIssue: vi.fn(),
  uploadAttachment: vi.fn(),
  getMediaFileId: vi.fn(),
  updateIssueDescription: vi.fn(),
  createIssueLink: vi.fn(),
}));

vi.mock("../jira-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

vi.mock("@/lib/inject-issue-url", () => ({
  injectIssueUrl: vi.fn(async (dataUrl: string) => dataUrl),
}));

const AUTH: JiraAuth = {
  kind: "apiKey",
  baseUrl: "https://acme.atlassian.net",
  email: "a@b.c",
  apiToken: "tok",
};

vi.mock("@/lib/settings-storage", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readStoredAuth: vi.fn(async () => AUTH),
}));

import { handleMessage } from "../messages";

const DESCRIPTION: JiraAdfDoc = { version: 1, type: "doc", content: [] };

const ATTACHMENTS = () => [
  { filename: "screenshot.webp", dataUrl: "data:image/webp;base64,AAAA", width: 10, height: 20 },
  { filename: "logs.html", dataUrl: "data:text/html;base64,AAAA" },
];

const submit = () =>
  handleMessage(
    {
      type: "jira.submitIssue",
      payload: {
        projectKey: "BUG",
        summary: "s",
        description: DESCRIPTION,
        issueTypeId: "1",
      },
      attachments: ATTACHMENTS(),
    },
    {} as chrome.runtime.MessageSender,
  );

// 완전 성공 경로의 반환값. 아래 degradation 행의 계약 ②가 이 리터럴과의 동일성이다.
const EXPECTED = {
  key: "BUG-42",
  url: "https://acme.atlassian.net/browse/BUG-42",
  logsDropped: false,
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  api.createIssue.mockResolvedValue({ id: "1", key: "BUG-42", self: "https://x" });
  api.uploadAttachment.mockImplementation(async (_a, _k, filename: string) =>
    filename === "screenshot.webp"
      ? [{ id: "10001", filename, mediaApiFileId: "media-1" }]
      : [{ id: "10002", filename }],
  );
  api.updateIssueDescription.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ── 2차 본문 갱신 실패 시 graceful degradation — 전수 표 (jira 행) ────────────────
// 나머지 4행(clickup·asana·linear·gitlab)은 사이드패널 어댑터에 있고 표 헤더 주석은
// `src/sidepanel/lib/__tests__/submitToClickup.test.ts`에 있다. jira만 2차 write가
// background(`messages.ts:850-868`의 try {} catch {}) 안이라 파일이 갈린다 —
// `grep -rn "전수 표"` 로 5행이 모인다.
//
// 이 행이 잠그는 계약 3개:
//   ① 2차 갱신(updateIssueDescription)이 reject해도 제출이 reject되지 않는다
//   ② 반환값(key·url·logsDropped)이 완전 성공 경로와 동일하다
//   ③ 1차 이슈 생성과 첨부 업로드는 그대로 남는다(첨부 보존)
describe("jira.submitIssue — 2차 본문 갱신 실패 (전수 표 jira 행)", () => {
  it("완전 성공 경로 (② 비교 기준)", async () => {
    await expect(submit()).resolves.toEqual(EXPECTED);
    expect(api.updateIssueDescription).toHaveBeenCalledTimes(1);
  });

  it("updateIssueDescription이 reject해도 제출은 성공하고 이슈·첨부가 보존된다", async () => {
    api.updateIssueDescription.mockRejectedValue(new Error("PUT 500"));

    // ①② 완전 성공 경로와 같은 반환값으로 resolve한다.
    await expect(submit()).resolves.toEqual(EXPECTED);

    // ③ 1차 생성과 첨부 업로드는 그대로, 2차 갱신을 시도했다는 사실까지 고정.
    expect(api.createIssue).toHaveBeenCalledTimes(1);
    expect(api.uploadAttachment.mock.calls.map((c) => c[2])).toEqual([
      "screenshot.webp",
      "logs.html",
    ]);
    expect(api.updateIssueDescription).toHaveBeenCalledTimes(1);
  });
});
