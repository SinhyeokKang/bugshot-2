import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_PLACEHOLDER } from "@/lib/adf-sentinels";
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

// ── 사용자 첨부 파일명 충돌 (asana Task 8-1과 같은 뿌리, jira 판) ────────────────
// jira는 캡처와 사용자 첨부가 `rawAttachments` 한 배열에 이름으로만 섞여 있고
// (`submitToJira.ts`가 사용자 첨부를 `displayName ?? filename`으로 뒤에 push한다),
// background가 `uploadMap.set(att.filename, …)`로 받는다 — **뒤가 앞을 덮는다.**
// asana는 캡처가 밀려나 사라졌지만 jira는 그 반대로 **사용자가 올린 파일이 이슈 본문에
// 인라인된다.** 배열이 realm을 건너므로 asana처럼 인덱스 경계로 못 가르고, 입력에
// 표식을 실어 보낸다.
describe("jira.submitIssue — 사용자 첨부 파일명 충돌", () => {
  const IMG = "data:image/webp;base64,AAAA";
  const HTML = "data:text/html;base64,AAAA";

  const submitWith = (attachments: unknown[], description: JiraAdfDoc = DESCRIPTION) =>
    handleMessage(
      {
        type: "jira.submitIssue",
        payload: { projectKey: "BUG", summary: "s", description, issueTypeId: "1" },
        attachments,
      } as never,
      {} as chrome.runtime.MessageSender,
    );

  // 업로드 순서로 캡처(1번째)와 사용자 파일(2번째)을 구분되게 찍는다.
  const uploadByOrder = () =>
    api.uploadAttachment.mockImplementation(async (_a, _k, filename: string) => {
      const n = api.uploadAttachment.mock.calls.length;
      return [{ id: `1000${n}`, filename, mediaApiFileId: `media-${n}` }];
    });

  it("동명의 사용자 첨부가 있어도 본문에 인라인되는 건 캡처다", async () => {
    uploadByOrder();

    await submitWith(
      [
        { filename: "screenshot.webp", dataUrl: IMG, width: 10, height: 20 },
        { filename: "screenshot.webp", dataUrl: IMG, userAttachment: true },
      ],
      // 이미지가 실제로 박히려면 본문에 placeholder 문단이 있어야 한다.
      {
        version: 1,
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: IMAGE_PLACEHOLDER }] }],
      },
    );

    const doc = JSON.stringify(api.updateIssueDescription.mock.calls[0]?.[2]);
    expect(doc).toContain("media-1");
    expect(doc).not.toContain("media-2");
  });

  it("사용자가 logs.html과 동명의 파일을 첨부해도 백링크는 우리 logs.html에만 주입된다", async () => {
    const { injectIssueUrl } = await import("@/lib/inject-issue-url");
    uploadByOrder();

    await submitWith([
      { filename: "logs.html", dataUrl: HTML },
      { filename: "logs.html", dataUrl: HTML, userAttachment: true },
    ]);

    expect(injectIssueUrl).toHaveBeenCalledTimes(1);
  });

  it("우리 logs.html이 성공하면 동명의 사용자 첨부가 실패해도 logsDropped는 false다", async () => {
    // 반대 방향(우리 실패 + 사용자 성공)은 이름 매칭으로도 true라 구분이 안 된다.
    api.uploadAttachment.mockImplementation(async (_a, _k, filename: string) => {
      if (api.uploadAttachment.mock.calls.length === 2) throw new Error("413");
      return [{ id: "10001", filename }];
    });

    await expect(
      submitWith([
        { filename: "logs.html", dataUrl: HTML },
        { filename: "logs.html", dataUrl: HTML, userAttachment: true },
      ]),
    ).resolves.toMatchObject({ logsDropped: false });
  });
});
