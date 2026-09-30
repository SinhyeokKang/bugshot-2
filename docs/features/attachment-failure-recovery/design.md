# 파일 첨부 실패 처리와 재첨부 — 기술 설계

## 개요

파일 의도 목록 → 로컬 복구 사본 저장 → 원격 생성 체크포인트 → 파일별 결과 확정 → 결과 화면의 순서로 제출한다. 결과는 업로드 여부만이 아니라 이슈에서 파일에 접근할 수 있는지를 기준으로 한다. 이슈 목록의 사용자 트리거로 실패 단계만 재개하고 기존 이슈의 첨부·본문을 갱신한다. 다운로드는 자동 복구 불가 시 보조 경로다. 신규 작성과 저장 draft가 같은 준비·완료 함수를 사용한다.

기준 코드는 2026-10-01 `6274b9e6`. 기존 `logsDropped`·`mediaDropped`는 마이그레이션 중 UI 호환용으로만 파생하고, 전 어댑터 전환이 끝나면 제거한다. 새 영속 레코드에 두 boolean을 중복 저장하지 않는다.

## 변경 범위

| 파일/모듈 | 현재 역할 | 변경 |
|---|---|---|
| `src/types/attachment.ts` | 사용자 파일 메타 | 파일 의도·결과·복구 메타 타입 |
| `src/types/platform.ts`, `jira.ts`, `slack.ts`, `messages.ts` | 플랫폼 제출·업로드 응답 | 파일 ID/실패 단계 전달, 생성 체크포인트 식별자 |
| `src/store/blob-db.ts` | IndexedDB v8, Blob 보관 | v9 `submissionRecovery` store와 트랜잭션 API |
| `src/store/issues-store.ts` | 제출 가드·병합·원본 삭제 | 복구 포인터·부분 완료 처리·미확인 제출 차단 |
| `src/store/editor-store.ts` | 라이브 결과 화면 상태 | 파일 결과가 포함된 제출 결과 전달 |
| `src/sidepanel/lib/resolveInlineImages.ts`, `buildCaptureFiles.ts`, `buildEditorCapture.ts` | 참조 해소·제출 파일 생성 | 예상 파일과 로딩 결과 비교, 무음 제외 중단 |
| `src/sidepanel/lib/submissionRecovery.ts` (신규) | — | 공통 준비·체크포인트 조정·완료·재시작 복구 |
| `src/sidepanel/lib/retryAttachments.ts`, `retryAttachmentAdapters.ts`, `attachmentBodyPatch.ts` (신규) | — | 재시도 오케스트레이션·8플랫폼 재개·본문 충돌 판정 |
| `src/sidepanel/lib/attachmentResults.ts` (신규) | — | 순수 파일 결과 합성·성공 판정·오류 코드 정규화 |
| `src/sidepanel/lib/submitTo*.ts`, `prepareUpload.ts`, `submitAdapters.ts` | 9개 제출 경로 | 파일별 결과와 생성 시점 통지, 생성 후 예외 격리 |
| `src/background/messages.ts`, `*-api.ts`, `github-upload.ts` | 외부 호출 | 실제 실패 단계/HTTP 상태, Jira 생성 체크포인트, 빈 locator 판정 |
| 본문 빌더·`issueBodyShared.ts`·`resolveInlineImages.ts` | 본문 생성 | 내부 마커 제거, 실패 파일명과 사실에 맞는 안내 |
| `IssueCreateModal.tsx`, `DraftDetailDialog.tsx`, `SubmitFieldsDialog.tsx` | 제출 진입점 | 공통 완료 처리, 부분 성공을 전체 실패로 되돌리지 않음 |
| `SubmitSuccessView.tsx`, `IssueTab.tsx`, `IssueListTab.tsx`, `IssueRow.tsx`, `issueListUtils.ts` | 결과·목록 | 지속 경고·복구 상세·다운로드·재제출 가드 |
| `src/sidepanel/components/AttachmentRecoveryPanel.tsx` (신규) | — | 완료 화면과 목록 상세의 공통 파일 목록 |
| `src/i18n/namespaces/{integrations,issue}.ts` | 문구 | 모든 현재 로케일에 원인 중립 문구·상태·동작 추가 |

## 인터페이스 설계

아래는 신설 계약이다. 파일 이름은 표시명이고 매칭 키가 아니다. 같은 이름의 사용자 첨부와 캡처가 충돌하지 않도록 ID를 메시지 경계까지 전달한다.

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

interface SubmissionProgress {
  attemptId: string;
  beforeCreate(): Promise<void>;
  created(remote: CreatedDestination): Promise<void>;
}

interface SubmissionRecoveryMeta {
  attemptId: string;
  issueId: string;
  title: string;
  platform: PlatformId;
  createdAt: number;
  phase: "prepared" | "creating" | "created" | "partial" | "complete" | "unknown";
  destination?: CreatedDestination;
  files: Array<Omit<SubmissionFile, "dataUrl">>;
  results: AttachmentResult[];
  // Retry state is detailed below.
  retry?: AttachmentRetrySnapshot;
  updatedAt: number;
}

interface NormalizedSubmitResult {
  key: string;
  url: string;
  attachments: AttachmentResult[];
}
```

`CreatedDestination`는 구현 시 platform 판별 union으로 정의한다. 허용 locator는 Jira=issueKey/siteId, GitHub=owner/repo/number, GitLab=projectId/iid, Linear=issueId, Notion=pageId, Asana=taskGid, ClickUp=taskId, Slack=channelId/ts, Webhook=반환 key/url이다. 인증 정보·업로드 서명 URL은 보관하지 않는다.

## 데이터 흐름과 로컬 저장

### 1. 준비와 누락 검출

- 로그 토글·캡처 모드·활성 paragraph 섹션·사용자 첨부 설정으로 **예상 파일 ID 집합을 먼저** 정한다. 빈 로그처럼 현행상 파일이 생성되지 않는 경우는 기대 집합에서도 제외한다.
- 두 제출 진입점의 `getAttachmentBlob` null filter, `resolveInlineImagesForSections`의 조용한 return을 명시적인 로딩 결과로 바꾼다. 캡처/영상도 레코드의 존재 플래그와 Blob을 대조한다.
- 누락된 원본이 하나라도 있으면 `MissingSubmissionFilesError`로 제출 전에 중단한다. 누락을 어댑터로 넘겨 성공 처리하지 않는다.
- `buildCaptureFiles`로 생성한 logs.html과 모든 전송 대상의 **제출 직전 원본**을 Blob으로 보관한다. Asana JPEG 변환·Notion ZIP·생성 후 로그 역링크 삽입 전 사본이다. 다운로드는 원본을 제공하며 같은 순간의 로그·영상·본문을 유지한다.
- 다운로드 파일명 확장자는 실제 dataUrl MIME에 맞춘다. 외부 업로드 MIME 교정은 별도이며 여기서 모든 업로드 계약을 바꾸지 않는다. Notion 로그는 기존 `zipLogsHtml`로 래핑한다. 재시도 전송용 변환 Blob은 최초 변환 결과를 journal에 한 번 저장해 동일한 바이트로 재사용한다.

### 2. 복구 journal

기존 DB `bugshot-video`를 v8→v9로 올리고 `submissionRecovery` store 하나를 추가한다. 메타 키는 `attempt:<issueId>`, Blob 키는 `file:<attemptId>:<fileId>`. 메타와 Blob을 **동일 readwrite 트랜잭션**으로 저장한다. 기존 8개 store의 데이터는 이동하지 않는다.

`blob-db.ts`에 아래 API를 추가한다. 기존 Blob API의 catch/false 규약과 달리 이 API는 실패를 throw한다. 복구 준비 실패 뒤 외부 전송하면 안 되기 때문이다.

```ts
beginSubmissionRecovery(meta: SubmissionRecoveryMeta, files: Map<string, Blob>): Promise<void>;
checkpointSubmission(issueId: string, attemptId: string,
  patch: Pick<SubmissionRecoveryMeta, "phase" | "destination" | "results">): Promise<void>;
readSubmissionRecovery(issueId: string): Promise<SubmissionRecoveryMeta | null>;
readRecoveryFile(attemptId: string, fileId: string): Promise<Blob | null>;
listSubmissionRecoveries(): Promise<SubmissionRecoveryMeta[]>;
deleteSubmissionRecovery(issueId: string, attemptId: string): Promise<void>;
```

- `begin`은 같은 issueId의 미완료 attempt가 있으면 거절한다. 확인·생성을 같은 IDB 트랜잭션으로 수행해 두 패널의 중복 시작을 막는다. 기존 `withIssueSubmitGuard`는 프로세스 내 집합이므로 이 용도로 충분하지 않다.
- 체크포인트는 attemptId 일치와 허용 상태 전이를 확인한다. 오래된 호출이 새 제출 결과를 덮지 못한다. 네트워크 await를 IDB transaction 안에 넣지 않는다.
- 복구 journal은 별도 store라 기존 `pruneOrphanBlobs`·inline GC가 건드리지 않는다. 새 파일은 기존 원본의 참조가 아니라 복제 Blob이므로 성공 처리의 `stripSubmitted`에도 살아남는다.
- `IssueRecord`에는 optional `submissionRecoveryId`만 추가한다. journal이 복구 상태의 단일 출처다. 없음은 기존 동작이며 별도 issues-store version bump는 불필요하다. 부분 완료 포인터를 `stripSubmitted`가 의도적으로 보존하고, 해제 액션은 `updatedAt`을 갱신한다.
- 일반 제출 완료·복구 자료 삭제·이슈 삭제·전체 이슈 삭제에 각각 journal 정리를 연결한다. 사용자 삭제는 journal 무효화/삭제를 먼저 완료한 뒤 목록을 삭제해 재시작 reconciliation이 지운 항목을 부활시키지 않게 한다. 늦게 도착한 checkpoint는 존재하지 않는 attempt를 다시 만들지 않는다. 자동 기간 만료는 추가하지 않는다. 브라우저 저장 데이터 제거는 기존과 같이 복구 불가다.
- complete journal을 먼저 기록하고 이슈 목록에 submitted를 영속한 뒤 사본을 삭제한다. Zustand set 반환을 영속 완료로 간주하지 않고, 해당 write Promise/실패를 관찰하는 store API를 둔다. 중간 종료 시 journal로 목록을 복구한다. partial은 미완료 파일의 Blob과 **성공 파일을 포함한 전체 locator·본문 패치 계획**을 유지한다. 성공한 파일 Blob은 정리 가능하지만, 본문 재구성에 필요한 텍스트와 참조는 최종 완료까지 유지한다.
- 조회 시 복구 Blob이 유실됐으면 다운로드 버튼 대신 “로컬 파일 없음”을 표시한다. 다운로드 동작을 성공으로 위장하지 않는다.

### 3. 생성 체크포인트와 중단

어댑터에 `SubmissionProgress`를 넘긴다. 업로드 선행 플랫폼은 생성 API 직전에 `beforeCreate`, 응답 직후 `created`를 await한다. 생성 선행 플랫폼은 후속 첨부 작업보다 먼저 `created`를 await한다. Jira는 background 단일 메시지 내부에서 생성하므로 메시지에 issueId/attemptId를 싣고 background가 같은 IDB 체크포인트 API를 사용한다. UI로 별도 이벤트를 보내는 방식은 패널 종료 시 유실되므로 쓰지 않는다.

created 이후 실패는 destination과 파일 결과를 가진 부분 완료로 반환한다. 업로드 배치 자체가 throw하면 미완료 파일은 unknown으로 표시한다. per-file 확정 실패는 failed다. 생성까지 성공한 제출을 일반 에러 catch로 되돌려 “제출 실패 → 다시 제출” 흐름으로 보내지 않는다.

prepared에서 생성 전 확정 실패는 draft로 돌아가 재시도 가능하다. 새 시도 전 이전 journal을 정리하되 원본 draft Blob은 남긴다. 이미 올라간 미연결 파일은 원격 롤백하지 않으며 새 제출 시 재사용 가능한 locator만 옮긴다. creating 중 응답 유실 또는 종료는 unknown이다. 서버가 명시적으로 생성을 거절한 응답은 draft 재시도 가능하지만, 타임아웃·5xx·응답 파싱 실패는 생성 여부를 추정하지 않는다. created/partial/unknown journal이 있으면 `canSubmitIssue`와 두 제출 관문에서 새 생성을 막는다. unknown 해제는 사용자 명시 확인 동작만 허용하며 먼저 재조회해 다른 패널이 기록한 created를 우선한다.

초기화와 외부 issues 동기화 시 journal을 읽어 목록 포인터를 복원하는 `reconcileSubmissionRecovery`를 신규 lib에 둔다. `main.tsx`에 상태 판단을 인라인하지 않는다. 기존 #240 병합 규칙의 submitted 우선·updatedAt·echo 가드를 유지한다. 목록 레코드가 사라졌어도 journal의 최소 title/platform/issueId/생성시각 메타로 복구 항목을 복원할 수 있게 구현 타입에 포함한다. 계정이 해제돼도 로컬 다운로드는 가능해야 한다.

### 4. 플랫폼별 완료 판정

| 플랫폼 | attached 판정 | 추가 처리 |
|---|---|---|
| GitHub/GitLab | 업로드 locator 존재 + 생성 본문에 파일 참조 포함 | 실패 inline ref를 현지화된 파일 누락 문구로 치환. GitLab 역링크 보강 실패는 기존 링크가 살아 있으므로 delivery 실패 아님 |
| Jira | 업로드 응답의 유효한 attachment id | 업로드 locator가 빈 응답은 invalid-response. 본문 갱신 실패는 presentation 실패. 사용자 파일도 결과 포함 |
| Linear | 이미지/영상은 생성 본문 참조, 로그는 attachment 연결 또는 본문 링크 중 하나 성공, 사용자 파일은 attachment 연결 성공 | `attachmentCreate.success`·`issueUpdate.success`를 확인. 두 로그 연결이 실패하면 link 실패. 파일 업로드 성공만으로 attached 금지 |
| Notion | 생성 요청에 파일 참조 블록이 실제 포함되고 page 응답 성공 | `expandPageBlocks`와 실제 잘린 children의 placeholder 대응을 유지. 100블록 밖 파일은 body-limit. 재시도에서 누락 첨부만 기존 page에 분할 append; 일반 본문 복원 제외 |
| Asana/ClickUp | 생성된 task의 네이티브 첨부 locator | 본문 2차 write 실패와 첨부 실패를 구분. 생성 후 배치 요청 throw도 부분 완료 |
| Slack | `completeUploadExternal` 성공 | complete 실패를 모든 해당 파일 실패로 전달. permalink 실패여도 channelId/ts 체크포인트로 새 post 방지 |
| Webhook multipart | 파일 파트 포함 + 2xx + key/url 계약 성공 | 수신 서버 내부 저장을 별도로 보증하지 않음. 응답 유실은 unknown, idempotencyKey는 기존 issueId 유지 |
| Webhook JSON | 파일 전송 대상 없음 | 기존 recorded:false·원본 보존 유지. 파일 결과/복구 사본 대상에서 제외 |

각 파일 결과는 ID 기준으로 누락·중복 응답을 대조한다. 사용자 표시명이 logs.html·screenshot.webp와 같아도 오염되지 않아야 한다. low-level 실패에 안전한 stage/code/httpStatus만 추가한다. GitHub MAIN world 함수는 self-contained를 유지하며 외부 helper를 주입 함수에서 참조하지 않는다.

### 5. 본문과 UX

- 생성 선행 플랫폼의 최초 본문에는 실행용 내부 마커를 넣지 않는다. Jira는 내부 템플릿과 생성용 안전 폴백 ADF를 분리해 2차 갱신이 실패해도 마커가 남지 않게 한다. ClickUp도 최초 본문의 `inline:`을 안전 문구로 렌더한다.
- `logsNotAttached`라는 사용자 의도와 업로드 실패는 구분한다. 로그 요약의 건수는 유지하되 성공 확인 전 “첨부되어 있습니다”를 쓰지 않는다. 플랫폼에서 네이티브 첨부가 확인됐으면 본문 링크가 없어도 첨부 완료로 표현할 수 있다.
- `AttachmentRecoveryPanel`은 파일명·종류·단계·현지화된 이유·재시도 진행·다운로드를 표시한다. 주 트리거는 IssueRow의 **첨부 재시도**이고, 같은 액션을 상세 패널에서도 호출한다. raw API body, 개발용 마커, 내부 attemptId는 노출하지 않는다.
- 완료 화면과 목록 상세가 같은 패널을 사용한다. partial을 기존 성공 토스트 뒤에 숨기지 않는다. `SubmitFieldsDialog`의 성공 callback과 analytics가 partial을 전체 실패로 재분류하지 않게 한다. 신규 분석 속성은 추가하지 않는다.
- `IssueRow`의 기존 URL 열기는 유지하고 복구 배지/상세 버튼을 별도로 둔다. 복구 레코드를 editable draft로 취급하지 않는다. Slack 부분 실패는 기존 스레드에 재첨부하며 새 부모/본문 메시지를 재생성하지 않는다. 승격은 재첨부 완료 또는 복구 포기 후 허용한다.
- 복구 자료 삭제는 원격 상태를 수정하지 않는다. Slack의 기존 `slackPreserved` 원본은 이 동작으로 지우지 않는다. 이슈 삭제는 기존 원본과 복구 사본 모두 지운다.
- 스타일은 DESIGN의 amber 경고·semantic 토큰·기존 Button/Dialog/ScrollArea를 따른다. 새 UI kit나 의존성을 추가하지 않는다.

## 재첨부 실행 설계

### 진입점과 재개 계약

`IssueRow`의 **첨부 재시도**는 `retryAttachments(issueId)`를 호출한다. 등록 목적지·계정 신원·본문 언어·제출 당시 파일을 그대로 사용하며 현재 설정의 기본 프로젝트나 로케일로 바꾸지 않는다. 실행 중 버튼 비활성 + 파일별 진행을 보여주고, 다른 화면으로 이동해도 파일별 체크포인트는 보존한다. 실행 중 자료 삭제·승격은 차단한다.

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
  accountIdentity: string;
  bodyLocale: string;
  checkpoints: AttachmentCheckpoint[];
  bodyPlan: AttachmentBodyPlan;
  run?: { id: string; revision: number; heartbeatAt: number };
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

1. IDB 트랜잭션에서 현재 attemptId/revision을 검사하고 run을 획득한다. 부분 완료에 대해서만 허용하며 이미 완료된 파일은 제외한다. 시작 전 저장 상태를 다시 읽으므로 연속 클릭이나 다른 패널도 같은 목록을 공유한다.
2. 계정 신원을 최초 제출 당시와 비교한다. 같은 계정의 토큰 refresh는 기존 runner 사용, 다른 계정/workspace/baseUrl이면 중단하고 원래 연결 복구를 안내한다. 토큰 자체는 journal에 저장하지 않는다.
3. 원격 대상과 최신 본문을 조회한다. 404/권한 없음은 생성으로 대체하지 않는다. 재시도 입력은 새 captures나 새 logs가 아니라 journal의 사본이다.
4. upload=done인 파일은 locator를 재사용한다. link=done이면 body만 처리한다. pending/확정 failed만 해당 단계 호출. 응답 직후 checkpoint를 저장한 다음 단계로 이동한다.
5. 성공한 파일과 실패한 파일을 섞어 전체 body를 과거 스냅샷으로 덮지 않고 아래 패치 계획으로 업데이트한다. 갱신 결과를 재조회/응답으로 확인한 뒤 완료를 기록한다.
6. 아직 미완료가 있으면 partial과 사본을 유지한다. 전부 완료하면 submitted 기록을 영속하고 복구 사본/계획을 정리한다.

`SubmissionProgress`에 `fileCheckpoint(value: AttachmentCheckpoint): Promise<void>`를 추가한다. 초기 제출부터 성공한 locator를 기록해야 첫 재시도에서 중복 업로드를 피할 수 있다. Jira의 내부 루프와 생성 후 attachment 연결도 동일 계약을 사용한다. 반환값을 UI가 받은 뒤에만 기록하는 구현은 패널 종료 구간을 보호하지 못하므로 background의 실제 원격 응답 수신 지점에서 journal을 갱신한다. 저수준 요청에 `recovery: {issueId, attemptId, fileId, runId}`를 전달하고 초기 제출/재시도 모두 동일하게 검사한다.

run heartbeat는 10초마다 갱신하고 60초 이상 멈추면 stale로 분류한다. 타이머 throttling도 가능하므로 stale을 새 외부 쓰기 허가로 쓰지 않는다. run heartbeat가 멈춰도 다음 클릭이 곧바로 업로드를 반복하지 않는다. 미완료 외부 쓰기는 unknown으로 전환해 먼저 원격 결과와 locator를 대조한다. IDB revision 검사는 늦게 돌아온 옛 응답의 상태 덮어쓰기를 막을 뿐 원격 exactly-once를 보장하지 않는다. 결과를 조회할 수 없는 ambiguous upload는 자동 반복을 멈추고 다운로드/기존 이슈 확인을 제공한다. 새 run은 미확정 쓰기가 없는 파일/단계만 진행한다.

### 원격 본문 갱신과 충돌

- 초기 제출 때 전송한 실제 본문과 파일별 삽입/치환 위치를 `AttachmentBodyPlan`에 저장한다. 전체 MarkdownContext를 무기한 보관할 필요 없이 생성한 플랫폼 본문과 미완료 첨부 자리만 보관한다. 재시도에 필요한 성공 파일 locator는 완료 전까지 유지한다.
- markdown 플랫폼은 저장된 base, 최신 remote, 파일 성공을 반영한 desired의 세 입력으로 **첨부 관련 hunk만** 적용한다. 문자열 전역 replace 금지. 동일 문구가 여럿이면 전후 문맥으로 한 곳만 식별될 때 처리하고, 모호하면 conflict다. 사용자에게 보이는 내부 ID/마커를 추가하지 않는다.
- ADF/HTML은 구조적 노드 경로와 앞뒤 텍스트를 anchor로 검증한다. 경로가 이동했으면 문맥으로 다시 찾고, 대상이 삭제되거나 변경되면 중단한다. 제목·담당자·라벨·상태·댓글 필드는 갱신 payload에서 제외한다.
- 본문 GET 후 저장 전 다시 읽어 remote가 달라졌으면 새 base에 패치를 계산한다. 동일 실행에서 무한 반복하지 않고 충돌을 반환한다. API가 문서화한 conditional write를 제공하면 사용한다. 그렇지 않은 플랫폼에서는 마지막 조회와 쓰기 사이의 경쟁을 완전히 제거할 수 없다는 한계를 명시한다. conditional write 지원을 추측해 임의 헤더를 붙이지 않는다.
- 충돌이면 파일 업로드 성공을 취소하지 않는다. 이미 업로드/연결된 파일은 다시 올리지 않고, 본문만 미완료로 남긴다. 재시도 시 조회한 본문에 목표 링크가 이미 있으면 성공으로 reconcile한다.
- Jira/ClickUp 최초 생성 본문도 안전한 안내 문구를 사용한다. 실패 마커가 원격에 남았다가 재시도로만 지워지는 설계는 허용하지 않는다.

### 플랫폼별 재시도 경로

| 플랫폼 | 재사용/신설 동작 | 안전 경계 |
|---|---|---|
| GitHub | 기존 uploadFiles + 신설 `github.getIssueBody` / `github.updateIssueBody` (GET/PATCH `/repos/{owner}/{repo}/issues/{number}`) | 새 issue POST 금지. body 필드만 PATCH. 파일 URL은 본문 반영 실패 시 재사용 |
| GitLab | 기존 uploadFiles / updateIssueDescription + description 조회 추가 | projectId/iid 고정. 로그 역링크 보강은 별도 성공 조건으로 만들지 않음 |
| Jira | 기존 uploadAttachment / updateIssueDescription + description/attachment 조회 메시지 신설 | 이미 attachment id 있으면 재업로드 없이 ADF만 갱신. getMediaFileId의 fallback과 인증 refresh 유지 |
| Linear | 기존 uploadFile/createAttachment/updateIssueDescription + description/attachment 조회 추가 | GraphQL success=false도 실패. attachment 링크가 있으면 재등록하지 않음 |
| Notion | uploadFile + page child 조회/블록 추가·수정·삭제 메시지 신설 | 이미지/영상/로그/사용자 파일을 기존 page에 추가. 반환 block id 저장. 같은 블록 재추가 방지. 첨부 외 일반 본문은 유지 |
| Asana | 기존 uploadFiles/updateTaskNotes + html_notes/attachments 조회 | taskGid 고정, webp 변환은 초기 사본 재사용. notes만 미완료면 업로드 0회 |
| ClickUp | 기존 uploadFile/updateTaskMarkdown + markdown/attachment 조회 | taskId 고정. 서버 반환 포맷으로 안전한 body patch를 만들 수 없으면 conflict 처리 |
| Slack | 기존 uploadFiles의 파일 단계 분리와 thread_ts 고정 | 같은 채널·부모 ts에 실패 파일만 공유. 새 부모/상세 본문 메시지 재생성 금지. 기존 본문에 파일별 실패 안내를 새로 추가하지 않아 chat.update 권한 확장을 피함 |
| Webhook | 자동 재첨부 미지원 | 임의 key/url을 PATCH 주소로 해석하거나 같은 POST를 부분 파일로 재전송하지 않음. 다운로드 제공 |

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

테스트 우선, sidepanel의 `@/` 관례와 store/types/background의 상대경로 관례를 유지한다. 본문 언어 스왑 내부에서 store write를 하지 않는다. 메타는 로컬, Blob은 IndexedDB이며 BugShot 서버를 경유하지 않는다. 현재 지원 로케일 전체(ko/en/fr)와 placeholder 대칭을 확인한다. 메시지 union·handler·허용 타입 Set 변경이 필요한 경우 셋을 함께 갱신한다. 파일명·실패 응답을 PostHog로 보내지 않는다.

## 대안 검토

- **실패 토스트만 보강**: 현재 실패 파일과 원본이 사라지는 문제를 해결하지 못해 제외.
- **실패 시 전체 제출을 throw**: Asana·ClickUp·Slack 등에서 이미 생성된 이슈를 재생성하므로 제외.
- **모든 원본 draft를 무기한 보존**: 필요 이상으로 캡처 문맥을 남기고 제출 당시 logs.html 재현도 어렵다. 필요한 파일 사본과 최소 목적지 정보만 보존.
- **다운로드만 제공**: 초기 검토안이었으나 사용자 결정으로 재첨부를 채택했다. 다운로드는 충돌/권한/미확인 상태의 폴백으로 남긴다.
- **플랫폼 업로드 코드를 하나로 통합**: 업로드/생성 순서와 인증·연결 모델이 달라 제외. 결과 계약과 복구 수명만 공통화.

## 위험 요소

- 최초 사본 저장은 파일 크기만큼 추가 공간이 필요하다. base64 대신 Blob을 저장하고 quota 실패 시 외부 호출을 시작하지 않는다.
- HTTP 413이나 구조화된 provider 오류 외에는 size-limit로 단정하지 않는다. 403은 용량으로 추측하지 않는다.
- 생성 성공 직후 checkpoint 저장이 실패할 수 있다. creating journal과 파일은 남기고 unknown 처리하며 재생성을 막는다. 손실 없는 원격 exactly-once는 보증하지 않는다.
- Notion 일반 본문 절단 자체는 남는다. 누락 첨부의 보고·재첨부는 포함하지만 장문 본문까지 복구했다고 표시하지 않는다.
- Webhook multipart의 key/url은 수신 계약 확인이지 파일 저장의 독립 증거가 아니다.
- GitHub 주입 반환 계약 변경은 실탭 smoke가 필요하다. #244 원인 관찰을 위한 반복 업로드나 업로더 리팩터와 묶지 않는다.
- 로컬 복구 보존은 개인정보 보존 기간 변경이므로 구현 시 privacy ko/en과 시행일을 함께 갱신한다.

## 관찰과 기능의 분리

#245의 새 task space 성공은 #244의 원인이 해소됐다는 판정이 아니다. 이번 문서는 실패 이후의 재첨부 계약을 설계하며 GitHub 업로드 엔드포인트·세션·로그량 원인 실험은 별도 관찰로 둔다.
