import { describe, it, expect } from "vitest";

import {
  jiraSubmitArgs,
  jiraLastSubmitFields,
  githubSubmitArgs,
  githubLastSubmitFields,
  linearSubmitArgs,
  linearLastSubmitFields,
  notionSubmitArgs,
  notionLastSubmitFields,
  gitlabSubmitArgs,
  gitlabLastSubmitFields,
  asanaSubmitArgs,
  asanaLastSubmitFields,
  clickupSubmitArgs,
  clickupLastSubmitFields,
  slackSubmitArgs,
  slackLastSubmitFields,
} from "../submitAdapters";
import type { MarkdownContext } from "../buildIssueMarkdown";
import type { CaptureFiles } from "../buildCaptureFiles";

// 신규 제출(IssueCreateModal)과 재제출(DraftDetailDialog)이 같은 인자를 만들어야 한다 —
// 한쪽에만 필드를 더하면 그 경로에서만 값이 붙는다. 단언을 toEqual(정확 일치)로 거는 이유는
// 부분 일치면 필드가 새로 끼어들어도, 빠져도 통과하기 때문이다.
const ctx = { title: "T" } as unknown as MarkdownContext;
const inlineImages = [{ refId: "r1", dataUrl: "data:IMG" }];
const captureFiles = {
  images: [{ filename: "before-0.webp", dataUrl: "data:B" }],
  video: { filename: "recording.mp4", dataUrl: "data:V" },
  logs: [{ filename: "logs.html", dataUrl: "data:L" }],
  attachments: [{ filename: "a.pdf", dataUrl: "data:A" }],
} as unknown as CaptureFiles;

const media = {
  images: captureFiles.images,
  video: captureFiles.video,
  logs: captureFiles.logs,
  attachments: captureFiles.attachments,
};

const cc = [{ id: "u1", name: "User" }];

// *LastSubmitFields는 chrome.storage에 영속된다. fields 타입에 UI 전용 키가 붙어도 설정으로
// 새면 안 되므로 어댑터가 명시 키 화이트리스트로 거른다 — fixture에 이 키를 심어 그 거름망이
// 실제로 도는지 본다(변수 전달이라 excess property check는 이 축을 안 잡는다).
const UI_ONLY = { _uiScratch: "설정으로 새면 안 되는 값" };

describe("jira", () => {
  const fields = {
    projectKey: "BUG",
    issueTypeId: "10001",
    assigneeId: "acc-1",
    assigneeName: "담당자",
    priorityId: "3",
    priorityName: "Medium",
    parentKey: "BUG-1",
    parentLabel: "부모",
    sprintId: 42,
    sprintName: "Sprint 9",
    relates: [{ key: "BUG-2", label: "관련" }],
    cc: [{ accountId: "acc-2", displayName: "참조" }],
  };

  it("제출 인자를 조립한다", () => {
    expect(
      jiraSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields,
        projectKey: "BUG",
        issueTypeId: "10001",
        summary: "  제목  ",
      }),
    ).toEqual({
      ctx,
      inlineImages,
      ...media,
      projectKey: "BUG",
      // 제목은 여기서 trim한다 — 두 진입점이 각자 trim하면 한쪽만 놓칠 수 있다.
      summary: "제목",
      issueTypeId: "10001",
      assigneeAccountId: "acc-1",
      priorityId: "3",
      parentKey: "BUG-1",
      sprintId: 42,
      relates: fields.relates,
      cc: fields.cc,
    });
  });

  // siteId는 계정 auth에서 파생한 값을 받는다 — sticky 게이트(initialJiraFields)가 이걸로 사이트를 가른다.
  it("lastSubmitFields는 sticky 5키를 전부 싣는다", () => {
    expect(
      jiraLastSubmitFields({
        fields: { ...fields, ...UI_ONLY },
        projectKey: "BUG",
        issueTypeId: "10001",
        siteId: "site-1",
      }),
    ).toEqual({
      projectKey: "BUG",
      issueTypeId: "10001",
      siteId: "site-1",
      assigneeId: "acc-1",
      assigneeName: "담당자",
      priorityId: "3",
      priorityName: "Medium",
      parentKey: "BUG-1",
      parentLabel: "부모",
      sprintId: 42,
      sprintName: "Sprint 9",
      relates: fields.relates,
      cc: fields.cc,
    });
  });
});

describe("github", () => {
  const fields = { owner: "o", repo: "r", label: "bug", assignee: "me", cc: ["u1"] };

  it("제출 인자를 조립한다", () => {
    expect(
      githubSubmitArgs({ ctx, inlineImages, captureFiles, fields, owner: "o", repo: "r" }),
    ).toEqual({
      ctx,
      ...media,
      inlineImages,
      owner: "o",
      repo: "r",
      label: "bug",
      assignee: "me",
      cc: ["u1"],
      requireMediaUpload: false,
    });
  });

  // Slack 승격 경로에서만 켠다 — 미디어 업로드가 실패하면 등록 전에 중단해야 원본이 안 날아간다.
  it("requireMediaUpload를 넘기면 그대로 실린다", () => {
    expect(
      githubSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields,
        owner: "o",
        repo: "r",
        requireMediaUpload: true,
      }).requireMediaUpload,
    ).toBe(true);
  });

  it("lastSubmitFields는 화이트리스트 키만 남긴다", () => {
    expect(githubLastSubmitFields({ ...fields, ...UI_ONLY })).toEqual({
      owner: "o",
      repo: "r",
      label: "bug",
      assignee: "me",
      cc: ["u1"],
    });
  });
});

describe("linear", () => {
  const fields = {
    teamId: "t1",
    teamName: "Team",
    teamKey: "TEA",
    projectId: "p1",
    projectName: "Proj",
    labelId: "l1",
    labelName: "Bug",
    assigneeId: "a1",
    assigneeName: "담당",
    priority: 2,
    cc,
  };

  it("제출 인자를 조립한다", () => {
    expect(linearSubmitArgs({ ctx, inlineImages, captureFiles, fields, teamId: "t1" })).toEqual({
      ctx,
      ...media,
      inlineImages,
      teamId: "t1",
      projectId: "p1",
      labelId: "l1",
      assigneeId: "a1",
      priority: 2,
      cc,
    });
  });

  it("lastSubmitFields는 화이트리스트 키만 남긴다", () => {
    expect(linearLastSubmitFields({ ...fields, ...UI_ONLY })).toEqual({
      teamId: "t1",
      teamName: "Team",
      teamKey: "TEA",
      projectId: "p1",
      projectName: "Proj",
      labelId: "l1",
      labelName: "Bug",
      assigneeId: "a1",
      assigneeName: "담당",
      priority: 2,
      cc,
    });
  });
});

describe("notion", () => {
  const fields = {
    databaseId: "db1",
    databaseTitle: "DB",
    statusOption: "Todo",
    selectValues: [],
    cc,
  };
  const schema = {
    titlePropertyName: "Name",
    statusProperty: { name: "Status" },
  } as never;

  it("statusOption과 schema가 둘 다 있으면 상태를 싣는다", () => {
    expect(
      notionSubmitArgs({ ctx, inlineImages, captureFiles, fields, databaseId: "db1", schema }),
    ).toEqual({
      ctx,
      ...media,
      inlineImages,
      databaseId: "db1",
      titlePropertyName: "Name",
      statusOption: { propertyName: "Status", optionName: "Todo" },
      selectValues: [],
      // cc는 id만 넘긴다 — 다른 플랫폼과 달리 표시명이 필요 없다.
      cc: ["u1"],
      requireMediaUpload: false,
    });
  });

  it("requireMediaUpload를 넘기면 그대로 실린다", () => {
    expect(
      notionSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields,
        databaseId: "db1",
        schema,
        requireMediaUpload: true,
      }).requireMediaUpload,
    ).toBe(true);
  });

  it("statusOption이 없으면 undefined로 떨어진다", () => {
    expect(
      notionSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields: { ...fields, statusOption: undefined },
        databaseId: "db1",
        schema,
      }).statusOption,
    ).toBeUndefined();
  });

  it("lastSubmitFields는 화이트리스트 키만 남긴다", () => {
    expect(notionLastSubmitFields({ ...fields, ...UI_ONLY })).toEqual({
      databaseId: "db1",
      databaseTitle: "DB",
      statusOption: "Todo",
      selectValues: [],
      cc,
    });
  });
});

describe("gitlab", () => {
  const fields = {
    projectId: 7,
    projectPath: "g/p",
    label: "bug",
    assigneeId: 3,
    assigneeName: "담당",
    cc: [{ username: "user1", name: "User" }],
  };

  it("cc를 username으로 바꿔 싣는다", () => {
    expect(
      gitlabSubmitArgs({ ctx, inlineImages, captureFiles, fields, projectId: 7 }),
    ).toEqual({
      ctx,
      ...media,
      inlineImages,
      projectId: 7,
      label: "bug",
      assigneeId: 3,
      cc: ["user1"],
      requireMediaUpload: false,
    });
  });

  it("requireMediaUpload를 넘기면 그대로 실린다", () => {
    expect(
      gitlabSubmitArgs({
        ctx,
        inlineImages,
        captureFiles,
        fields,
        projectId: 7,
        requireMediaUpload: true,
      }).requireMediaUpload,
    ).toBe(true);
  });

  it("lastSubmitFields는 cc를 원본 객체로 남긴다", () => {
    expect(gitlabLastSubmitFields({ ...fields, ...UI_ONLY })).toEqual({
      projectId: 7,
      projectPath: "g/p",
      label: "bug",
      assigneeId: 3,
      assigneeName: "담당",
      cc: fields.cc,
    });
  });
});

describe("asana", () => {
  // cc 모양이 플랫폼마다 다르다 — asana는 gid, gitlab은 username, 나머지는 id.
  const asanaCc = [{ gid: "u1", name: "User" }];
  const fields = {
    workspaceGid: "w1",
    workspaceName: "WS",
    projectGid: "p1",
    projectName: "Proj",
    assigneeGid: "a1",
    assigneeName: "담당",
    cc: asanaCc,
  };

  it("제출 인자를 조립한다", () => {
    expect(
      asanaSubmitArgs({ ctx, inlineImages, captureFiles, fields, workspaceGid: "w1" }),
    ).toEqual({
      ctx,
      ...media,
      inlineImages,
      workspaceGid: "w1",
      projectGid: "p1",
      assigneeGid: "a1",
      cc: asanaCc,
    });
  });

  it("lastSubmitFields는 화이트리스트 키만 남긴다", () => {
    expect(asanaLastSubmitFields({ ...fields, ...UI_ONLY })).toEqual({
      workspaceGid: "w1",
      workspaceName: "WS",
      projectGid: "p1",
      projectName: "Proj",
      assigneeGid: "a1",
      assigneeName: "담당",
      cc: asanaCc,
    });
  });
});

describe("clickup", () => {
  const fields = {
    workspaceId: "w1",
    workspaceName: "WS",
    spaceId: "s1",
    spaceName: "Space",
    listId: "l1",
    listName: "List",
    assigneeId: "a1",
    assigneeName: "담당",
    cc,
  };

  it("제출 인자를 조립한다", () => {
    expect(clickupSubmitArgs({ ctx, inlineImages, captureFiles, fields, listId: "l1" })).toEqual({
      ctx,
      ...media,
      inlineImages,
      listId: "l1",
      assigneeId: "a1",
      cc,
    });
  });

  it("lastSubmitFields는 workspace·space까지 남긴다", () => {
    expect(clickupLastSubmitFields({ ...fields, ...UI_ONLY })).toEqual({
      workspaceId: "w1",
      workspaceName: "WS",
      spaceId: "s1",
      spaceName: "Space",
      listId: "l1",
      listName: "List",
      assigneeId: "a1",
      assigneeName: "담당",
      cc,
    });
  });
});

describe("slack", () => {
  const fields = {
    channelId: "c1",
    channelName: "#bug",
    mentions: [{ id: "u1", name: "User" }],
  };

  it("제출 인자를 조립한다", () => {
    expect(slackSubmitArgs({ ctx, inlineImages, captureFiles, fields, channelId: "c1" })).toEqual({
      ctx,
      ...media,
      inlineImages,
      channelId: "c1",
      mentions: fields.mentions,
    });
  });

  it("lastSubmitFields는 화이트리스트 키만 남긴다", () => {
    expect(slackLastSubmitFields({ ...fields, ...UI_ONLY })).toEqual({
      channelId: "c1",
      channelName: "#bug",
      mentions: fields.mentions,
    });
  });
});

// requireMediaUpload를 받는 건 3플랫폼뿐이다. 타입이 이미 막지만 이 describe가 따로 필요한 건
// toEqual이 **값이 undefined인 키를 무시**하기 때문이다 — `requireMediaUpload: undefined`가
// 실리면 위 플랫폼별 toEqual은 전부 통과하고 여기서만 잡힌다.
describe("requireMediaUpload 축", () => {
  it("github·notion·gitlab만 이 키를 산출한다", () => {
    const base = { ctx, inlineImages, captureFiles };
    expect("requireMediaUpload" in slackSubmitArgs({ ...base, fields: { channelId: "c1" }, channelId: "c1" })).toBe(false);
    expect("requireMediaUpload" in asanaSubmitArgs({ ...base, fields: { workspaceGid: "w1" }, workspaceGid: "w1" })).toBe(false);
    expect("requireMediaUpload" in clickupSubmitArgs({ ...base, fields: { listId: "l1" }, listId: "l1" })).toBe(false);
    expect("requireMediaUpload" in linearSubmitArgs({ ...base, fields: { teamId: "t1" }, teamId: "t1" })).toBe(false);
    expect(
      "requireMediaUpload" in
        jiraSubmitArgs({ ...base, fields: {}, projectKey: "B", issueTypeId: "1", summary: "t" }),
    ).toBe(false);
  });
});
