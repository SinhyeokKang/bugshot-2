# Inline Area Capture — 기술 설계

## 개요

DraftingPanel의 SectionTextarea에 캡처 버튼을 추가하고, 기존 area-select + captureVisibleTab 인프라를 재사용하여 뷰포트 영역을 캡처한 뒤 해당 섹션의 TiptapEditor에 인라인 이미지로 삽입한다. editor store에 `inlineCaptureTarget` 상태를 추가하여 기존 screenshot 캡처와 인라인 캡처를 구분한다.

## 변경 범위

### 1. `src/store/editor-store.ts` — 인라인 캡처 상태 추가

현재 역할: 에디터 전체 상태 관리 (phase, captureMode, draft, screenshot 등).

변경:
- `EditorState`에 `inlineCaptureTarget: string | null` 필드 추가. 값은 캡처 대상 섹션 ID (예: `"description"`).
- 액션 3개 추가:
  - `startInlineCapture(sectionId: string)`: `inlineCaptureTarget` 설정
  - `cancelInlineCapture()`: `inlineCaptureTarget` 해제
  - `appendInlineImage(sectionId: string, refId: string)`: `draft.sections[sectionId]` 마크다운 끝에 `\n\n![](inline:<refId>)` 추가. 빈 문자열이면 `\n\n` 없이. `draft === null`이면 no-op.

`inlineCaptureTarget`은 phase와 독립적인 필드다. phase는 "drafting"을 유지하면서 DraftingPanel이 이 값의 유무로 캡처 다이얼로그를 렌더링한다.

**세션 영속화 제외**: `inlineCaptureTarget`은 `EditorSnapshot`에 포함하지 않는다. 세션 복원 시 content script의 area-select가 이미 해제되어 있으므로 영속화 무의미. `snapshotFromState()`에서 자연스럽게 누락.

### 2. `src/sidepanel/picker-control.ts` — 인라인 캡처 시작 함수

현재 역할: picker와 side panel 간 메시지 래퍼 (startPicker, startAreaCapture 등).

변경:
- `startInlineAreaCapture(tabId: number)` 함수 추가. 기존 `startAreaCapture`와 달리 `startCapturing()`을 호출하지 않아 editor state를 리셋하지 않음. `ensureContentScript` → `picker.startAreaSelect` 메시지 전송만 수행.

```typescript
export async function startInlineAreaCapture(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    useEditorStore.getState().cancelInlineCapture();
    return;
  }
  if (!isSupportedUrl(tab.url)) {
    onPickerUnavailable.fire();
    useEditorStore.getState().cancelInlineCapture();
    return;
  }
  const { captureMode } = useEditorStore.getState();
  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.startAreaSelect",
      restoreAfter: captureMode === "element",
    });
  } catch (err) {
    if (err instanceof PickerUnavailableError) {
      onPickerUnavailable.fire();
    } else {
      console.error("[bugshot] inline area capture start failed", err);
    }
    useEditorStore.getState().cancelInlineCapture();
  }
}
```

기존 `startAreaCapture` 패턴을 따라 `isSupportedUrl` 검사를 추가. `restoreAfter` 플래그로 element 모드 overlay 복원을 제어 (섹션 6 참조).

### 3. `src/sidepanel/hooks/usePickerMessages.ts` — 인라인 캡처 분기

현재 역할: content script 메시지 수신 및 처리.

변경:
- `picker.areaSelected` 핸들러에서 `inlineCaptureTarget` 확인:
  - 값 있음 → `captureAndInsertInline(sectionId, rect, viewport)` 호출
  - 값 없음 → 기존 `captureAndCrop(rect, viewport)` 호출
- `picker.cancelled` 핸들러에서 `inlineCaptureTarget` 확인:
  - 값 있음 → `cancelInlineCapture()` (drafting 상태 유지)
  - 값 없음 → 기존 로직 (phase 기반 reset/cancelPicking)
- `captureAndInsertInline` 함수 추가:
  1. `captureVisibleTab` + `cropImage` (기존 `captureAndCrop`과 동일한 크롭 로직)
  2. dataUrl → blob 변환 (`dataUrlToBlob`)
  3. 압축 판단: `createImageBitmap(blob)` → `shouldCompact` → 필요 시 `compactImage`
  4. `saveInlineImage(refId, finalBlob)` → IndexedDB 저장
  5. `appendInlineImage(sectionId, refId)` → 마크다운에 이미지 참조 추가
  6. `cancelInlineCapture()` → 인라인 캡처 상태 해제

### 4. `src/sidepanel/tabs/DraftingPanel.tsx` — UI 변경

현재 역할: 이슈 초안 편집 UI.

변경 (SectionTextarea):
- `Camera` 아이콘 버튼을 ImagePlus 버튼 좌측에 추가 (Camera는 기존 screenshot 모드 시작 아이콘과 동일 계열).
- AI Draft 로딩 중(`aiLoading || aiDraftLoading`)이면 캡처 버튼 `disabled`.
- 클릭 시 `startInlineCapture(section.id)` + `startInlineAreaCapture(tabId)` 호출.

변경 (DraftingPanel 본체):
- `inlineCaptureTarget` 상태 구독.
- 캡처 다이얼로그 전환 전 `PageScroll`의 `scrollTop`을 ref에 저장, 복귀 시 복원.
- `inlineCaptureTarget`이 non-null이면 정상 콘텐츠 대신 캡처 다이얼로그를 렌더링:
  - `EmptyShell` 패턴 사용 (`ImageIcon` 아이콘 + `t("issue.capturing.title")` + 취소 버튼). 기존 CapturingState와 동일한 아이콘.
  - 취소 클릭 → `cancelInlineCapture()` + `cancelAreaCapture(tabId)`.

```tsx
// DraftingPanel 내부 (inlineCaptureTarget 분기)
if (inlineCaptureTarget) {
  return (
    <PageShell>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
        <div className="mb-3 rounded-full bg-muted p-3">
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-[18px] font-semibold">{t("issue.capturing.title")}</h3>
        <div className="mt-4">
          <Button variant="outline" onClick={handleCancelInlineCapture}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
```

### 5. `src/i18n/ko.ts` + `src/i18n/en.ts` — 번역 키 추가

- `"draft.captureArea"`: 캡처 버튼 tooltip
  - ko: `"영역 캡처"`
  - en: `"Capture area"`

`issue.capturing.title`(캡처 중 다이얼로그 타이틀)과 `common.cancel`은 기존 키 재사용.

### 6. `src/content/picker.ts` + `src/types/picker.ts` — element 모드 overlay 복원

현재 역할: picker FSM + 메시지 타입 정의.

변경:
- `picker.startAreaSelect` 메시지에 `restoreAfter?: boolean` 옵션 추가.
- `handleStartAreaSelect`에서 `restoreAfter`가 true이면:
  - area-select 완료/취소 시 `handleClear()` 대신 경량 복원 수행:
    1. `cancelAreaSelect(areaHandle)` → area-select UI 제거
    2. `setMode("selected")` → blocker cursor 원복 + viewport listener 재설정
    3. `render()` → selectedEl의 아웃라인·배지 재렌더
  - `selectedEl`은 `handleStartAreaSelect`에서 클리어하지 않으므로 area-select 중에도 보존됨.
- `restoreAfter`가 false/undefined면 기존 동작 유지 (`handleClear()`).

이 변경으로 element 모드에서 인라인 캡처 후 picker가 selected 상태로 복귀하므로, "스타일링으로 돌아가기"가 정상 동작한다.

### 새로 추가되는 파일: 없음

## 데이터 흐름

```
[SectionTextarea]
  ─ click Crosshair ──────────────────────────────────────────────┐
                                                                   │
[editor-store]                                                     │
  ─ startInlineCapture("description")                              │
  ─ inlineCaptureTarget = "description"                            │
                                                                   │
[picker-control]                                                   │
  ─ startInlineAreaCapture(tabId)                                  │
  ─ ensureContentScript → picker.startAreaSelect (restoreAfter) ───→│
                                                                   │
[content/picker.ts]                                                │
  ─ mode = "area-select"                                           │
  ─ startAreaSelect() ── drag UI ── onSelected(rect, viewport)     │
  ─ restoreAfter? → mode = "selected" + render() (overlay 복원)    │
  ─ chrome.runtime.sendMessage({ type: "picker.areaSelected" }) ──→│
                                                                   │
[usePickerMessages]                                                │
  ─ inlineCaptureTarget !== null → captureAndInsertInline()        │
    ─ captureVisibleTab → cropImage → dataUrlToBlob               │
    ─ shouldCompact → compactImage (if needed)                     │
    ─ saveInlineImage(refId, blob)                                 │
    ─ appendInlineImage("description", refId)                      │
      → draft.sections.description += "\n![](inline:<refId>)"      │
    ─ cancelInlineCapture()                                        │
                                                                   │
[DraftingPanel]                                                    │
  ─ inlineCaptureTarget = null → 정상 뷰 복귀                       │
  ─ SectionTextarea re-mount                                       │
                                                                   │
[TiptapEditor]                                                     │
  ─ value에 inline:<refId> 포함                                     │
  ─ useEffect: extractInlineRefs → getInlineImage → createObjectURL│
  ─ 이미지 렌더링                                                    │
```

## 인터페이스 설계

### editor-store 추가 필드/액션

```typescript
// EditorState 추가
interface EditorState {
  // ... 기존 필드
  inlineCaptureTarget: string | null;
}

// 액션 추가
startInlineCapture: (sectionId: string) => void;
cancelInlineCapture: () => void;
appendInlineImage: (sectionId: string, refId: string) => void;
```

### picker-control 추가 함수

```typescript
export async function startInlineAreaCapture(tabId: number): Promise<void>;
```

### usePickerMessages 추가 함수 (모듈 내부)

```typescript
async function captureAndInsertInline(
  sectionId: string,
  rect: ViewportRect,
  viewport: { width: number; height: number },
): Promise<void>;
```

## 기존 패턴 준수

- **EmptyShell 패턴**: IssueTab의 CapturingState와 동일한 레이아웃 패턴 사용 (아이콘 + 타이틀 + 액션 버튼).
- **인라인 이미지 저장**: TiptapEditor의 기존 `insertImageFile` 흐름과 동일한 IndexedDB + `inline:refId` 패턴 사용.
- **area-select 재사용**: content script의 picker FSM과 area-select.ts를 변경 없이 재사용.
- **i18n 동시 갱신**: ko/en 로케일 동시 추가.
- **IconButton 사이즈**: 패널/섹션 헤더 액션은 `h-8 w-8` (32px) 통일.
- **이미지 압축**: `shouldCompact` + `compactImage` 파이프라인으로 일관된 압축 처리.
- **세션 영속화 범위**: `EditorSnapshot`에 포함하지 않는 필드는 명시적으로 제외 (기존 `tokens` 등과 동일 패턴).

## 대안 검토

### 대안 A: DraftingPanel 콘텐츠를 숨기지 않고 오버레이로 캡처 다이얼로그를 띄우는 방안

TiptapEditor를 unmount하지 않으면 ref를 유지할 수 있어 캡처 후 직접 `insertImageFile`을 호출할 수 있다. 그러나:
- DraftingPanel은 스크롤 가능한 복잡한 UI. 위에 오버레이를 띄우면 시각적으로 산만.
- 사용자가 "drafting panel이 다이얼로그로 변경"이라고 명시.
- TiptapEditor는 마크다운 값 기반이므로, `draft.sections`에 inline ref를 추가하면 remount 시 자동 해석됨 (기존 `extractInlineRefs` + `getInlineImage` useEffect).
- **채택하지 않은 이유**: 사용자 요구와 다른 UX. 마크다운 기반 삽입이 ref 유지 없이도 동작.

### 대안 B: TiptapEditor ref를 유지하고 `insertImageFile`로 직접 삽입

캡처 완료 후 TiptapEditor가 mount된 상태에서 `editorRef.current?.insertImageFile(file)`을 호출하는 방식. 대안 A와 동일한 전제(editor unmount 안 함)가 필요하며, 추가로 DraftingPanel에서 섹션별 ref를 `Map<string, RefObject<TiptapEditorHandle>>`로 관리하는 구조가 필요해 복잡도가 높다. 마크다운 append 방식이 기존 inline ref 파이프라인을 그대로 활용하면서 ref 관리 없이 동작하므로, 현재 접근이 더 단순.

## 위험 요소

1. **element 모드 picker overlay 복원**: `restoreAfter` 플래그로 area-select 종료 시 selected 상태를 복원하지만, `selectedEl`의 DOM 참조가 페이지 리로드 등으로 무효화될 수 있다. `render()` 시 `selectedEl`이 DOM에서 분리된 상태면 오버레이가 빈 상태로 렌더링될 수 있으므로 `document.contains(selectedEl)` 체크 필요. 단, 기존 picker의 다른 경로에서도 동일한 가정(selectedEl이 유효)을 하고 있으므로 이 변경의 고유 위험은 아님.

2. **TiptapEditor remount 시 inline ref 해석 타이밍**: `appendInlineImage`로 마크다운에 inline ref를 추가한 뒤 TiptapEditor가 remount되면, useEffect에서 비동기로 IndexedDB를 조회해 blob URL을 생성한다. 이미 `saveInlineImage`가 완료된 후이므로 정상 동작하지만, 비동기 간 미세한 타이밍 차이로 잠깐 깨진 이미지가 보일 수 있다. 기존 에디터 remount에서도 동일한 패턴이므로 추가 처리 불요.

3. **대용량 캡처**: 고해상도 디스플레이에서 넓은 영역을 캡처하면 이미지가 클 수 있음. `shouldCompact` + `compactImage`로 1280px 이하로 리사이즈하여 완화.
