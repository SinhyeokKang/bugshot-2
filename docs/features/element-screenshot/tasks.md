# 요소 캡처 (Element Screenshot) — 구현 태스크

## 선행 조건
- 권한·env·OAuth 변경 없음. manifest 무관.
- captureMode union에 **새 값 추가 안 함**(screenshot 재사용이 원칙). 정의 2곳(`editor-store.ts:14`, `buildCaptureFiles.ts:11`) 모두 무변경 확인.
- selector 보관은 **경량 `shotSelector` 필드**(`{ selector, tagName } | null`). `selection`(EditorSelection)은 재사용하지 않음(스타일 메타 부담·구독 부작용 회피).
- 기준 숙지: `startAreaCapture`/`onAreaCaptured`(picker-control.ts/editor-store.ts), `captureElementSnapshot`(capture.ts:7 — 시그니처 `(tabId, options?) => Promise<string | null>`, 크롭 dataUrl만 반환·viewport 없음·null 가능), `AnnotationOverlay`(DraftingPanel:362), `buildMetaComment`/env DOM 줄(buildIssueMarkdown.ts).
- 회귀 기준선: 기존 screenshot(area) 등록 이슈 본문/로그/IssueRecord 출력. element 스타일 모드 DOM 줄 출력(Group B 표시 변화 주의).

## 태스크

### Task 1: shotSelector 필드 + 진입·선택 액션 (editor-store)
- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**:
  - `shotSelector: { selector: string; tagName: string } | null` 필드 신설(`initial`에서 null).
  - `startElementShot(target)`: `...initial`, `captureMode: "screenshot"`, `phase: "picking"`, `...preserveLogs`, `shotSelector: null`.
  - `onElementShot(shot, image, viewport)`: `screenshotRaw: image`, `screenshotViewport: viewport`, `screenshotCapturedAt`, `shotSelector: shot`, `phase: "drafting"`. captureMode `"screenshot"` 유지, **`selection`은 null 유지**.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 단위/상태: startElementShot 후 captureMode="screenshot" & phase="picking" & shotSelector=null; onElementShot 후 screenshotRaw 세팅 & shotSelector 보관 & phase="drafting" & **selection은 여전히 null**.

### Task 2: 진입 함수 (picker-control)
- **변경 대상**: `src/sidepanel/picker-control.ts`
- **작업 내용**: `startElementShot(tabId)` — `startAreaCapture` 골격이되 `startElementShot` 액션 호출 + `picker.start`(요소 picker) 메시지(area select 아님).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: idle 진입 → 요소 picker(hover 하이라이트) 표시.

### Task 3: 선택 분기 + 캡처 null 가드 + overlay 정리 (usePickerMessages)
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`
- **작업 내용**: `picker.selected` 핸들러(`:55-82`, 현재 무조건 element 경로)를 captureMode로 분기 —
  - `"element"`: 기존 `onElementSelected`(styling) + `collectTokens` + `setBeforeImage`(변경 없이 보존).
  - `"screenshot"`(요소 캡처):
    1. `captureElementSnapshot(tabId)` → 크롭 dataUrl. **null이면 idle 복귀 + 에러 안내**(drafting 진입·빈 이미지 금지).
    2. viewport는 `picker.selected` payload(`msg.payload.viewport`)에서 취득.
    3. `onElementShot({selector, tagName}, image, viewport)` → drafting.
    4. **`clearPicker(tabId)`**(overlay destroy).
    - **`collectTokens`·`setBeforeImage`는 호출 안 함**.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 요소 캡처에서 요소 선택 → 바로 drafting + **페이지 overlay 사라짐**. 캡처 이미지에 overlay 미포함.
  - [ ] 수동: 캡처 null(권한 만료 유도) 시 idle 복귀 + 에러 안내, 빈 drafting 진입 없음.
  - [ ] 수동(회귀): element 모드는 기존대로 styling 진입 + tokens/beforeImage 수집. screenshot 분기에서 collectTokens/before-image **미호출** 확인.

### Task 4: buildCtx selector 주입 (IssueCreateModal)
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`
- **작업 내용**: screenshot 분기 `buildCtx`(`:208-209` `selector:""`/`tagName:""`)에서 `shotSelector`가 있으면 `selector: shotSelector.selector`, `tagName: shotSelector.tagName` 주입(area는 shotSelector null → `""`). 나머지 screenshot 그대로(`screenshotImage = screenshotAnnotated ?? screenshotRaw`라 annotation 자동).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 요소 캡처 이슈 본문에 selector 반영(Task 5).

### Task 5: env DOM 줄 — Group A 완화 / Group B 전환 (6개 빌더 + 메타)
- **변경 대상**:
  - **Group A** (조건만 완화, `ctx.selector` truthy): `buildIssueMarkdown.ts`(md `:63` / html `:159`), `buildGithubIssueBody.ts:68`, `buildGitlabIssueBody.ts:68`, `buildAsanaIssueBody.ts:51-56`.
  - **Group B** (selector 기반 전환): `buildLinearIssueBody.ts:69-72`, `buildNotionIssueBody.ts:99-105`, `buildIssueAdf.ts:67-82`.
- **작업 내용**:
  - Group A: DOM 줄 조건을 `captureMode !== "screenshot" && ...` → **`ctx.selector`(truthy) 기준**으로 완화. 출력값 raw `ctx.selector` 유지.
  - Group B: ① screenshot 게이트(`!isScreenshot` / Adf if-else) 풀고 ② DOM 줄 소스를 `domLabel = formatElementName(...)` → **`ctx.selector`**로 전환(`ctx.selector` truthy 시 표시). 6개 + 메타가 동일 selector 문자열로 일관.
  - 메타(`buildMetaComment` `:264-265`)는 `meta.selector = ctx.selector`로 이미 일관 — 변경 없음.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] **단위 테스트(6개 빌더 각각 + md/html)**: ① screenshot+selector → env에 `- **DOM**: selector` 표시, ② screenshot+selector 빈값(area) → 미표시(회귀), ③ Group B element 모드 → selector 표시(`formatElementName` 아님)로 변경 확인. 기존 빌더 테스트(`buildLinearIssueBody.test.ts` 등)에 screenshot+selector 케이스 추가.
  - [ ] 본문 selector == 메타 selector 동일 문자열 검증.
  - [ ] `pnpm test` 통과

### Task 5b: drafting 미리보기 env selector (DraftingPanel)
- **변경 대상**: `src/sidepanel/components/DraftingPanel.tsx:407`
- **작업 내용**: `deriveReadonlyEnvRows`의 selector 소스를 `captureMode === "element" ? selection?.selector : (shotSelector?.selector ?? null)`로 보정. 요소 캡처(shotSelector) → 미리보기 env DOM 줄 표시, area(shotSelector null) → 미표시.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 요소 캡처 drafting 미리보기 Environment에 DOM 줄 표시. area는 미표시(회귀).

### Task 5c: 마크다운 복사 경로 selector (buildMarkdownContext + PreviewPanel)
- **변경 대상**: `src/sidepanel/lib/buildMarkdownContext.ts:77-91`(screenshot 분기 `selector:""`), `src/sidepanel/tabs/PreviewPanel.tsx:237-249`
- **작업 내용**: `buildMarkdownContext` screenshot 분기에 optional `selector`/`tagName` 주입 경로 추가 + `PreviewPanel`이 `shotSelector` 전달. "마크다운 복사" 결과물에 DOM 줄·메타 selector 포함.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 단위/수동: PreviewPanel 마크다운 복사 결과에 DOM 줄 + 메타 selector. area는 미포함.

### Task 5d: 로그 뷰어 Report 탭 selector (buildReportData)
- **변경 대상**: `src/sidepanel/lib/buildReportData.ts:19-24`
- **작업 내용**: DOM row 조건을 Group A와 동일하게 `ctx.selector`(truthy) 기준으로 완화.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 단위/수동: 요소 캡처 이슈를 로그 뷰어 Report 탭에서 볼 때 DOM 줄 표시.

### Task 5e: AI 초안 입력 selector (AiDraftDialog)
- **변경 대상**: `src/sidepanel/components/AiDraftDialog.tsx:81-82`
- **작업 내용**: `isElement` 가드를 요소 캡처도 포함하도록 완화(`isElement || shotSelector`) → `shotSelector`의 selector/tagName을 AI 컨텍스트에 주입. 본문·메타·AI 초안 selector 일관.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 요소 캡처에서 AI 초안 생성 시 selector가 입력 컨텍스트에 포함.

### Task 6: AI 메타 selector — 확인 (buildMetaComment)
- **변경 대상**: 없음(확인). `buildIssueMarkdown.ts:264-265` `meta.selector = ctx.selector`(`captureMode !== "freeform"`)는 기존 그대로. 요소 캡처면 자동 노출.
- **검증**:
  - [ ] 수동: 요소 캡처 이슈 메타 주석에 `"selector": "..."` 포함.

### Task 7: IssueRecord selector 저장 (confirmDraft)
- **변경 대상**: `src/store/editor-store.ts`(confirmDraft screenshot 분기 `:492~`)
- **작업 내용**: 요소 캡처(screenshot + `shotSelector` 존재) 시 IssueRecord에 `selector`/`tagName` 저장(기존 optional 필드 `:148-149`). area는 `shotSelector` null → 미저장.
- **DraftDetailDialog는 변경 거의 불필요**: `buildCtxForSubmit`(`DraftDetailDialog.tsx:272`)이 이미 `issue.selector ?? ""`로 ctx 복원 → 저장만 하면 재제출 본문/메타 일관 자동(단, 본문 DOM 줄 출력은 Task 5 빌더 완화에 의존). DraftDetail 수정이 정말 불필요한지 확인만.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 단위: confirmDraft screenshot+shotSelector → IssueRecord.selector 저장; area(shotSelector null) → 미저장(회귀).
  - [ ] 수동: 요소 캡처 draft 저장 → 이슈 목록 재열람/재제출 시 DOM 줄·메타 유지.

### Task 8: idle UI 재구성 (IssueTab)
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`(EmptyState `:170~223`)
- **작업 내용**: 버튼 배치·라벨 재구성 — `[요소 스타일 편집](col-span-2)` / `[요소 캡처][범위 캡처]` / `[화면 녹화][30초 리플레이]` + footer `[가이드][이슈 작성]`. "요소 캡처" 신설(`startElementShot`).
  - **footer 가이드 버튼(`settings.guide`, BookOpen) 유지** — 삭제 금지.
  - 리플레이를 2x2 짝으로(`:263/268`의 단독 셀/`col-span-2` 처리 제거).
  - 신설 "요소 캡처"는 **단축키 무툴팁**(capture 단축키 상한 도달, 재배치 보류). 기존 capture-element/screenshot/video 툴팁 매핑 그대로.
  - 아이콘: 요소 캡처(Crosshair/SquareDashedMousePointer 계열) vs 범위 캡처(점선 사각형) 시각 차별화.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 5개 진입 버튼 + footer 2버튼(가이드·이슈 작성)이 올바른 동작으로 진입. 가이드 버튼 잔존. 각 버튼 라벨 = design Task 9 표.

### Task 9: i18n 라벨
- **변경 대상**: `src/i18n/namespaces/issue.ts`
- **작업 내용**: ko/en 동시:
  - `issue.mode.elementShot` 신규 — ko "요소 캡처" / en "Capture element"
  - `issue.mode.element` → ko "요소 스타일 편집" / en "Edit element styles"
  - `issue.mode.screenshot` → ko "범위 캡처" / en "Capture area"
  - `issue.mode.video` → ko "화면 녹화" / en "Record screen"
  - `issue.mode.replay`·`issue.startDraft` 유지.
- **검증**:
  - [ ] PostToolUse 훅(locales.test.ts) 통과
  - [ ] 수동: 각 버튼 라벨 텍스트가 표와 일치(자동 검증 밖).

### Task 10: annotation — 확인
- **변경 대상**: 없음(확인). 요소 크롭이 `screenshotRaw`에 세팅되면 `DraftingPanel` `AnnotationOverlay`(`:362`) 자동 동작.
- **검증**:
  - [ ] 수동: 요소 캡처 → drafting에서 주석 추가/제거 → 제출 본문에 주석본(`screenshotAnnotated`) 반영.

## 테스트 계획
- **단위**:
  - env DOM 줄 — 6개 빌더 각각 + md/html: selector 유무별 표시/미표시(area 회귀), Group B element 모드 selector 표시 전환.
  - 본문 selector == 메타 selector 일치.
  - buildReportData / buildMarkdownContext selector 주입.
  - editor-store: startElementShot/onElementShot 상태(shotSelector, selection null 유지).
  - confirmDraft selector 저장(screenshot+shotSelector) / area 미저장.
- **수동(Chrome)**:
  - [ ] idle "요소 캡처" → 요소 선택 → styling 없이 drafting + overlay 제거.
  - [ ] 캡처 null(권한 만료) → idle 복귀 + 에러 안내.
  - [ ] 본문이 screenshot 골격(미디어 섹션·로그) + env DOM 줄(6플랫폼) + 메타 selector.
  - [ ] drafting 미리보기 env + 마크다운 복사 + Report 탭 + AI 초안 입력에 selector 일관.
  - [ ] drafting "뒤로"가 area와 동일 동작(backToStyling 미노출).
  - [ ] annotation 동작(주석본 제출 반영).
  - [ ] 범위 캡처(area)·element 스타일 모드·녹화·리플레이 회귀 없음. element 모드 DOM 줄이 selector로 바뀐 것 확인(Group B 의도된 변경).
  - [ ] idle 버튼 배치/라벨 재구성 + 가이드 footer 잔존.
  - [ ] App.tsx picker-port disconnect — "screenshot+picking" 조합에서 picker 탭 종료 시 동작(신규 조합 회귀).

## 회귀 리스크 (집중 점검)
- **Group B selector 전환**: element 스타일 모드의 Linear/Notion/Adf DOM 줄이 `formatElementName`(`div.card`) → raw selector(`div.card > button`)로 바뀜 — 의도된 변경, 단위 테스트로 고정.
- **env 조건 완화(Group A·Report·미리보기)**: area/video/freeform이 selector `""`라 미표시인지 확인.
- **shotSelector vs selection**: selection을 `shotSelector` 존재로 분기하지 않는지(혼동 금지), screenshot 모드 selection null 유지로 element 전용 분기(StyleEditorPanel·backToStyling·isElementNoDiff) 자연 회피 확인.
- **i18n 키 변경**(`issue.mode.*`): 다른 사용처(라벨 외) 영향 확인.

## 구현 순서 권장
1. Task 1→2→3(shotSelector·진입·선택·null 가드·overlay) — 핵심 플로우.
2. Task 4→5(buildCtx·6빌더 selector 통일) — 직렬화 핵심.
3. Task 5b→5c→5d→5e(미리보기·마크다운 복사·Report·AI 초안 selector 일관).
4. Task 6(메타 확인).
5. Task 7(IssueRecord selector 저장·재제출).
6. Task 8→9(idle UI·i18n).
7. Task 10(annotation 확인).
- 핵심 의존: Task 1 → 3/4/5b/5e/7; Task 4 → 5; Task 5 → 5b/5c/5d 출력 일관.

## 가이드 영향
사용자 노출 UX 변경(새 진입 모드 + idle 재구성). 구현 후 `/guide`로 대조(작성 기준 `guide/AUTHORING.md`):
- `guide/ko/`·`guide/en/`의 캡처 모드 안내 페이지: 모드 구조(엘리먼트/스크린샷[범위·요소]/녹화[수동·리플레이]) + "요소 캡처" 사용법 추가.
- [[multi-element-buffer]]의 no-diff 폐지 안내와 함께 "요소만 캡처하려면 요소 캡처 모드" 유도.
