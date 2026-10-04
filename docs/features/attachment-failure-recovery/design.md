# 파일 첨부 실패 처리와 재첨부 — 기술 설계

## 개요

파일 의도 목록 → 원본 존재 확인·제출 시점 생성물 저장 → 원격 생성 체크포인트 → 파일별 결과 확정 → 결과 화면의 순서로 제출한다. 결과는 업로드 여부만이 아니라 이슈에서 파일에 접근할 수 있는지를 기준으로 한다. 신규 작성과 저장 draft가 같은 준비·완료 함수를 사용한다.

두 단계로 나눈다.

- **1단계**: 결과 계약, 내부 마커 제거, 부분 실패 시 미완료 원본 보존(삭제 보류)·다운로드, 생성 체크포인트, 등록 여부 미확인 처리, 30일 보존 기한, 지속 표시(완료 화면 변형·목록 표시·복구 상세). Jira 제출 메시지 분해도 1단계에 포함한다(체크포인트 전제).
- **2단계**: 이슈 목록 **첨부 재시도**, 원격 본문 3-way 패치, `navigator.locks` 기반 교차 인스턴스 배타, 재시작 후 재개.

기준 코드는 2026-10-01 `6274b9e6`. 기존 `logsDropped`·`mediaDropped`는 마이그레이션 중 UI 호환용으로만 파생하고, 1단계의 전 어댑터 전환이 끝나면 제거한다. 새 영속 레코드에 두 boolean을 중복 저장하지 않는다.

## 변경 범위

| 파일/모듈 | 현재 역할 | 변경 | 단계 |
|---|---|---|---|
| `src/types/attachment.ts` | 사용자 파일 메타 | 파일 의도·결과·복구 메타 타입 | 1 |
| `src/types/platform.ts`, `jira.ts`, `slack.ts`, `messages.ts` | 플랫폼 제출·업로드 응답 | 파일 ID/실패 단계 전달, 생성 체크포인트 식별자, Jira 분해 메시지 | 1 |
| `src/store/blob-db.ts` | IndexedDB v8, Blob 보관 | v9 `submissionRecovery` store, journal API, 키 단위 원본 삭제 API, **이슈 삭제용 정리 API** | 1 |
| `src/store/issues-store.ts` | 제출 가드·병합·원본 삭제·`pruneOrphanBlobs`(:311) | 복구 포인터, 부분 완료 시 삭제 보류, 영속 완료 관찰 API, 미확인 제출 차단, prune의 journal 참조 키 제외 | 1 |
| `src/store/editor-store.ts` | 라이브 결과 화면 상태 | 파일 결과가 포함된 제출 결과 전달 | 1 |
| `src/sidepanel/lib/resolveInlineImages.ts`, `buildCaptureFiles.ts`, `buildEditorCapture.ts` | 참조 해소·제출 파일 생성 | 예상 파일과 로딩 결과 비교, 무음 제외 중단 | 1 |
| `src/sidepanel/lib/submissionRecovery.ts` (신규) | — | 공통 준비·체크포인트 조정·완료·재시작 reconciliation·TTL 정리. `SubmissionProgress` 인터페이스 정의 위치 | 1 |
| `src/sidepanel/lib/attachmentResults.ts` (신규) | — | 순수 파일 결과 합성·성공 판정·오류 코드 정규화·결과 표시 여부 판정(토스트/패널) | 1 |
| `src/sidepanel/lib/submitTo*.ts`, `prepareUpload.ts`, `submitAdapters.ts` | 9개 제출 경로 | 파일별 결과와 생성 시점 통지, 생성 후 예외 격리. `submitToJira.ts`는 분해된 메시지를 사이드패널에서 오케스트레이션 | 1 |
| `src/background/messages.ts`, `*-api.ts`, `github-upload.ts` | 외부 호출 | 실제 실패 단계/HTTP 상태, 빈 locator 판정, `jira.submitIssue` → create/upload/updateDescription 분해 | 1 |
| 본문 빌더·`issueBodyShared.ts`·`resolveInlineImages.ts` | 본문 생성 | 내부 마커 제거, 실패 파일명과 사실에 맞는 안내 | 1 |
| `IssueCreateModal.tsx`, `DraftDetailDialog.tsx`, `SubmitFieldsDialog.tsx` | 제출 진입점 | 공통 완료 처리, 부분 성공을 전체 실패로 되돌리지 않음. `DraftDetailDialog` 읽기 전용 복구 모드 | 1 |
| `SubmitSuccessView.tsx`, `IssueTab.tsx`, `IssueListTab.tsx`, `IssueRow.tsx`, `src/sidepanel/tabs/issueListUtils.ts` | 결과·목록 | 부분 완료 변형, 행 메타 줄 경고, 복구 상세 진입, 다운로드, 재제출 가드, "제출" 필터 개수 | 1 |
| `src/sidepanel/components/AttachmentRecoveryPanel.tsx` (신규) | — | 완료 화면과 복구 상세의 공통 파일 목록 | 1 |
| `src/sidepanel/lib/retryAttachments.ts`, `retryAttachmentAdapters.ts`, `attachmentBodyPatch.ts` (신규) | — | 재시도 오케스트레이션·8플랫폼 재개·본문 충돌 판정 | 2 |
| `src/i18n/namespaces/{integrations,issue}.ts` | 문구 | 모든 현재 로케일에 원인 중립 문구·상태·동작 추가 | 1·2 |

## 인터페이스 설계

아래는 신설 계약이다. 파일 이름은 표시명이고 매칭 키가 아니다. 같은 이름의 사용자 첨부와 캡처가 충돌하지 않도록 ID를 메시지 경계까지 전달한다. 계약 타입은 `src/types`, journal 저장 API는 `src/store/blob-db.ts`에 둔다. store가 `@/sidepanel/lib/*`를 value import하지 않게 해 `store/__tests__/bundleBoundary.test.ts`의 `ALLOWED`를 늘리지 않는다.

```ts
type AttachmentKind = "capture" | "video" | "inline" | "logs" | "user";
type AttachmentFailureCode =
  | "missing-source" | "local-storage" | "authentication" | "permission"
  | "size-limit" | "rate-limit" | "network" | "timeout"
  | "invalid-response" | "body-limit" | "unknown";

interface SubmissionFile {
  id: string; // capture:before-0 / video / inline:<ref> / logs / user:<meta.id>
  kind: AttachmentKind;
  filename: string;
  contentType: string;
  dataUrl: string; // Runtime only; never persist in chrome.storage.
}

interface AttachmentResult {
  fileId: string;
  delivery: "attached" | "failed" | "unknown";
  // An attached file may still need its body reference updated.
  presentation: "complete" | "failed" | "not-applicable";
  failure?: {
    stage: "source" | "upload" | "link" | "body";
    code: AttachmentFailureCode;
    httpStatus?: number;
  };
}

interface CreatedDestination {
  platform: PlatformId;
  key: string;
  url?: string; // Preserve channelId/ts even if permalink lookup fails.
  locator: Record<string, string>; // Provider-specific allowlist; see below.
}

// Where the original bytes live: a key in an existing store (deferred deletion)
// or a generated copy inside the recovery store.
type RecoverySource =
  | { kind: "original"; store: "blobs" | "images" | "inlineImages" | "attachments"; key: string }
  | { kind: "generated"; key: string }; // file:<attemptId>:<fileId>

interface SubmissionRecoveryMeta {
  attemptId: string;
  issueId: string;
  title: string;
  platform: PlatformId;
  createdAt: number;
  expiresAt: number; // createdAt + 30 days
  localFilesRemoved?: boolean;
  phase: "prepared" | "creating" | "created" | "partial" | "complete" | "unknown";
  destination?: CreatedDestination;
  files: Array<Omit<SubmissionFile, "dataUrl"> & {
    source: RecoverySource;
    originalSource?: Extract<RecoverySource, { kind: "original" }>;
  }>;
  results: AttachmentResult[];
  submissionFailure?: AttachmentResult["failure"];
  // Phase 2 only.
  retry?: AttachmentRetrySnapshot;
  updatedAt: number;
}

interface NormalizedSubmitResult {
  key: string;
  url: string;
  attachments: AttachmentResult[];
}
```

`SubmissionProgress`는 파일이 아니라 신규 `submissionRecovery.ts`가 정의·export하는 인터페이스다.

```ts
interface SubmissionProgress {
  attemptId: string;
  beforeCreate(): Promise<void>;
  created(remote: CreatedDestination): Promise<void>;
  // Phase 2 adds fileCheckpoint(value: AttachmentCheckpoint): Promise<void>.
}
```

`CreatedDestination`는 구현 시 platform 판별 union으로 정의한다. 허용 locator는 Jira=issueKey/siteId, GitHub=owner/repo/number, GitLab=projectId/iid, Linear=issueId, Notion=pageId, Asana=taskGid, ClickUp=taskId, Slack=channelId/ts, Webhook=반환 key/url이다. 인증 정보·업로드 서명 URL은 보관하지 않는다.

`accountIdentity`(2단계 재시도의 계정 비교 키)는 플랫폼별로 아래처럼 정의한다. 토큰이 아니라 연결 시점에 이미 저장하는 식별자만 쓴다.

| 플랫폼 | accountIdentity |
|---|---|
| Jira | cloudId + accountId |
| GitHub | user id(login 아님 — 리네임 내성) |
| GitLab | baseUrl + user id |
| Linear | organization id + user id |
| Notion | workspace id + bot/owner user id |
| Asana | workspace gid + user gid |
| ClickUp | team id + user id |
| Slack | team id + user id |

## 데이터 흐름과 로컬 저장

### 1. 준비와 누락 검출

- 로그 토글·캡처 모드·활성 paragraph 섹션·사용자 첨부 설정으로 **예상 파일 ID 집합을 먼저** 정한다. 빈 로그처럼 현행상 파일이 생성되지 않는 경우는 기대 집합에서도 제외한다.
- 두 제출 진입점의 `getAttachmentBlob` null filter, `resolveInlineImagesForSections`의 조용한 return을 명시적인 로딩 결과로 바꾼다. 캡처/영상도 레코드의 존재 플래그와 Blob을 대조한다.
- 누락된 원본이 하나라도 있으면 `MissingSubmissionFilesError`로 제출 전에 중단한다. 누락을 어댑터로 넘겨 성공 처리하지 않는다.
- **원본은 복제하지 않는다.** journal에는 원본이 있는 기존 store의 키(`RecoverySource.original`)만 기록한다.
- 제출 시점에 새로 만들어지는 바이트만 journal에 Blob으로 저장한다: `buildCaptureFiles`의 logs.html(생성 후 로그 역링크 삽입 전), Asana JPEG 변환본, Notion `zipLogsHtml` ZIP. logs.html은 이후 로그가 늘어도 다운로드 내용이 바뀌지 않게 이 사본을 쓴다. 2단계 재시도의 전송용 변환 Blob도 이 사본을 재사용해 같은 바이트를 보낸다.
- 기대 파일이 0개인 제출도 생성 체크포인트(등록 여부 미확인 판정)를 위해 파일 목록이 빈 journal을 만든다. 완료 시 즉시 정리한다.
- 다운로드 파일명 확장자는 실제 dataUrl MIME에 맞춘다. 외부 업로드 MIME 교정은 별도이며 여기서 모든 업로드 계약을 바꾸지 않는다.

### 2. 복구 journal과 원본 삭제 보류

기존 DB `bugshot-video`를 v8→v9로 올리고 `submissionRecovery` store 하나를 추가한다. 메타 키는 `attempt:<issueId>`, 생성물 Blob 키는 `file:<attemptId>:<fileId>`. 메타와 생성물 Blob을 **동일 readwrite 트랜잭션**으로 저장한다. 기존 8개 store의 데이터는 이동하지 않는다.

v9 업그레이드 시 옛 버전 패널이 연결을 쥐고 있으면 `onblocked`가 reject한다(`blob-db.ts:51-54`). 이 경우 begin이 throw해 제출이 막히므로 “다른 BugShot 패널을 닫고 다시 시도하세요” 안내 문구를 둔다. e2e seed가 DB 버전을 하드코딩하므로(`e2e/slack-promote-media-guard.spec.ts:75`, `e2e/GOTCHAS.md`) 버전 상수를 seed와 함께 올린다.

`blob-db.ts`에 아래 API를 추가한다. 기존 Blob API는 getter가 null, setter가 false를 돌려주는 규약이지만 이 API는 실패를 throw한다. 준비 실패 뒤 외부 전송하면 안 되기 때문이다.

```ts
beginSubmissionRecovery(meta: SubmissionRecoveryMeta, generated: Map<string, Blob>): Promise<void>;
checkpointSubmission(issueId: string, attemptId: string,
  patch: Pick<SubmissionRecoveryMeta, "phase" | "destination" | "results">): Promise<void>;
readSubmissionRecovery(issueId: string): Promise<SubmissionRecoveryMeta | null>;
readRecoveryFile(meta: SubmissionRecoveryMeta, fileId: string): Promise<Blob | null>;
listSubmissionRecoveries(): Promise<SubmissionRecoveryMeta[]>;
deleteSubmissionRecovery(issueId: string, attemptId: string): Promise<void>;
// Called by issues-store on removeIssue/clearIssues — lives here so the store
// needs no sidepanel/lib import (bundleBoundary).
purgeRecoveryForIssues(issueIds: string[]): Promise<void>;
// Deletes the original-store keys of completed files only.
deleteOriginalKeys(issueId: string, attemptId: string, sources: RecoverySource[]): Promise<void>;
// Also removes unneeded issue-owned raw logs, thumbnails and pre-transform media.
cleanupSubmissionOriginals(issueId: string, attemptId: string): Promise<void>;
```

- `begin`은 같은 issueId의 미완료 attempt가 있으면 거절한다. 확인·생성을 같은 IDB 트랜잭션으로 수행한다. `withIssueSubmitGuard`는 프로세스 내 집합에 더해 `bugshot-submission:<issueId>` Web Lock을 준비부터 완료까지 잡는다. 락 획득 뒤 최신 Chrome 저장분의 submitted·복구 포인터·삭제 여부를 읽고, 이후 journal을 확인한다. 이전 패널이 정상 완료해 journal을 지운 뒤라도 storage 이벤트를 아직 받지 않은 패널의 재생성을 막는다. 저장분 읽기 실패와 잠금 API 부재는 제출을 차단한다. Slack 보존본 승격 예외는 유지한다.
- 체크포인트는 attemptId 일치와 허용 상태 전이를 확인한다. 오래된 호출이 새 제출 결과를 덮지 못한다. 네트워크 await를 IDB transaction 안에 넣지 않는다.
- 원본 정리도 현재 issueId·attemptId를 같은 트랜잭션에서 검증한다. `deleteOriginalKeys`는 partial/complete journal의 완료된 파일만 정리하며 다른 journal·일반 draft·편집 세션이 참조하는 원본을 보존한다. 목록 영속화 성공 뒤, journal 삭제 전에 호출한다. 참조 조회 실패는 삭제로 진행하지 않는다. 생성 시 원본 존재도 journal 트랜잭션 안에서 다시 확인한다.
- **삭제 보류**: `markSubmittedDurably`는 해당 목록 write의 성공을 관찰하고 Blob을 지우지 않는다. 이후 `cleanupSubmissionOriginals`가 미완료 파일·공유 참조를 보호하면서 완료 원본과 불필요한 issue 소유 원시 로그·썸네일·비전송 미디어를 한 트랜잭션에서 정리한다. Asana 변환본의 `originalSource`도 추적한다. 목록 메타를 비우는 `stripSubmitted` 뒤에도 journal에서 남은 원본을 찾는다. complete 포인터는 정리와 journal 삭제가 끝날 때까지 유지하고, journal 삭제 뒤 포인터 저장이 실패하면 재시작 시 최신 저장분을 우선해 포인터만 정리한다. Slack 보존본은 이 자동 정리에서 제외한다.
- **GC 제외**: 부분 완료 레코드는 목록에 남아 `pruneOrphanBlobs`(`issues-store.ts:311`, 목록에 없는 issueId 키만 지움)는 원본을 건드리지 않는다. 다만 inline GC처럼 레코드의 `draft.sections` 참조로 살아있음을 판정하는 경로는 `stripSubmitted` 뒤에 참조가 사라지므로, live journal의 `RecoverySource` 키를 제외 집합으로 받는다. journal store 자체는 별도 store라 어떤 기존 GC도 순회하지 않는다.
- `IssueRecord`에는 optional `submissionRecoveryId`만 추가한다. journal이 복구 상태의 단일 출처다. 없음은 기존 동작이며 별도 issues-store version bump는 불필요하다. 부분 완료 포인터를 `stripSubmitted`가 의도적으로 보존하고, 해제 액션은 `updatedAt`을 갱신한다(#240 병합 규칙의 전제).
- **보존 기한**: `expiresAt = createdAt + 30일`. 패널 초기화 시 `reconcileSubmissionRecovery`가 만료 journal의 생성물·보류 원본을 지우고 메타의 `localFilesRemoved`를 기록한다. 만료 journal끼리는 보존 근거가 되지 않는다. 미만료 journal·일반 draft·편집 세션의 공유 참조 때문에 원본 바이트를 유지하더라도 만료된 journal의 읽기는 “로컬 파일 없음”으로 처리한다. 원격 상태는 건드리지 않는다.
- **삭제 순서**: 일반 제출 완료·로컬 사본 삭제·이슈 삭제·전체 이슈 삭제에 각각 journal 정리를 연결한다. 사용자 삭제는 journal 무효화/삭제를 먼저 완료한 뒤 목록을 삭제해 재시작 reconciliation이 지운 항목을 부활시키지 않게 한다. journal 삭제가 실패하면 목록 항목도 지우지 않는다. 늦게 도착한 checkpoint는 존재하지 않는 attempt를 다시 만들지 않는다. 브라우저 저장 데이터 제거는 기존과 같이 복구 불가다.
- **영속 완료 관찰 API**: complete journal을 먼저 기록하고 이슈 목록에 submitted를 영속한 뒤 사본·원본을 삭제한다. 현재 `markSubmitted`는 동기 void이고, persist `setItem`(`issues-store.ts:111-120`)은 Promise를 호출자에게 돌려주지 않으며 `chromeLocalStorage.setItem`은 에러를 삼킨다(`store/chrome-storage.ts:18-23`). 그래서 `markSubmittedDurably(id, patch, opts): Promise<void>`를 신설해 해당 write의 성공/실패를 관찰하고, 실패면 reject해 호출자가 삭제를 건너뛰게 한다. 이 write도 `pendingOwnWrites` 에코 가드 집합에 들어가야 하며, 그 상호작용을 테스트로 고정한다. 기존 `markSubmitted`는 정상 제출 경로를 위해 시그니처를 유지한다. 중간 종료 시 journal로 목록을 복구한다.
- 조회 시 복구 Blob이 유실됐거나 만료로 지워졌으면 다운로드 버튼 대신 “로컬 파일 없음”을 표시한다. 다운로드 동작을 성공으로 위장하지 않는다.

파일 결과와 별개인 `submissionFailure`는 부모 생성 뒤 Slack 상세 메시지·permalink 처리 실패 같은 제출 전체의 후속 실패를 저장한다. 파일이 0개라도 이 값이 있으면 partial이며 complete 체크포인트는 거부된다. 생성 이전 begin에는 허용하지 않고, 재시작·만료에도 보존한다. `NormalizedSubmitResult`도 같은 선택 필드를 전달한다. B4 UI는 파일 결과의 `every`만으로 완료를 판정하지 않는다.

### 3. 생성 체크포인트와 중단

어댑터에 `SubmissionProgress`를 넘긴다. 업로드 선행 플랫폼은 생성 API 직전에 `beforeCreate`, 응답 직후 `created`를 await한다. 생성 선행 플랫폼은 후속 첨부 작업보다 먼저 `created`를 await한다. 모든 체크포인트는 사이드패널이 쓴다. background는 IDB journal을 쓰지 않는다.

**Jira 분해**: 현재 `jira.submitIssue`는 생성·업로드·본문 갱신을 background 단일 메시지(`messages.ts:821-911`) 안에서 수행해 사이드패널이 생성 시점을 볼 수 없다. 이를 `jira.createIssue` / `jira.uploadAttachment`(파일당 1메시지) / `jira.updateIssueDescription` 세 메시지로 쪼개 다른 8개 플랫폼과 같은 사이드패널 오케스트레이션으로 맞춘다. 이로써 background의 IDB 쓰기, 업로드 전체가 `onMessage` 하나에 묶이는 SW 수명 문제, 다파일 단일 메시지의 64MiB 한도 위험이 함께 사라진다. 승격 원본 소실 회고(POSTMORTEM 2026-06-30)가 요구한 프로토콜 변경과 같은 방향이다. 기존 refresh 경로(`jira-api.ts`)와 `getMediaFileId` 폴백은 각 메시지 안에서 유지한다. 본문 빌더의 `withLocale` 래핑은 분해 후에도 background `updateIssueDescription` 진입점에 그대로 두고 `bodyLocale`을 payload로 싣는다.

created 이후 실패는 destination과 파일 결과를 가진 부분 완료로 반환한다. 업로드 배치 자체가 throw하면 미완료 파일은 unknown으로 표시한다. per-file 확정 실패는 failed다. 생성 이후 로컬 체크포인트·목록 저장·정리가 실패하면 `recovery.storageFailed`와 확정 목적지를 가진 결과를 전달한다. 저장 실패를 정상 완료로 숨기거나 일반 “제출 실패 → 다시 제출” 경로로 보내지 않는다. UI는 첨부 결과가 모두 성공이어도 `recovery`를 우선한다.

**생성 전 실패는 현행 유지**: prepared에서 생성 전 확정 실패(Linear `submitToLinear.ts`·Notion `submitToNotion.ts`의 생성 전 업로드 `Promise.all` throw 포함)는 기존처럼 제출 실패로 draft에 돌아가 재시도 가능하다. Slack 승격의 `requireMediaUpload` 가드(`DraftDetailDialog.tsx:517,603,645`)도 유지한다. 새 시도 전 이전 journal을 정리하며 원본 draft Blob은 원래 삭제되지 않았으므로 그대로다. 이미 올라간 미연결 파일은 원격 롤백하지 않는다.

creating 중 응답 유실 또는 종료는 unknown이다. 서버가 명시적으로 생성을 거절한 응답은 draft 재시도 가능하지만, 타임아웃·5xx·응답 파싱 실패는 생성 여부를 추정하지 않는다. created/partial/unknown journal이 있으면 `canSubmitIssue`와 두 제출 관문에서 새 생성을 막는다. unknown 해제는 복구 상세의 **등록되지 않았음 확인**(AlertDialog 확인 필수)만 허용하며, 실행 직전 journal을 재조회해 다른 패널이 기록한 created를 우선한다. 해제하면 journal을 정리하고 레코드를 draft로 되돌린다(원본은 삭제 보류 상태였으므로 그대로 남아 있다).

초기화와 외부 issues 동기화 시 journal을 읽어 목록 포인터를 복원하고 만료 journal을 정리하는 `reconcileSubmissionRecovery`를 신규 lib에 둔다. `main.tsx`에 상태 판단을 인라인하지 않는다. 기존 #240 병합 규칙의 submitted 우선·updatedAt·echo 가드를 유지한다. 목록 레코드가 사라졌어도 journal의 최소 title/platform/issueId/생성시각 메타로 복구 항목을 복원할 수 있게 구현 타입에 포함한다. 계정이 해제돼도 로컬 다운로드는 가능해야 한다.

초기 제출·reconcile·미확인 해제·이슈 삭제는 같은 Web Lock을 공유한다. 다른 패널이 진행 중인 prepared/creating attempt를 중단된 것으로 오판해 폐기하지 않는다. 2단계 재첨부도 같은 잠금 이름을 사용한다. unknown 해제의 journal 삭제 뒤 목록 저장 실패로 남은 포인터는 락 안에서 최신 저장분을 대조해 정리하며, 이미 submitted인 상태를 draft로 되돌리지 않는다.

### 4. 플랫폼별 완료 판정

| 플랫폼 | 생성 전 업로드 실패 | attached 판정 | 추가 처리 |
|---|---|---|---|
| GitHub/GitLab | 해당 없음(업로드 후 생성이지만 업로드 실패는 per-file로 보고하고 생성 진행) | 업로드 locator 존재 + 생성 본문에 파일 참조 포함 | 실패 inline ref를 현지화된 파일 누락 문구로 치환. GitLab 역링크 보강 실패는 기존 링크가 살아 있으므로 delivery 실패 아님 |
| Jira | 해당 없음(생성 선행) | 업로드 응답의 유효한 attachment id | 업로드 locator가 빈 응답은 invalid-response. 본문 갱신 실패는 presentation 실패. 사용자 파일도 결과 포함 |
| Linear | **현행 유지 — 제출 실패, draft 유지** | 이미지/영상은 생성 본문 참조, 로그는 attachment 연결 또는 본문 링크 중 하나 성공, 사용자 파일은 attachment 연결 성공 | `attachmentCreate.success`·`issueUpdate.success`를 확인. 두 로그 연결이 실패하면 link 실패. 파일 업로드 성공만으로 attached 금지 |
| Notion | **현행 유지 — 제출 실패, draft 유지** | 생성 요청에 파일 참조 블록이 실제 포함되고 page 응답 성공 | 절단은 `createPage`의 `children: expanded.slice(0, 100)`(`notion-api.ts:652-662`)에서 일어나고 첨부 블록이 끝에 붙어 가장 먼저 잘린다. 100블록 밖 파일은 body-limit. 재시도에서 누락 첨부만 기존 page에 분할 append; 일반 본문 복원 제외 |
| Asana/ClickUp | 해당 없음(생성 선행) | 생성된 task의 네이티브 첨부 locator | 본문 2차 write 실패와 첨부 실패를 구분. 생성 후 배치 요청 throw도 부분 완료 |
| Slack | 해당 없음 | `completeUploadExternal` 성공 | 파일별 grant→bytes(메시지당 1파일) 뒤 complete 1회. 확정 거절은 해당 파일 실패, internal/fatal/5xx/네트워크는 unknown(재호출 없음 — 2단계 B6에서 변경). permalink 실패여도 channelId/ts 체크포인트로 새 post 방지 |
| Slack → 트래커 승격 | **현행 유지 — `requireMediaUpload` 가드로 생성 전 중단** | 대상 트래커 규칙을 따른다 | 생성 이후 실패만 부분 완료 |
| Webhook multipart | 해당 없음 | 파일 파트 포함 + 2xx + key/url 계약 성공 | 수신 서버 내부 저장을 별도로 보증하지 않음. 응답 유실은 unknown, idempotencyKey는 기존 issueId 유지 |
| Webhook JSON | 해당 없음 | 파일 전송 대상 없음 | 기존 recorded:false·원본 보존 유지(`markSubmitted` 미호출). 파일 결과/복구 대상에서 제외 |

각 파일 결과는 ID 기준으로 누락·중복 응답을 대조한다. 사용자 표시명이 logs.html·screenshot.webp와 같아도 오염되지 않아야 한다(POSTMORTEM 2026-08-20 — Asana는 배열 위치, Jira는 `userAttachment` 플래그로 구분하던 함정). low-level 실패에 안전한 stage/code/httpStatus만 추가한다. GitHub MAIN world 함수는 self-contained를 유지하며 외부 helper를 주입 함수에서 참조하지 않는다.

### 5. 본문과 UX

**본문**

- 생성 선행 플랫폼의 최초 본문에는 실행용 내부 마커를 넣지 않는다. Jira는 내부 템플릿과 생성용 안전 폴백 ADF를 분리해 2차 갱신이 실패해도 마커가 남지 않게 한다. ClickUp도 최초 본문의 `inline:`을 안전 문구로 렌더한다.
- `logsNotAttached`라는 사용자 의도와 업로드 실패는 구분한다. 로그 요약의 건수는 유지하되 성공 확인 전 “첨부되어 있습니다”를 쓰지 않는다. 플랫폼에서 네이티브 첨부가 확인됐으면 본문 링크가 없어도 첨부 완료로 표현할 수 있다.

**완료 화면 (`SubmitSuccessView`)**

- 성공: 기존 화면 그대로(초록 `CircleCheck`, 스토어 리뷰 버튼 포함).
- 부분 완료: amber `CircleAlert`, 별도 제목 키(“이슈는 등록됐어요 · 첨부 N개 확인 필요”), **스토어 리뷰 요청 버튼 숨김**. 가운데 정렬 컬럼 대신 위쪽 정렬 `PageScroll`에 이슈 링크와 `AttachmentRecoveryPanel`을 넣고 `PageFooter`에 [확인]을 둔다.
- 등록 여부 미확인: 같은 레이아웃에 “등록됐는지 확인할 수 없어요” 제목과 다운로드만 둔다.
- partial을 기존 성공 토스트 뒤에 숨기지 않는다. `attachmentResults.ts`의 순수 함수로 파일 결과를 판정해 완료 화면의 복구 패널에 표시한다. 전 어댑터 전환 후 기존 누락 토스트와 boolean 계약은 제거했다(POSTMORTEM 2026-09-29의 판정 lib화 교훈).
- `SubmitFieldsDialog`의 성공 callback과 analytics가 partial을 전체 실패로 재분류하지 않게 한다. 신규 분석 속성은 추가하지 않는다.

**이슈 목록 (`IssueRow`·`IssueListTab`)**

- 부분 완료/미확인 행은 메타 줄에 amber 아이콘 + “첨부 확인 필요”(미확인은 “등록 확인 필요”) 텍스트를 넣는다. 색만으로 상태를 구분하지 않는다. `TONE_TEXT.amber`(`text-amber-600 dark:text-amber-400`)는 AA 미검증이라 눈으로 확인한다.
- 오른쪽 자리는 기존 `SubmittedBadge` 대신 Slack 승격 행과 같은 `ButtonGroup`(`h-8 w-8` 아이콘 버튼, `aria-label` 필수) [상세][첨부 재시도]로 대체한다. 1단계에서는 [상세]만 둔다. 재시도할 수 없는 상태면 [첨부 재시도]를 숨기고 상세로 유도한다.
- 부분 완료/미확인 행 자체를 누르면 외부 URL이 아니라 복구 상세가 열린다. URL은 상세 안의 [이슈 열기]로 옮긴다. 정상 submitted 행은 기존처럼 URL을 연다.
- 필터 탭은 전체/제출/초안 3개를 유지하고, “제출” 탭에 확인 필요 개수를 표시한다.
- 실행 중 재시도: 행 버튼을 `Loader2`로 바꾸고 `aria-busy`·`disabled`. 파일별 진행은 상세 패널에만 둔다. stale·unknown 쓰기가 있는 run은 스피너 없이 “결과 확인 필요”로 표시한다.

**복구 상세**

- 제출된 이슈용 상세는 지금 없다. 새 화면을 만들지 않고 `DraftDetailDialog`를 **읽기 전용 복구 모드**로 재사용한다. 편집 컨트롤은 숨기고 `AttachmentRecoveryPanel` 섹션, 남은 보존 기간(“N일 후 로컬 사본이 자동 삭제돼요”), 푸터 [이슈 열기][첨부 재시도]를 붙인다. 복구 레코드를 editable draft로 취급하지 않는다. 코드로 열 때는 `blurActiveElement()`를 먼저 호출한다.
- `AttachmentRecoveryPanel`은 파일명·종류·단계·현지화된 이유·재시도 진행·다운로드를 표시한다. 파일명은 `truncate` + `title={filename}`, 사유 줄은 `break-words`로 줄바꿈한다. 미완료 파일을 먼저 정렬하고 완료 파일은 “완료 n개”로 접는다. 패널은 Dialog 본문 스크롤을 따르고 내부 스크롤을 중첩하지 않는다. 파일별 상태는 lucide `h-4 w-4` 아이콘 + 텍스트를 함께 쓴다. 패널 안 텍스트 버튼은 `size="sm"`. raw API body, 개발용 마커, 내부 attemptId는 노출하지 않는다.
- **로컬 사본 삭제**: 기존 `AlertDialog` 패턴으로 확인을 받는다. 본문: “원격 이슈는 그대로 남고, 이 파일들은 다시 첨부할 수 없어요.” 원격 상태는 수정하지 않는다. Slack의 기존 `slackPreserved` 원본은 이 동작으로 지우지 않는다. 이슈 삭제는 기존 원본과 복구 자료 모두 지운다. known-created partial은 submitted 목적지를 먼저 영속한 뒤 복구 journal·포인터를 정리한다. unknown은 파일을 지워도 journal·포인터와 생성 차단을 남기며, 자동 만료도 명시적 포기로 취급하지 않는다. complete-but-retained는 로컬 완료 처리 실패를 안내하고 partial/unknown 전용 삭제를 노출하지 않는다.
- **등록되지 않았음 확인**(미확인 상태 전용): 상세 푸터의 보조 버튼. AlertDialog 문구: “목적지에서 이슈가 없는 걸 확인했나요? 실제로 등록됐다면 같은 이슈가 두 번 만들어집니다.” 확인 시 draft로 되돌린다.
- 재시도 완료 피드백: 끝나면 `role="status" aria-live="polite"` 영역에 요약 한 줄만 읽는다(파일마다 읽지 않음). 상세가 열려 있으면 패널을 갱신하고, 다른 화면에서 끝나면 `toast.success`(“첨부 3개 완료”) 또는 경고 토스트(“다시 2개 실패”)를 하나 띄운다.

**사용자 문구**

| 내부 상태 | 표시 문구 |
|---|---|
| upload failed | 업로드되지 않음 |
| link failed | 이슈에 연결되지 않음 |
| body failed (attached) | 첨부됨 · 본문 링크 없음 |
| unknown | 업로드 결과 확인 안 됨 |
| 완료 화면 partial 제목 | 이슈는 등록됐어요 · 첨부 N개 확인 필요 |
| 생성 여부 unknown 제목 | 등록됐는지 확인할 수 없어요 |
| 자료 삭제 | 로컬 사본 삭제 |

이행 기간의 기존 누락 안내는 원인을 단정하지 않아야 한다. 전 어댑터 전환 후 `submit.logsDropped` 등 기존 누락 토스트 키는 제거하고 파일별 안전한 실패 사유로 대체했다.

**재시도할 수 없는 상태 (2단계)**

| 상태 | 재시도 버튼 | 대신 보여줄 동작 | 문구 키(예) |
|---|---|---|---|
| 연결 해제 / 다른 계정·workspace·baseUrl | 숨김 | 연동 탭 재연결 안내 + 다운로드 | `recovery.reason.accountChanged` |
| 원격 이슈 404 | 숨김 | 다운로드(새로 만들지 않음) | `recovery.reason.remoteMissing` |
| 원격 403 | 숨김 | [이슈 열기] + 다운로드 | `recovery.reason.permission` |
| 본문 충돌 | 표시(업로드 완료분은 재전송 안 함) | [이슈 열기]로 수동 확인 + 다운로드 | `recovery.reason.bodyConflict` |
| 결과 모호(응답 유실, Slack ambiguous complete) | 숨김 | “결과 확인 필요” + [이슈 열기] + 다운로드 | `recovery.reason.ambiguous` |
| Webhook | 없음 | 다운로드만 | `recovery.reason.webhookUnsupported` |
| 로컬 파일 유실·만료 | 숨김(해당 파일) | “로컬 파일 없음” | `recovery.reason.localMissing` |

- Slack 부분 실패는 기존 스레드에 재첨부하며 새 부모/본문 메시지를 재생성하지 않는다. 재시도 진행 중이거나 미완료 첨부가 남은 Slack 보존 이슈는 [트래커로 등록]을 숨기지 않고 비활성화하며 툴팁으로 “첨부 확인을 먼저 끝내세요”를 보여준다. 승격은 재첨부 완료 또는 로컬 사본 삭제 후 허용한다.
- 스타일은 DESIGN의 amber 경고(세 번째 명도 쌍)·semantic 토큰·기존 Button/Dialog/ScrollArea를 따른다. 새 UI kit나 의존성을 추가하지 않는다.

## 재첨부 실행 설계 (2단계)

### 진입점과 재개 계약

`IssueRow`/복구 상세의 **첨부 재시도**는 `retryAttachments(issueId)`를 호출한다. 등록 목적지·계정 신원·본문 언어·제출 당시 파일을 그대로 사용하며 현재 설정의 기본 프로젝트나 로케일로 바꾸지 않는다. 재시도 메시지 payload의 `bodyLocale`은 현재 설정이 아니라 snapshot 값이다. 다른 화면으로 이동해도 파일별 체크포인트는 보존한다. 실행 중 자료 삭제·승격은 차단한다.

```ts
type RetryStage = "upload" | "link" | "body";
interface AttachmentCheckpoint {
  fileId: string;
  upload: "pending" | "done" | "failed" | "unknown";
  link: "pending" | "done" | "failed" | "unknown" | "not-applicable";
  body: "pending" | "done" | "failed" | "conflict" | "not-applicable";
  // Provider-specific union in implementation; no signed upload URLs.
  uploaded?: { id?: string; href?: string; expiresAt?: number };
  linkedId?: string;
}
interface AttachmentRetrySnapshot {
  schemaVersion: 1;
  accountIdentity: string; // see accountIdentity table
  bodyLocale: string;
  checkpoints: AttachmentCheckpoint[];
  bodyPlan: AttachmentBodyPlan;
  revision: number;
}
interface AttachmentBodyPlan {
  format: "markdown" | "adf" | "asana-html" | "notion-blocks" | "slack-thread";
  // Serialized provider body, including successfully attached references.
  lastWritten: string;
  replacements: Array<{
    fileId: string;
    anchor: string;
    before: string;
    after?: string;
    // Serialized provider fragment with internal URL/id slots, never sent as-is.
    renderTemplate: string;
  }>;
}
retryAttachments(issueId: string): Promise<NormalizedSubmitResult>;
planAttachmentRetry(meta: SubmissionRecoveryMeta): Array<{fileId: string; stage: RetryStage}>;
planAttachmentBodyPatch(plan: AttachmentBodyPlan, remoteBody: string):
  | {kind: "unchanged"}
  | {kind: "update"; body: string}
  | {kind: "conflict"; fileIds: string[]};
```

파일 ID/remote locator는 재시도 후에도 유지한다. `NormalizedSubmitResult`는 생성된 목적지가 있는 최종 결과만 표현한다. 생성 여부 unknown은 예외를 일반 toast로만 소비하지 않고 journal과 별도 결과 화면으로 처리한다.

1. 초기 제출·복구 판정·로컬 삭제와 같은 `withIssueOperationLock`(`bugshot-submission:<issueId>`, `ifAvailable: true`)으로 배타를 얻는다. 재시도 전용 별도 이름의 락을 만들지 않는다. 못 얻으면 다른 패널이 실행 중이므로 시작하지 않는다. 락 안에서 IDB 트랜잭션으로 현재 attemptId/revision을 검사하고 revision을 올린다. 부분 완료에 대해서만 허용하며 이미 완료된 파일은 제외한다.
2. 계정 신원을 최초 제출 당시와 비교한다. 같은 계정의 토큰 refresh는 기존 runner 사용, 다른 계정/workspace/baseUrl이거나 연결이 해제됐으면 중단하고 재연결을 안내한다. 토큰 자체는 journal에 저장하지 않는다.
3. 원격 대상과 최신 본문을 조회한다. 404/권한 없음은 생성으로 대체하지 않는다. 재시도 입력은 새 captures나 새 logs가 아니라 journal이 가리키는 보존 원본·생성물이다.
4. upload=done인 파일은 locator를 재사용한다. link=done이면 body만 처리한다. pending/확정 failed만 해당 단계 호출. 응답 직후 checkpoint를 저장한 다음 단계로 이동한다. 업로드는 **메시지당 1파일**로 보낸다. 사용자 첨부 50MB는 `recordingBudget.ts`의 64MiB 예산 밖이므로 여러 파일을 한 `sendBg`에 싣지 않는다.
5. 성공한 파일과 실패한 파일을 섞어 전체 body를 과거 스냅샷으로 덮지 않고 아래 패치 계획으로 업데이트한다. 갱신 결과를 재조회/응답으로 확인한 뒤 완료를 기록한다.
6. 아직 미완료가 있으면 partial과 보존 자료를 유지한다. 전부 완료하면 `markSubmittedDurably`로 영속한 뒤 보존 원본·생성물·계획을 정리한다.

`SubmissionProgress.fileCheckpoint`는 1단계 초기 제출부터 성공한 locator를 기록해야 첫 재시도에서 중복 업로드를 피할 수 있으므로, 인터페이스는 2단계에서 추가하되 1단계 어댑터가 per-file 결과를 이미 사이드패널로 돌려주는 구조(Jira 분해 포함)를 전제로 한다. 모든 체크포인트는 사이드패널의 원격 응답 수신 지점에서 기록한다. background에 recovery 컨텍스트를 실어 보내지 않는다.

`navigator.locks`는 같은 확장 origin의 사이드패널 인스턴스 사이에서 공유되고, 락을 쥔 컨텍스트가 죽으면 자동 해제된다. 그래서 heartbeat·stale 타이머가 필요 없다. 락이 풀렸는데 journal에 미완료 외부 쓰기(`unknown`)가 남아 있으면 다음 run은 그 파일/단계를 반복하지 않고 먼저 원격 결과와 locator를 대조한다. IDB revision 검사는 늦게 돌아온 옛 응답의 상태 덮어쓰기를 막을 뿐 원격 exactly-once를 보장하지 않는다. 결과를 조회할 수 없는 ambiguous upload는 자동 반복을 멈추고 다운로드/기존 이슈 확인을 제공한다. 새 run은 미확정 쓰기가 없는 파일/단계만 진행한다.

### 원격 본문 갱신과 충돌

사용자 결정으로 댓글/append 대신 **본문 패치**를 유지한다.

- 초기 제출 때 전송한 실제 본문과 파일별 삽입/치환 위치를 `AttachmentBodyPlan`에 저장한다. 전체 MarkdownContext를 무기한 보관할 필요 없이 생성한 플랫폼 본문과 미완료 첨부 자리만 보관한다. 재시도에 필요한 성공 파일 locator는 완료 전까지 유지한다.
- markdown 플랫폼은 저장된 base, 최신 remote, 파일 성공을 반영한 desired의 세 입력으로 **첨부 관련 hunk만** 적용한다. 문자열 전역 replace 금지. 동일 문구가 여럿이면 전후 문맥으로 한 곳만 식별될 때 처리하고, 모호하면 conflict다. 사용자에게 보이는 내부 ID/마커를 추가하지 않는다.
- ADF/HTML은 구조적 노드 경로와 앞뒤 텍스트를 anchor로 검증한다. 경로가 이동했으면 문맥으로 다시 찾고, 대상이 삭제되거나 변경되면 중단한다. 제목·담당자·라벨·상태·댓글 필드는 갱신 payload에서 제외한다.
- 본문 GET 후 저장 전 다시 읽어 remote가 달라졌으면 새 base에 패치를 계산한다. 동일 실행에서 무한 반복하지 않고 충돌을 반환한다. API가 문서화한 conditional write를 제공하면 사용한다. conditional write 지원을 추측해 임의 헤더를 붙이지 않는다.
- **수용한 위험**: conditional write가 없는 플랫폼에서는 마지막 조회와 쓰기 사이에 들어온 원격 편집을 덮을 수 있다. 이 창은 재조회로 좁힐 뿐 원리적으로 없앨 수 없다. 사용자는 이 한계를 알고 본문 패치를 택했다. 영향 범위는 재시도 실행 순간의 수백 ms 창이고 첨부 hunk만 쓰므로 무관한 문단은 덮지 않는다.
- 충돌이면 파일 업로드 성공을 취소하지 않는다. 이미 업로드/연결된 파일은 다시 올리지 않고, 본문만 미완료로 남긴다. 재시도 시 조회한 본문에 목표 링크가 이미 있으면 성공으로 reconcile한다.
- Jira/ClickUp 최초 생성 본문도 안전한 안내 문구를 사용한다. 실패 마커가 원격에 남았다가 재시도로만 지워지는 설계는 허용하지 않는다.
- 패치 빌더가 `t`나 본문 헬퍼를 import하면 `builderLocaleWrap.test.ts`의 WRAPPED/EXEMPT 분류에 등재하고, background에서 쓰는 새 본문 문구 키는 `bodyLocaleBackground.test.ts` 화이트리스트에 넣는다.

### 플랫폼별 재시도 경로

| 플랫폼 | 재사용/신설 동작 | 안전 경계 |
|---|---|---|
| GitHub | 기존 uploadFiles + 신설 `github.getIssueBody` / `github.updateIssueBody` (GET/PATCH `/repos/{owner}/{repo}/issues/{number}`). 현재 `github-api.ts`에는 `updateIssueState`만 있다 | 새 issue POST 금지. body 필드만 PATCH. 파일 URL은 본문 반영 실패 시 재사용 |
| GitLab | 기존 uploadFiles / updateIssueDescription + description 조회 추가 | projectId/iid 고정. 로그 역링크 보강은 별도 성공 조건으로 만들지 않음 |
| Jira | 1단계에서 분해한 uploadAttachment / updateIssueDescription + description/attachment 조회 메시지 신설 | 이미 attachment id 있으면 재업로드 없이 ADF만 갱신. getMediaFileId의 fallback과 인증 refresh 유지 |
| Linear | 기존 uploadFile/createAttachment/updateIssueDescription + description/attachment 조회 추가 | GraphQL success=false도 실패. attachment 링크가 있으면 재등록하지 않음 |
| Notion | uploadFile + page child 조회/블록 추가·수정·삭제 메시지 신설(현재 갱신 API 없음) | 이미지/영상/로그/사용자 파일을 기존 page에 추가. 반환 block id 저장. 같은 블록 재추가 방지. 첨부 외 일반 본문은 유지 |
| Asana | 기존 uploadFiles/updateTaskNotes + html_notes/attachments 조회 | taskGid 고정, webp 변환은 journal의 생성물 사본 재사용. notes만 미완료면 업로드 0회 |
| ClickUp | 기존 uploadFile/updateTaskMarkdown + markdown/attachment 조회 | taskId 고정. 서버 반환 포맷으로 안전한 body patch를 만들 수 없으면 conflict 처리 |
| Slack | 기존 uploadFiles의 파일 단계 분리와 thread_ts 고정 | 같은 채널·부모 ts에 실패 파일만 공유. 새 부모/상세 본문 메시지 재생성 금지. 기존 본문에 파일별 실패 안내를 새로 추가하지 않아 chat.update 권한 확장을 피함 |
| Webhook | 자동 재첨부 미지원 | 임의 key/url을 PATCH 주소로 해석하거나 같은 POST를 부분 파일로 재전송하지 않음. 다운로드 제공 |

신설 메시지는 `BgRequest` union·handler·`BG_REQUEST_TYPE_MAP`(`background/bgRequestTypes.ts`) 세 곳에 함께 등록한다.

Notion은 paragraph를 image로 타입 변경하지 않는다. 실패 자리의 block id를 확인해 새 파일 블록을 추가한 뒤, **우리의 실패 안내가 그대로인 경우에만** 해당 안내 블록을 지운다. 중간 실패 시 생성된 block id로 재개한다. 100블록 제한으로 첨부 자리가 원래 요청에 없었다면 페이지 끝에 첨부 블록을 추가한다. append는 100개 이하로 나누며 반환 블록 ID를 각 배치 직후 저장한다. 응답 유실로 새 block id를 잃으면 파일 참조를 페이지에서 찾아 확인하고, 확인 불가이면 맹목적으로 append하지 않는다.

Notion의 미연결 fileUploadId는 만료될 수 있으므로 expiresAt을 보존한다. 만료된 **미연결** 파일만 Blob으로 새로 업로드하며 이미 연결된 블록은 교체하지 않는다. 현재 NOTION_VERSION은 `2022-06-28`이다. 최신 문서의 `position`만 보고 전체 API 버전을 올리지 않는다. 새 첨부는 기본 append로 구현하고 기존 실패 자리 삽입은 고정 버전의 `after` 지원을 fixture/테스트 계정으로 확인해 적용한다. 불가능하면 끝에 첨부하고 기존 실패 안내만 제거하는 안전한 폴백을 사용한다.

Slack은 발급된 file_id를 bytes 전송 전에 저장하고 complete 호출 직전도 기록한다. complete는 같은 업로드에 임의로 반복 호출할 수 없다. 현재 scope에 files:read가 없으므로 complete 응답 유실은 자동 재시도를 중단한다. **이번 범위에서 files:read나 대화 history scope를 추가하지 않는다.** 명확한 업로드 실패 파일은 새 업로드로 같은 스레드에 재첨부하고, ambiguous complete는 기존 스레드 확인/다운로드로 남긴다. 네이티브 스레드 첨부 추가가 Slack의 원격 내용 갱신이다.

### 외부 계약 근거와 구현 검증

- [GitHub issue update](https://docs.github.com/en/rest/issues/issues#update-an-issue): 기존 이슈 body 갱신을 사용한다.
- [Notion append children](https://developers.notion.com/reference/patch-block-children): 요청당 최대 100블록, insert content capability. 최신 문서는 position을 안내하지만 저장소의 고정 버전은 별도 검증한다.
- [Slack complete upload](https://docs.slack.dev/reference/methods/files.completeUploadExternal/): 같은 업로드의 complete 재호출을 일반 retry처럼 취급하지 않는다.
- [Slack files.info](https://docs.slack.dev/reference/methods/files.info/): files:read가 필요하며 현재 USER_SCOPES에는 없다. 권한 추가 없이 불확실한 결과를 단정하지 않는다.

추가 read/write는 기존 연결 권한 안에서 시도하며 부족한 capability/권한은 사유를 표시하고 다운로드로 폴백한다. 기존 create가 된다는 이유로 update 권한도 있다고 가정하지 않는다.

## 기존 패턴 준수

테스트 우선, sidepanel의 `@/` 관례와 store/types/background의 상대경로 관례를 유지한다. 본문 언어 스왑 내부에서 store write를 하지 않는다. 메타는 로컬, Blob은 IndexedDB이며 BugShot 서버를 경유하지 않는다. 현재 지원 로케일 전체와 placeholder 대칭을 확인한다. 메시지 union·handler·허용 타입 Map 변경이 필요한 경우 셋을 함께 갱신한다. 파일명·실패 응답을 PostHog로 보내지 않는다. store는 `@/sidepanel/lib/*`를 value import하지 않는다(정리 API는 `blob-db.ts`). 신규 lib 파일은 커버리지 로직 스코프에 남긴다(`BROWSER_BOUND_EXACT`에 등재하지 않는다).

## 대안 검토

- **실패 토스트만 보강**: 현재 실패 파일과 원본이 사라지는 문제를 해결하지 못해 제외.
- **실패 시 전체 제출을 throw**: Asana·ClickUp·Slack 등에서 이미 생성된 이슈를 재생성하므로 제외.
- **모든 원본을 제출 전에 복제(초안)**: 정상 제출의 저장량이 두 배가 되고 quota 실패라는 새 실패 모드가 생긴다. 원본은 원래 `markSubmitted` 전까지 지워지지 않으므로, 미완료 파일의 삭제만 보류하고 제출 시점 생성물만 저장하는 쪽을 채택.
- **모든 원본 draft를 무기한 보존**: 필요 이상으로 캡처 문맥을 남기고 제출 당시 logs.html 재현도 어렵다. 미완료 파일과 최소 목적지 정보만 30일 보존.
- **재첨부를 댓글/append로 반영**: 충돌 판정·본문 조회가 사라져 단순하지만 본문의 빈 자리가 남는다. 사용자 결정으로 본문 패치를 유지하고 race는 수용한 위험으로 명시.
- **IDB heartbeat 기반 run lease**: 10초/60초 stale 판정과 타이머 throttling 함정이 생긴다. 컨텍스트 종료 시 자동 해제되는 `navigator.locks`로 대체.
- **Jira만 background 체크포인트**: background IDB 쓰기·SW 수명·64MiB 위험이 남는다. 메시지 분해로 대체.
- **다운로드만 제공**: 1단계의 기본 경로로 채택하고, 2단계에서 재첨부를 얹는다.
- **플랫폼 업로드 코드를 하나로 통합**: 업로드/생성 순서와 인증·연결 모델이 달라 제외. 결과 계약과 복구 수명만 공통화.

## 위험 요소

- 제출 시점 생성물(영상을 재임베드한 logs.html 포함)은 정상 제출에도 잠시 저장된다. base64 대신 Blob을 저장하고 quota 실패 시 외부 호출을 시작하지 않는다. `unlimitedStorage` 권한은 없다(새 권한 추가 안 함).
- HTTP 413이나 구조화된 provider 오류 외에는 size-limit로 단정하지 않는다. 403은 용량으로 추측하지 않는다.
- 생성 성공 직후 checkpoint 저장이 실패할 수 있다. creating journal은 남기고 unknown 처리하며 재생성을 막는다. 손실 없는 원격 exactly-once는 보증하지 않는다.
- Notion 일반 본문 절단 자체는 남는다. 누락 첨부의 보고·재첨부는 포함하지만 장문 본문까지 복구했다고 표시하지 않는다.
- Webhook multipart의 key/url은 수신 계약 확인이지 파일 저장의 독립 증거가 아니다. Webhook 재전송 시 중복 수신은 기존 문제로 범위 밖이다.
- GitHub 주입 반환 계약 변경은 실탭 smoke가 필요하다. #244 원인 관찰을 위한 반복 업로드나 업로더 리팩터와 묶지 않는다.
- 부분 실패 시 미완료 원본을 최대 30일 로컬 보존하는 것은 개인정보 보존 기간 변경이다. 현재 `docs/privacy.ko.md`는 “일반 이슈 제출 성공 시 blob 자동 삭제”라고 적고 있으므로, 구현 시 privacy ko/en 본문과 시행일을 함께 갱신한다.
- Jira 메시지 분해는 기존 단일 메시지 경로의 회귀 위험이 있다. 정상 제출 happy path와 refresh 경로를 분해 전후 같은 결과로 고정한다.
- 2단계 본문 패치의 조회-쓰기 race는 수용한 위험이다(위 "원격 본문 갱신과 충돌").

## 관찰과 기능의 분리

#245의 새 task space 성공은 #244의 원인이 해소됐다는 판정이 아니다. 이번 문서는 실패 이후의 보고·보존·재첨부 계약을 설계하며 GitHub 업로드 엔드포인트·세션·로그량 원인 실험은 별도 관찰로 둔다.
