# 요소 캡처 (Element Screenshot) — 기술 설계

## 개요

요소 캡처를 **`captureMode: "screenshot"`의 세부 모드**로 구현한다. 새 captureMode를 만들지 않으므로 로그 게이팅·본문 빌더·captureFiles·IssueRecord·blob 키가 전부 screenshot 정책을 자동으로 탄다(유지보수 핵심). 요소 캡처가 추가하는 것은 **진입 경로(요소 picker) + 캡처 소스(요소 크롭)** + **selector를 본문 env·AI 메타에 노출**뿐이다.

흐름: idle "요소 캡처" → `picking`(captureMode `"screenshot"`) → 요소 선택 시 `captureElementSnapshot`(요소 크롭)을 `screenshotRaw`에 세팅 + selector 보관 → `drafting`. 이후는 screenshot과 동일(annotation·미디어 섹션·로그·제출). styling 단계 없음.

## 변경 범위

### 1. `src/store/editor-store.ts` — 진입·선택 액션
- **현재 역할**: `startCapturing`(screenshot/area 진입, phase `capturing`), `onAreaCaptured`(area 결과 → `screenshotRaw` + drafting), `onElementSelected`(element → styling).
- **변경 내용**:
  - 진입 액션 `startElementShot(target)` 추가: `...initial`, `captureMode: "screenshot"`, `phase: "picking"`, `...preserveLogs`. (area의 `startCapturing`과 동일 골격이되 phase가 picking — 요소 picker를 띄우기 위함.)
  - 선택→캡처 액션 `onElementShot(selection, image, viewport)` 추가: `screenshotRaw: image`, `screenshotViewport: viewport`, `screenshotCapturedAt`, `phase: "drafting"`, 그리고 **selector/tagName/viewport 보관**(아래 selector 전달용 — `selection` 필드 재사용 또는 경량 `shotSelector` 필드). captureMode는 `"screenshot"` 유지.
  - **selector 보관 방식(택1, design 결정)**: `selection`(EditorSelection)을 그대로 세팅(요소 정보 일체 보관, styleEdits는 미사용) — 가장 적은 신규 필드. buildCtx screenshot 분기에서 `selection?.selector`를 `ctx.selector`로 채운다.

### 2. `src/sidepanel/picker-control.ts` — 진입 함수
- **현재 역할**: `startPicker`(element), `startAreaCapture`(screenshot area).
- **변경 내용**: `startElementShot(tabId)` 추가 — `startAreaCapture`와 유사하나 `startElementShot` 액션 호출 + `picker.start`(요소 picker) 메시지(area select가 아니라 element picker). content script picker 재사용(요소 hover/선택 UI 동일).

### 3. `src/sidepanel/hooks/usePickerMessages.ts` — 선택 분기
- **현재 역할**: `picker.selected` 수신 시 `onElementSelected`(styling) + tokens/beforeImage 수집.
- **변경 내용**: captureMode로 분기 —
  - `captureMode === "element"`: 기존대로 `onElementSelected`(styling).
  - `captureMode === "screenshot"`(요소 캡처): `captureElementSnapshot(tabId)`로 요소 크롭 → `onElementShot(selection, image, viewport)`(drafting). tokens·before/after는 불필요(screenshot 정책).

### 4. `src/sidepanel/tabs/IssueCreateModal.tsx` — buildCtx selector 주입
- **현재 역할**: screenshot 분기 `buildCtx`에서 `selector: ""`, `tagName: ""`.
- **변경 내용**: screenshot 분기에서 `selection`이 있으면(요소 캡처) `selector: selection.selector`, `tagName: selection.tagName`을 채운다(area 캡처는 selection 없음 → `""` 유지). 나머지(미디어·로그·이미지)는 screenshot 그대로. `screenshotImage`는 기존 `screenshotAnnotated ?? screenshotRaw`라 annotation 자동 반영.

### 5. `src/sidepanel/lib/buildIssueMarkdown.ts` (+ 6개 빌더) — env DOM 줄 조건 완화
- **현재 역할**: env DOM 줄 조건이 `captureMode !== "screenshot" && !== "video" && !== "freeform" && ctx.selector`(line 63 md / 159 html). screenshot은 미표시. `buildMetaComment`(line 264)는 `captureMode !== "freeform"`이면 `meta.selector` 포함.
- **변경 내용**:
  - **본문 env DOM 줄**: 조건을 `ctx.selector`(truthy) 기준으로 완화 — screenshot이어도 selector가 채워졌으면 표시. 요소 캡처는 표시, 범위 캡처(`selector: ""`)는 미표시. `buildIssueMarkdown`·`buildIssueHtml` + **6개 빌더의 env DOM 줄 동일 완화**.
  - **AI 메타**: `meta.selector`는 screenshot도 이미 포함(변경 불필요). 요소 캡처면 `ctx.selector`가 채워져 자동 노출. (단, `meta.classListBefore/cssChanges` 등은 screenshot이라 빈 값 — 무해.)

### 6. `src/store/editor-store.ts` `confirmDraft` — IssueRecord selector
- **현재 역할**: screenshot 분기 `confirmDraft`에서 selector 미저장.
- **변경 내용**: 요소 캡처(screenshot + selection 존재) 시 IssueRecord에 `selector`/`tagName` 저장(기존 `IssueRecord.selector` 필드 재사용, optional). draft 재제출(DraftDetailDialog)에서 selector를 ctx로 복원해 본문/메타 일관. blob 키·captureMode는 screenshot 그대로 → 스키마/마이그레이션 변경 없음.

### 7. `src/sidepanel/tabs/IssueTab.tsx` — idle UI 재구성
- **현재 역할**: EmptyState(line 170~223) 2열 그리드 — [DOM 요소 선택(col-span-2)] / [화면 캡처][영상 녹화] / [리플레이][placeholder] + footer[이슈 작성].
- **변경 내용**: 배치·라벨 재구성(prd UI):
  ```
  [ 요소 스타일 편집 ]          (col-span-2, primary) → startPicker (element)
  [ 요소 캡처 ] [ 범위 캡처 ]   → startElementShot (신설) / startAreaCapture
  [ 화면 녹화 ] [ 30초 리플레이 ]
  footer: [ 이슈 작성 ]        (freeform, 유지)
  ```
  - 라벨 세트(동사로 모드 구분 — 편집/캡처/녹화): 요소 스타일 편집(element) / 요소 캡처(신설)·범위 캡처(기존 "화면 캡처") / 화면 녹화(기존 "영상 녹화")·30초 리플레이. freeform footer "이슈 작성"은 유지.
  - "요소 캡처" 버튼 신설(아이콘 — Crosshair/SquareDashedMousePointer 등 picker 계열) → `startElementShot(tabId)`.

### 7b. picker overlay 정리 — 캡처 후 제거 (screenshot 패턴)
- **현재 역할**: element(스타일) 모드는 선택 후에도 overlay를 유지(styling 하이라이트·스타일 프리뷰). area 모드는 캡처 후 `cancelAreaSelect`/`handleClear`로 overlay 정리. 캡처 자체는 `prepareCapture`가 overlay를 `visibility:hidden`(picker.ts:374) 처리 후 찍어 이미지에 overlay 미포함.
- **변경 내용**: element-screenshot은 스타일 프리뷰가 없어 overlay 유지 이유가 없다. `usePickerMessages`의 요소 캡처 분기에서 `onElementShot`(drafting) 직후 **`clearPicker(tabId)`로 overlay를 제거** → drafting 중 페이지 깨끗(screenshot/area와 동일). `clearPicker`→`handleClear`의 `restoreOriginal`은 스타일 변경 0이라 무해, `destroyOverlay`가 목적. content picker는 idle, sidepanel은 drafting(상태 분리 — screenshot과 동일 정상 패턴).
- 재선택은 drafting에서 `startElementShot` 재진입(새 picker.start). overlay를 유지/재활용하지 않는다.

### 8. annotation — 변경 없음 (확인만)
- `DraftingPanel`의 `AnnotationOverlay`(line 362)는 `screenshotAnnotated ?? screenshotRaw`를 대상으로 하고 captureMode `"screenshot"`에서 동작. 요소 캡처가 `screenshotRaw`에 크롭을 세팅하므로 **자동 지원**. 코드 변경 없음 — 수동 확인 항목.

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
- captureMode union — `"element" | "screenshot" | "video" | "freeform"` 그대로(신규 값 없음).
- `IssueRecord` 스키마/`ISSUES_STORE_VERSION`/마이그레이션 — 변경 없음(selector는 기존 optional 필드 재사용).
- blob 키·로그 게이팅·captureFiles — screenshot 정책 그대로(자동 종속).

## 데이터 흐름

```
[idle "요소 캡처"] → startElementShot(tabId)
                   → editor-store: captureMode="screenshot", phase="picking"
                   → picker.start (요소 picker UI, content script 재사용)
[요소 선택]        → picker.selected → usePickerMessages: captureMode==="screenshot" 분기
                   → captureElementSnapshot(tabId)  (요소 크롭, cropImage)
                   → onElementShot(selection, image, viewport)
                   → screenshotRaw=image, selection 보관, phase="drafting"
                   → clearPicker(tabId)  (overlay destroy → 페이지 깨끗)
[drafting]         → DraftingPanel (screenshot 정책)
                   → annotation: AnnotationOverlay(screenshotRaw) → screenshotAnnotated  (자동)
[이슈 등록]        → buildCtx (screenshot 분기) + selector=selection.selector
                   → 본문: 미디어 섹션(이미지) + env "- **DOM**: selector" + meta.selector
                   → captureFiles/로그/IssueRecord: screenshot 정책 그대로
```

## 인터페이스 설계

```typescript
// src/store/editor-store.ts
startElementShot: (target: EditorTarget) => void;   // captureMode "screenshot" + phase "picking"
onElementShot: (
  selection: EditorSelection,
  image: string,                                     // 요소 크롭 dataUrl → screenshotRaw
  viewport: { width: number; height: number },
) => void;                                           // phase "drafting", selection 보관

// src/sidepanel/picker-control.ts
export async function startElementShot(tabId: number): Promise<void>;
```

## 기존 패턴 준수

- **captureMode 재사용**: 새 모드를 만들지 않아 로그/MD/빌더/captureFiles/IssueRecord/blob 키가 자동 종속(분기 최소).
- **picker·크롭 함수 재사용**: content script picker(요소 선택) + `captureElementSnapshot`(크롭)을 그대로 활용. 신규 캡처 로직 없음.
- **annotation 파이프라인 재사용**: `screenshotRaw` 세팅만으로 기존 `AnnotationOverlay` 동작.
- **`...initial` + preserveLogs**: 진입 액션이 기존 패턴 따름.
- **i18n 동시 갱신**: 새/변경 키 ko/en 양쪽.

## 대안 검토

1. **새 captureMode `"element-screenshot"` 추가 (기각)**: 로그 게이팅·본문 빌더·captureFiles·IssueRecord·blob 키에 분기를 새로 퍼뜨려 유지보수 부담 증가. 사용자가 "screenshot 생태계 종속"을 명시 → captureMode 재사용 채택.
2. **no-diff element 유지(폐지 안 함) (기각)**: `isElementNoDiff` 동적 강등이 element 모드에 남아 multi-element-buffer를 복잡화. 요소 캡처를 screenshot 세부 모드로 분리하는 게 책임 분리·유지보수 양면에서 우월.
3. **selector를 별도 신규 store 필드로 (기각)**: `selection` 재사용이 신규 필드 최소화. screenshot 모드에서 selection이 채워지는 하이브리드지만, buildCtx에서 selector만 읽으면 되고 styleEdits는 미사용이라 부작용 없음.

## 위험 요소

- **selection 재사용의 부수효과**: screenshot 모드인데 `selection`이 세팅되면, selection을 보는 다른 코드(예: element 전용 UI)가 오작동할 수 있다. → "요소 캡처는 phase가 styling을 거치지 않고 바로 drafting"이라 StyleEditorPanel은 렌더되지 않음. selection을 읽는 지점을 점검(phase 가드 확인). 불안하면 경량 `shotSelector` 필드로 대체.
- **env DOM 줄 조건 완화의 회귀**: 조건을 `ctx.selector` truthy로 바꾸면, 혹시 다른 모드에서 selector가 우연히 채워진 경우 DOM 줄이 새로 뜰 수 있다. area 캡처/video/freeform이 selector를 `""`로 두는지 확인(현재 그러함). 6개 빌더 각각 조건 일관 적용 + 단위 테스트.
- **draft 재제출 selector 복원**: IssueRecord에 selector 저장 시, DraftDetailDialog `buildCtxForSubmit`이 screenshot 분기에서 selector를 ctx로 복원해야 본문/메타 일관. 누락 시 재제출 본문에 DOM 줄 빠짐.
- **picker 재사용 시 캡처 타이밍**: `picker.selected` 후 `captureElementSnapshot`은 비동기(visibleTab 캡처). 캡처 완료 전 phase 전환/UI 깜빡임 주의 — area 캡처의 기존 타이밍 패턴 따름.
