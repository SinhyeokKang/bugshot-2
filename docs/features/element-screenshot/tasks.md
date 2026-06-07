# 요소 캡처 (Element Screenshot) — 구현 태스크

## 선행 조건
- 권한·env·OAuth 변경 없음. manifest 무관.
- captureMode union에 **새 값 추가 안 함**(screenshot 재사용이 원칙).
- 기준 숙지: `startAreaCapture`/`onAreaCaptured`(picker-control.ts/editor-store.ts), `captureElementSnapshot`(capture.ts, 요소 크롭), `AnnotationOverlay`(DraftingPanel), `buildMetaComment`/env DOM 줄(buildIssueMarkdown.ts).
- 회귀 기준선: 기존 screenshot(area) 등록 이슈 본문/로그/IssueRecord 출력.

## 태스크

### Task 1: 진입·선택 액션 (editor-store)
- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**:
  - `startElementShot(target)`: `...initial`, `captureMode: "screenshot"`, `phase: "picking"`, `...preserveLogs`.
  - `onElementShot(selection, image, viewport)`: `screenshotRaw: image`, `screenshotViewport: viewport`, `screenshotCapturedAt`, `selection` 보관(요소 정보), `phase: "drafting"`. captureMode는 `"screenshot"` 유지.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 단위/상태: startElementShot 후 captureMode="screenshot" & phase="picking"; onElementShot 후 screenshotRaw 세팅 & phase="drafting".

### Task 2: 진입 함수 (picker-control)
- **변경 대상**: `src/sidepanel/picker-control.ts`
- **작업 내용**: `startElementShot(tabId)` — `startAreaCapture` 골격이되 `startElementShot` 액션 호출 + `picker.start`(요소 picker) 메시지(area select 아님).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: idle 진입 → 요소 picker(hover 하이라이트) 표시.

### Task 3: 선택 분기 + overlay 정리 (usePickerMessages)
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`
- **작업 내용**: `picker.selected` 핸들러를 captureMode로 분기 —
  - `"element"`: 기존 `onElementSelected`(styling) + tokens/beforeImage.
  - `"screenshot"`(요소 캡처): `captureElementSnapshot(tabId)` → `onElementShot(selection, image, viewport)` → **`clearPicker(tabId)`**(overlay destroy). tokens/before·after 수집 안 함.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 요소 캡처에서 요소 선택 → 바로 drafting + **페이지 overlay 사라짐**. 캡처 이미지에 overlay 미포함.
  - [ ] 수동(회귀): element 모드는 기존대로 styling 진입.

### Task 4: buildCtx selector 주입 (IssueCreateModal)
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`
- **작업 내용**: screenshot 분기 `buildCtx`에서 `selection`이 있으면 `selector: selection.selector`, `tagName: selection.tagName` 주입(area 캡처는 selection 없음 → `""`). 나머지 screenshot 그대로(`screenshotImage = screenshotAnnotated ?? screenshotRaw`라 annotation 자동).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 요소 캡처 이슈 본문에 selector 반영(아래 Task 5/6).

### Task 5: env DOM 줄 조건 완화 (buildIssueMarkdown + 6개 빌더)
- **변경 대상**: `buildIssueMarkdown.ts`(env md line 63 / html 159) + 6개 빌더(`buildGithubIssueBody`/`buildLinearIssueBody`/`buildGitlabIssueBody`/`buildAsanaIssueBody`/`buildNotionIssueBody`/`buildIssueAdf`)의 env DOM 줄.
- **작업 내용**: DOM 줄 조건을 `captureMode !== "screenshot" && ...` → **`ctx.selector`(truthy) 기준**으로 완화. 요소 캡처(selector 채움)는 표시, area/video/freeform(`selector: ""`)은 미표시.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 단위 테스트: selector 있는 screenshot ctx → env에 `- **DOM**: selector`; selector 빈 screenshot → 미표시(area 회귀).
  - [ ] `pnpm test` 통과

### Task 6: AI 메타 selector — 확인 (buildMetaComment)
- **변경 대상**: `buildIssueMarkdown.ts` `buildMetaComment`
- **작업 내용**: `captureMode !== "freeform"`이면 `meta.selector` 포함은 기존 그대로. 요소 캡처면 `ctx.selector` 채워져 자동 노출. **변경 없음(확인 태스크)**. (screenshot이라 `meta.classListBefore/cssChanges`는 빈 값 — 무해 확인.)
- **검증**:
  - [ ] 수동: 요소 캡처 이슈 메타 주석에 `"selector": "..."` 포함.

### Task 7: IssueRecord selector 저장/복원 (confirmDraft + DraftDetailDialog)
- **변경 대상**: `src/store/editor-store.ts`(confirmDraft screenshot 분기), `src/sidepanel/tabs/DraftDetailDialog.tsx`(buildCtxForSubmit screenshot 분기)
- **작업 내용**: 요소 캡처(screenshot + selection) 시 IssueRecord에 `selector`/`tagName` 저장(기존 optional 필드). DraftDetailDialog 재제출 시 ctx에 selector 복원 → 본문 DOM 줄·메타 일관. 스키마/버전/blob 키 변경 없음.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 요소 캡처 draft 저장 → 이슈 목록 재열람/재제출 시 DOM 줄·메타 유지.

### Task 8: idle UI 재구성 (IssueTab)
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`(EmptyState)
- **작업 내용**: 버튼 배치·라벨 재구성(prd UI) — `[요소 스타일 편집](col-span-2)` / `[요소 캡처][범위 캡처]` / `[화면 녹화][30초 리플레이]` + footer `[이슈 작성]`(유지). "요소 캡처" 신설(`startElementShot`).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 5개 진입 버튼 + footer가 올바른 모드로 진입.

### Task 9: i18n 라벨
- **변경 대상**: `src/i18n/namespaces/issue.ts`
- **작업 내용**: ko/en 동시(design Task 9 표):
  - `issue.mode.elementShot` 신규 — ko "요소 캡처" / en "Capture element"
  - `issue.mode.element` → ko "요소 스타일 편집" / en "Edit element styles"
  - `issue.mode.screenshot` → ko "범위 캡처" / en "Capture area"
  - `issue.mode.video` → ko "화면 녹화" / en "Record screen"
  - `issue.mode.replay`("30s replay")·`issue.startDraft`("Write issue") 유지.
- **검증**:
  - [ ] PostToolUse 훅(locales.test.ts) 통과

### Task 10: annotation — 확인
- **변경 대상**: 없음(확인)
- **작업 내용**: 요소 크롭이 `screenshotRaw`에 세팅되면 `DraftingPanel` `AnnotationOverlay` 자동 동작.
- **검증**:
  - [ ] 수동: 요소 캡처 → drafting에서 주석 추가/제거 → 제출 본문에 주석본(`screenshotAnnotated`) 반영.

## 테스트 계획
- **단위**: env DOM 줄 조건 완화(selector 유무별 표시/미표시, area 회귀). buildMetaComment selector 포함.
- **수동(Chrome)**:
  - [ ] idle "요소 캡처" → 요소 선택 → styling 없이 drafting + overlay 제거.
  - [ ] 본문이 screenshot 골격(미디어 섹션·로그) + env DOM 줄 + 메타 selector.
  - [ ] annotation 동작(주석본 제출 반영).
  - [ ] 범위 캡처(area)·element 스타일 모드·녹화·리플레이 회귀 없음.
  - [ ] idle 버튼 배치/라벨 재구성 확인.

## 구현 순서 권장
1. Task 1→2→3(진입·선택·overlay) — 핵심 플로우.
2. Task 4→5→6(selector 본문·메타) — 직렬화.
3. Task 7(IssueRecord selector) — draft 영속.
4. Task 8→9(idle UI·i18n).
5. Task 10(annotation 확인).
- 핵심 의존: Task 1 → 3/4; Task 4 → 5.

## 가이드 영향
사용자 노출 UX 변경(새 진입 모드 + idle 재구성). 구현 후 `/guide`로 대조(작성 기준 `guide/AUTHORING.md`):
- `guide/ko/`·`guide/en/`의 캡처 모드 안내 페이지: 모드 구조(엘리먼트/스크린샷[범위·요소]/녹화[수동·리플레이]) + "요소 캡처" 사용법 추가.
- [[multi-element-buffer]]의 no-diff 폐지 안내와 함께 "요소만 캡처하려면 요소 캡처 모드" 유도.
