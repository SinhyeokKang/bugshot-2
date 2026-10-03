# 파일 첨부 실패 처리와 재첨부 — 구현 태스크

## 선행 조건

- 이 작업은 설계만 완료하며 구현·테스트 실행·빌드는 후속 단계다.
- 사용자 결정: 두 단계로 출시한다. **1단계**는 정직한 보고·내부 마커 제거·부분 실패 시 미완료 원본 보존(삭제 보류)과 다운로드·생성 체크포인트·등록 여부 미확인 처리·30일 보존 기한. **2단계**는 이슈 목록에서 실패 첨부를 재시도하고 기존 원격 이슈의 첨부·본문을 패치한다. 새 이슈 재생성·예약 반복 재시도는 제외한다.
- 착수 시 `docs/POSTMORTEM.md`의 2026-09-29 첨부 경고, 2026-06-30 승격 원본 소실, 2026-08-20 파일명 식별자, 2026-07-18 e2e seed DB 버전, 크로스 인스턴스 병합(2026-09-22) 항목을 읽는다.
- IDB v8→v9 업그레이드가 필요하다. env·의존성·권한은 추가하지 않는다. 2단계 원격 조회/갱신 권한과 Slack scope는 Task 9에서 검증하며 부족하면 다운로드 폴백을 둔다.
- #244의 실제 업로드 실패 원인은 별도 관찰 대상으로 둔다. 이번 수용 테스트는 결정적인 mock 응답을 사용한다.

## 1단계 태스크

### Task 1: 파일 의도·결과 계약과 순수 판정 [1단계]
- **변경 대상**: `src/types/{attachment,platform,messages,jira,slack}.ts`, 신규 `src/sidepanel/lib/attachmentResults.ts`와 테스트.
- **작업 내용**: 파일 ID·종류·단계·실패 코드·delivery/presentation 계약과 기대 집합 대조를 먼저 테스트로 고정한다. 결과 → 표시 경로(성공 화면 / 부분 완료 패널 / 미확인 / 토스트 여부) 판정을 이 lib의 순수 함수로 둔다. `logsDropped`/`mediaDropped`와 호환되는 파생 함수를 이행 기간에만 둔다.
- **검증**:
  - [x] 사용자 파일 실패와 로그 실패가 분리된다. 같은 표시명·빈 locator·빠진 응답·중복 응답을 성공으로 간주하지 않는다.
  - [x] 업로드 성공/연결 실패, 첨부 성공/본문 실패, 의도적 미전송을 서로 구분한다.
  - [x] 원인 미확인은 unknown이며 HTTP 403을 size-limit로 추측하지 않는다.
  - [x] 표시 판정: partial/unknown이면 완료 화면 패널 경로이고 토스트를 띄우지 않는다. 성공이면 기존 성공 화면.

### Task 2: 전송 전 원본 검사와 제출 시점 생성물 확정 [1단계]
- **변경 대상**: `resolveInlineImages.ts`, `buildCaptureFiles.ts`, `buildEditorCapture.ts`, 두 제출 진입점, 신규 `submissionRecovery.ts`.
- **작업 내용**: 로딩 전 예상 파일 목록을 만들고 Blob 누락을 명시적으로 반환한다. 로그 OFF/활성 섹션 규칙을 유지한다. 원본은 복제하지 않고 기존 store 키(`RecoverySource.original`)만 기록한다. 제출 시점 생성물(logs.html·Asana JPEG·Notion ZIP)의 바이트·MIME·표시명을 전송 전 확정한다.
- **검증**:
  - [ ] 누락 inline·영상·스크린샷·사용자 파일 각각에서 외부 생성 호출 0회.
  - [ ] 로그 OFF·비활성 섹션·Webhook JSON은 누락으로 오탐하지 않는다.
  - [ ] 원본 파일은 새 Blob으로 복제되지 않는다(journal에 원본 키만 기록).
  - [ ] JPEG 원본 다운로드의 확장자/MIME이 일치하고 업로드 엔드포인트 변경은 없다.

### Task 3: IDB 복구 journal·삭제 보류·정리 API [1단계]
- **변경 대상**: `src/store/blob-db.ts` 및 `__tests__`, `src/store/issues-store.ts`(prune 제외 집합·삭제 연결), e2e seed(`grep -rn '"bugshot-video"' e2e/` — 현재 `e2e/slack-promote-media-guard.spec.ts:75`, `e2e/GOTCHAS.md` 서술).
- **작업 내용**: DB v9와 `submissionRecovery` store, 메타+생성물 Blob 원자 저장·상태 전이·조회·삭제 API, 키 단위 원본 삭제(`deleteOriginalKeys`), 이슈 삭제용 `purgeRecoveryForIssues`를 구현한다. 복구 API는 오류를 throw한다(기존 Blob API는 getter null / setter false 규약). store는 `@/sidepanel/lib/*`를 import하지 않는다. e2e seed의 DB 버전과 store 목록을 v9에 맞추고, 버전 상수를 seed와 공유하거나 GOTCHAS에 갱신 규칙을 남긴다. v9 `onblocked` 시 사용자 안내 문구를 둔다.
- **검증**:
  - [ ] 기존 v8 데이터 보존, 열린 연결의 versionchange/blocked 처리가 유지되고 blocked는 안내 문구로 이어진다.
  - [ ] 생성물 quota 실패 시 메타나 파일 일부만 남지 않고 외부 요청도 없다.
  - [x] 동시 begin 2회 중 하나만 성공한다(fake-indexeddb). 오래된 attempt의 checkpoint/delete는 새 attempt를 변경하지 않는다.
  - [x] `pruneOrphanBlobs`(`issues-store.ts:311`)·inline GC가 live journal이 가리키는 원본 키와 recovery store를 건드리지 않는다.
  - [x] journal 삭제가 실패하면 목록 항목도 유지된다(삭제 순서: journal → 목록).
  - [x] `removeIssue`·`clearIssues`가 `purgeRecoveryForIssues`를 호출한다.
  - [ ] 생성 후 로그가 늘어나도 journal의 logs.html은 최초 바이트 그대로다(Task 2에서 이동).
  - [ ] 기대 파일 0개 제출도 빈 journal이 생기고 완료 시 정리된다.
  - [x] `store/__tests__/bundleBoundary.test.ts`의 `ALLOWED`가 늘지 않는다.
  - [x] 기존 e2e seed spec이 v9에서 VersionError 없이 돈다.

### Task 4: 생성 체크포인트·영속 완료 API·제출 수명 [1단계]
- **변경 대상**: `issues-store.ts`, `editor-store.ts`, `IssueCreateModal.tsx`, `DraftDetailDialog.tsx`, `SubmitFieldsDialog.tsx`, `submissionRecovery.ts`.
- **작업 내용**: 생성 직전/직후 체크포인트, 부분 결과 완료, 재시작 reconciliation(만료 정리 포함), submitted 포인터 보존을 두 진입점에 공통 연결한다. 모든 체크포인트는 사이드패널이 쓴다. `markSubmittedDurably(id, patch, opts): Promise<void>`를 신설해 persist write 성공을 관찰하고, partial이면 완료 파일 원본만 지운다. 등록 여부 미확인 해제(**등록되지 않았음 확인**) 액션을 둔다.
- **검증**:
  - [ ] 원격 생성 이후 upload RPC throw에서 기존 key/id를 보존하며 create 호출은 한 번이다.
  - [ ] creating 중 종료는 unknown, created 중 종료는 기존 목적지 있는 복구 항목으로 돌아온다.
  - [ ] 다른 패널의 stale draft·unknown 해제가 최신 created 상태를 역행시키지 않는다. unknown 해제는 실행 직전 journal 재조회 결과 created면 거부된다.
  - [ ] `markSubmittedDurably`: persist write reject를 주입하면 reject하고 사본·원본이 삭제되지 않는다. 이 write가 `pendingOwnWrites` 에코 가드에 들어가 자기 write를 외부 변경으로 오인하지 않는다.
  - [ ] complete journal → submitted 목록 영속 → 삭제의 각 경계에서 종료해도 reconcile로 복구된다.
  - [ ] partial이면 미완료 파일의 원본 키는 남고 완료 파일 원본만 지워진다. `stripSubmitted`가 비운 메타와 무관하게 journal로 원본을 찾는다.
  - [ ] 만료(30일) journal은 reconcile에서 정리되고 레코드는 "로컬 파일 없음"이 된다.
  - [ ] 같은 패널에서 최초 제출 in-flight 중에는 `withIssueSubmitGuard`/`canSubmitIssue`가 그 이슈의 승격·로컬 사본 삭제를 막는다.
  - [ ] 회귀 기준: 기존 `issues-store.test.ts`의 markSubmitted(:336-370)·merge(:634-780) 테스트가 무변경 green.
  - [ ] analytics는 기존 `track-submit.test.ts`를 확장해 신규 속성·파일명이 추가되지 않음을 고정한다.

### Task 5: 어댑터별 파일 도달 판정 + Jira 메시지 분해 [1단계]
- **변경 대상**: `submitTo*.ts`, `prepareUpload.ts`, `submitAdapters.ts`, background `messages.ts`·`bgRequestTypes.ts`·`jira-api.ts`와 각 API 모듈, `src/types/jira.ts`.
- **작업 내용**: 설계의 플랫폼 표에 따라 9개 경로를 전환한다. 파일 ID를 응답까지 왕복시킨다. 기존 upload/auth 처리 구조는 유지한다. `jira.submitIssue`를 `jira.createIssue` / `jira.uploadAttachment`(파일당 1메시지) / `jira.updateIssueDescription`으로 분해하고 `submitToJira.ts`가 오케스트레이션한다. `withLocale` 래핑은 background `updateIssueDescription` 진입점에 유지하고 `bodyLocale`을 payload로 싣는다. 생성 전 업로드 실패(Linear·Notion)와 Slack 승격 `requireMediaUpload` 가드는 현행 동작을 유지한다.
- **검증**:
  - [ ] 전 플랫폼에 capture/video/inline/logs/user 성공·실패·응답 누락 매트릭스를 적용한다.
  - [ ] 9개 어댑터 전부: 사용자 파일명이 `logs.html`/`screenshot.webp`인 경우 캡처·로그 결과와 섞이지 않는다.
  - [ ] Linear는 `attachmentCreate.success:false`, attachment 연결과 본문 갱신 동시 실패를 검출한다.
  - [ ] Linear·Notion 생성 전 업로드 실패는 기존처럼 제출 실패 + draft 유지, journal은 prepared에서 정리된다.
  - [ ] Jira 분해: 정상 제출 결과(key·첨부·ADF)가 분해 전과 같다. 빈 attachment 응답·사용자 파일 실패가 보존된다. 401 refresh 경로가 각 메시지에서 동작한다. 120초 영상 + logs.html도 메시지당 1파일이라 64MiB를 넘지 않는다.
  - [ ] Jira 분해 후 background 진입점이 `builderLocaleWrap`/`bodyLocaleBackground` 스캔 분류에 맞게 등재된다.
  - [ ] Slack complete 실패·permalink 실패가 보존된다.
  - [ ] Notion 본문 99/100/101블록에서 파일이 실제 요청에 들어갔는지를 검사한다(`createPage`의 `slice(0, 100)` 경계).
  - [ ] GitLab 역링크 보강 실패는 기존 첨부 성공을 뒤집지 않는다.
  - [ ] Webhook multipart 파트/계약·JSON 비전송·idempotencyKey가 유지된다.
  - [ ] GitHub 주입 함수는 직렬화 후에도 module closure를 참조하지 않는다.
  - [ ] 신설·삭제 메시지가 union·handler·`BG_REQUEST_TYPE_MAP`에서 일치한다.

### Task 6: 거짓 첨부 문구와 내부 마커 제거 [1단계]
- **변경 대상**: `issueBodyShared.ts`, `resolveInlineImages.ts`, `buildMarkdownIssueBody.ts`, `buildClickupIssueBody.ts`, Jira ADF 생성·갱신 경로, 필요한 기타 빌더.
- **작업 내용**: 사용자 로그 제외와 전송 실패를 구분한다. 최초 생성 본문부터 안전한 폴백을 쓰고 확정 업로드 결과로 참조를 갱신한다.
- **검증**:
  - [ ] GitHub/GitLab/ClickUp 실패 본문에 `inline:`이 없다.
  - [ ] Jira의 첨부 전부 실패 + 본문 갱신 실패에서도 원격 최초 본문에 내부 sentinel이 없다.
  - [ ] 링크 없는 로그에 “첨부됨”을 무조건 출력하지 않는다. 정상 본문과 bodyLocale은 유지된다.
  - [ ] 새 본문 문구 키가 `bodyLocaleBackground.test.ts` 화이트리스트에 등재된다.

### Task 7: 완료 화면 변형·목록 표시·복구 상세·로컬 정리 [1단계]
- **변경 대상**: 신규 `AttachmentRecoveryPanel.tsx`, `SubmitSuccessView.tsx`, `IssueTab.tsx`, `IssueListTab.tsx`, `IssueRow.tsx`, `DraftDetailDialog.tsx`(읽기 전용 복구 모드), `src/sidepanel/tabs/issueListUtils.ts`, 다운로드 helper와 i18n.
- **작업 내용**:
  - 완료 화면: partial이면 amber `CircleAlert`·별도 제목 키·스토어 리뷰 버튼 숨김·위쪽 정렬 `PageScroll` + `PageFooter` [확인]. unknown은 별도 제목 + 다운로드만.
  - 목록 행: 메타 줄에 amber 아이콘 + 텍스트, 오른쪽 자리는 `SubmittedBadge` 대신 `ButtonGroup`(1단계는 [상세]만). partial/unknown 행 클릭은 복구 상세. "제출" 필터에 확인 필요 개수.
  - 복구 상세: `DraftDetailDialog` 읽기 전용 모드 + `AttachmentRecoveryPanel` + 남은 보존 기간 + 푸터 [이슈 열기]. unknown이면 **등록되지 않았음 확인**(AlertDialog).
  - 로컬 사본 삭제(AlertDialog). partial은 기존 이슈 복구만, unknown은 새 이슈 제출과 재첨부 모두 차단.
  - 토스트: 완료 화면이 뜨는 경로에서 `toastSubmitDropped`를 띄우지 않는다(판정은 Task 1 lib). 승격 경로 토스트가 Slack을 플랫폼명으로 쓰는 기존 버그(`IssueListTab.tsx:243`, `activeDraft.platform`)를 이 경로 교체 때 대상 플랫폼명으로 고친다.
  - Slack 보존 이슈에 미완료 첨부가 있으면 [트래커로 등록]을 비활성 + 툴팁.
- **testid** (e2e 매핑):
  - `submit-success-partial`, `submit-success-unknown` — e2e 1·2·3·7·9
  - `recovery-row-warning`(행 메타 줄), `recovery-detail-open` — e2e 4·7·16
  - `recovery-file-row`(+`data-file-id`·`data-state`), `recovery-file-download`, `recovery-local-missing` — e2e 1·2·4·8
  - `recovery-delete-local`, `recovery-confirm-not-registered` — e2e 7
  - `recovery-retry`(2단계), `recovery-retry-status`(live region) — e2e 11~15
- **검증**:
  - [ ] 확인·닫기·패널 재시작 후 표시/파일이 남고 다운로드 바이트가 같다.
  - [ ] 파일 유실·만료면 성공 토스트 없이 로컬 파일 없음 표시. Notion 로그는 ZIP 다운로드 가능.
  - [ ] 다운로드만으로 상태가 완료로 바뀌지 않는다. 로컬 사본 삭제 후 표시·사본이 정리되고 원격 호출은 0회.
  - [ ] 등록되지 않았음 확인 → AlertDialog 확인 후 draft로 돌아가고, 취소하면 상태 불변.
  - [ ] 이슈 삭제/전체 삭제에 journal 정리가 포함된다. Slack 원본 보존·승격과 일반 복구 상태가 섞이지 않는다.
  - [ ] 정상 제출·Webhook JSON UI는 기존 동작 유지. 복구 상세는 계정 해제 후에도 열린다.
  - [ ] 기존 `DraftDetailDialog`의 draft·Slack 보존 상세 동작이 유지된다.
  - [ ] partial 레코드는 `IssueStatus = "submitted"` + `submissionRecoveryId`로 표현되고 `filter-submitted`에 보이며 `filter-draft`에는 없다. 승격 버튼(`promote-issue`)은 미완료 첨부가 있으면 비활성.
  - [ ] 키보드 접근(행 버튼 `aria-label`, Dialog 포커스)·색+아이콘+텍스트 병기.

### Task 8: 1단계 통합 검증과 문서 [1단계]
- **변경 대상**: 회귀 테스트·e2e spec, `docs/{ARCHITECTURE,DIRECTORY,POSTMORTEM}.md`, `docs/privacy.{ko,en}.md`, 가이드.
- **작업 내용**: 결과 계약 전환 완료 후 옛 boolean과 중복 toast 경로를 제거한다. 함께 갱신할 대상: `submitDroppedToast.test.ts`, `uploadResultGuard.test.ts`(소스 스캔), `jiraSubmitIssue.test.ts`, `submitTo*.test.ts` 8개, i18n `submit.logsDropped`/`submit.mediaDropped`(전 로케일, 이행 기간에는 원인 중립 문구로 교체). 보존 정책(부분 실패 시 미완료 원본 최대 30일·사용자 삭제)과 실패 안내를 문서화한다. 개인정보 문서는 ko 원본·en 번역 본문과 시행일을 함께 갱신한다.
- **검증**:
  - [ ] `pnpm typecheck`, `pnpm test` 통과(i18n 키 대칭은 `locales.test.ts`·log-viewer `i18n.test.ts`가 자동 검사). 이 명령들은 구현 단계에서만 실행한다.
  - [ ] 신규 lib 파일이 커버리지 로직 스코프에 남는다(`BROWSER_BOUND_EXACT` 미등재).
  - [ ] `/e2e-write`로 아래 1단계 시나리오를 green까지 작성한다. 일반 빌드는 자동 실행하지 않는다.
  - [ ] GitHub MAIN world 변경에 대한 실탭 smoke 결과를 기록한다. 실행 환경이 없으면 미검증 범위를 명시한다.
  - [ ] `docs/privacy.{ko,en}.md`가 보존 범위·30일 기한·삭제 방법을 명시하고 "제출 성공 시 blob 자동 삭제" 서술과 모순되지 않는다.
  - [ ] 회고에 사용자 첨부 축 누락·업로드/연결 혼동·삭제 보류 수명·Jira 분해 함정을 기록한다.
  - [ ] 수동: 좁은 패널·라이트/다크에서 완료 화면 변형·목록 행·복구 상세를 확인한다(amber AA 미검증 조합 육안 확인).

## 2단계 태스크

1단계가 배포된 뒤 착수한다. 1단계의 결과 계약·journal·보존 원본을 그대로 쓴다.

### Task 9: 원격 조회·갱신과 단계 체크포인트 [2단계]
- **변경 대상**: background API 모듈·messages/types/`bgRequestTypes.ts`, `SubmissionProgress.fileCheckpoint`(신규 `submissionRecovery.ts`의 인터페이스 확장 — 파일이 아님), `blob-db.ts`.
- **작업 내용**: 설계 플랫폼 표의 body/attachment 조회 및 갱신 메시지를 추가하고 파일별 upload/link/body checkpoint를 저장한다. 계정 신원(플랫폼별 `accountIdentity`)·목적지 locator를 고정한다. 모든 체크포인트는 사이드패널의 응답 수신 지점에서 쓴다.
- **검증**:
  - [ ] 8개 플랫폼 각각 기존 이슈를 조회·갱신하고 생성 API를 호출하지 않는 mock 계약 테스트.
  - [ ] GitHub는 body만 PATCH, Jira는 attachment id 재사용, Linear는 GraphQL success=false를 실패 처리.
  - [ ] Notion child pagination·100개 이하 append·반환 block id 저장·미연결 upload 만료·응답 유실 재조회를 검증한다. 고정 API 버전에서 삽입 위치와 capability를 실계정 fixture로 확인한다.
  - [ ] Slack file_id/complete 상태 보존, 같은 complete 무조건 재호출 금지, scope 추가 없음.
  - [ ] 401 refresh 후 동일 계정 재개, 계정 변경·연결 해제·404·403 시 새 생성 없이 중단하고 크래시 없이 재연결 안내/다운로드를 반환한다.
  - [ ] 8개 플랫폼의 `accountIdentity` 추출이 정의 표와 일치한다.
  - [ ] 기존 메시지 허용 타입 Map·union·handler가 모두 일치한다.

### Task 10: 실패 단계 재개와 본문 패치 [2단계]
- **변경 대상**: 신규 `retryAttachments.ts`, `retryAttachmentAdapters.ts`, `attachmentBodyPatch.ts`, journal revision 관리.
- **작업 내용**: 이슈 목록에서 호출할 단일 runner를 만든다. `navigator.locks`로 이슈별 배타를 얻고 IDB 트랜잭션으로 revision을 검사한다. 첨부 관련 hunk만 3-way patch하고 성공한 upload/link를 재사용한다. 업로드는 메시지당 1파일. Webhook은 미지원 판정을 명시한다.
- **검증**:
  - [ ] upload 성공/body 실패 후 두 번째 시도는 upload 0회·body update 1회.
  - [ ] 여러 파일 중 일부 재성공하면 다음 시도는 남은 파일만 처리한다.
  - [ ] remote에 추가된 문장·상태·담당자는 유지, 첨부 자리 수정/삭제/모호한 중복 문구는 conflict로 차단.
  - [ ] `navigator.locks` mock으로 동시 2회 호출 중 1회만 실행된다. 락 해제 후 unknown 쓰기가 남은 파일은 반복하지 않고 reconcile한다.
  - [ ] 응답 유실/오래된 revision은 먼저 reconcile하고, 결과를 확인할 수 없는 쓰기는 반복하지 않는다.
  - [ ] 제목·본문 언어·파일·로그는 현재 draft/설정 대신 최초 제출 snapshot을 사용한다. 현재 bodyLocale ≠ snapshot일 때 재시도 메시지 payload의 bodyLocale이 snapshot이다.
  - [ ] 패치 빌더가 `t`/본문 헬퍼를 import하면 `builderLocaleWrap.test.ts`의 WRAPPED/EXEMPT에 분류된다.
  - [ ] 재시도 중 보존 Blob이 유실되면 해당 파일은 `local-storage`/로컬 없음으로 표시되고 업로드 0회.
  - [ ] 120초 영상 + logs.html 동시 실패 재시도에서 각 메시지가 1파일이다.
  - [ ] complete 영속(`markSubmittedDurably`) 후에만 보존 자료 삭제. 실패한 metadata write는 자료를 보존한다.

### Task 11: 재시도 UI·피드백 [2단계]
- **변경 대상**: `IssueRow.tsx`, `AttachmentRecoveryPanel.tsx`, `DraftDetailDialog.tsx`(복구 모드 푸터), i18n.
- **작업 내용**: 행 `ButtonGroup`에 [첨부 재시도] 추가, 재시도 불가 상태면 숨김. 실행 중 `Loader2` + `aria-busy` + `disabled`, 파일별 진행은 상세에만. 완료 요약은 `role="status" aria-live="polite"` 한 줄, 다른 화면에서 끝나면 토스트 하나. stale/unknown은 스피너 없이 "결과 확인 필요". 재시도 불가 상태표(design §5)의 대체 동작과 문구를 연결한다.
- **검증**:
  - [ ] 재시도 불가 상태(계정 변경·404·403·충돌·모호·Webhook·로컬 유실) 각각에서 버튼 노출/대체 동작/문구가 표와 일치한다.
  - [ ] 연속 클릭은 한 번만 실행된다(버튼 disabled + 락).
  - [ ] 성공 시 표시가 사라지고 `toast.success`가 뜬다. 재실패 시 "다시 N개 실패"와 갱신된 패널.
  - [ ] live region은 완료 요약 한 번만 읽는다.
  - [ ] 재시도 중 로컬 사본 삭제·Slack 승격이 차단된다.

### Task 12: 2단계 통합 검증과 문서 [2단계]
- **변경 대상**: e2e spec, `docs/{ARCHITECTURE,POSTMORTEM}.md`, 가이드.
- **검증**:
  - [ ] `pnpm typecheck`, `pnpm test` 통과.
  - [ ] `/e2e-write`로 아래 2단계 시나리오를 green까지 작성한다.
  - [ ] 수동: 8플랫폼 실계정에서 기존 이슈 첨부/본문 갱신과 원격 동시 편집 시 race 한계를 확인·기록한다.
  - [ ] 회고에 단계 재개·본문 충돌·락 함정을 기록한다.

## 테스트 계획

### 단위 테스트

기대 파일 집합, 실패 코드 정규화, 결과 누락·중복 대조, 부분 완료 판정, 표시 경로 판정, journal 상태 전이, 파일별 정리 목록을 순수 함수로 먼저 고정한다. fake IndexedDB(`fake-indexeddb/auto`, `blob-db-attachments.test.ts` 선례)로 v8 업그레이드·원자 저장·quota·두 인스턴스 동시 begin·오래된 attempt·삭제 순서를 검증한다. 어댑터 테스트는 외부 응답만 mock(`vi.mock("@/lib/bg-client")` sendBg 스파이, background는 `vi.stubGlobal("fetch")`)하고 가능하면 실제 본문 빌더를 사용해 placeholder가 숨지 않게 한다. Jira 분해 후에는 체크포인트가 모두 사이드패널에 있으므로 sendBg 스파이로 검증한다. background 핸들러 자체(분해된 Jira 메시지·신설 조회/갱신)는 핸들러 직접 호출(`jiraSubmitIssue.test.ts` 패턴)로 검증한다. 두 패널 동시성(begin 원자성·재시도 락)은 e2e가 아니라 fake-IDB·`navigator.locks` mock 단위 테스트로 결정적으로 고정한다.

### e2e 시나리오

e2e 스파이는 각 Page에서 `chrome.runtime.sendMessage`를 가로채 `msg.type`별 호출 수와 payload를 기록한다(SW 우회 — `e2e/GOTCHAS.md`). 판정은 스파이 기록과 testid로만 한다.

**1단계**

1. GitHub `uploadFiles` 스파이가 인라인 1개를 실패로 반환하면, `github.submitIssue` 호출은 1회이고 그 payload body에 `inline:`이 없으며, `submit-success-partial`이 보이고 `recovery-file-row[data-state=failed]`가 1개 있고 `recovery-file-download`가 활성이다.
2. 사용자 PDF 업로드만 실패하면, `recovery-file-row`의 파일명이 PDF이고 logs.html 용량 문구 텍스트가 페이지에 없다.
3. ClickUp/Asana/Slack에서 생성 응답 뒤 업로드 배치를 거절하면, 생성 메시지(`*.submitIssue`/`createTask`/`postMessage`) 호출은 1회이고, `submit-success-partial`에서 [확인] 후 목록 행에 `recovery-row-warning`이 있으며, 그 행과 상세 어디에도 `submit-issue`(새 제출) 버튼이 없다. 상세를 열고 닫아도 생성 메시지 호출 수는 1회 그대로다.
4. 부분 완료 후 패널을 reload하면 `recovery-row-warning`이 남고, `recovery-detail-open` → `recovery-file-download`로 받은 파일의 바이트 길이가 제출 전과 같다.
5. (단위 테스트로 이동) 두 패널 동시 제출 원격 생성 1회 — Task 3 fake-IDB begin 원자성.
6. 원본 Blob을 지운 draft를 제출하면 외부 메시지 호출 0회이고 draft가 목록에 그대로 있다.
7. 생성 메시지 스파이가 영구 pending promise를 반환하는 상태에서 panel을 reload하고 `addInitScript`로 스파이를 재설치한다. 그러면 목록 행에 "등록 확인 필요"(`recovery-row-warning`)가 보이고 새 제출 버튼이 없다. 상세에서 `recovery-confirm-not-registered` → AlertDialog 확인을 누르면 행이 draft로 바뀐다. 그 전까지 생성 메시지 추가 호출은 0회다.
8. 로그 OFF로 제출하면 결과의 `recovery-file-row` 중 `data-file-id=logs`가 없고, 이미지 실패 시 이미지 행만 있다.
9. 정상 제출이면 `submit-success-partial`이 없고 기존 성공 화면이 보이며 목록에 `recovery-row-warning`이 없다.
10. Slack 승격에서 미디어 업로드 실패는 기존 `requireMediaUpload` 가드로 생성 메시지 0회(`slack-promote-media-guard.spec.ts` 유지), Webhook JSON은 `recovery-row-warning` 없이 기존 보존 규칙 유지.
16. Webhook multipart 부분 실패 항목의 상세에는 `recovery-retry`가 없고 `recovery-file-download`만 있다.

**2단계**

11. 부분 완료 행의 `recovery-retry`를 누르면, 업로드 메시지가 실패 파일 수만큼, 본문 갱신 메시지가 1회 호출되고 생성 메시지는 0회다. 성공 후 `recovery-row-warning`이 사라진다.
12. 업로드 성공/본문 갱신 실패 이슈를 재시도하면 업로드 메시지 0회, 본문 갱신 메시지 1회다.
13. 본문 조회 스파이가 base에 사용자 문장 "외부 편집"을 추가한 본문을 반환하면, 본문 갱신 payload의 body에 "외부 편집"이 포함되고 `inline:`이 없다. 조회 본문에서 첨부 자리를 지운 경우에는 본문 갱신 호출 0회이고 해당 `recovery-file-row[data-state=conflict]`가 보인다.
14. (단위 테스트로 이동) 두 패널 동시 재시도 외부 쓰기 1회 — Task 10 `navigator.locks` mock.
15. Notion 101블록 제출에서 잘린 첨부를 재시도하면 append children 메시지의 대상 pageId가 원래 pageId이고 page 생성 메시지는 0회다. Slack 실패 파일 재시도는 업로드 메시지의 `thread_ts`가 원래 부모 ts이고 `postMessage` 호출은 0회다.

### 수동 테스트

실 GitHub 탭 주입·웹 로그인·업로드 반환값과 iframe 없는 새 탭 정리, 실제 다운로드 파일 열기, 좁은 패널/다크모드의 파일 목록 표시를 확인한다(1단계). 8플랫폼의 기존 이슈 첨부/본문 갱신, 원격 동시 편집은 2단계에서 확인한다. 실서비스 권한·제한 오류는 가능한 테스트 계정에서 보조 확인하고 mock green을 실업로드 성공으로 보고하지 않는다. #244 재현률·업로드 원인 조사는 별도 관찰 기록으로 남긴다.

## 구현 순서 권장

**1단계**: 1 → 2/3 → 4 → 5/6 → 7 → 8. Task 2와 3, 계약이 고정된 이후 Task 5의 플랫폼별 변경(Jira 분해 포함)과 Task 6의 본문 폴백은 병렬 작업 가능하다. 1단계 안에서 전 어댑터 전환과 원본 보호(삭제 보류)가 끝나기 전에 부분 완료 UI만 배포하지 않는다.

**2단계**: 1단계 배포 후 9 → 10 → 11 → 12. 2단계는 1단계 배포를 막지 않는다.

## 가이드 영향

`guide/AUTHORING.md` 기준으로 구현 후 `/guide`에서 ko/en을 함께 갱신한다.

- `guide/{ko,en}/integrations/issue-tracking.md`: 부분 완료·복구 상세·다운로드·보존 기한(1단계), 이슈 목록 재첨부·본문 충돌·중복 등록 방지(2단계).
- `guide/{ko,en}/integrations/platforms.md`: 플랫폼별 첨부/본문 상태 차이, 생성 전 실패는 제출 실패로 남는 플랫폼(Linear·Notion).
- `guide/{ko,en}/integrations/custom-webhook.md`: multipart 확인 범위와 JSON 비전송, 복구는 다운로드만.
- `guide/{ko,en}/{element,screenshot,video}/issue.md`: 완료 화면의 복구 동선.
- `guide/{ko,en}/faq.md`: 첨부 실패 원인 미확인, 로컬 파일 없음, 로컬 사본 삭제, 30일 자동 삭제, 등록 여부 미확인.
- `guide/AUTHORING.md`: 제출 사실 스냅샷과 보존 규칙 갱신. 바뀐 완료 화면·목록 상세 스크린샷은 `/guide-shots` 대상으로 표시.
