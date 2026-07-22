# 본문 구성 순서 변경 — 구현 태스크

## 선행 조건

- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/modifiers` 설치. postinstall 없어 `approve-builds` 불요. `arrayMove`는 스토어에 인라인(dnd-kit는 UI에서만 import).
- 착수 전 `docs/POSTMORTEM.md`를 `builder`·`POST_MEDIA`·`issueSections`·`i18n`·`draft`·`drag`·`e2e`로 grep해 과거 함정 소환.

## 태스크

### Task 0: 현행 출력 골든 박제 (⚠️ 리팩터보다 먼저 — 회귀 봉쇄 전제)
- **변경 대상**: `src/sidepanel/lib/__tests__/bodyOutputGolden.test.ts`(신규) 또는 기존 빌더 테스트에 스냅샷 추가
- **작업 내용**: **현행 코드 상태**에서, 마이그레이션 후 기본 순서를 대표하는 ctx(각 캡처 모드: element/screenshot/video/freeform + 로그 유/무)로 8빌더 + `buildIssueMarkdown`/`buildIssueHtml` + `composePreviewLayout` 출력을 인라인 골든/스냅샷으로 고정. 이 골든이 이후 리팩터의 "바이트 동일" 기준.
- **검증**:
  - [x] Task 3~5 리팩터 후에도 이 골든이 **무수정으로 통과**(기본 순서 출력 불변 증명).
  - [x] 골든이 element/screenshot/video/freeform + 로그 유무를 커버.

### Task 1: 스토어 순서 모델 + 정규화 + 복원 (테스트 우선)
- **변경 대상**: `src/store/settings-ui-store.ts`, `src/store/__tests__/settings-ui-store.test.ts`
- **작업 내용**:
  - `IssueSectionId`에 `"media"`, `IssueSectionRenderAs`에 `"meta"`.
  - `DEFAULT_ISSUE_SECTIONS`에 미디어 엔트리(재현과정/기대결과 사이).
  - `POST_MEDIA_SECTION_IDS` **삭제**.
  - `normalizeSections(sections)` 순수 헬퍼(미디어 정확히 1개: backfill + dedupe + `enabled:true` 강제, 멱등, 레거시 앵커).
  - `reorderIssueSections(from,to)` — `arrayMove` **스토어 인라인 구현**.
  - `setIssueEnabled`에 `id==="media"` 방어 가드.
  - persist `version` 9, `migrateSettingsUi`·rehydrate에서 `normalizeSections`.
- **검증**:
  - [x] `normalizeSections`: 미디어 없음→레거시 앵커 삽입 / 이미 1개→위치 보존 / 2개↑→dedupe / `enabled:false` media→`true` 강제 / notes만 enabled→notes 앞 / post-media 전무→말미. 멱등.
  - [x] `reorderIssueSections`: 경계값(0, 마지막) 안전.
  - [x] v8 저장 상태 로드→미디어 1개, 나머지 순서·enabled 보존.
  - [x] `setIssueEnabled("media", false)` no-op.

### Task 2: 순서 단일 함수 `bodyBlocks` (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/bodyBlocks.ts`(신규), `__tests__/bodyBlocks.test.ts`(신규)
- **작업 내용**: `filter(id==="media" || enabled)` 후 media→`meta`, 그 외→`section` 매핑.
- **검증**:
  - [x] 기본 배열→`[section(desc), section(steps), meta, section(expected)]`.
  - [x] media 선두 이동→`meta` 선두.
  - [x] disabled 섹션 제외. `enabled:false`로 오염된 media도 포함(오염 방어).

### Task 3: 클립보드/프리뷰 빌더 전환 (패턴 확립)
- **변경 대상**: `buildIssueMarkdown.ts`(`buildIssueMarkdown`,`buildIssueHtml`) + `__tests__/buildIssueMarkdown.test.ts`
- **작업 내용**: 앵커 분기 + 트레일링 `emitMedia()` 폴백 제거 → `bodyBlocks` 순회. env·footer 유지. 픽스처 `sectionConfig`에 media 엔트리 추가, `vi.mock(POST_MEDIA)` dead mock 제거.
- **검증**:
  - [x] Task 0 골든 무수정 통과(기본 순서 바이트 동일).
  - [x] media를 앞으로 옮긴 순서에서 미디어 블록이 해당 위치에 emit.

### Task 4: 7개 제출 빌더 전환 (Task 3 패턴 복제 — 병렬 가능)
- **변경 대상**: `buildMarkdownIssueBody.ts`, `buildIssueAdf.ts`, `buildNotionIssueBody.ts`, `buildAsanaIssueBody.ts`, `buildClickupIssueBody.ts`, `buildLinearIssueBody.ts`, `buildSlackBody.ts` + 각 테스트
- **작업 내용**: Task 3과 동일 패턴. **모든 픽스처(12+ 파일)에 media 엔트리 추가 + dead mock 제거**.
- **검증**(각 빌더):
  - [x] Task 0 골든 무수정 통과.
  - [x] 테스트 갱신 대상 누락 없음: `buildMarkdownIssueBody.test`, `buildIssueAdf.test`, `buildNotionIssueBody.test`, `buildAsanaIssueBody.test`, `buildClickupIssueBody.test`, `buildLinearIssueBody.test`, **`buildSlackBody.test`**, `buildGithubIssueBody.test`, `buildGitlabIssueBody.test`, `submitToAsana.test`, **`buildMarkdownContext.test`**, **`buildReportData.test`**.
  - [x] 재정렬 순서에서 미디어 위치가 배열 위치를 따름(빌더별 최소 1케이스).

### Task 5: 간접 소비처 격리 + 프리뷰·draft UI 전환
- **변경 대상**: `AiDraftDialog.tsx`, `buildReportData.ts`, `composePreviewLayout.ts`, `IssuePreviewView.tsx`, `PreviewPanel.tsx`, `DraftingPanel.tsx`, `DraftDetailDialog.tsx`
- **작업 내용**:
  - **`AiDraftDialog.tsx`**: 섹션 id 추출에 `filter(s => s.enabled && s.renderAs !== "meta")` — AI 프롬프트에 media 유입 차단.
  - **`buildReportData.ts`**: `sectionConfig` 순회에서 media 사전 필터(`renderAs !== "meta"`) — Report 섹션·renderAs 유니온 오염 차단.
  - **`composePreviewLayout.ts`**: `postMediaSectionIds` 인자 제거, 인자 `sectionIds:string[]` **유지**(IssueSection[] 아님), `id==="media"`에서 media+logCards push.
  - **`IssuePreviewView.tsx`/`PreviewPanel.tsx`**: `postMediaSectionIds` 전달 제거. PreviewPanel은 media를 표시 섹션 목록에서 제외하되 순서용 `sectionIds`(media id 포함)는 레이아웃에 전달.
  - **`DraftingPanel.tsx`/`DraftDetailDialog.tsx`**: 렌더 루프를 `bodyBlocks`로(`meta`→mediaBlock+logCardsBlock).
- **검증**:
  - [x] AI 초안: media 섹션이 프롬프트 스키마·응답 병합에 없음(단위/jsdom).
  - [x] `buildReportData`: media 미포함, `pnpm typecheck` 통과.
  - [x] `composePreviewLayout.test`(이미 존재 — 갱신): 기본 순서 media→logCards가 기대결과 앞, 재정렬 반영.
  - [ ] `DraftDetailDialog`: 재정렬 반영 + 기존 편집 동작(`draft-field-edit.spec`) 회귀 없음.

### Task 6: 설정 UI — DnD + IA 재편 + 복원 버튼
- **변경 대상**: `SettingsTab.tsx`, `src/i18n/namespaces/settings.ts`
- **작업 내용**:
  - 본문 구성 Section을 `DndContext`+`SortableContext`+`restrictToVerticalAxis`로. 각 행 `useSortable`. `onDragEnd`→`reorderIssueSections`.
  - 좌측 아이콘→GripVertical **버튼**(`h-8 w-8`, `aria-label`, `focus-visible:ring`, `listeners`는 핸들에만). 행 구분선 `Separator`→wrapper `border-t`.
  - 미디어 행: 스위치 없음, 라벨 `settings.section.media`, **필수 헬프** `settings.section.media.help`, 스위치 자리 스페이서.
  - `DndContext`에 로컬라이즈 `accessibility.announcements`/`screenReaderInstructions`(ko/en).
  - **복원 버튼**: `<Section action={<ResetOrderButton/>}>` — `RotateCcw`, 기본값 동형이면 `disabled`, 클릭 `resetIssueSections()`.
  - `AttachmentToggleRow` 본문 구성에서 제거. "AI 설정" Section 제거.
  - "기타" Section 신설(최하단): `AutoReproPrefillToggleRow`→`AttachmentToggleRow`. autoRepro disabled 가드 유지.
  - i18n: `settings.otherSection`·`settings.section.media`·`.help`·복원/핸들 aria-label·dnd 안내(ko/en) 추가. `settings.aiSection` 제거. ⚠️ `section.media` 키는 **불변**(draft 패널 공유).
  - 고아 `SECTION_ICONS` 제거.
- **검증**:
  - [x] `pnpm typecheck`, i18n 훅 `locales.test`(ko/en 대칭) 통과.
  - [x] 본문 구성 5행(미디어 행 스위치 없음, 헬프 있음), 기타에 재현채우기→첨부, AI 설정 부재.
  - [x] 복원 버튼 기본값 disabled ↔ 변경 시 active ↔ 클릭 시 기본 복원.

## 테스트 계획

- **단위**:
  - `normalizeSections`(삽입/dedupe/enabled강제/멱등), `reorderIssueSections`(경계), `bodyBlocks`(필터·meta매핑·오염방어).
  - **Task 0 골든**: 8빌더 기본 순서 = 변경 전 바이트 동일(회귀 봉쇄).
  - 재정렬 케이스(빌더별), `composePreviewLayout` 기본/재정렬.
  - AiDraftDialog·buildReportData media 격리.
- **e2e**(`/e2e-write` 입력 — **키보드 재정렬로 판정**, 설정 오염 `finally` 복원):
  - "본문 구성 미디어 카드 핸들에 포커스 후 Space→ArrowUp→Space로 위로 옮기면 프리뷰에서 미디어가 발생 현상보다 위에 온다."
  - "순서를 바꾸고 사이드패널을 새로고침하면 순서가 유지된다."
  - "이슈 설정 탭에 'AI 설정' 섹션이 없고 '기타' 섹션에 재현 과정 채우기와 파일 첨부가 있다."
  - "미디어 카드에는 사용 여부 스위치가 없다."
  - "순서를 바꾸면 복원 버튼이 활성화되고, 누르면 기본 순서로 돌아간다."
  - testid 부착 지점: 본문 구성 행 핸들, 미디어 행, 복원 버튼, 프리뷰 미디어 블록(현재 `download-media` 버튼만 있음).
- **수동**(jsdom 불가):
  - 실제 포인터 드래그 감/드롭 애니메이션·drag elevation.
  - element 모드에서 미디어 카드 위치에 diff 테이블(captureVisibleTab 의존).
  - 실제 8개 플랫폼 제출 본문 육안(최소 GitHub/Jira/Notion/Slack).

### Task 7: 문서 갱신
- **변경 대상**: `docs/DIRECTORY.md`(`bodyBlocks.ts` 신규 등재), `docs/ARCHITECTURE.md`(이슈 섹션 구성 "자동 메타 위치" 문단 — `POST_MEDIA_SECTION_IDS` 앵커 → `bodyBlocks`/media 엔트리 서술로 갱신)
- **검증**:
  - [x] `/push` 신선도 검사 통과(diff에 걸린 문서 커버).

## 구현 순서 권장

1. **Task 0**(현행 골든 박제 — 최우선).
2. **Task 1 → Task 2**(스토어·순수함수).
3. **Task 3**(단일 빌더로 패턴 확립 + 골든 회귀 확인).
4. **Task 4**(7개 병렬).
5. **Task 5**(간접 격리 + 프리뷰·draft — Task 2 의존).
6. **Task 6**(설정 UI — Task 1 의존).
7. **Task 7**(문서 — 코드 확정 후).

Task 4의 7개 빌더는 상호 독립이라 병렬 가능. Task 6은 Task 1 완료 후 언제든.

## 가이드 영향

**있음.** 사용자 노출 UX 변경(설정 IA 재편 + 본문 순서 제어 + 복원 버튼). `/guide`가 `guide/AUTHORING.md` 기준으로 정확한 페이지 확정 후 ko·en 동시 갱신:
- 설정 → 이슈 설정 화면 설명(본문 구성 드래그/키보드 순서 변경, 미디어·로그 카드, "기타" 섹션 신설, "AI 설정" 통합, 복원 버튼). 관련 자산: `guide/ko/assets/settings-issue-*.jpg`, `settings-ai-*.jpg`(스크린샷 갱신 필요 가능).
- 정확한 파일은 `/guide`에서 SUMMARY·AUTHORING 대조로 확정.
