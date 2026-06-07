# 복수 Element 스타일 변경 버퍼 — 구현 태스크

## 선행 조건
- 권한·env·OAuth·외부 API 변경 없음. manifest 무관.
- `buildStyleDiff`(StyleChangesTable.tsx), `captureElementSnapshot`(capture.ts), `EditorSnapshot`/`snapshotFromState`(useEditorSessionSync.ts), `hasChange`(StyleEditorPanel.tsx:122) 위치 숙지.
- 회귀 기준선: 단일 element diff 이슈를 6개 플랫폼에 등록한 현재 본문 출력(스냅샷 테스트로 고정 권장).

---

## Phase 0 — no-diff 폐지 (선행 정리)

> element 모드 = diff 전용. 이 Phase를 먼저 끝내면 element 모드가 "diff 있는 element + before/after 항상 존재"로 단순해져 이후 복수 element가 깔끔히 얹힌다.

### Task 0-1: diff 진입 게이트
- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`
- **작업 내용**: "다음" 버튼(line 436)을 `disabled={proceeding || !hasChange}`. diff 없을 때 안내(헬퍼 텍스트/툴팁 — screenshot 모드 권유). `handleNext`에 `if (!hasChange) return` 방어. (게이트 기준을 `buildStyleDiff` 결과와 일치시킬지 검토 — 위험요소 참조.)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 요소 선택만 하고 스타일 안 바꾸면 "다음" 비활성 + 안내. screenshot 모드로 유도되는지.

### Task 0-2: isElementNoDiff 제거 (신규 경로)
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`(buildCtx/buildEditorCaptureFiles), `src/sidepanel/lib/buildCaptureFiles.ts`
- **작업 내용**: `isElementNoDiff` 강등 분기 삭제. element 모드는 항상 before/after 경로. (DraftDetailDialog의 레거시 분기는 Task 0-4에서 별도.)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 단일 diff 이슈가 styleChanges + before/after로 정상 등록(회귀).

### Task 0-3: media/diff-0 폴백 제거 (본문 빌더)
- **변경 대상**: `buildIssueMarkdown.ts`(emitMedia, buildIssueHtml), 6개 빌더(`buildGithubIssueBody`/`buildLinearIssueBody`/`buildGitlabIssueBody`/`buildAsanaIssueBody`/`buildNotionIssueBody`/`buildIssueAdf`)
- **작업 내용**: element 모드의 `diffs.length > 0 ? styleChanges : media` 폴백에서 else(media/screenshot) 가지 삭제. element 모드는 항상 styleChanges. (screenshot/video/freeform media 경로는 유지.)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 단위 테스트(buildIssueMarkdown.test.ts 등) 단일 diff 출력 회귀 확인
  - [ ] `pnpm test` 통과

### Task 0-4: 레거시 no-diff draft 하위호환 확인
- **변경 대상**: `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**: `buildCtxForSubmit`의 `isElementNoDiff` 분기는 **유지**(레거시 폴백). 주석으로 "legacy no-diff draft fallback — 신규 경로는 diff 게이트로 미발생" 명시. 신규 변경 없음(확인 태스크).
- **검증**:
  - [ ] 수동: 폐지 이전 no-diff element draft가 있으면 DraftDetailDialog에서 기존처럼 screenshot으로 표시(회귀 없음).

---

## Phase 1 — 복수 element 데이터·직렬화

### Task 1-1: `BufferedElement` + 버퍼 상태/액션
- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**: `BufferedElement` 인터페이스, `EditorState.bufferedElements`, `initial: []`, `bufferCurrentElement(afterImage)`(같은 selector 갱신·before 유지), `preserveBuffer` 헬퍼 + `startPicking`에 적용, `onSubmitted`에 `bufferedElements: []`.
- **검증**:
  - [ ] `pnpm typecheck` 통과 / Task 1-2 테스트 통과

### Task 1-2: 버퍼 단위 테스트
- **변경 대상**: `src/store/__tests__/editor-store.test.ts`(없으면 신설)
- **작업 내용**: append / 같은 selector 갱신·before 유지 / startPicking 후 버퍼 보존 / onSubmitted 후 비움.
- **검증**:
  - [ ] `pnpm test` 통과

### Task 1-3: `mergeStyleElements` + `StyleElementContext` + MarkdownContext
- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`
- **작업 내용**: `StyleElementContext` + `MarkdownContext.styleElements?`. `mergeStyleElements(buffered, current)`(버퍼+현재 머지, selector dedup 현재 우선, diff 0 제외 안전장치, `before-${i}`/`after-${i}`). `buildIssueMarkdown`/`buildIssueHtml`을 styleElements 반복으로(단일이면 기존 출력 동일).
- **검증**:
  - [ ] `pnpm typecheck` 통과 / Task 1-4 테스트 통과

### Task 1-4: 직렬화 단위 테스트
- **변경 대상**: `src/sidepanel/lib/__tests__/buildIssueMarkdown.test.ts`
- **작업 내용**: styleElements 2개 → `## Style Changes ({selector})` 2섹션·테이블·이미지 셀 출력 + env DOM 쉼표 나열; 단일 → 1섹션 `(selector)` 형식; `mergeStyleElements` dedup·diff 0 제외·파일명 인덱싱.
- **검증**:
  - [ ] `pnpm test` 통과

### Task 1-5: buildCaptureFiles element별 파일
- **변경 대상**: `src/sidepanel/lib/buildCaptureFiles.ts`, `__tests__/buildCaptureFiles.test.ts`
- **작업 내용**: element별 이미지 배열 입력 → `before-${i}.webp`/`after-${i}.webp` 생성. 단위 테스트로 파일명·개수 고정.
- **검증**:
  - [ ] `pnpm test` 통과

### Task 1-6: 6개 빌더 element 반복
- **변경 대상**: 6개 본문 빌더(Task 0-3에서 폴백 제거된 상태)
- **작업 내용**: Style Changes 섹션을 `styleElements.map`으로 — 헤더 `## Style Changes ({selector})`, 자신의 diff 테이블. **이미지 매칭을 `startsWith` → `before-${i}` 정확 일치(인덱스 기반)로 교체**. attached/mediaHandled에 element별 N쌍 전부 등록. map 전 빈 배열 가드.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 빌더 단위 테스트에 복수 element 케이스 추가 — **각 element가 자기 `before-${i}`/`after-${i}`를 가리키는지**(이미지 교차 매칭 버그 방지) + 첨부 N쌍 중복 없이 등록
  - [ ] 단일 element 출력이 `## Style Changes (selector)` 새 형식으로 나오는지(기존 테스트 갱신)
  - [ ] 수동: 플랫폼별 실제 제출(특히 notion placeholder·asana inline 순서)

### Task 1-7: IssueCreateModal buildCtx/captureFiles 머지
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`
- **작업 내용**: element 분기 `buildCtx`에서 `mergeStyleElements(bufferedElements, 현재)` → `ctx.styleElements`; 단일 필드는 첫 element로. `buildEditorCaptureFiles`에서 styleElements의 before/after 배열 전달.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 복수 element 등록 시 본문 element별 섹션·이미지

### Task 1-7b: element 전환 진입점 — RepickButton + DomNavButton push + 시각 위계
- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`(RepickButton), `src/sidepanel/tabs/DomTreeDialog.tsx`(DomNavButton)
- **작업 내용**:
  - **공유 push**: 두 버튼 onClick async화 — diff 있으면(`hasChange`) `captureElementSnapshot(tabId)` → `bufferCurrentElement(after)` 후 `startPicker`/`navigatePicker`. diff 없으면 push 생략하고 전환만. 중복 클릭 방지 플래그. (push 로직 헬퍼로 공유.)
  - **시각 위계(RepickButton만)**: `variant="outline"` → `variant="default"`(shadcn primary, 까만 배경/흰 아이콘). 커스텀 색상 없이, `h-8 w-8` 유지.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: RepickButton 까만 배경/흰 아이콘 위계 상승, 라이트/다크 자연스러움
  - [ ] 수동: A 수정 → **repick** → B 선택 시 버퍼에 A 적재
  - [ ] 수동: A 수정 → **부모/자식 navigate** → 다른 element 선택 시 버퍼에 A 적재(repick과 동일). diff 없이 navigate 시엔 페이지 잔여 없음.

### Task 1-8: 세션 영속화에 버퍼 포함
- **변경 대상**: `src/sidepanel/hooks/useEditorSessionSync.ts`(+ EditorSnapshot in editor-store.ts)
- **작업 내용**: `EditorSnapshot`·`snapshotFromState`에 `bufferedElements`. **하위호환**: hydrate/초기화 시 `bufferedElements ?? []`(기존 스냅샷엔 필드 없음). lite 강등에 버퍼 이미지 제거 보강.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 버퍼 담긴 채 사이드패널 닫았다 열면 복원
  - [ ] 수동: 기존(필드 없는) 세션 스냅샷 복원 시 에러 없이 빈 버퍼로 시작

---

## Phase 2 — content script 누적 프리뷰

### Task 2-1: 편집 element 레지스트리
- **변경 대상**: `src/content/picker.ts`
- **작업 내용**: `editedEls: Map<Element, OriginalState>`; `captureOriginal`은 미존재 시만 원본 기록; `restoreOriginal` 호출 제거(handleStart/handleNavigate/onClickCommit/Escape/iframe); diff 없는 element 전환 시 레지스트리 제거; `restoreAll()` 신설→`handleClear`; `handleResetEdits`는 단일 원복+제거; `handleApplyStyles`는 레지스트리 원본 기준 리셋.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: A 수정 → 다시 선택 → B 수정 시 페이지에 A·B 동시 표시
  - [ ] 수동: 같은 element 재선택·DOM 네비게이션 왕복 후 누적 변경 정상(원본 안 깨짐)
  - [ ] 수동(회귀 핵심): 작성 취소·"이 요소 reset"·idle·탭 이동 시 페이지 전체 원복(잔여 오염 0)
  - [ ] 수동: 제출 완료 → done에서 reset→idle 시 페이지 복원. done 상태 패널 닫는 케이스 확인 후 필요 시 onSubmitted 복원 보강

---

### Task 3-1: i18n 라벨(필요 시)
- **변경 대상**: `src/i18n/namespaces/issue.ts`(또는 editor.ts)
- **작업 내용**: element 소제목 / "diff 없이 다음" 안내 키 추가 시 ko/en 동시.
- **검증**:
  - [ ] PostToolUse 훅(locales.test.ts) 통과

## 테스트 계획
- **단위 테스트**:
  - `bufferCurrentElement`: append, 같은 selector 갱신, before 유지, onSubmitted 비움.
  - `mergeStyleElements`: 머지, selector dedup, diff 0 제외, 파일명 인덱싱.
  - `buildIssueMarkdown`/`buildCaptureFiles`: 복수 element 출력 + 단일 회귀.
- **수동 테스트(Chrome)**:
  - [ ] (no-diff 폐지) 요소 선택만·스타일 미변경 → "다음" 비활성 + screenshot 모드 안내.
  - [ ] A 색 변경 → 다시 선택 → B 여백 변경 → 다음 → 등록. 본문 A·B 섹션 각각 selector·diff·before/after.
  - [ ] A 변경 → **부모/자식 navigate** → B 변경 → 등록. navigate도 repick처럼 A가 버퍼에 담겨 A·B 섹션 출력.
  - [ ] **누적 프리뷰**: B 편집 화면에서 페이지에 A 변경 그대로 보임(A·B 동시).
  - [ ] 같은 element 두 번 다루면 본문 1회만(최종 상태).
  - [ ] 6개 플랫폼 각각 복수 element 제출 → 이미지·테이블 정상.
  - [ ] 단일 element diff 제출 → `## Style Changes (selector)` 새 형식 + env DOM 1개. 이미지 정상.
  - [ ] **페이지 복원(회귀 핵심)**: 작성 취소/제출 완료 후 idle/탭 이동 시 페이지 전체 원복(잔여 오염 0).
  - [ ] 버퍼 담긴 채 사이드패널 닫았다 열기 → 복원.
  - [ ] draft 재편집(DraftDetailDialog) 단일 element 정상 + 레거시 no-diff draft 표시 회귀 없음.

## 구현 순서 권장
1. **Phase 0**(no-diff 폐지) 먼저 — element 모드를 diff 전용으로 단순화. Task 0-1→0-2→0-3, 0-4 확인.
2. **Phase 1**: Task 1-1→1-2(버퍼) → 1-3→1-4(머지·MarkdownContext)·1-5(파일명) 병렬 → 1-6(6개 빌더, 독립 병렬) → 1-7(buildCtx)→1-7b(RepickButton push+위계)→1-8(영속화).
3. **Phase 2**: Task 2-1(누적 프리뷰) — Task 1-1·1-7b(repick push)와 짝. **회귀 위험 최고**라 취소/제출/탭이동 복원 집중 테스트.
4. **Task 3-1**(i18n): 구현 중 필요 시.
- 핵심 의존: Phase 0 → Phase 1(깔끔한 전제); Task 1-1 → 1-7/Phase 2; Task 1-3 → 1-6/1-7.

## 가이드 영향
사용자 노출 UX 변경 2건이 있어 구현 후 `/guide`로 대조(작성 기준 `guide/AUTHORING.md`):
- `guide/ko/element/styling.md`·`guide/en/element/styling.md`:
  - **no-diff 폐지**: "스타일을 변경해야 다음으로 진행되며, 단순 요소 캡처는 screenshot 모드를 쓰라"는 안내 추가.
  - **복수 element**: "다시 선택" 시 이전 요소 변경이 누적되어 한 이슈에 여러 요소가 담기고, 페이지에도 누적 반영된다는 설명 추가.
- 버퍼 관리 UI는 헤드리스(이번 스코프)라 목록/삭제 설명은 후속 UI 작업과 함께.
