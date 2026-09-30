# 파일 첨부 실패 처리와 재첨부 — 구현 태스크

## 선행 조건

- 이 작업은 설계만 완료하며 구현·테스트 실행·빌드는 후속 단계다.
- 사용자 결정: 이슈 목록에서 실패 첨부를 재시도하고 기존 원격 이슈의 첨부·본문을 갱신한다. 새 이슈 재생성·예약 반복 재시도는 제외한다.
- 착수 시 `docs/POSTMORTEM.md`의 2026-09-29 첨부 경고, 2026-06-30 승격 원본 소실, 크로스 인스턴스 병합 항목을 읽는다.
- IDB v8→v9 업그레이드가 필요하다. env·의존성은 추가하지 않는다. 원격 조회/갱신 권한과 Slack scope는 Task 5A에서 검증하며 부족하면 다운로드 폴백을 둔다.
- #244의 실제 업로드 실패 원인은 별도 관찰 대상으로 둔다. 이번 수용 테스트는 결정적인 mock 응답을 사용한다.

## 태스크

### Task 1: 파일 의도·결과 계약과 순수 판정
- **변경 대상**: `src/types/{attachment,platform,messages,jira,slack}.ts`, 신규 `src/sidepanel/lib/attachmentResults.ts`와 테스트.
- **작업 내용**: 파일 ID·종류·단계·실패 코드·delivery/presentation 계약과 기대 집합 대조를 먼저 테스트로 고정한다. `logsDropped`/`mediaDropped`와 호환되는 파생 함수를 이행 기간에만 둔다.
- **검증**:
  - [ ] 사용자 파일 실패와 로그 실패가 분리된다. 같은 표시명·빈 locator·빠진 응답·중복 응답을 성공으로 간주하지 않는다.
  - [ ] 업로드 성공/연결 실패, 첨부 성공/본문 실패, 의도적 미전송을 서로 구분한다.
  - [ ] 원인 미확인은 unknown이며 HTTP 403을 size-limit로 추측하지 않는다.

### Task 2: 전송 전 원본 검사와 불변 복구 사본
- **변경 대상**: `resolveInlineImages.ts`, `buildCaptureFiles.ts`, `buildEditorCapture.ts`, 두 제출 진입점, 신규 `submissionRecovery.ts`.
- **작업 내용**: 로딩 전 예상 파일 목록을 만들고 Blob 누락을 명시적으로 반환한다. 로그 OFF/활성 섹션 규칙을 유지한다. 복구 파일의 바이트·MIME·표시명을 전송 전 확정한다.
- **검증**:
  - [ ] 누락 inline·영상·스크린샷·사용자 파일 각각에서 외부 생성 호출 0회.
  - [ ] 로그 OFF·비활성 섹션·Webhook JSON은 누락으로 오탐하지 않는다.
  - [ ] 생성 후 로그가 늘어나도 복구 logs.html은 최초 바이트 그대로다.
  - [ ] JPEG 원본 다운로드의 확장자/MIME이 일치하고 업로드 엔드포인트 변경은 없다.

### Task 3: IDB 복구 journal과 원자적 제출 시작
- **변경 대상**: `src/store/blob-db.ts` 및 `__tests__`, 신규 lib.
- **작업 내용**: DB v9와 `submissionRecovery` store, 메타+Blob 원자 저장·상태 전이·조회·삭제 API 구현. 기존 함수와 달리 복구 API는 오류를 throw한다.
- **검증**:
  - [ ] 기존 v8 데이터 보존, 열린 연결의 versionchange/blocked 처리가 유지된다.
  - [ ] quota 실패 시 메타나 파일 일부만 남지 않고 외부 요청도 없다.
  - [ ] 동시 begin 2회 중 하나만 성공한다. 오래된 attempt의 checkpoint/delete는 새 attempt를 변경하지 않는다.
  - [ ] 기존 Blob prune·inline GC·markSubmitted 이후에도 복구 Blob이 남는다.

### Task 4: 생성 체크포인트와 제출 수명
- **변경 대상**: `issues-store.ts`, `editor-store.ts`, `IssueCreateModal.tsx`, `DraftDetailDialog.tsx`, `SubmitFieldsDialog.tsx`, `messages.ts`, `submissionRecovery.ts`.
- **작업 내용**: 생성 직전/직후 체크포인트, 부분 결과 완료, 재시작 reconciliation, submitted 포인터 보존을 두 진입점에 공통 연결한다. Jira는 background가 IDB에 체크포인트를 쓴다.
- **검증**:
  - [ ] 원격 생성 이후 upload RPC throw에서 기존 key/id를 보존하며 create 호출은 한 번이다.
  - [ ] creating 중 종료는 unknown, created 중 종료는 기존 목적지 있는 복구 항목으로 돌아온다.
  - [ ] 다른 패널의 stale draft·unknown 해제가 최신 created 상태를 역행시키지 않는다.
  - [ ] complete journal → submitted 목록 영속 → 사본 삭제의 각 경계에서 종료해도 복구 가능하다.
  - [ ] 실패 사유·상태를 제외한 원본 데이터가 analytics에 추가되지 않는다.

### Task 5: 어댑터별 파일 도달 판정
- **변경 대상**: `submitTo*.ts`, `prepareUpload.ts`, `submitAdapters.ts`, background `messages.ts`와 각 API 모듈.
- **작업 내용**: 설계의 플랫폼 표에 따라 9개 경로를 전환한다. 파일 ID를 응답까지 왕복시킨다. 기존 upload/auth 처리 구조는 유지한다.
- **검증**:
  - [ ] 전 플랫폼에 capture/video/inline/logs/user 성공·실패·응답 누락 매트릭스를 적용한다.
  - [ ] Linear는 `attachmentCreate.success:false`, attachment 연결과 본문 갱신 동시 실패를 검출한다.
  - [ ] Jira 빈 attachment 응답·사용자 파일 실패, Slack complete 실패·permalink 실패가 보존된다.
  - [ ] Notion 본문 99/100/101블록에서 파일이 실제 요청에 들어갔는지를 검사한다.
  - [ ] GitLab 역링크 보강 실패는 기존 첨부 성공을 뒤집지 않는다.
  - [ ] Webhook multipart 파트/계약·JSON 비전송·idempotencyKey가 유지된다.
  - [ ] GitHub 주입 함수는 직렬화 후에도 module closure를 참조하지 않는다.

### Task 5A: 원격 조회·갱신과 단계 체크포인트
- **변경 대상**: background API 모듈·messages/types, `SubmissionProgress`, `blob-db.ts`.
- **작업 내용**: 설계 플랫폼 표의 body/attachment 조회 및 갱신 메시지를 추가하고 파일별 upload/link/body checkpoint를 초기 제출부터 저장한다. 계정 신원·목적지 locator를 고정한다.
- **검증**:
  - [ ] 8개 플랫폼 각각 기존 이슈를 조회·갱신하고 생성 API를 호출하지 않는 mock 계약 테스트.
  - [ ] GitHub는 body만 PATCH, Jira는 attachment id 재사용, Linear는 GraphQL success=false를 실패 처리.
  - [ ] Notion child pagination·100개 이하 append·반환 block id 저장·미연결 upload 만료·응답 유실 재조회를 검증한다. 고정 API 버전에서 삽입 위치와 capability를 실계정 fixture로 확인한다.
  - [ ] Slack file_id/complete 상태 보존, 같은 complete 무조건 재호출 금지, scope 추가 없음.
  - [ ] 401 refresh 후 동일 계정 재개, 계정 변경·404·403 시 새 생성 없이 중단한다.
  - [ ] 기존 메시지 허용 타입 Set·union·handler가 모두 일치한다.

### Task 5B: 실패 단계 재개와 본문 패치
- **변경 대상**: 신규 `retryAttachments.ts`, `retryAttachmentAdapters.ts`, `attachmentBodyPatch.ts`, journal run 관리.
- **작업 내용**: 이슈 목록에서 호출할 단일 runner를 만든다. 첨부 관련 hunk만 3-way patch하고 성공한 upload/link를 재사용한다. Webhook은 미지원 판정을 명시한다.
- **검증**:
  - [ ] upload 성공/body 실패 후 두 번째 시도는 upload 0회·body update 1회.
  - [ ] 여러 파일 중 일부 재성공하면 다음 시도는 남은 파일만 처리한다.
  - [ ] remote에 추가된 문장·상태·담당자는 유지, 첨부 자리 수정/삭제/모호한 중복 문구는 conflict로 차단.
  - [ ] 재시도 실행 중 재시작·두 패널·연속 클릭에서 하나의 run만 실행된다.
  - [ ] 응답 유실/오래된 run은 먼저 reconcile하고, 결과를 확인할 수 없는 쓰기는 반복하지 않는다.
  - [ ] 제목·본문 언어·파일·로그는 현재 draft/설정 대신 최초 제출 snapshot을 사용한다.
  - [ ] complete 영속 후에만 복구 사본 삭제. 실패한 metadata write는 자료를 보존한다.

### Task 6: 거짓 첨부 문구와 내부 마커 제거
- **변경 대상**: `issueBodyShared.ts`, `resolveInlineImages.ts`, `buildMarkdownIssueBody.ts`, `buildClickupIssueBody.ts`, Jira ADF 생성·갱신 경로, 필요한 기타 빌더.
- **작업 내용**: 사용자 로그 제외와 전송 실패를 구분한다. 최초 생성 본문부터 안전한 폴백을 쓰고 확정 업로드 결과로 참조를 갱신한다.
- **검증**:
  - [ ] GitHub/GitLab/ClickUp 실패 본문에 `inline:`이 없다.
  - [ ] Jira의 첨부 전부 실패 + 본문 갱신 실패에서도 원격 최초 본문에 내부 sentinel이 없다.
  - [ ] 링크 없는 로그에 “첨부됨”을 무조건 출력하지 않는다. 정상 본문과 bodyLocale은 유지된다.

### Task 7: 이슈 목록 재시도·복구 상세·로컬 정리
- **변경 대상**: 신규 `AttachmentRecoveryPanel.tsx`, `SubmitSuccessView.tsx`, `IssueTab.tsx`, `IssueListTab.tsx`, `IssueRow.tsx`, `DraftDetailDialog.tsx`, `issueListUtils.ts`, 다운로드 helper와 i18n.
- **작업 내용**: 파일별 결과·첨부 재시도·개별 다운로드·기존 이슈 열기·복구 자료 삭제를 제공한다. partial은 기존 이슈 복구만, 생성 여부 unknown은 새 이슈 제출과 재첨부 모두 차단한다. 토스트는 보조 신호만 담당한다.
- **검증**:
  - [ ] 확인·닫기·패널 재시작 후 배지/파일이 남고 다운로드 바이트가 같다.
  - [ ] 파일 유실이면 성공 토스트 없이 로컬 파일 없음 표시. Notion 로그는 ZIP 다운로드 가능.
  - [ ] 다운로드만으로 상태가 완료로 바뀌지 않는다. 자료 삭제 후 배지·사본이 정리된다.
  - [ ] 이슈 삭제/전체 삭제에 journal 정리가 포함된다. Slack 원본 보존·승격과 일반 복구 상태가 섞이지 않는다.
  - [ ] 정상 제출·Webhook JSON UI는 기존 동작 유지. 복구 상세는 계정 해제 후에도 열린다.
  - [ ] ko/en/fr 키 대칭·키보드 접근·좁은 패널·라이트/다크를 확인한다.

### Task 8: 통합 검증과 문서
- **변경 대상**: 회귀 테스트·e2e spec, `docs/{ARCHITECTURE,DIRECTORY,POSTMORTEM}.md`, `docs/privacy.{ko,en}.md`, 가이드.
- **작업 내용**: 결과 계약 전환 완료 후 옛 boolean과 중복 toast 경로를 제거한다. 보존 정책과 실패 안내를 문서화한다. 개인정보 문서는 실제 로컬 저장·삭제 동작과 시행일을 함께 갱신한다.
- **검증**:
  - [ ] `pnpm typecheck`, `pnpm test`, 수동 i18n 대칭 테스트 통과. 이 명령들은 구현 단계에서만 실행한다.
  - [ ] `/e2e-write`로 아래 자동화 시나리오를 green까지 작성한다. 일반 빌드는 자동 실행하지 않는다.
  - [ ] GitHub MAIN world 변경에 대한 실탭 smoke 결과를 기록한다. 실행 환경이 없으면 미검증 범위를 명시한다.
  - [ ] 회고에 사용자 첨부 축 누락·업로드/연결 혼동·복구 사본 수명·단계 재개·본문 충돌 함정을 기록한다.

## 테스트 계획

### 단위 테스트

기대 파일 집합, 실패 코드 정규화, 결과 누락·중복 대조, 부분 완료 판정, journal 상태 전이, 파일별 정리 목록을 순수 함수로 먼저 고정한다. fake IndexedDB로 v8 업그레이드·원자 저장·quota·두 인스턴스·오래된 attempt를 검증한다. 어댑터 테스트는 외부 응답만 mock하고 가능하면 실제 본문 빌더를 사용해 placeholder가 숨지 않게 한다.

### e2e 시나리오

1. GitHub 인라인 업로드가 실패하면 이슈는 한 번만 생성되고 본문에 `inline:`이 없으며 다운로드 가능한 복구 항목이 남는다.
2. 사용자 PDF만 실패하면 파일명이 PDF로 표시되고 logs.html 용량 초과 문구는 나오지 않는다.
3. ClickUp/Asana/Slack 생성 뒤 업로드 배치가 거절되면 기존 목적지를 보존하고 재제출 버튼이 없어 중복 생성되지 않는다.
4. 복구 항목에서 패널을 닫고 다시 열면 같은 파일을 다운로드할 수 있다.
5. 두 패널에서 같은 draft 제출을 시작하면 원격 생성은 한 번이다.
6. 원본 누락 또는 복구 사본 저장 실패 시 외부 호출 없이 draft가 남는다.
7. 생성 응답 유실 뒤 재시작하면 등록 여부 미확인이 표시되고 사용자 확인 전 새 생성이 차단된다.
8. 로그 OFF의 제출 파일 목록에 logs.html이 없으며 이미지 실패 결과에는 이미지만 들어간다.
9. 정상 제출은 복구 배지 없이 기존 성공 화면이고 임시 사본이 정리된다.
10. Slack 승격 부분 실패와 Webhook JSON 비전송은 각각의 기존 보존 규칙을 유지한다.
11. 이슈 목록에서 첨부 재시도를 누르면 같은 원격 이슈의 첨부/본문만 갱신되고 성공 후 배지가 사라진다.
12. 업로드 성공 후 본문 갱신이 실패한 이슈를 재시도하면 파일이 중복 첨부되지 않는다.
13. 원격 본문에 추가된 사용자 문장은 보존되고 충돌하는 첨부 위치는 자동 덮어쓰지 않는다.
14. 같은 이슈를 두 패널에서 재시도하면 외부 파일 쓰기는 한 번만 실행된다.
15. Notion의 잘린 첨부는 기존 page에 추가되고 Slack 실패 파일은 기존 thread에 추가된다.
16. Webhook 복구 항목에는 자동 재첨부 버튼 대신 다운로드가 표시된다.

### 수동 테스트

실 GitHub 탭 주입·웹 로그인·업로드 반환값과 iframe 없는 새 탭 정리, 실제 다운로드 파일 열기, 8플랫폼의 기존 이슈 첨부/본문 갱신, 원격 동시 편집, 좁은 패널/다크모드의 파일 목록 표시를 확인한다. 실서비스 권한·제한 오류는 가능한 테스트 계정에서 보조 확인하고 mock green을 실업로드 성공으로 보고하지 않는다. #244 재현률·업로드 원인 조사는 별도 관찰 기록으로 남긴다.

## 구현 순서 권장

1 → 2/3 → 4 → 5/5A/6 → 5B → 7 → 8. Task 2와 3, 계약이 고정된 이후 Task 5의 플랫폼별 변경과 Task 6의 본문 폴백은 병렬 작업 가능하다. 전 어댑터 전환과 원본 보호가 끝나기 전에 부분 UI만 배포하지 않는다.

## 가이드 영향

`guide/AUTHORING.md` 기준으로 구현 후 `/guide`에서 ko/en을 함께 갱신한다.

- `guide/{ko,en}/integrations/issue-tracking.md`: 부분 완료·이슈 목록 재첨부·본문 충돌·중복 등록 방지.
- `guide/{ko,en}/integrations/platforms.md`: 플랫폼별 첨부/본문 상태 차이.
- `guide/{ko,en}/integrations/custom-webhook.md`: multipart 확인 범위와 JSON 비전송.
- `guide/{ko,en}/{element,screenshot,video}/issue.md`: 완료 화면의 복구 동선.
- `guide/{ko,en}/faq.md`: 첨부 실패 원인 미확인, 파일 없음, 로컬 자료 삭제.
- `guide/AUTHORING.md`: 제출 사실 스냅샷과 보존 규칙 갱신. 바뀐 완료 화면·목록 상세 스크린샷은 `/guide-shots` 대상으로 표시.
