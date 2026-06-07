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
- **작업 내용**: "다음" 버튼(line 436, `disabled={proceeding}`은 438)을 `disabled={proceeding || !hasChange}`(hasChange는 line 122). diff 없을 때 안내는 **disabled 버튼이라 툴팁이 안 뜨므로 상시 헬퍼 텍스트로**(PageFooter `flex flex-col gap-2`에 한 줄, screenshot 모드 권유 — element-screenshot 선행 과제와 짝). `handleNext`(124)에 `if (!hasChange) return` 방어.
  - **게이트 vs 직렬화 판정**: `hasChange`와 `buildStyleDiff().length`의 `>0` 경계는 검증 결과 일치(design 위험요소). 게이트 교체는 불필요 — `hasChange` 유지 + 동치를 단위 테스트로 고정.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 단위: `hasChange === (buildStyleDiff(...).length > 0)` 동치(대표 케이스 — inlineStyle/class/text 변경, shorthand collapse 포함).
  - [ ] 수동: 요소 선택만 하고 스타일 안 바꾸면 "다음" 비활성 + 상시 헬퍼 텍스트. screenshot 모드로 유도되는지.

### Task 0-2: isElementNoDiff 제거 (신규 경로)
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`(buildCtx/buildEditorCaptureFiles), `src/sidepanel/lib/buildCaptureFiles.ts`
- **작업 내용**: `isElementNoDiff` 강등 분기 삭제. element 모드는 항상 before/after 경로. (DraftDetailDialog의 레거시 분기는 Task 0-4에서 별도.)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 단일 diff 이슈가 styleChanges + before/after로 정상 등록(회귀).

### Task 0-3: media/diff-0 폴백 제거 (본문 빌더)
- **변경 대상**: `buildIssueMarkdown.ts`(emitMedia, buildIssueHtml), 6개 빌더(`buildGithubIssueBody`/`buildLinearIssueBody`/`buildGitlabIssueBody`/`buildAsanaIssueBody`/`buildNotionIssueBody`/`buildIssueAdf`)
- **작업 내용**: element 모드의 `diffs.length > 0 ? styleChanges : media` 폴백에서 else(media/screenshot) 가지 삭제(github 폴백 else line 112, notion `startsWith("screenshot")` line 195). element 모드는 항상 styleChanges. (screenshot/video/freeform media 경로는 유지.)
  - **주의(jira)**: `buildIssueAdf`의 styleChanges(line 102~113)는 텍스트 table만 만들고 **이미지를 본문에 안 넣는다**. before/after 이미지 인라인은 **`messages.ts` jira 제출 후처리**가 담당(Task 1-6b). buildIssueAdf 자체는 폴백 제거만.
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
- **변경 대상**: `src/store/editor-store.ts` (+ 제출 완료 구독 지점)
- **작업 내용**: `BufferedElement` 인터페이스, `EditorState.bufferedElements`, `initial: []`, `bufferCurrentElement(afterImage)`(같은 selector 갱신·before 유지), `preserveBuffer` 헬퍼 + `startPicking`에 적용, `onSubmitted`(line 618)에 `bufferedElements: []`.
- **제출 완료 페이지 복원**: `onSubmitted`는 `done`만 만들고 `restoreAll`을 안 부른다 → done 상태 패널/탭 닫기 시 누적 변경 잔여. store는 chrome API 직접 호출 회피이므로, **제출 완료를 구독하는 지점**(IssueTab phase subscribe 또는 제출 성공 콜백)에서 `clearPicker`(→`restoreAll`) 동반.
- **검증**:
  - [ ] `pnpm typecheck` 통과 / Task 1-2 테스트 통과
  - [ ] 수동: 제출 완료 직후(done) 패널/탭 닫아도 페이지 복원(잔여 0).

### Task 1-2: 버퍼 단위 테스트
- **변경 대상**: `src/store/__tests__/editor-store.test.ts`(없으면 신설)
- **작업 내용**: append / 같은 selector 갱신·before 유지 / startPicking 후 버퍼 보존 / onSubmitted 후 비움.
- **검증**:
  - [ ] `pnpm test` 통과

### Task 1-3: `mergeStyleElements` + `StyleElementContext` + MarkdownContext
- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`
- **작업 내용**: `StyleElementContext` + `MarkdownContext.styleElements?`. `mergeStyleElements(buffered, current)`(버퍼+현재 머지, selector dedup 현재 우선, diff 0 제외 안전장치). **파일명 인덱스 `i`는 dedup·머지가 끝난 최종 배열 인덱스**로 부여(`before-${i}`/`after-${i}`) — dedup으로 길이가 바뀌어도 styleElements[i]와 CaptureFiles의 before-${i}가 같은 i를 보도록 단일 출처(최종 배열)에서 결정. `current` 입력은 `{ selection, styleEdits, before, after }`이며 before/after는 store의 `beforeImage`/`afterImage`. `buildIssueMarkdown`/`buildIssueHtml`을 styleElements 반복으로(단일이면 기존 출력과 동일 와꾸 + `(selector)`).
- **검증**:
  - [ ] `pnpm typecheck` 통과 / Task 1-4 테스트 통과

### Task 1-4: 직렬화 단위 테스트
- **변경 대상**: `src/sidepanel/lib/__tests__/buildIssueMarkdown.test.ts`
- **작업 내용**: styleElements 2개 → `## Style Changes ({selector})` 2섹션·테이블·이미지 셀 출력 + env DOM 쉼표 나열; 단일 → 1섹션 `(selector)` 형식; `mergeStyleElements` dedup·diff 0 제외·파일명 인덱싱. **dedup으로 현재 element가 버퍼 항목을 덮은 뒤 `i`가 최종 배열 기준으로 재정렬되는 케이스**(길이 변화 후 styleElements[i] ↔ before-${i} 일치) 추가.
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
- **작업 내용**: element 분기 `buildCtx`에서 `mergeStyleElements(bufferedElements, { selection, styleEdits, before: beforeImage, after: afterImage })` → `ctx.styleElements`; 단일 필드는 첫 element로. `buildEditorCaptureFiles`는 **머지·dedup이 끝난 최종 `styleElements` 배열을 단일 출처로** before/after 이미지 배열을 만들어 buildCaptureFiles에 전달(styleElements[i] ↔ before-${i}.webp 인덱스 일치).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 복수 element 등록 시 본문 element별 섹션·이미지(각 섹션이 자기 before-${i}/after-${i})

### Task 1-7c: ctx.styleElements 경로 통일 — PreviewPanel + DraftDetailDialog (review 추가)
- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`(`buildMarkdownContext`), `src/sidepanel/tabs/PreviewPanel.tsx`(line 216), `src/sidepanel/tabs/DraftDetailDialog.tsx`(line 249 `buildCtxForSubmit`)
- **작업 내용**: 빌더가 `ctx.styleElements`를 반복하므로, ctx 생성 **공통 지점(`buildMarkdownContext`)이 항상 `styleElements`를 채운다**(단일 폴백 분기 없음). 단일 element도 1개짜리 `styleElements`(`before-0`/`after-0`)로 정규화.
  - PreviewPanel: `mergeStyleElements(bufferedElements, 현재)`로 버퍼 포함(마크다운 복사에 A·B 섹션).
  - DraftDetailDialog: 레거시 단일을 1개짜리 styleElements로(레거시 no-diff 분기는 별개 유지). buildCaptureFiles도 `before-0`/`after-0`로 생성.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: A·B 담고 PreviewPanel "마크다운 복사" → 복사 결과에 A·B 섹션 둘 다.
  - [ ] 수동: 레거시/단일 draft 재제출 → before-0/after-0 이미지 본문에 정상(깨짐 없음).

### Task 1-6b: jira(ADF) 이미지 인라인 후처리 복수 element (review 추가)
- **변경 대상**: `src/background/messages.ts`(jira 제출 후처리 line 612~625, `snapshotRow`/`snapshotCell`)
- **작업 내용**: 현재 후처리는 `uploadMap.get("before.webp")`/`"after.webp")` 단일 파일명 + `findIndex(n => n.type === "table")` 첫 table 1개에만 `snapshotRow` splice. 복수 대응 —
  - 파일명을 **`before-${i}.webp`/`after-${i}.webp`** element별 조회.
  - content의 **모든 styleChanges table을 순서대로 순회**, i번째 table에 i번째 element의 snapshotRow 주입(table 순서 = styleElements 인덱스 i). styleChanges table 식별 기준(heading 직후 table 등) 명확히.
  - 단일도 통일안에 따라 `before-0`이므로 `before-${i}` 순회로 일관(무인덱스 폴백 불요). screenshot/video 후처리는 기존 유지.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동(jira 실제 제출): 복수 element 이슈 본문에 element별 table + 각 table에 자기 before/after Snapshot 행 인라인(KAN 류 실제 확인).
  - [ ] 수동: 단일 element jira 제출 회귀(Snapshot 행 정상).

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
- **작업 내용**: `EditorSnapshot`·`snapshotFromState`에 `bufferedElements`. **하위호환**: hydrate는 부분 머지라 키 없는 구 스냅샷은 `initial`의 `[]`가 자동 유지(`snapshotFromState`가 명시적 undefined 쓸 때만 `?? []`). **lite 강등 얕은 스프레드 함정**: 현 lite(line 143)는 `{...snap}`이라 `bufferedElements` 배열 내부 base64가 안 비워진다 → `bufferedElements: snap.bufferedElements.map(e => ({ ...e, beforeImage: null, afterImage: null }))`로 **명시 변환**.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 버퍼 담긴 채 사이드패널 닫았다 열면 복원
  - [ ] 수동: 기존(필드 없는) 세션 스냅샷 복원 시 에러 없이 빈 버퍼로 시작
  - [ ] 수동: 버퍼+이미지로 storage quota 초과 → lite 재저장 성공(버퍼 이미지 제거됨, 텍스트 diff 유지)

---

## Phase 2 — content script 누적 프리뷰

### Task 2-1: 편집 element 레지스트리
- **변경 대상**: `src/content/picker.ts`
- **작업 내용**: `editedEls: Map<Element, OriginalState>`; `captureOriginal`(481)은 미존재 시만 원본 기록; **`restoreOriginal` 호출 제거**: `handleStart`(391)·`handleNavigate`(438)·`onClickCommit`(622)·Escape(656)·iframe(634) **+ `handleSelectByPath`(724, restore 733)**(DOM 트리 노드 클릭도 element 전환); diff 없는 element 전환 시 레지스트리 제거; `restoreAll()` 신설→`handleClear`(412); `handleResetEdits`(475)는 단일 원복+제거.
  - **전역 `original*` 캐시 의존 함수 전부**: `handleApplyStyles`(459)·**`handleApplyClasses`(450)**·**`handleApplyText`(511)** 모두 리셋/원본 기준으로 전역 `original*`(또는 `editableHandle`)를 쓴다 → element 전환 시 `captureOriginal`로 레지스트리에서 현재 element 원본을 전역 캐시에 채우는 지점을 셋 모두에 보장(재선택·navigate 왕복 후 class/text 리셋 어긋남 방지).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: A 수정 → 다시 선택 → B 수정 시 페이지에 A·B 동시 표시
  - [ ] 수동: 같은 element 재선택·DOM 네비게이션 왕복(navigate + DomTree 노드 클릭) 후 누적 변경 정상(원본 안 깨짐)
  - [ ] 수동: 재선택/navigate 왕복 후 **class 토글·text 편집 시 원본 기준 정상 리셋**(handleApplyClasses/handleApplyText 캐시 어긋남 없음)
  - [ ] 수동(회귀 핵심): 작성 취소·"이 요소 reset"·idle·탭 이동 시 페이지 전체 원복(잔여 오염 0)
  - [ ] 수동: 제출 완료(done) → 패널 닫기/탭 이동에서도 페이지 복원(Task 1-1 제출 완료 구독 복원)

---

### Task 3-1: i18n 라벨(필요 시)
- **변경 대상**: `src/i18n/namespaces/issue.ts`(또는 editor.ts)
- **작업 내용**: element 소제목 / "diff 없이 다음" 안내 키 추가 시 ko/en 동시.
- **검증**:
  - [ ] PostToolUse 훅(locales.test.ts) 통과

## 테스트 계획
- **단위 테스트**:
  - `bufferCurrentElement`: append, 같은 selector 갱신, before 유지, onSubmitted 비움.
  - `mergeStyleElements`: 머지, selector dedup, diff 0 제외, **파일명 인덱싱(dedup으로 길이 변한 뒤 최종 배열 i 기준 styleElements[i] ↔ before-${i} 일치)**.
  - `buildIssueMarkdown`/`buildCaptureFiles`: 복수 element 출력 + 단일(`before-0`) 회귀.
  - 게이트 동치: `hasChange === (buildStyleDiff(...).length > 0)`.
  - 6개 빌더: 복수 element 시 각 섹션이 자기 `before-${i}`/`after-${i}`(교차 매칭 방지) + 첨부 N쌍 중복 없음(github `mediaHandled`/`extras`).
- **수동 테스트(Chrome)**:
  - [ ] (no-diff 폐지) 요소 선택만·스타일 미변경 → "다음" 비활성 + screenshot 모드 안내.
  - [ ] A 색 변경 → 다시 선택 → B 여백 변경 → 다음 → 등록. 본문 A·B 섹션 각각 selector·diff·before/after.
  - [ ] A 변경 → **부모/자식 navigate** → B 변경 → 등록. navigate도 repick처럼 A가 버퍼에 담겨 A·B 섹션 출력.
  - [ ] **누적 프리뷰**: B 편집 화면에서 페이지에 A 변경 그대로 보임(A·B 동시).
  - [ ] 같은 element 두 번 다루면 본문 1회만(최종 상태).
  - [ ] 6개 플랫폼 각각 복수 element 제출 → 이미지·테이블 정상(특히 **jira: 각 styleChanges table에 자기 before/after Snapshot 행** 인라인 — messages.ts 후처리).
  - [ ] **PreviewPanel "마크다운 복사"**: A·B 담고 복사 → 복사 결과에 A·B 섹션 둘 다(현재 1개만 나오던 회귀 방지).
  - [ ] 단일 element diff 제출 → `## Style Changes (selector)` 새 형식 + env DOM 1개. 이미지(before-0/after-0) 정상.
  - [ ] **페이지 복원(회귀 핵심)**: 작성 취소/제출 완료(done에서 패널 닫기 포함)/idle/탭 이동 시 페이지 전체 원복(잔여 오염 0).
  - [ ] 버퍼 담긴 채 사이드패널 닫았다 열기 → 복원. quota 초과 시 lite 재저장(버퍼 이미지 제거).
  - [ ] draft 재편집(DraftDetailDialog) 단일 element 정상(before-0/after-0) + 레거시 no-diff draft 표시 회귀 없음.

## 구현 순서 권장
1. **Phase 0**(no-diff 폐지) 먼저 — element 모드를 diff 전용으로 단순화. Task 0-1→0-2→0-3, 0-4 확인.
2. **Phase 1**: Task 1-1→1-2(버퍼) → 1-3→1-4(머지·MarkdownContext)·1-5(파일명) 병렬 → 1-6(6개 빌더, 독립 병렬)·**1-6b(jira messages.ts 후처리)** → 1-7(buildCtx)·**1-7c(buildMarkdownContext 통일: PreviewPanel/DraftDetail)** → 1-7b(RepickButton push+위계)→1-8(영속화).
3. **Phase 2**: Task 2-1(누적 프리뷰) — Task 1-1·1-7b(repick push)와 짝. **회귀 위험 최고**라 취소/제출/탭이동 복원 집중 테스트.
4. **Task 3-1**(i18n): 구현 중 필요 시.
- 핵심 의존: Phase 0 → Phase 1(깔끔한 전제); Task 1-1 → 1-7/Phase 2; Task 1-3 → 1-6/1-6b/1-7/1-7c(styleElements 통일이 선행).

## 가이드 영향
사용자 노출 UX 변경 2건이 있어 구현 후 `/guide`로 대조(작성 기준 `guide/AUTHORING.md`):
- `guide/ko/element/styling.md`·`guide/en/element/styling.md`:
  - **no-diff 폐지**: "스타일을 변경해야 다음으로 진행되며, 단순 요소 캡처는 screenshot 모드를 쓰라"는 안내 추가.
  - **복수 element**: "다시 선택" 시 이전 요소 변경이 누적되어 한 이슈에 여러 요소가 담기고, 페이지에도 누적 반영된다는 설명 추가.
- 버퍼 관리 UI는 헤드리스(이번 스코프)라 목록/삭제 설명은 후속 UI 작업과 함께.
