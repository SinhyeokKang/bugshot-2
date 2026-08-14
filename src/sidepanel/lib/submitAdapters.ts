import type { CaptureFiles } from "./buildCaptureFiles";
import type { MarkdownContext } from "./buildIssueMarkdown";
import type { InlineImageInput } from "./resolveInlineImages";
import type { AsanaSubmitInput } from "./submitToAsana";
import type { ClickupSubmitInput } from "./submitToClickup";
import type { GithubSubmitInput } from "./submitToGithub";
import type { GitlabSubmitInput } from "./submitToGitlab";
import type { JiraSubmitInput } from "./submitToJira";
import type { LinearSubmitInput } from "./submitToLinear";
import type { NotionSubmitInput } from "./submitToNotion";
import type { SlackSubmitInput } from "./submitToSlack";
import type { EditorIssueFields } from "@/store/editor-store";
import type { AsanaIssueFieldsValue } from "@/sidepanel/tabs/asanaFields/AsanaIssueFields";
import type { ClickupIssueFieldsValue } from "@/sidepanel/tabs/clickupFields/ClickupIssueFields";
import type { GithubIssueFieldsValue } from "@/sidepanel/tabs/githubFields/GithubIssueFields";
import type { GitlabIssueFieldsValue } from "@/sidepanel/tabs/gitlabFields/GitlabIssueFields";
import type { LinearIssueFieldsValue } from "@/sidepanel/tabs/linearFields/LinearIssueFields";
import type { NotionIssueFieldsValue } from "@/sidepanel/tabs/notionFields/NotionIssueFields";
import type { NotionDatabaseSchema } from "@/types/notion";
import type { SlackIssueFieldsValue } from "@/sidepanel/tabs/slackFields/SlackIssueFields";
import type {
  AsanaLastSubmitFields,
  ClickupLastSubmitFields,
  GithubLastSubmitFields,
  GitlabLastSubmitFields,
  JiraLastSubmitFields,
  LinearLastSubmitFields,
  NotionLastSubmitFields,
  SlackLastSubmitFields,
} from "@/types/platform";

// 두 제출 진입점이 공유하는 **인자 매핑만** 담는다. 이 파일은 아무것도 실행하지 않는다 —
// 제출 후처리가 진입점마다 다르고 그 사이 순서에 의미가 있어서, 실행을 여기로 끌어오면
// 호출처에서 보이던 순서가 어댑터 안으로 숨는다.
// 반환 타입을 전부 명시하는 건 필수다: 리터럴이 함수 뒤로 들어가면 호출부의 excess property
// 검사가 사라져 optional 필드 오타가 무음이 된다(POSTMORTEM 2026-08-14).
// tabs에서 가져오는 건 전부 type-only여야 한다 — 값으로 바꾸면 컴포넌트 그래프가 딸려온다.

interface SubmitBase {
  ctx: MarkdownContext;
  inlineImages: InlineImageInput[];
  captureFiles: CaptureFiles;
}

// Slack 승격 경로에서만 켠다 — markSubmitted가 원본 blob을 파괴하므로, 미디어 업로드가
// 실패하면 이슈 등록 전에 중단해야 한다.
interface MediaGuard {
  requireMediaUpload?: boolean;
}

// 반환 타입을 박는 이유는 아래 각 함수와 같다 — 이건 스프레드로 들어가므로 리터럴 검사가
// **한 번 더** 비껴간다(반환 타입 명시는 자기 키만 지키고 스프레드 소스는 안 본다).
function media(captureFiles: CaptureFiles): Pick<
  CaptureFiles,
  "images" | "video" | "logs" | "attachments"
> {
  return {
    images: captureFiles.images,
    video: captureFiles.video,
    logs: captureFiles.logs,
    attachments: captureFiles.attachments,
  };
}

// projectKey·issueTypeId를 fields와 따로 받는 건 가드로 좁힌 값을 넘기기 위해서다. 특히
// projectKey는 `fields.projectKey ?? account.projectKey`로 **계정 fallback을 거친 유효값**이라
// fields.projectKey와 다를 수 있다 — 여기서 fields 쪽을 읽으면 그 fallback이 조용히 죽는다.
export function jiraSubmitArgs(input: SubmitBase & {
  fields: EditorIssueFields;
  projectKey: string;
  issueTypeId: string;
  summary: string;
}): JiraSubmitInput {
  const { ctx, inlineImages, captureFiles, fields } = input;
  return {
    ctx,
    inlineImages,
    ...media(captureFiles),
    projectKey: input.projectKey,
    summary: input.summary.trim(),
    issueTypeId: input.issueTypeId,
    assigneeAccountId: fields.assigneeId,
    priorityId: fields.priorityId,
    parentKey: fields.parentKey,
    sprintId: fields.sprintId,
    relates: fields.relates,
    cc: fields.cc,
  };
}

export function jiraLastSubmitFields(input: {
  fields: EditorIssueFields;
  projectKey: string;
  issueTypeId: string;
  siteId: string;
}): JiraLastSubmitFields {
  const { fields } = input;
  return {
    projectKey: input.projectKey,
    issueTypeId: input.issueTypeId,
    siteId: input.siteId,
    assigneeId: fields.assigneeId,
    assigneeName: fields.assigneeName,
    priorityId: fields.priorityId,
    priorityName: fields.priorityName,
    parentKey: fields.parentKey,
    parentLabel: fields.parentLabel,
    sprintId: fields.sprintId,
    sprintName: fields.sprintName,
    relates: fields.relates,
    cc: fields.cc,
  };
}

export function githubSubmitArgs(input: SubmitBase & MediaGuard & {
  fields: GithubIssueFieldsValue;
  owner: string;
  repo: string;
}): GithubSubmitInput {
  const { ctx, inlineImages, captureFiles, fields } = input;
  return {
    ctx,
    ...media(captureFiles),
    inlineImages,
    owner: input.owner,
    repo: input.repo,
    label: fields.label,
    assignee: fields.assignee,
    cc: fields.cc,
    requireMediaUpload: input.requireMediaUpload ?? false,
  };
}

// *LastSubmitFields 계열은 오늘 기준 전키 복사지만 `(f) => ({...f})`로 접지 않는다 — 이건
// chrome.storage에 영속되는 설정이고, *IssueFieldsValue에 UI 전용 필드가 하나 붙는 순간
// 그대로 딸려 들어간다. 명시 키 목록이 그걸 막는 유일한 화이트리스트다.
export function githubLastSubmitFields(
  fields: GithubIssueFieldsValue,
): GithubLastSubmitFields {
  return {
    owner: fields.owner,
    repo: fields.repo,
    label: fields.label,
    assignee: fields.assignee,
    cc: fields.cc,
  };
}

export function linearSubmitArgs(input: SubmitBase & {
  fields: LinearIssueFieldsValue;
  teamId: string;
}): LinearSubmitInput {
  const { ctx, inlineImages, captureFiles, fields } = input;
  return {
    ctx,
    ...media(captureFiles),
    inlineImages,
    teamId: input.teamId,
    projectId: fields.projectId,
    labelId: fields.labelId,
    assigneeId: fields.assigneeId,
    priority: fields.priority,
    cc: fields.cc,
  };
}

export function linearLastSubmitFields(
  fields: LinearIssueFieldsValue,
): LinearLastSubmitFields {
  return {
    teamId: fields.teamId,
    teamName: fields.teamName,
    teamKey: fields.teamKey,
    projectId: fields.projectId,
    projectName: fields.projectName,
    labelId: fields.labelId,
    labelName: fields.labelName,
    assigneeId: fields.assigneeId,
    assigneeName: fields.assigneeName,
    priority: fields.priority,
    cc: fields.cc,
  };
}

export function notionSubmitArgs(input: SubmitBase & MediaGuard & {
  fields: NotionIssueFieldsValue;
  databaseId: string;
  schema: NotionDatabaseSchema;
}): NotionSubmitInput {
  const { ctx, inlineImages, captureFiles, fields, schema } = input;
  return {
    ctx,
    ...media(captureFiles),
    inlineImages,
    databaseId: input.databaseId,
    titlePropertyName: schema.titlePropertyName,
    statusOption:
      fields.statusOption && schema.statusProperty
        ? { propertyName: schema.statusProperty.name, optionName: fields.statusOption }
        : undefined,
    selectValues: fields.selectValues,
    cc: fields.cc?.map((u) => u.id),
    requireMediaUpload: input.requireMediaUpload ?? false,
  };
}

export function notionLastSubmitFields(
  fields: NotionIssueFieldsValue,
): NotionLastSubmitFields {
  return {
    databaseId: fields.databaseId,
    databaseTitle: fields.databaseTitle,
    statusOption: fields.statusOption,
    selectValues: fields.selectValues,
    cc: fields.cc,
  };
}

export function gitlabSubmitArgs(input: SubmitBase & MediaGuard & {
  fields: GitlabIssueFieldsValue;
  projectId: number;
}): GitlabSubmitInput {
  const { ctx, inlineImages, captureFiles, fields } = input;
  return {
    ctx,
    ...media(captureFiles),
    inlineImages,
    projectId: input.projectId,
    label: fields.label,
    assigneeId: fields.assigneeId,
    // GitLab 멘션은 username이라 cc 객체에서 그것만 뽑는다(다른 플랫폼은 id 또는 객체 그대로).
    cc: fields.cc?.map((u) => u.username),
    requireMediaUpload: input.requireMediaUpload ?? false,
  };
}

export function gitlabLastSubmitFields(
  fields: GitlabIssueFieldsValue,
): GitlabLastSubmitFields {
  return {
    projectId: fields.projectId,
    projectPath: fields.projectPath,
    label: fields.label,
    assigneeId: fields.assigneeId,
    assigneeName: fields.assigneeName,
    cc: fields.cc,
  };
}

export function asanaSubmitArgs(input: SubmitBase & {
  fields: AsanaIssueFieldsValue;
  workspaceGid: string;
}): AsanaSubmitInput {
  const { ctx, inlineImages, captureFiles, fields } = input;
  return {
    ctx,
    ...media(captureFiles),
    inlineImages,
    workspaceGid: input.workspaceGid,
    projectGid: fields.projectGid,
    assigneeGid: fields.assigneeGid,
    cc: fields.cc,
  };
}

export function asanaLastSubmitFields(
  fields: AsanaIssueFieldsValue,
): AsanaLastSubmitFields {
  return {
    workspaceGid: fields.workspaceGid,
    workspaceName: fields.workspaceName,
    projectGid: fields.projectGid,
    projectName: fields.projectName,
    assigneeGid: fields.assigneeGid,
    assigneeName: fields.assigneeName,
    cc: fields.cc,
  };
}

export function clickupSubmitArgs(input: SubmitBase & {
  fields: ClickupIssueFieldsValue;
  listId: string;
}): ClickupSubmitInput {
  const { ctx, inlineImages, captureFiles, fields } = input;
  return {
    ctx,
    ...media(captureFiles),
    inlineImages,
    listId: input.listId,
    assigneeId: fields.assigneeId,
    cc: fields.cc,
  };
}

export function clickupLastSubmitFields(
  fields: ClickupIssueFieldsValue,
): ClickupLastSubmitFields {
  return {
    workspaceId: fields.workspaceId,
    workspaceName: fields.workspaceName,
    spaceId: fields.spaceId,
    spaceName: fields.spaceName,
    listId: fields.listId,
    listName: fields.listName,
    assigneeId: fields.assigneeId,
    assigneeName: fields.assigneeName,
    cc: fields.cc,
  };
}

export function slackSubmitArgs(input: SubmitBase & {
  fields: SlackIssueFieldsValue;
  channelId: string;
}): SlackSubmitInput {
  const { ctx, inlineImages, captureFiles, fields } = input;
  return {
    ctx,
    ...media(captureFiles),
    inlineImages,
    channelId: input.channelId,
    mentions: fields.mentions,
  };
}

export function slackLastSubmitFields(
  fields: SlackIssueFieldsValue,
): SlackLastSubmitFields {
  return {
    channelId: fields.channelId,
    channelName: fields.channelName,
    mentions: fields.mentions,
  };
}
