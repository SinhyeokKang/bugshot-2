# 본문 구성 순서 변경 — 구현 태스크

## 선행 조건

- `@dnd-kit/core`, `@dnd-kit/sortable` 설치(필요 시 `@dnd-kit/modifiers`). `minimumReleaseAge` 정책상 최신 버전은 직전 버전으로 resolve될 수 있음(정상). postinstall 없어 `approve-builds` 불요.
- 착수 전 `docs/POSTMORTEM.md`를 `builder`·`POST_MEDIA`·`issueSections`·`i18n`·`draft`로 grep해 과거 함정 소환.

## 태스크

### Task 1: 스토어 순서 모델 + 마이그레이션 (테스트 우선)
- **변경 대상**: `src/store/settings-ui-store.ts`, `src/store/__tests__/settings-ui-store.test.ts`
- **작업 내용**:
  - `IssueSectionId`에 `"media"`, `IssueSectionRenderAs`에 `"meta"` 추가.
  - `DEFAULT_ISSUE_SECTIONS`에 미디어 엔트리를 재현과정/기대결과 사이에 삽입.
  - `POST_MEDIA_SECTION_IDS` **삭제**(이 파일에서 export 제거 — 소비처는 Task 4·5에서 정리).
  - `backfillMediaSection(sections)` 순수 헬퍼 추가(멱등, 레거시 앵커 위치 삽입).
  - `reorderIssueSections(from, to)` 액션 추가(`arrayMove`).
  - `setIssueEnabled`에 `id==="media"` 방어 가드.
  - persist `version` 9, `migrateSettingsUi`에서 `backfillMediaSection` 호출. rehydrate 정규화도 `backfillMediaSection` 경유.
- **검증**:
  - [ ] `backfillMediaSection`: 미디어 없는 기본 배열 → 재현과정 뒤·기대결과 앞 삽입. 이미 있으면 no-op(멱등). notes만 enabled면 notes 앞. post-media 섹션 전무면 말미.
  - [ ] `reorderIssueSections`: from/to 인덱스로 배열 재배열. 경계값(0, 마지막) 안전.
  - [ ] v8 저장 상태 로드 → 미디어 엔트리 1개 backfill, 나머지 순서·enabled 보존.
  - [ ] `setIssueEnabled("media", false)` no-op.

### Task 2: 순서 단일 함수 `bodyBlocks` (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/bodyBlocks.ts`(신규), `src/sidepanel/lib/__tests__/bodyBlocks.test.ts`(신규)
- **작업 내용**: `bodyBlocks(sections)` — enabled 필터 후 `id==="media"`→`{kind:"meta"}`, 그 외→`{kind:"section",section}` 매핑.
- **검증**:
  - [ ] 기본 배열 → `[section(description), section(steps), meta, section(expected)]`(notes disabled 제외).
  - [ ] 미디어를 맨 앞으로 옮긴 배열 → `meta`가 선두.
  - [ ] disabled 섹션 제외. 미디어는 항상 포함.

### Task 3: 클립보드/프리뷰 빌더 전환
- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`(`buildIssueMarkdown`, `buildIssueHtml`)
- **작업 내용**: `POST_MEDIA_SECTION_IDS` 앵커 분기 + 트레일링 `emitMedia()` 폴백 제거 → `bodyBlocks(ctx.sectionConfig)` 순회, `kind==="meta"`에서 `emitMedia()`. env·footer 위치 유지.
- **검증**:
  - [ ] 기본 순서 출력이 변경 전과 **바이트 동일**(`buildIssueMarkdown.test` 골든 유지).
  - [ ] 미디어를 앞으로 옮긴 순서에서 미디어 블록이 해당 위치에 emit.

### Task 4: 8플랫폼 제출 빌더 전환
- **변경 대상**: `buildMarkdownIssueBody.ts`(GitHub/GitLab), `buildIssueAdf.ts`(Jira), `buildNotionIssueBody.ts`, `buildAsanaIssueBody.ts`, `buildClickupIssueBody.ts`, `buildLinearIssueBody.ts`, `buildSlackBody.ts`
- **작업 내용**: 각 파일에서 Task 3과 동일 패턴 교체(`bodyBlocks` 순회, `meta`에서 미디어/diff/로그 렌더). `emitMedia` 내부 렌더 로직은 유지.
- **검증**(각 빌더별):
  - [ ] 기본 순서 출력 바이트 동일(`buildMarkdownIssueBody.test`, `buildIssueAdf.test`, `buildNotionIssueBody.test`, `buildAsanaIssueBody.test`, `buildClickupIssueBody.test`, `buildLinearIssueBody.test`, `buildGithubIssueBody.test`, `buildGitlabIssueBody.test`, `submitToAsana.test` 골든 유지·갱신).
  - [ ] 재정렬 순서에서 미디어 위치가 배열 위치를 따름(각 빌더 최소 1케이스 추가).

### Task 5: 프리뷰 · draft UI 전환
- **변경 대상**: `composePreviewLayout.ts`, `IssuePreviewView.tsx`, `PreviewPanel.tsx`, `DraftingPanel.tsx`, `DraftDetailDialog.tsx`
- **작업 내용**: `composePreviewLayout`를 `bodyBlocks` 위에서 재구현(`postMediaSectionIds` 인자 제거, 인자를 `sections`로). 소비 컴포넌트에서 `POST_MEDIA_SECTION_IDS` 전달 제거. DraftingPanel/DraftDetailDialog 렌더 루프를 `bodyBlocks`로 교체(`meta`→mediaBlock+logCardsBlock).
- **검증**:
  - [ ] `composePreviewLayout.test`(있으면 갱신, 없으면 추가): 기본 순서 = media→logCards가 기대결과 앞. 재정렬 순서 반영.
  - [ ] DraftingPanel 렌더: 미디어 카드 위치 변경 시 mediaBlock 위치 이동(가능하면 jsdom 렌더 테스트, 아니면 e2e).

### Task 6: 설정 UI — DnD + IA 재편
- **변경 대상**: `src/sidepanel/tabs/SettingsTab.tsx`, `src/i18n/namespaces/settings.ts`, `src/i18n/namespaces/issue.ts`
- **작업 내용**:
  - 본문 구성 Section을 `DndContext`+`SortableContext`로 감싸고 각 행 `useSortable`. 좌측 아이콘을 GripVertical 핸들로 대체(핸들에만 `listeners`). `onDragEnd`→`reorderIssueSections`.
  - 미디어 행: 스위치 없음, 핸들+라벨(`section.media`)+헬프.
  - `AttachmentToggleRow`를 본문 구성에서 제거.
  - "AI 설정" Section 제거.
  - "기타" Section 신설(최하단): `AutoReproPrefillToggleRow`→`AttachmentToggleRow`. autoRepro `disabled` 가드 유지.
  - i18n: `settings.otherSection`(ko/en) 추가, `settings.aiSection`(ko/en) 제거, 필요 시 `section.media` 라벨/`section.media.help` 갱신(ko/en).
  - 고아화된 `SECTION_ICONS` 제거.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] i18n 훅 `locales.test.ts` 자동 통과(ko/en 대칭).
  - [ ] 설정 화면: 본문 구성 5행(미디어 행 스위치 없음), 기타 섹션에 재현채우기→첨부, AI 설정 섹션 부재.

## 테스트 계획

- **단위 테스트**:
  - `backfillMediaSection`: 삽입 위치(기본/notes만/post-media 전무), 멱등.
  - `reorderIssueSections`: 인덱스 재배열, 경계.
  - `bodyBlocks`: enabled 필터, meta 매핑, 재정렬 반영.
  - 8빌더 골든: **기본 순서 = 변경 전 바이트 동일**(회귀 봉쇄) + 재정렬 케이스.
  - `composePreviewLayout`: 기본/재정렬.
- **e2e 시나리오**(`/e2e-write` 입력):
  - "설정 본문 구성에서 미디어 카드를 맨 위로 드래그하면 프리뷰에서 미디어가 발생 현상보다 위에 온다."
  - "본문 구성 순서를 바꾸고 사이드패널을 새로고침하면 순서가 유지된다."
  - "이슈 설정 탭에 'AI 설정' 섹션이 없고 '기타' 섹션에 재현 과정 채우기와 파일 첨부가 있다."
  - "미디어 카드에는 사용 여부 스위치가 없다."
- **수동 테스트**(Chrome, jsdom 불가 영역):
  - 실제 포인터 드래그 감/드롭 애니메이션.
  - element 캡처 모드에서 미디어 카드 위치에 diff 테이블이 오는지(captureVisibleTab 의존).
  - 실제 8개 플랫폼 제출 본문 육안 확인(최소 GitHub/Jira/Notion/Slack).

## 구현 순서 권장

1. **Task 1 → Task 2**(스토어·순수함수 기반, 선행).
2. **Task 3**(단일 빌더로 패턴 확립 + 골든 회귀 확인).
3. **Task 4**(Task 3 패턴을 7개로 복제 — 병렬 가능).
4. **Task 5**(프리뷰·draft — Task 2에 의존).
5. **Task 6**(설정 UI·i18n — Task 1의 `reorderIssueSections`에 의존).

Task 4의 7개 빌더는 상호 독립이라 병렬 작업 가능. Task 6은 Task 1 완료 후 언제든.

## 가이드 영향

**있음.** 사용자 노출 UX 변경(설정 IA 재편 + 본문 순서 제어). `/guide`가 `guide/AUTHORING.md` 기준으로 정확한 페이지 확정 후 ko·en 동시 갱신:
- 설정 → 이슈 설정 화면 설명(본문 구성 드래그 순서 변경, 미디어·로그 카드, "기타" 섹션 신설, "AI 설정" 섹션 통합). 관련 자산: `guide/ko/assets/settings-issue-*.jpg`, `settings-ai-*.jpg`(스크린샷 갱신 필요 가능).
- 정확한 파일은 `/guide`에서 SUMMARY·AUTHORING 대조로 확정.
