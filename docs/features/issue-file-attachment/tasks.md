# 이슈 파일 첨부 — 구현 태스크

## 선행 조건

- 추가 manifest 권한·env·OAuth **없음**. 파일 선택은 `<input type="file">`, 전송은 기존 플랫폼 업로드 경로 재사용.
- `MAX_ATTACHMENT_COUNT` 값은 10으로 시작(PRD 합의). 플랫폼 한도 상수는 코드 근거 있는 것만: Notion 5MiB, GitLab 10MB. 나머지는 `null`(경고 안 함).
- IndexedDB `DB_VERSION` 증가는 한 번만(6→7). 다른 미반영 store 변경과 충돌 없는지 확인.

## 태스크

### Task 1: 첨부 메타 타입 + 한도 순수 함수 (테스트 우선)
- **변경 대상**: `src/types/attachment.ts`(신규), `src/sidepanel/lib/attachmentLimits.ts`(신규), `src/sidepanel/lib/__tests__/attachmentLimits.test.ts`(신규)
- **작업 내용**: `UserAttachmentMeta` 타입. `MAX_ATTACHMENT_COUNT`, `PLATFORM_FILE_SIZE_LIMIT`, `checkAttachmentLimits(attachments, platform)`, `takeWithinCount(existing, incoming)` 구현. `/tdd interface`로 테스트 먼저.
- **검증**:
  - [ ] `checkAttachmentLimits`: 개수 초과 시 `overCount=true`, 한도 초과 파일 id가 `oversizeIds`에 포함, 한도 `null` 플랫폼은 항상 빈 `oversizeIds`
  - [ ] `takeWithinCount`: existing+incoming가 상한 이하면 전부 accept, 초과분은 dropped로 계산
  - [ ] `pnpm test` 통과

### Task 2: blob-db에 attachments store
- **변경 대상**: `src/store/blob-db.ts`
- **작업 내용**: `DB_VERSION` 6→7, `STORE_ATTACHMENTS` 추가(`onupgradeneeded`에 누락 분기). `saveAttachmentBlob`/`getAttachmentBlob`/`deleteAttachmentBlob`/`deleteAttachmentBlobs(prefix)`/`getAttachmentBlobKeys`/`rekeyAttachmentBlobs` 구현(기존 image/log 함수 시그니처·에러처리 패턴 복제).
- **검증**:
  - [ ] 기존 6개 store 데이터가 업그레이드 후 보존(수동: 기존 draft 있는 프로필로 로드)
  - [ ] save→get 라운드트립, `deleteAttachmentBlobs(owner)`가 prefix만 삭제, `rekeyAttachmentBlobs`가 pending→issueId 이동 후 pending 삭제
  - [ ] `pnpm typecheck`

### Task 3: settings-ui-store 토글
- **변경 대상**: `src/store/settings-ui-store.ts`
- **작업 내용**: `attachmentsEnabled: boolean`(기본 false) + `setAttachmentsEnabled`. `persist` 버전 5→6, `migrate`에서 누락 시 false. `replayEnabled`와 동형.
- **검증**:
  - [ ] 신규 설치 시 false, 기존 사용자 마이그레이션 후 false(누락 주입)
  - [ ] 토글 set 후 chrome.storage local 반영
  - [ ] `pnpm test`(settings 마이그레이션 테스트가 있으면 케이스 추가)

### Task 4: editor-store 첨부 상태·액션·영속
- **변경 대상**: `src/store/editor-store.ts`, `src/sidepanel/hooks/useEditorSessionSync.ts`
- **작업 내용**: state `attachments: UserAttachmentMeta[]`, `addAttachments(files)`(상한 컷 + `saveAttachmentBlob('pending:'+tabId)` + 메타 push), `removeAttachment(id)`(메타 제거 + blob 삭제). `EditorSnapshot`에 `attachments` 추가. `confirmDraft`에 `rekeyAttachmentBlobs('pending:'+tabId, id, ids)` + IssueRecord 메타 저장(모든 captureMode 공통 블록). `reset`/폐기 경로에 `deleteAttachmentBlobs('pending:'+tabId)`. `snapshotFromState`에 `attachments` 포함.
- **검증**:
  - [ ] addAttachments 후 메타가 state·session 스냅샷에 반영, Blob은 IndexedDB `pending:`에 존재
  - [ ] 사이드패널 재오픈(세션 복원) 후 리스트 유지(수동)
  - [ ] confirmDraft 후 Blob 키가 issueId로 이동, pending 잔여 없음
  - [ ] `pnpm test`(editor-store 순수 로직 테스트 범위)

### Task 5: issues-store 정리·orphan prune
- **변경 대상**: `src/store/issues-store.ts`
- **작업 내용**: `IssueRecord.attachments?` 추가. `markSubmitted`/`removeIssue`에 `deleteAttachmentBlobs(id)`. `stripSubmitted`에 `attachments: undefined`. `pruneOrphanBlobs`에 attachment 키 정리(image prune 로직 복제).
- **검증**:
  - [ ] 제출/삭제 후 해당 issueId의 attachment Blob 제거
  - [ ] 미존재 issueId의 attachment 키가 prune됨, `pending:`은 보존
  - [ ] `pnpm test`

### Task 6: buildCaptureFiles 첨부 합류 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/buildCaptureFiles.ts`, `src/sidepanel/lib/__tests__/buildCaptureFiles.test.ts`
- **작업 내용**: `CaptureFile.displayName?`, `CaptureFiles.attachments`, `BuildCaptureFilesInput.userAttachments`. 각 blob→dataURL 변환해 `{ filename: id+'__'+name(고유), displayName: name, dataUrl }` push.
- **검증**:
  - [ ] userAttachments 주어지면 `attachments` 배열 생성, filename 고유화·displayName 원본
  - [ ] 없으면 `attachments: []`
  - [ ] `pnpm test`

### Task 7a: 파일 메타 헬퍼 (테스트 우선) + shadcn item 설치
- **변경 대상**: `src/sidepanel/lib/fileMeta.ts`(신규), `src/sidepanel/lib/__tests__/fileMeta.test.ts`(신규), `src/components/ui/item.tsx`(shadcn 설치)
- **작업 내용**: `fileCategory(contentType, filename)`·`formatBytes(n)` 순수 함수 구현(`/tdd interface` 선행). `npx shadcn@latest add item` 설치 후 `src/components/ui/`에 위치 확인(루트에 생성됐으면 이동).
- **검증**:
  - [ ] `fileCategory`: image/video/audio/pdf/archive/text MIME 및 확장자 폴백, 미상은 `"file"`
  - [ ] `formatBytes`: 0·KB·MB 경계 포맷
  - [ ] `item.tsx`가 `src/components/ui/`에 존재, `pnpm typecheck`
  - [ ] `pnpm test`

### Task 7b: AttachmentSection UI + DraftingPanel 연결
- **변경 대상**: `src/sidepanel/components/AttachmentSection.tsx`(신규), `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**: 숨김 `<input type="file" multiple>`. 업로드 버튼은 `Button variant="outline"`, 라벨에 카운터 `파일 첨부 (n/10)` 내장, `n===MAX_ATTACHMENT_COUNT`면 `disabled`. 리스트는 shadcn `Item`(ItemMedia=형식 아이콘[`fileCategory`→lucide], ItemContent=파일명+MIME·크기[`formatBytes`], ItemActions=`Trash2` ghost 버튼). 한도 초과 파일(`checkAttachmentLimits`)에 경고 표시. DraftingPanel은 `attachmentsEnabled`일 때만 렌더, editor 액션 연결. `data-testid` 부여.
- **검증**:
  - [ ] 토글 ON일 때만 섹션 노출
  - [ ] 다중 선택→리스트 추가(형식 아이콘·파일명·MIME·크기 표시), 개별 Trash 삭제
  - [ ] 버튼 라벨 카운터가 `n/10`로 갱신, 10/10에서 비활성
  - [ ] 타깃 플랫폼 한도 초과 파일에 경고 표시(수동: Notion 선택 + 5MiB 초과 파일)

### Task 8: SettingsTab 토글 row
- **변경 대상**: `src/sidepanel/tabs/SettingsTab.tsx`
- **작업 내용**: 본문 구성 섹션에 "파일 첨부" 토글(`attachmentsEnabled` 바인딩, `IssueSectionRow`와 같은 시각). help에 "권장하지 않음" 뉘앙스. `id="setting-attachments-enabled"`.
- **검증**:
  - [ ] 토글이 기본 OFF로 표시, 변경이 즉시 drafting 첨부 섹션 노출에 반영
  - [ ] i18n ko/en 라벨·help 표시

### Task 9: 제출 합류 — IssueCreateModal + 6개 플랫폼
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/lib/submitToGithub.ts`·`submitToGitlab.ts`·`submitToLinear.ts`·`submitToNotion.ts`·`submitToAsana.ts`, `src/sidepanel/lib/buildGithubIssueBody.ts`·`buildGitlabIssueBody.ts`·`buildLinearIssueBody.ts`·`buildNotionIssueBody.ts`
- **작업 내용**: `buildEditorCaptureFiles`에서 `attachmentsEnabled && attachments`면 `getAttachmentBlob(issueId, id)`로 로드→`userAttachments` 전달. 각 핸들러에서 `captureFiles.attachments`를 업로드 배열에 합류(플랫폼별 표대로). GitHub/GitLab/Linear 본문 빌더에 `## Attachments` 링크 섹션 추가. Notion은 `attachments` category `"other"`. Asana는 `webpToJpeg` 미적용 분리. Jira는 `rawAttachments`에 push.
- **검증**:
  - [ ] 6개 플랫폼 각각 실제 이슈에 첨부 접근 가능(수동, 각 플랫폼 1건씩)
  - [ ] 인라인 미리보기 없음(GitHub/GitLab/Linear는 링크, Jira/Asana/Notion은 네이티브 첨부)
  - [ ] 파일명 중복 첨부 시 둘 다 업로드됨(고유 filename)
  - [ ] `pnpm typecheck`

### Task 10: i18n 키
- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**: 토글 라벨/help, 버튼, 리스트 빈 상태, 개수/한도 경고, "Attachments" 섹션 헤딩 키 ko/en 동시 추가.
- **검증**:
  - [ ] PostToolUse i18n 대칭 검사 통과(ko/en 키·placeholder 일치)

## 테스트 계획

- **단위 테스트**:
  - `attachmentLimits.test.ts`: `checkAttachmentLimits`(개수/단건 한도/null 플랫폼), `takeWithinCount`(경계값)
  - `fileMeta.test.ts`: `fileCategory`(MIME/확장자/폴백), `formatBytes`(경계값)
  - `buildCaptureFiles.test.ts`: userAttachments 유무, filename 고유화/displayName, 빈 배열
  - settings 마이그레이션(있으면): v5→v6 `attachmentsEnabled` 기본 false
  - blob-db rekey/delete가 순수 추출 가능하면 키 파생 함수 단위 테스트
- **e2e 시나리오** (`/e2e-write` 입력):
  - 설정에서 파일 첨부 토글을 켜면 drafting에 첨부 섹션이 나타난다(기본 상태에선 없다).
  - 파일 첨부 버튼으로 파일 2개를 고르면 리스트에 2개가 표시된다(`setInputFiles`).
  - 리스트에서 파일 1개를 삭제하면 1개만 남는다.
  - 파일을 더 고를수록 버튼 라벨 카운터가 증가하고, 상한(10/10)에서 첨부 버튼이 비활성화된다.
  - 첨부 후 사이드패널을 닫았다 열면 리스트가 유지된다.
  - 토글을 끄면 첨부 섹션이 사라진다.
- **수동 테스트** (자동화 불가):
  - 6개 플랫폼 각각 실제 이슈 생성 → 첨부 파일 접근 가능 확인(네트워크·OAuth 의존)
  - Notion 5MiB / GitLab 10MB 초과 파일 한도 경고 시각 확인
  - 대용량 파일 다중 첨부 시 제출 메모리/성공 동작

## 구현 순서 권장

- Task 1 → Task 6은 순수 함수/빌더라 선행·병렬 가능(테스트 우선).
- Task 2(blob-db) → Task 4(editor-store) → Task 5(issues-store)는 영속 의존 체인이라 순차.
- Task 7a(fileMeta + item 설치)는 Task 7b 선행. Task 1과 병렬 가능(순수 함수).
- Task 3(settings) → Task 8(SettingsTab) 페어, Task 7b(UI)와 병렬 가능.
- Task 9(제출 합류)는 Task 2·4·6 완료 후. 플랫폼 6개는 각각 독립이라 병렬 가능하나 본문 빌더 패턴 1개(GitHub) 먼저 확립 후 복제.
- Task 10(i18n)은 UI 태스크와 함께 수시 갱신(훅 검사 때문에 ko/en 동시).

## 가이드 영향

사용자 노출 UX 추가 → `/guide`로 ko·en 동시 갱신. `guide/AUTHORING.md` 규칙 선행.
- `guide/ko/settings/*`·`guide/en/settings/*` — 본문 구성에 "파일 첨부" 토글(기본 OFF, 권장 안 함) 설명 추가
- `guide/ko/*`(이슈 작성 흐름 페이지)·`guide/en/*` — drafting에서 파일 첨부 버튼 사용법, 플랫폼별 노출(네이티브 첨부 vs 링크), 개수/용량 한도 안내
- 정확한 대상 페이지는 `guide/SUMMARY.md`·기존 settings/quick-start 구조 대조 후 확정

> 권한·매니페스트 변동은 없으나 **사용자 임의 파일을 외부 플랫폼에 전송**하는 새 동작이므로 `docs/privacy.md` 대조·시행일 갱신 필요(`/push` privacy 게이트 대상).
