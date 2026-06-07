# 요소 캡처 (Element Screenshot) — 기술 설계

## 개요

요소 캡처를 **`captureMode: "screenshot"`의 세부 모드**로 구현한다. 새 captureMode를 만들지 않으므로 로그 게이팅·본문 빌더·captureFiles·IssueRecord·blob 키가 전부 screenshot 정책을 자동으로 탄다(유지보수 핵심). 요소 캡처가 추가하는 것은 **진입 경로(요소 picker) + 캡처 소스(요소 크롭)** + **selector를 사용자가 보는 모든 면(본문·메타·미리보기·마크다운 복사·Report 탭·AI 초안)에 일관 노출**뿐이다.

흐름: idle "요소 캡처" → `picking`(captureMode `"screenshot"`) → 요소 선택 시 `captureElementSnapshot`(요소 크롭)을 `screenshotRaw`에 세팅 + selector를 **경량 `shotSelector` 필드**에 보관 → `drafting`. 이후는 screenshot과 동일(annotation·미디어 섹션·로그·제출). styling 단계 없음.

## 핵심 결정 (review 반영)

- **selector 보관: 경량 `shotSelector` 필드 신설** — `EditorSelection` 재사용은 `computedStyles`/`specifiedStyles`/`propSources` 등 무거운 스타일 메타를 store에 들고 가고("스타일 없음" 비목표와 상충), selection을 구독하는 컴포넌트가 phase 가드 없이 오작동할 위험이 있다. → `shotSelector: { selector: string; tagName: string } | null` 경량 필드로 대체. screenshot 모드에서 `selection`은 계속 null이라 기존 element 전용 분기(StyleEditorPanel·backToStyling·isElementNoDiff)가 자연 회피된다.
- **6개 빌더 selector 통일** — 빌더가 두 갈래라 단순 조건 완화로는 3개 플랫폼에 selector가 안 뜬다(아래 §5). Group B(Linear·Notion·Adf)를 selector 기반으로 전환해 6개 + 메타가 동일 문자열로 일관.
- **selector 전 경로 노출** — 등록 본문뿐 아니라 drafting 미리보기(§5b)·마크다운 복사(§5c)·Report 탭(§5d)·AI 초안(§5e)까지.
- **단축키 재배치 보류** — capture 단축키 3개가 상한(4개)에 도달. 신설 "요소 캡처" 버튼은 **단축키 무툴팁**으로 둔다(추후 별도 결정).

## 변경 범위

### 1. `src/store/editor-store.ts` — 진입·선택 액션 + shotSelector 필드
- **현재 역할**: `startCapturing`(screenshot/area 진입, phase `capturing`), `onAreaCaptured`(area 결과 → `screenshotRaw` + drafting), `onElementSelected`(element → styling).
- **변경 내용**:
  - **`shotSelector: { selector: string; tagName: string } | null` 필드 신설**(`initial`에서 null). selection이 아니라 이 경량 필드에 요소 정보 보관.
  - 진입 액션 `startElementShot(target)` 추가: `...initial`, `captureMode: "screenshot"`, `phase: "picking"`, `...preserveLogs`, `shotSelector: null`. (area의 `startCapturing`과 동일 골격이되 phase가 picking — 요소 picker를 띄우기 위함.)
  - 선택→캡처 액션 `onElementShot(shot, image, viewport)` 추가: `screenshotRaw: image`, `screenshotViewport: viewport`, `screenshotCapturedAt`, `shotSelector: shot`, `phase: "drafting"`. captureMode는 `"screenshot"` 유지. **`selection`은 건드리지 않음(null 유지)**.

### 2. `src/sidepanel/picker-control.ts` — 진입 함수
- **현재 역할**: `startPicker`(element), `startAreaCapture`(screenshot area).
- **변경 내용**: `startElementShot(tabId)` 추가 — `startAreaCapture`와 유사하나 `startElementShot` 액션 호출 + `picker.start`(요소 picker) 메시지(area select가 아니라 element picker). content script picker 재사용(요소 hover/선택 UI 동일).

### 3. `src/sidepanel/hooks/usePickerMessages.ts` — 선택 분기 + 캡처 + overlay 정리
- **현재 역할**: `picker.selected` 수신 시 **무조건** `onElementSelected`(styling) + `collectTokens` + `captureElementSnapshot`(beforeImage) 수집(`:55-82`).
- **변경 내용**: captureMode로 분기 —
  - `captureMode === "element"`: 기존대로 `onElementSelected`(styling) + tokens/beforeImage.
  - `captureMode === "screenshot"`(요소 캡처):
    1. `captureElementSnapshot(tabId)`로 요소 크롭 dataUrl 획득. **반환값이 null이면**(권한 만료·캡처 실패) drafting 진입하지 않고 idle 복귀 + 에러 안내(빈 이미지 진입 금지).
    2. viewport는 `captureElementSnapshot`이 주지 않으므로 **`picker.selected` payload의 viewport**(`msg.payload.viewport`, 페이지 뷰포트)에서 가져온다.
    3. `onElementShot({ selector, tagName }, image, viewport)` → drafting.
    4. **`clearPicker(tabId)`로 overlay destroy**(§7b).
    - **`collectTokens`·`setBeforeImage`는 호출하지 않는다**(screenshot은 before/after·토큰 미사용 — 불필요 캡처 방지).

### 4. `src/sidepanel/tabs/IssueCreateModal.tsx` — buildCtx selector 주입
- **현재 역할**: screenshot 분기 `buildCtx`에서 `selector: ""`, `tagName: ""`(`:208-209`).
- **변경 내용**: screenshot 분기에서 `shotSelector`가 있으면(요소 캡처) `selector: shotSelector.selector`, `tagName: shotSelector.tagName`을 채운다(area 캡처는 `shotSelector` null → `""` 유지). 나머지(미디어·로그·이미지)는 screenshot 그대로. `screenshotImage`는 기존 `screenshotAnnotated ?? screenshotRaw`라 annotation 자동 반영.

### 5. env DOM 줄 — 빌더 두 갈래 (Group A 완화 / Group B 전환)
빌더의 DOM 줄 생성 방식이 두 종류라 design 초안의 "6개 동일 완화"는 틀렸다. 두 갈래로 나눠 처리하고, **양쪽 모두 출력 문자열을 `ctx.selector`로 통일**한다(메타 `meta.selector = ctx.selector`와 일치).

- **Group A — 조건만 완화** (`buildIssueMarkdown.ts:63`(md)/`:159`(html), `buildGithubIssueBody.ts:68`, `buildGitlabIssueBody.ts:68`, `buildAsanaIssueBody.ts:51-56`):
  - 현재 `captureMode !== "screenshot" && !== "video" && !== "freeform" && ctx.selector`. 출력값은 raw `ctx.selector`.
  - → 조건을 **`ctx.selector`(truthy) 기준**으로 완화. 요소 캡처(selector 채움)는 표시, area/video/freeform(`selector: ""`)은 미표시.
- **Group B — selector 기반으로 전환** (`buildLinearIssueBody.ts:69-72`, `buildNotionIssueBody.ts:99-105`, `buildIssueAdf.ts:67-82`):
  - 현재 DOM 줄을 `domLabel = ctx.tagName ? formatElementName({tag, classList: ctx.classListBefore}) : ""`로 만들고, 게이트가 `!isVideo && !isScreenshot && !isFreeform`(Adf는 if/else로 screenshot이면 DOM 줄 없는 별도 블록).
  - → ① screenshot 게이트를 풀고 ② DOM 줄 소스를 `domLabel`이 아니라 **`ctx.selector`**로 전환(`ctx.selector` truthy 시 표시). element 모드도 `ctx.selector`가 채워지므로(picker가 selector 세팅) 동작 동일, 단 표시 형식이 `formatElementName`(예: `div.card`) → raw selector(예: `div.card > button`)로 바뀜에 유의. 6개 + 메타가 같은 selector 문자열로 일관.

### 5a. `buildMetaComment` — 변경 없음 (확인)
`buildIssueMarkdown.ts:264-265`가 `captureMode !== "freeform"`이면 `meta.selector = ctx.selector`를 넣음. 요소 캡처면 `ctx.selector` 채워져 자동 노출. (screenshot이라 `meta.classListBefore/cssChanges`는 빈 값 — 무해.)

### 5b. `src/sidepanel/components/DraftingPanel.tsx` — drafting 미리보기 env selector
- **현재 역할**: `:407` `deriveReadonlyEnvRows({ selector: captureMode === "element" ? selection?.selector : null, ... })` — screenshot은 무조건 null이라 요소 캡처 미리보기 env에 DOM 줄이 안 뜸(제출본과 불일치).
- **변경 내용**: selector 소스를 `captureMode === "element" ? selection?.selector : shotSelector?.selector ?? null`(또는 동등)로 보정. 요소 캡처(shotSelector 채움)면 미리보기 env에 DOM 줄 표시, area(shotSelector null)는 미표시.

### 5c. `src/sidepanel/lib/buildMarkdownContext.ts` + `PreviewPanel.tsx` — 마크다운 복사 경로
- **현재 역할**: `buildMarkdownContext.ts:77-91` screenshot 분기 `selector: ""` 하드코딩. `PreviewPanel.tsx:237-249`가 `buildMarkdownContext({captureMode:"screenshot", ...})` 호출 시 selector 미전달.
- **변경 내용**: `buildMarkdownContext`의 screenshot 분기에 optional `selector`/`tagName` 주입 경로 추가 + `PreviewPanel`이 `shotSelector`를 전달. "마크다운 복사" 결과물에 DOM 줄·메타 selector 포함(PRD 성공기준 "마크다운 복사 동일 구성").

### 5d. `src/sidepanel/lib/buildReportData.ts` — 로그 뷰어 Report 탭
- **현재 역할**: `:19-24`도 `captureMode !== "screenshot" && ... && ctx.selector` DOM row 조건.
- **변경 내용**: Group A와 동일하게 `ctx.selector`(truthy) 기준으로 완화. 요소 캡처 이슈를 로그 뷰어 Report 탭에서 봐도 DOM 줄 표시.

### 5e. `src/sidepanel/components/AiDraftDialog.tsx` — AI 초안 입력 selector
- **현재 역할**: `:81-82` `isElement = captureMode === "element"` 가드로 element 모드에서만 selector/tagName을 AI 컨텍스트에 넣음.
- **변경 내용**: 가드를 요소 캡처(screenshot + shotSelector)도 포함하도록 완화 — `isElement || shotSelector` 시 `shotSelector`의 selector/tagName을 AI 입력에 주입. 본문·메타·AI 초안 모두 selector 일관.

### 6. `src/store/editor-store.ts` `confirmDraft` — IssueRecord selector 저장
- **현재 역할**: screenshot 분기 `confirmDraft`(`:492~`)에서 selector 미저장.
- **변경 내용**: 요소 캡처(screenshot + `shotSelector` 존재) 시 IssueRecord에 `selector`/`tagName` 저장(기존 `IssueRecord.selector?`/`tagName?` optional 필드 재사용, `:148-149`). area 캡처는 `shotSelector` null → 미저장.
- **DraftDetailDialog 재제출은 거의 자동**: `DraftDetailDialog.tsx:272` `buildCtxForSubmit`이 이미 `selector: issue.selector ?? ""`로 IssueRecord에서 ctx로 복원하므로, confirmDraft가 저장만 하면 재제출 본문/메타 일관이 따라온다(near no-op). blob 키·captureMode는 screenshot 그대로 → 스키마/마이그레이션 변경 없음.

### 7. `src/sidepanel/tabs/IssueTab.tsx` — idle UI 재구성
- **현재 역할**: EmptyState(`:170~223`) — `grid grid-cols-2 gap-2` + `col-span-2` primary. 실제 구성: [DOM 요소 선택(col-span-2)] / [화면 캡처][영상 녹화] / [리플레이(단독 셀)] + **footer [가이드(settings.guide, BookOpen)][이슈 작성(startDraft)]**. 버튼 3개에 `ShortcutTooltip`(`:185/191/197` — capture-element/screenshot/video).
- **변경 내용**: 배치·라벨 재구성(prd UI):
  ```
  [ 요소 스타일 편집 ]          (col-span-2, primary) → startPicker (element)
  [ 요소 캡처 ] [ 범위 캡처 ]   → startElementShot (신설) / startAreaCapture
  [ 화면 녹화 ] [ 30초 리플레이 ]
  footer: [ 가이드 ] [ 이슈 작성 ]   (가이드·freeform 유지)
  ```
  - **footer 가이드 버튼 유지** — 기존 `settings.guide`(BookOpen) 버튼을 지우지 않는다.
  - **리플레이가 2x2 안으로 들어가므로** 기존 단독 셀(`col-span-2`/단독 분기, `:263/268`) 처리를 "[화면 녹화][30초 리플레이]" 짝으로 맞춘다(리플레이의 `col-span-2` 제거).
  - 라벨 세트(동사로 모드 구분 — 편집/캡처/녹화): 요소 스타일 편집(element) / 요소 캡처(신설)·범위 캡처(기존 "화면 캡처") / 화면 녹화(기존 "영상 녹화")·30초 리플레이.
  - **단축키 툴팁**: 신설 "요소 캡처"는 무툴팁(capture 단축키 상한 도달). 기존 capture-element/screenshot/video 툴팁 매핑은 그대로(재배치 보류).
  - "요소 캡처" 버튼 신설(아이콘 — picker 계열, 범위 캡처와 시각 차별화: 요소=Crosshair/SquareDashedMousePointer, 범위=점선 사각형 계열) → `startElementShot(tabId)`.

### 7b. picker overlay 정리 + drafting 뒤로 — area와 동일
- **현재 역할**: element(스타일) 모드는 선택 후 overlay 유지(styling 하이라이트). area 모드는 캡처 후 overlay 정리. 캡처 자체는 `prepareCapture`가 overlay를 `visibility:hidden`(picker.ts:374) 처리 후 찍어 이미지에 overlay 미포함.
- **변경 내용**:
  - element-screenshot은 스타일 프리뷰가 없어 overlay 유지 이유가 없다. `usePickerMessages`의 요소 캡처 분기에서 `onElementShot`(drafting) 직후 **`clearPicker(tabId)`로 overlay 제거** → drafting 중 페이지 깨끗(screenshot/area와 동일). `clearPicker`→`handleClear`의 `restoreOriginal`은 스타일 변경 0이라 무해, `destroyOverlay`가 목적.
  - **drafting 뒤로**: `DraftingPanel.tsx:62/306`의 `backToStyling` 버튼은 element 전용이다. 요소 캡처는 styling이 없으므로 **범위 캡처(area)의 drafting 뒤로 동작과 동일**하게 처리한다. `shotSelector`만 채우고 `selection`은 null로 두므로, back 버튼 분기가 `captureMode === "element"`(또는 selection 기반)이면 요소 캡처가 자연히 element용 backToStyling을 피하고 area와 같은 경로를 탄다 — 구현 시 back 버튼 가드가 selection이 아닌 captureMode 기준인지 확인.
  - 재선택은 area와 동일 경로. overlay를 유지/재활용하지 않는다.

### 8. annotation — 변경 없음 (확인만)
- `DraftingPanel`의 `AnnotationOverlay`(`:362`)는 `screenshotAnnotated ?? screenshotRaw`를 대상으로 하고 captureMode `"screenshot"`에서 동작. 요소 캡처가 `screenshotRaw`에 크롭을 세팅하므로 **자동 지원**. 코드 변경 없음 — 수동 확인 항목.

### 9. `src/i18n/namespaces/issue.ts` — 라벨 (ko/en 동시, PostToolUse 훅)

| 키 | ko | en |
|---|---|---|
| `issue.mode.elementShot` *(신규)* | 요소 캡처 | Capture element |
| `issue.mode.element` *(변경)* | DOM 요소 선택 → **요소 스타일 편집** | Select DOM element → **Edit element styles** |
| `issue.mode.screenshot` *(변경)* | 화면 캡처 → **범위 캡처** | Screenshot → **Capture area** |
| `issue.mode.video` *(변경)* | 영상 녹화 → **화면 녹화** | Record video → **Record screen** |
| `issue.mode.replay` *(유지)* | 30초 리플레이 | 30s replay |
| `issue.startDraft` *(유지)* | 이슈 작성 | Write issue |

### 변경 없음 (명시적)
- captureMode union — `"element" | "screenshot" | "video" | "freeform"` 그대로(신규 값 없음). 정의 2곳(`editor-store.ts:14`, `buildCaptureFiles.ts:11`) 모두 무변경.
- `IssueRecord` 스키마/`ISSUES_STORE_VERSION`/마이그레이션 — 변경 없음(`selector?`/`tagName?`는 기존 optional 필드 재사용).
- blob 키·로그 게이팅·captureFiles — screenshot 정책 그대로(자동 종속).
- 캡처 단축키 매핑(`useCaptureShortcuts.ts`) — 재배치 보류, 무변경.

## 데이터 흐름

```
[idle "요소 캡처"] → startElementShot(tabId)
                   → editor-store: captureMode="screenshot", phase="picking", shotSelector=null
                   → picker.start (요소 picker UI, content script 재사용)
[요소 선택]        → picker.selected → usePickerMessages: captureMode==="screenshot" 분기
                   → captureElementSnapshot(tabId)  (요소 크롭, string | null)
                   → null이면 idle 복귀 + 에러 안내 (가드)
                   → viewport = picker.selected payload (페이지 뷰포트)
                   → onElementShot({selector, tagName}, image, viewport)
                   → screenshotRaw=image, shotSelector 보관, phase="drafting"
                   → clearPicker(tabId)  (overlay destroy → 페이지 깨끗)
                   → (collectTokens / setBeforeImage 미호출)
[drafting]         → DraftingPanel (screenshot 정책)
                   → 미리보기 env: shotSelector → DOM 줄 (§5b)
                   → annotation: AnnotationOverlay(screenshotRaw) → screenshotAnnotated  (자동)
                   → AI 초안: shotSelector → selector AI 입력 (§5e)
[마크다운 복사]    → PreviewPanel → buildMarkdownContext(selector=shotSelector) (§5c)
[이슈 등록]        → buildCtx (screenshot 분기) + selector=shotSelector.selector
                   → 본문: 미디어 섹션(이미지) + env "- **DOM**: selector"(6빌더 통일) + meta.selector
                   → confirmDraft: IssueRecord에 selector/tagName 저장 (재제출 복원 자동)
                   → captureFiles/로그/IssueRecord: screenshot 정책 그대로
[Report 탭]        → buildReportData: ctx.selector → DOM 줄 (§5d)
```

## 인터페이스 설계

```typescript
// src/store/editor-store.ts
shotSelector: { selector: string; tagName: string } | null;   // 신규 경량 필드

startElementShot: (target: EditorTarget) => void;   // captureMode "screenshot" + phase "picking"
onElementShot: (
  shot: { selector: string; tagName: string },       // 경량 selector 정보 → shotSelector
  image: string,                                      // 요소 크롭 dataUrl → screenshotRaw
  viewport: { width: number; height: number },        // picker.selected payload에서
) => void;                                            // phase "drafting"

// src/sidepanel/picker-control.ts
export async function startElementShot(tabId: number): Promise<void>;

// 기존 (참고) — capture.ts
captureElementSnapshot(tabId: number, options?: { margin?: number }): Promise<string | null>;
//   → 요소 크롭 dataUrl만 반환. viewport 없음. null 가능(권한/캡처 실패).
```

## 기존 패턴 준수

- **captureMode 재사용**: 새 모드를 만들지 않아 로그/MD/빌더/captureFiles/IssueRecord/blob 키가 자동 종속(분기 최소).
- **picker·크롭 함수 재사용**: content script picker(요소 선택) + `captureElementSnapshot`(크롭)을 그대로 활용. 신규 캡처 로직 없음.
- **annotation 파이프라인 재사용**: `screenshotRaw` 세팅만으로 기존 `AnnotationOverlay` 동작.
- **`...initial` + preserveLogs**: 진입 액션이 기존 패턴 따름.
- **경량 신규 필드**: `selection` 재사용 대신 `shotSelector`로 스타일 메타 부담·구독 부작용 회피(아래 대안 검토 3).
- **i18n 동시 갱신**: 새/변경 키 ko/en 양쪽.

## 대안 검토

1. **새 captureMode `"element-screenshot"` 추가 (기각)**: 로그 게이팅·본문 빌더·captureFiles·IssueRecord·blob 키에 분기를 새로 퍼뜨려 유지보수 부담 증가. 사용자가 "screenshot 생태계 종속"을 명시 → captureMode 재사용 채택.
2. **no-diff element 유지(폐지 안 함) (기각)**: `isElementNoDiff` 동적 강등이 element 모드에 남아 multi-element-buffer를 복잡화. 요소 캡처를 screenshot 세부 모드로 분리하는 게 책임 분리·유지보수 양면에서 우월.
3. **selector를 `selection`(EditorSelection) 재사용으로 보관 (기각, review 반영)**: `EditorSelection`은 `computedStyles`/`specifiedStyles`/`propSources` 등 무거운 스타일 메타를 요구해 "캡처일 뿐인데 스타일 일체를 store에 보관"하는 부담을 진다("스타일 없음" 비목표와 상충). 또 screenshot 모드에서 `selection`이 채워지면 drafting 단계에 사는 selection 구독 컴포넌트(`PreviewPanel`·`DraftingPanel`·`IssueCreateModal`·`IssueTab`)가 phase 가드 없이 오작동할 위험. → **경량 `shotSelector: { selector, tagName }` 필드 채택**. selector만 필요하고 styleEdits는 미사용이라 충분하며, `selection`을 null로 유지해 기존 element 전용 분기(StyleEditorPanel·backToStyling·isElementNoDiff)를 자연 회피.
4. **6개 빌더 env DOM 줄 단순 조건 완화 (기각, review 반영)**: 빌더가 두 갈래(Group A는 `ctx.selector` 기반, Group B는 `formatElementName(tagName)` 기반 + screenshot 게이트)라 단순 완화로는 Group B 3개에 selector가 안 뜨고 표시 문자열도 갈린다. → Group A 완화 + Group B selector 전환(§5)으로 6개 + 메타 통일.

## 위험 요소

- **`shotSelector` 채택으로 selection 재사용 부작용 해소**: screenshot 모드에서 `selection`을 null로 유지하므로 selection 구독 컴포넌트·element 전용 분기가 자연 회피. 다만 `selection`을 보는 지점이 `captureMode`/`phase`가 아니라 `shotSelector` 존재로 분기하지 않는지(혼동 금지) 점검.
- **Group B selector 전환의 표시 변화**: Linear/Notion/Adf의 element 모드 DOM 줄이 `formatElementName`(예: `div.card`) → raw selector(예: `div.card > button`)로 바뀐다. element 모드 기존 출력의 회귀로 보일 수 있으므로, 변경이 의도임을 단위 테스트로 고정(element/요소캡처 모두 selector 표시).
- **env DOM 줄 조건 완화의 회귀(Group A)**: `ctx.selector` truthy 기준으로 바꾸면 다른 모드에서 selector가 우연히 채워진 경우 DOM 줄이 새로 뜰 수 있다. area/video/freeform이 selector를 `""`로 두는지 확인(현재 그러함). 빌더·buildReportData·미리보기 각각 조건 일관 적용 + 단위 테스트.
- **draft 재제출 selector 복원**: `confirmDraft`가 IssueRecord에 selector 저장 시, `buildCtxForSubmit`(`DraftDetailDialog.tsx:272`)이 이미 `issue.selector ?? ""`로 복원하므로 본문/메타 일관이 자동. 단, area draft가 selector를 저장하지 않는지(`shotSelector` null 가드) 확인.
- **picker 재사용 시 캡처 타이밍·실패**: `picker.selected` 후 `captureElementSnapshot`은 비동기(visibleTab 캡처)이고 `null` 반환 가능(권한 만료·캡처 실패). null 가드로 idle 복귀/에러 안내. 캡처 완료 전 phase 전환/UI 깜빡임 주의 — area 캡처의 기존 타이밍 패턴 따름.
- **picker-port disconnect 가드 신규 조합**: `App.tsx:155`는 `captureMode === "screenshot" && phase === "capturing"`에서만 reset. 요소 캡처는 `phase: "picking"`이라 이 조합 밖 — "screenshot+picking"은 신규 조합이므로 picker 탭 종료/disconnect 경로를 수동 회귀 항목에 추가.
