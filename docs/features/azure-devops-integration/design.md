# Azure DevOps Boards 연동 — 기술 설계

## 개요

GitLab 통합을 1:1 템플릿으로 미러링하되 인증은 **PAT only**(Basic auth), 생성은 **JSON Patch** 페이로드, 본문은 **마크다운 네이티브**(변환기 불필요)다. organization URL 정규화는 GitLab `gitlabInstanceUrl.ts`를 미러한다. OAuth·self-hosted는 비목표.

## 변경 범위

### 신규 파일 (GitLab 미러)

| GitLab 템플릿 | Azure 신규 파일 | 역할 |
|---|---|---|
| `src/types/gitlab.ts` | `src/types/azure.ts` | 타입 |
| `src/background/gitlab-api.ts` | `src/background/azure-api.ts` | REST 어댑터(JSON Patch) |
| `src/background/gitlab-oauth.ts` | (없음 — PAT only, OAuth 비목표) | — |
| `src/sidepanel/lib/buildGitlabIssueBody.ts` | `src/sidepanel/lib/buildAzureIssueBody.ts` | 마크다운 본문(GitLab과 거의 동일) |
| `src/sidepanel/lib/submitToGitlab.ts` | `src/sidepanel/lib/submitToAzure.ts` | 업로드+생성 |
| `connect/gitlabInstanceUrl.ts` | `connect/azureOrgUrl.ts` | org URL 정규화 |
| `gitlabFields/ProjectCombobox.tsx` | `azureFields/ProjectCombobox.tsx` | project 선택 |
| (신규) | `azureFields/WorkItemTypeCombobox.tsx` | work item type 선택 (Azure 고유) |
| `gitlabFields/AssigneeCombobox.tsx` | `azureFields/AssigneeCombobox.tsx` | assignee |
| `gitlabFields/GitlabIssueFields.tsx` | `azureFields/AzureIssueFields.tsx` | 필드 폼 |
| `connect/GitlabConnectForm.tsx` | `connect/AzureConnectForm.tsx` | 연결(org URL + PAT) |
| `statusBadges/GitlabStatusBadge.tsx` | `statusBadges/AzureStatusBadge.tsx` | State 토글 배지 |
| `statusBadges/GitlabSubmittedBadge.tsx` | `statusBadges/AzureSubmittedBadge.tsx` | State fetch/렌더 |

### 수정 파일 (공유 인프라)

GitLab과 동일한 11개 지점. 차이: OAuth 관련(`isXxxOAuthConfigured`, oauth.available/startOAuth 메시지, refresh-hook, env var) **전부 생략**.

- `src/types/platform.ts`: `"azure"` 추가; `PLATFORM_TAB_KEYS.azure`; `Accounts.azure?`; `AzureLastSubmitFields` + `LastSubmitFieldsByPlatform.azure?`.
- `manifest.config.ts`: `host_permissions`에 `"https://dev.azure.com/*"`. (OAuth 없음 → 프록시·env 불필요)
- `src/background/messages.ts`: `azure.*` 케이스(OAuth 케이스 제외) + `loadAzureAuth()`.
- `src/types/messages.ts`: `azure.*` 유니언.
- `src/sidepanel/tabs/IntegrationsTab.tsx`: `SiAzuredevops` 아이콘 + PLATFORMS 엔트리.
- `src/lib/settings-storage.ts`: `accounts.azure?`; `readStoredAzureAuth()` (OAuth 토큰 write 함수는 불필요 — PAT 불변).
- `src/store/settings-store.ts`: `updateAzureAccount()`; `SETTINGS_STORE_VERSION` +1.
- `src/sidepanel/tabs/IssueCreateModal.tsx`: azure 제출 분기 + lastSubmitFields.
- `src/sidepanel/hooks/usePlatformFields.ts`: azure 필드.
- `src/sidepanel/tabs/issueListUtils.ts`: `resolveAzureCoords()`.
- `src/store/issues-store.ts`: `azureOrg?: string`, `azureProject?: string`, `azureWorkItemId?: number`.
- `src/i18n/integrations.ts` + `issue.ts`: `azure.*` 키.
- `.env.example`: (Azure는 OAuth 비목표 → env 추가 없음).

## 데이터 흐름

```
IssueCreateModal (azure 선택)
  → submitToAzure({ org, project, workItemType, assigneeUniqueName, ctx, images, video, logs })
     1. sendMessage("azure.uploadAttachments", {org, files})
        ↳ POST {org}/_apis/wit/attachments?fileName=… → { id, url }  (work item 불필요, 선업로드 OK)
     2. buildAzureIssueBody(ctx, attachmentUrls) → 마크다운 (이미지: ![](attUrl) 인라인)
     3. sendMessage("azure.submitIssue", { payload }) → createWorkItem (JSON Patch)
        ↳ POST {org}/{project}/_apis/wit/workitems/${type}  (Content-Type: application/json-patch+json)
           [ {op:add,path:/fields/System.Title}, {op:add,path:/fields/System.Description},
             {op:add,path:/fields/System.AssignedTo}?,
             {op:add,path:/relations/-, value:{rel:"AttachedFile",url}} ... ]
  → NormalizedSubmitResult { url: _links.html.href, key: String(workItemId) }
  → issues-store에 azureOrg/azureProject/azureWorkItemId 저장
```

> GitLab과 달리 **attachment를 work item 생성 전에 업로드 가능**(attachment는 work item 독립). 따라서 GitLab의 선업로드→본문 임베드 흐름을 그대로 유지하되, attachment 링크는 description 인라인 + `/relations/-` AttachedFile 양쪽.

## 인터페이스 설계

### `src/types/azure.ts`

```typescript
import type { PlatformAccountBase } from "./platform";

export interface AzurePatAuth {
  kind: "pat";
  pat: string;
  org: string;            // organization name (URL에서 정규화)
  baseUrl: string;        // https://dev.azure.com/{org}
  viewerName: string;
  viewerEmail?: string;
}
export type AzureAuth = AzurePatAuth;   // MVP는 단일 variant (후속 OAuth 시 유니언화)

export interface AzureDefaults {
  project?: string;
  workItemType?: string;  // "Bug" 기본
}
export interface AzureAccount extends PlatformAccountBase<"azure"> {
  auth: AzureAuth;
  defaults: AzureDefaults;
}

export interface AzureMyself { id: string; displayName: string; uniqueName?: string; }
export interface AzureProject { id: string; name: string; }
export interface AzureWorkItemTypeInfo { name: string; referenceName: string; }
export interface AzureIdentity { id: string; displayName: string; uniqueName: string; }

export interface AzureCreateWorkItemPayload {
  org: string;
  project: string;
  workItemType: string;
  title: string;
  description: string;          // 마크다운
  assigneeUniqueName?: string;
  attachmentRelations?: { url: string; comment?: string }[];
}
export interface AzureCreateWorkItemResult {
  id: number;
  url: string;                  // _links.html.href
}
export interface AzureWorkItemStatus {
  id: number;
  title: string;
  state: string;                // System.State
  url: string;
}
```

### `src/background/azure-api.ts`

```typescript
export class AzureError extends Error { status: number; body?: unknown; }
export function buildAuthHeader(auth: AzureAuth): string;   // `Basic base64(":" + pat)`
export function messageForAzureStatus(status: number): string;
export async function azureFetch<T>(auth: AzureAuth, path: string, init?: RequestInit): Promise<T>;
  // baseUrl + path + api-version=7.1 자동 부착
export async function getConnectionData(auth: AzureAuth): Promise<AzureMyself>;   // _apis/connectionData (검증 + viewer)
export async function getProjects(auth: AzureAuth): Promise<AzureProject[]>;       // _apis/projects
export async function getWorkItemTypes(auth: AzureAuth, project: string): Promise<AzureWorkItemTypeInfo[]>; // {project}/_apis/wit/workitemtypes
export async function searchIdentities(auth: AzureAuth, query: string): Promise<AzureIdentity[]>;  // _apis/IdentityPicker 또는 GraphUsers
export function buildPatchDocument(p: AzureCreateWorkItemPayload): Array<{op:string;path:string;value:unknown}>; // 순수 함수, 테스트 대상
export async function createWorkItem(auth: AzureAuth, payload: AzureCreateWorkItemPayload): Promise<AzureCreateWorkItemResult>;
export async function uploadAttachment(auth: AzureAuth, fileName: string, blob: Blob): Promise<{ id: string; url: string }>;
  // POST {org}/_apis/wit/attachments?fileName=…  (body: binary)
export async function getWorkItemStatus(auth: AzureAuth, project: string, id: number): Promise<AzureWorkItemStatus>;
export async function updateWorkItemState(auth: AzureAuth, project: string, id: number, state: string): Promise<AzureWorkItemStatus>;
  // PATCH {project}/_apis/wit/workitems/{id}  ([{op:add,path:/fields/System.State,value:state}])
```

API base: `https://dev.azure.com/{org}`. 모든 호출 `?api-version=7.1`. 생성/수정은 `Content-Type: application/json-patch+json`.

### `src/sidepanel/lib/buildAzureIssueBody.ts`

GitLab `buildGitlabIssueBody`와 거의 동일 — 마크다운 그대로 생성. 차이: 첨부 이미지를 Azure attachment URL로 `![](url)` 인라인, 영상/로그는 마크다운 링크. **신규 변환기 없음**.

### `src/sidepanel/tabs/connect/azureOrgUrl.ts`

```typescript
export function normalizeAzureOrgUrl(input: string): { org: string; baseUrl: string };
  // "https://dev.azure.com/contoso/" → { org: "contoso", baseUrl: "https://dev.azure.com/contoso" }
  // "contoso" 단독 입력도 허용. 잘못된 호스트는 throw.
```
GitLab `normalizeInstanceUrl` 미러 + org 추출.

## 기존 패턴 준수

- 스토리지/스토어/메시지/per-file 업로드 격리/i18n 동시 갱신 모두 GitLab 패턴.
- PAT 불변이라 refresh-hook 불필요 (OAuth 비목표).
- 상태 배지는 GitLab `opened/closed` → Azure `System.State` 문자열로 일반화.

## 대안 검토

1. **OAuth(Entra) MVP 포함**: confidential client → secret 관리 + 프록시 엔드포인트 신규 + AAD 앱 등록. 비용 대비 MVP 과함 → PAT-우선, OAuth 후속. (기존 Jira/GitHub/Notion도 PAT/토큰 수동 경로 보유)
2. **description을 HTML로 전송**: 안전하지만 HTML 변환기 신규 필요. 마크다운 네이티브가 가능하면 변환기 0 → 마크다운 우선, format 미지원 시 폴백(위험 요소).
3. **work item type 고정("Bug")**: 단순하지만 Issue/Task만 쓰는 process(Basic)에선 Bug가 없어 실패 → type 동적 조회 채택.

## 위험 요소

- **마크다운 field format (최대 리스크)**: Azure work item 대용량 텍스트 필드는 전통적으로 HTML이며, 마크다운 렌더는 비교적 최근 기능이고 필드 format 설정에 의존. **구현 전 반드시 검증**: 실제 org에서 description에 마크다운 전송 후 렌더 확인. 미지원이면 ① `multilineFieldsFormat`/필드 format을 Markdown으로 설정하는 patch op 추가, 또는 ② `buildAzureIssueBody`를 HTML 출력으로 폴백(변환기 추가 — 이 경우 재사용 이점 감소). 이 분기를 tasks Task 0에서 확정.
- **Bug type의 repro 필드**: Bug work item은 `System.Description` 대신 `Microsoft.VSTS.TCM.ReproSteps`를 본문으로 쓰는 process가 있음 → type별 본문 필드 매핑 필요(MVP: Description 우선, Bug는 ReproSteps 병행 검토).
- **State 전이 규칙**: process별 허용 전이가 달라 임의 state PATCH가 거부될 수 있음 → 현재 state 조회 후 닫기/열기에 해당하는 state만 best-effort.
- **identity 검색 API**: assignee는 `uniqueName`(이메일) 기반. IdentityPicker/Graph API 권한·형태 검증 필요. MVP는 assignee optional로 두고 미선택 허용.
- **회귀**: PlatformId 확장 → exhaustive switch 컴파일 에러로 누락 검출(typecheck).
