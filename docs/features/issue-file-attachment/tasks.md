# 이슈 파일 첨부 — 구현 태스크

## 선행 조건

- 추가 manifest 권한·env·OAuth **없음**. 파일 선택은 `<input type="file">`, 전송은 기존 플랫폼 업로드 경로 재사용.
- 하드캡: `MAX_ATTACHMENT_COUNT = 10`, `MAX_TOTAL_ATTACHMENT_SIZE = 50MB`(둘 다 차단). 플랫폼 단건 한도 상수는 코드 근거 있는 것만 경고용: Notion 5MiB, GitLab 10MB. 나머지 `null`(경고 안 함).
- IndexedDB `DB_VERSION` 증가는 한 번만(6→7). 다른 미반영 store 변경과 충돌 없는지 확인.
- `formatBytes`는 **신설 금지** — 기존 `src/sidepanel/lib/formatBytes.ts` import. settings 토글은 persist **버전 bump 없이** 초기 state 기본값만(replayEnabled 동형).

## 태스크

### Task 1: 첨부 메타 타입 + 한도 순수 함수 (테스트 우선)
- **변경 대상**: `src/types/attachment.ts`(신규), `src/sidepanel/lib/attachmentLimits.ts`(신규), `src/sidepanel/lib/__tests__/attachmentLimits.test.ts`(신규)
- **작업 내용**: `UserAttachmentMeta` 타입. `MAX_ATTACHMENT_COUNT`, `MAX_TOTAL_ATTACHMENT_SIZE`, `PLATFORM_FILE_SIZE_LIMIT`, `checkAttachmentLimits(attachments, platform)`(단건 한도 경고), `takeWithinLimits(existing, incoming)`(개수+합계 하드캡) 구현. `/tdd interface`로 테스트 먼저.
- **검증**:
  - [ ] `checkAttachmentLimits`: 단건 한도 초과 파일 id가 `oversizeIds`에 포함, 한도 `null` 플랫폼은 항상 빈 `oversizeIds`
  - [ ] `takeWithinLimits`: 개수 상한·합계 50MB 경계에서 accept/dropped 정확 계산, `reason`이 `"count"`/`"total"` 구분
  - [ ] `pnpm test` 통과

### Task 2: blob-db에 attachments store
- **변경 대상**: `src/store/blob-db.ts`
- **작업 내용**: `DB_VERSION` 6→7, `STORE_ATTACHMENTS` 추가(`onupgradeneeded`에 누락 분기). `saveAttachmentBlob`/`getAttachmentBlob`/`deleteAttachmentBlob`/`deleteAttachmentBlobs(prefix)`/`getAttachmentBlobKeys`/`rekeyAttachmentBlobs` 구현. **`rekeyAttachmentBlobs`는 로그 rekey와 다름** — 로그는 메모리 객체 재저장이지만 첨부는 IndexedDB-internal `getAttachmentBlob`(read)→`saveAttachmentBlob`(write)→`deleteAttachmentBlob`(delete) 3-step. read 단계 누락 금지. 키 파생(`${owner}:${id}`)은 순수 함수로 떼어 단위 테스트.
- **검증**:
  - [ ] 기존 6개 store 데이터가 업그레이드 후 보존(수동: 기존 draft 있는 프로필로 로드)
  - [ ] save→get 라운드트립, `deleteAttachmentBlobs(owner)`가 prefix만 삭제, `rekeyAttachmentBlobs`가 read→write→delete로 pending→issueId 이동 후 pending 삭제(Blob 내용 보존 확인)
  - [ ] 키 파생 순수 함수 단위 테스트, `pnpm typecheck`

### Task 3: settings-ui-store 토글
- **변경 대상**: `src/store/settings-ui-store.ts`
- **작업 내용**: `attachmentsEnabled: boolean`(기본 false) + `setAttachmentsEnabled`. **`replayEnabled`와 정확히 동형 — persist 버전 bump·migrate 분기 추가하지 않음**(초기 state 기본값에 의존, 누락 키는 hydrate 시 기본값으로 채워짐).
- **검증**:
  - [ ] 신규 설치 시 false, 기존 v5 사용자도 hydrate 후 false(기본값)
  - [ ] 토글 set 후 chrome.storage local 반영
  - [ ] `pnpm test`

### Task 4: editor-store 첨부 상태·액션·영속
- **변경 대상**: `src/store/editor-store.ts`, `src/sidepanel/hooks/useEditorSessionSync.ts`
- **작업 내용**: state `attachments: UserAttachmentMeta[]`, `addAttachments(files)`(`takeWithinLimits` 컷 + `File`을 state에 보관 않고 즉시 `saveAttachmentBlob('pending:'+tabId)` + 메타만 push), `removeAttachment(id)`(메타 제거 + `deleteAttachmentBlob`). `EditorSnapshot`에 `attachments`(메타만) 추가, `snapshotFromState`에 포함.
- **confirmDraft rekey 지점 (주의)**: confirmDraft는 captureMode별 4개 분기이고 **element 분기는 `persistAttachedLogs` 미호출 + 이른 return 가드(`if (!state.selection) return`)** 가 있다. 첨부 rekey는 "공통 블록"이 아니라 **`id` 확정 직후·가드보다 앞**에 단일 지점으로 배치: `attachmentsEnabled && attachments.length`면 `rekeyAttachmentBlobs('pending:'+tabId, id, ids)` + IssueRecord `attachments` 저장. (element 모드 누락 시 첨부 유실)
- **토글 OFF 보존**: OFF로 제출해도 첨부 Blob·메타 보존(rekey는 수행, 업로드만 스킵). 정리는 폐기/제출완료 시점에만.
- `reset`/draft 폐기 경로에 `deleteAttachmentBlobs('pending:'+tabId)`.
- **검증**:
  - [ ] addAttachments 후 메타가 state·session 스냅샷에 반영, Blob은 IndexedDB `pending:`에 존재(`File`은 state/snapshot에 없음)
  - [ ] 사이드패널 재오픈(세션 복원) 후 리스트 유지(수동)
  - [ ] **element 모드** confirmDraft 후에도 Blob 키가 issueId로 이동, pending 잔여 없음
  - [ ] 토글 OFF로 제출 시 첨부 업로드 스킵 + Blob 보존, 재켜기 후 복원
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

### Task 7a: 파일 메타 헬퍼 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/fileMeta.ts`(신규), `src/sidepanel/lib/__tests__/fileMeta.test.ts`(신규)
- **작업 내용**: `fileCategory(contentType, filename)`·`fileExtLabel(filename, contentType)` 순수 함수 구현(`/tdd interface` 선행). `formatBytes`는 **기존 `formatBytes.ts` import**(신설 금지). **shadcn item 설치 안 함**(Task 7b는 기존 Card+flex 재사용).
- **검증**:
  - [ ] `fileCategory`: image/video/audio/pdf/archive/text MIME 및 확장자 폴백, 미상은 `"file"`
  - [ ] `fileExtLabel`: 파일명에서 확장자 라벨(`"PDF"`,`"ZIP"`), 확장자 없으면 폴백
  - [ ] `pnpm test`

### Task 7b: AttachmentSection UI + DraftingPanel 연결
- **변경 대상**: `src/sidepanel/components/AttachmentSection.tsx`(신규), `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**: 숨김 `<input type="file" multiple>`. 업로드 버튼은 `Button variant="outline"`, 라벨에 카운터 `파일 첨부 (n/10)` 내장(i18n placeholder), `n===MAX_ATTACHMENT_COUNT`면 `disabled`. 리스트는 **기존 `LogAttachmentCards`의 `Card`+flex 패턴 재사용**(shadcn item 미설치): 형식 아이콘(`shrink-0`, `fileCategory`→lucide) + 텍스트(`min-w-0 flex-1`, 파일명 `truncate` + `확장자 · 크기`[`fileExtLabel`·기존 `formatBytes`]) + 삭제(`shrink-0`, `Button variant="ghost" className="h-8 w-8"` + `Trash2`). 빈 상태(0개)는 버튼만 노출, 리스트 영역 미렌더. 단건 한도 초과(`checkAttachmentLimits`) 파일에 경고 배지(`shrink-0`). DraftingPanel은 `attachmentsEnabled`일 때만 렌더(OFF면 단서 0 — 의도된 묻힘), editor 액션 연결. `data-testid` 부여.
- **검증**:
  - [ ] 토글 ON일 때만 섹션 노출(OFF면 비노출, 힌트 없음)
  - [ ] 다중 선택→리스트 추가(형식 아이콘·파일명 truncate·확장자·크기 표시), 개별 Trash 삭제
  - [ ] 버튼 라벨 카운터가 `n/10`로 갱신, 10/10에서 비활성, 합계 50MB 초과 입력 거부
  - [ ] 긴 파일명이 ~372px에서 넘치지 않음(truncate)
  - [ ] 타깃 플랫폼 단건 한도 초과 파일에 경고 표시(수동: Notion 선택 + 5MiB 초과 파일)

### Task 8: SettingsTab 토글 row
- **변경 대상**: `src/sidepanel/tabs/SettingsTab.tsx`
- **작업 내용**: 본문 구성 섹션에 "파일 첨부" 토글(`attachmentsEnabled` 바인딩, `IssueSectionRow`와 같은 시각). help에 "권장하지 않음" 뉘앙스. `id="setting-attachments-enabled"`.
- **검증**:
  - [ ] 토글이 기본 OFF로 표시, 변경이 즉시 drafting 첨부 섹션 노출에 반영
  - [ ] i18n ko/en 라벨·help 표시

### Task 9: 제출 합류 — IssueCreateModal + 6개 플랫폼
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/lib/submitToGithub.ts`·`submitToGitlab.ts`·`submitToLinear.ts`·`submitToNotion.ts`·`submitToAsana.ts`, `src/sidepanel/lib/buildGithubIssueBody.ts`·`buildGitlabIssueBody.ts`·`buildNotionIssueBody.ts` (**`buildLinearIssueBody.ts`는 무변경** — Linear는 createAttachment API)
- **작업 내용**: `buildEditorCaptureFiles`에서 `attachmentsEnabled && attachments`면 `getAttachmentBlob(issueId, id)`로 로드→`userAttachments` 전달(**핸들러별 중복 빌드 말고 한 번 빌드해 공유**, IndexedDB read N회·메모리 스파이크 회피). 합류:
  - **GitHub/GitLab**: 기존 `emitAttachments`(`buildGithubIssueBody.ts:181`/`buildGitlabIssueBody.ts:178`) **입력 배열에 합류** — 신규 `## Attachments` 섹션·신규 i18n 키 추가 금지(헤딩 중복 방지)
  - **Linear**: `submitToLinear` 의 `createAttachment` 루프에 합류(본문 빌더 무변경)
  - **Notion**: `buildNotionIssueBody` attachments category `"other"`
  - **Asana**: `allFiles`에 push하되 **`webpToJpeg`·`renameStyleElementFilenames`·inline HTML 매칭·create→update 두 번 쓰기 경로에 안 섞이도록 분리**(회귀 표면)
  - **Jira**: `rawAttachments`에 push(파일명 `inline-*.webp` 충돌만 주의)
- **검증**:
  - [ ] 6개 플랫폼 각각 실제 이슈에 첨부 접근 가능(수동, 각 플랫폼 1건씩)
  - [ ] 인라인 미리보기 없음(GitHub/GitLab 본문 링크, Linear attachment API, Jira/Asana 네이티브, Notion file block)
  - [ ] GitHub/GitLab에 `## Attachments` 헤딩 중복 없음(기존 캡처·로그와 한 섹션)
  - [ ] 파일명 중복 첨부 시 둘 다 업로드됨(고유 filename `${id}__${name}`)
  - [ ] Asana 캡처 이미지(styleElements) 파일명 rename·inline 매칭이 사용자 첨부로 깨지지 않음(회귀)
  - [ ] `pnpm typecheck`

### Task 10: i18n 키
- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**: 토글 라벨/help, 버튼, 리스트 빈 상태, 개수/한도 경고, "Attachments" 섹션 헤딩 키 ko/en 동시 추가.
- **검증**:
  - [ ] PostToolUse i18n 대칭 검사 통과(ko/en 키·placeholder 일치)

## 테스트 계획

- **단위 테스트**:
  - `attachmentLimits.test.ts`: `checkAttachmentLimits`(단건 한도/null 플랫폼), `takeWithinLimits`(개수·합계 50MB 경계, reason 구분)
  - `fileMeta.test.ts`: `fileCategory`(MIME/확장자/폴백), `fileExtLabel`(확장자 라벨/폴백) — `formatBytes`는 기존 테스트 커버, 재작성 안 함
  - `buildCaptureFiles.test.ts`: userAttachments 유무, filename 고유화/displayName, 빈 배열
  - blob-db 키 파생(`${owner}:${id}`) 순수 함수 단위 테스트(rekey/delete prefix 로직)
  - settings는 버전 bump 없으므로 마이그레이션 테스트 불필요(기본값 hydrate만)
- **e2e 시나리오** (`/e2e-write` 입력):
  - 설정에서 파일 첨부 토글을 켜면 drafting에 첨부 섹션이 나타난다(기본 상태에선 없다).
  - 파일 첨부 버튼으로 파일 2개를 고르면 리스트에 2개가 표시된다(`setInputFiles`).
  - 리스트에서 파일 1개를 삭제하면 1개만 남는다.
  - 파일을 더 고를수록 버튼 라벨 카운터가 증가하고, 상한(10/10)에서 첨부 버튼이 비활성화된다.
  - 첨부 후 사이드패널을 닫았다 열면 리스트(메타)가 유지된다.
  - 토글을 끄면 첨부 섹션이 사라진다.
  - **주의: setInputFiles는 이 repo e2e 첫 도입** — 숨김 `<input>`에 직접 set(fixture 신규). "사이드패널 재오픈 후 유지"는 **메타 리스트 표시까지만** 판정 가능(IndexedDB Blob 정합·"제출 시 실제 로드"는 수동 영역).
- **수동 테스트** (자동화 불가):
  - 6개 플랫폼 각각 실제 이슈 생성 → 첨부 파일 접근 가능 확인(네트워크·OAuth 의존). GitHub/GitLab 헤딩 중복 없음, Asana 캡처 rename 회귀 없음 동시 확인.
  - Notion 5MiB / GitLab 10MB 초과 파일 단건 한도 경고 시각 확인
  - 합계 50MB 근처 다중 첨부 시 제출 메모리/성공 동작
  - 토글 OFF 제출 → 재켜기 시 첨부 복원, 제출 완료/폐기 후 Blob 잔여 없음(orphan)

## 구현 순서 권장

- Task 1 → Task 6은 순수 함수/빌더라 선행·병렬 가능(테스트 우선).
- Task 2(blob-db) → Task 4(editor-store) → Task 5(issues-store)는 영속 의존 체인이라 순차.
- Task 7a(fileMeta 순수 함수)는 Task 7b 선행. Task 1과 병렬 가능.
- Task 3(settings) → Task 8(SettingsTab) 페어, Task 7b(UI)와 병렬 가능.
- Task 9(제출 합류)는 Task 2·4·6 완료 후. GitHub→GitLab은 `emitAttachments` 합류 동형(복제). **Linear(createAttachment)·Notion(file block)·Asana(native+회귀 분리)·Jira(rawAttachments)는 각각 다른 경로** — GitHub 복제 가정 금지.
- Task 10(i18n)은 UI 태스크와 함께 수시 갱신(훅 검사 때문에 ko/en 동시).

## 가이드 영향

사용자 노출 UX 추가 → `/guide`로 ko·en 동시 갱신. `guide/AUTHORING.md` 규칙 선행.
- `guide/ko/settings/*`·`guide/en/settings/*` — 본문 구성에 "파일 첨부" 토글(기본 OFF, 권장 안 함) 설명 추가
- `guide/ko/*`(이슈 작성 흐름 페이지)·`guide/en/*` — drafting에서 파일 첨부 버튼 사용법, 플랫폼별 노출(네이티브 첨부 vs 링크), 개수/용량 한도 안내
- 정확한 대상 페이지는 `guide/SUMMARY.md`·기존 settings/quick-start 구조 대조 후 확정

> 권한·매니페스트 변동은 없으나 **사용자 임의 파일을 외부 플랫폼에 전송**하는 새 동작이므로 `docs/privacy.md` 대조·시행일 갱신 필요(`/push` privacy 게이트 대상).
