# Inline Area Capture — 구현 태스크

## 선행 조건

- 추가 권한/env/의존성 없음. 기존 인프라(area-select, captureVisibleTab, blob-db, TiptapEditor inline ref) 전부 재사용.

## 태스크

### Task 1: editor-store에 인라인 캡처 상태 추가

- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**:
  - `EditorState`에 `inlineCaptureTarget: string | null` 추가 (초기값 `null`)
  - `initial` 객체에 `inlineCaptureTarget: null` 추가
  - 액션 3개 추가:
    - `startInlineCapture(sectionId)`: `set({ inlineCaptureTarget: sectionId })`
    - `cancelInlineCapture()`: `set({ inlineCaptureTarget: null })`
    - `appendInlineImage(sectionId, refId)`: `draft.sections[sectionId]` 마크다운 끝에 `\n![](inline:<refId>)` 추가 (빈 문자열이면 `\n` 없이)
  - `reset()` 시 `inlineCaptureTarget: null`로 초기화 확인 (initial에 포함되면 자동)
- **검증**:
  - [ ] `startInlineCapture("description")` 호출 후 `inlineCaptureTarget === "description"`
  - [ ] `appendInlineImage("description", "test-ref")` 호출 후 `draft.sections.description`이 `![](inline:test-ref)`를 포함
  - [ ] `cancelInlineCapture()` 호출 후 `inlineCaptureTarget === null`
  - [ ] `reset()` 호출 후 `inlineCaptureTarget === null`

### Task 2: picker-control에 인라인 캡처 시작 함수 추가

- **변경 대상**: `src/sidepanel/picker-control.ts`
- **작업 내용**:
  - `startInlineAreaCapture(tabId: number)` 함수 export:
    1. `ensureContentScript(tabId)` 호출
    2. `chrome.tabs.sendMessage(tabId, { type: "picker.startAreaSelect" })` 전송
    3. 에러 시 `PickerUnavailableError`면 `onPickerUnavailable.fire()`, 그 외 console.error + `cancelInlineCapture()`
  - 기존 `startAreaCapture`와 차이: `startCapturing()` 호출 안 함 (editor state 리셋 안 함)
- **검증**:
  - [ ] 함수 호출 시 content script에 `picker.startAreaSelect` 메시지 전달 확인
  - [ ] editor store의 phase가 "drafting"으로 유지되는지 확인
  - [ ] 에러 시 `inlineCaptureTarget`이 해제되는지 확인

### Task 3: usePickerMessages에 인라인 캡처 분기 추가

- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`
- **작업 내용**:
  - `picker.areaSelected` 핸들러 수정:
    ```
    const { inlineCaptureTarget } = useEditorStore.getState();
    if (inlineCaptureTarget) {
      void captureAndInsertInline(inlineCaptureTarget, msg.rect, msg.viewport);
    } else {
      void captureAndCrop(msg.rect, msg.viewport);
    }
    ```
  - `picker.cancelled` 핸들러 수정:
    ```
    const { phase, inlineCaptureTarget } = useEditorStore.getState();
    if (inlineCaptureTarget) {
      useEditorStore.getState().cancelInlineCapture();
    } else if (phase === "capturing") { ... }
    ```
  - `captureAndInsertInline` 함수 추가:
    1. `captureVisibleTab(windowId, { format: "png" })`
    2. `cropImage(dataUrl, scaledRect)` — DPR 적용
    3. `dataUrlToBlob(cropped)` → blob 변환
    4. `createImageBitmap(blob)` → `shouldCompact(bitmap)` 확인
    5. 필요 시 `compactImage(bitmap)`, 아니면 원본 blob 사용 + `bitmap.close()`
    6. `crypto.randomUUID()` → refId 생성
    7. `saveInlineImage(refId, finalBlob)`
    8. `appendInlineImage(sectionId, refId)`
    9. finally: `cancelInlineCapture()`
  - import 추가: `dataUrlToBlob`, `saveInlineImage` from `blob-db`, `shouldCompact`, `compactImage` from `compactImage`
- **검증**:
  - [ ] 인라인 캡처 활성 상태에서 `picker.areaSelected` 수신 시 해당 섹션의 마크다운에 inline ref 추가
  - [ ] 인라인 캡처 활성 상태에서 `picker.cancelled` 수신 시 phase "drafting" 유지 + 인라인 캡처 해제
  - [ ] 인라인 캡처 비활성 상태에서 `picker.areaSelected`는 기존 동작 유지 (screenshotRaw 설정)
  - [ ] 캡처 에러 시 인라인 캡처 상태 해제 + drafting 상태 유지 (reset 안 됨)
  - [ ] `pnpm test` 통과

### Task 4: DraftingPanel UI — 캡처 버튼 + 다이얼로그

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**:

  **SectionTextarea 변경**:
  - `Crosshair` 아이콘 import (lucide-react)
  - ImagePlus 버튼 좌측에 캡처 버튼 추가:
    ```tsx
    <Button
      size="icon"
      variant="outline"
      className="h-8 w-8 shrink-0"
      title={t("draft.captureArea")}
      onClick={() => {
        useEditorStore.getState().startInlineCapture(section.id);
        const tabId = useEditorStore.getState().target?.tabId;
        if (tabId) void startInlineAreaCapture(tabId);
      }}
    >
      <Crosshair />
    </Button>
    ```
  - 버튼 순서: `[Crosshair] [ImagePlus]` (좌→우, Section의 action 영역은 `flex items-center gap-1`)

  **DraftingPanel 본체 변경**:
  - `inlineCaptureTarget` 구독: `const inlineCaptureTarget = useEditorStore(s => s.inlineCaptureTarget);`
  - `inlineCaptureTarget`이 non-null이면 캡처 다이얼로그 렌더링 (정상 콘텐츠 대신):
    ```tsx
    if (inlineCaptureTarget) {
      return (
        <PageShell>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
            <div className="mb-3 rounded-full bg-muted p-3">
              <Crosshair className="h-6 w-6 text-muted-foreground" />
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
  - `handleCancelInlineCapture` 핸들러: `cancelInlineCapture()` + `cancelAreaCapture(tabId)` 호출
  - import 추가: `Crosshair` from lucide-react, `startInlineAreaCapture` from picker-control, `cancelAreaCapture` from picker-control

- **검증**:
  - [ ] paragraph 섹션 헤더에 Crosshair 버튼이 ImagePlus 좌측에 표시
  - [ ] orderedList 섹션에는 캡처 버튼 미표시
  - [ ] 캡처 버튼 클릭 시 DraftingPanel이 캡처 다이얼로그로 전환
  - [ ] 취소 버튼 클릭 시 정상 drafting 뷰로 복귀
  - [ ] 영역 드래그 완료 후 이미지가 해당 섹션 에디터에 표시

### Task 5: i18n 키 추가

- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**:
  - `"draft.captureArea"` 키 추가:
    - ko: `"영역 캡처"`
    - en: `"Capture area"`
- **검증**:
  - [ ] Crosshair 버튼 호버 시 올바른 tooltip 표시
  - [ ] `pnpm typecheck` 통과 (i18n 키 타입 정합)

## 테스트 계획

### 단위 테스트

- `appendInlineImage`: 빈 섹션, 기존 텍스트 있는 섹션, 줄바꿈으로 끝나는 섹션 각각에서 올바른 마크다운 생성 확인
  - 파일 위치: `src/store/__tests__/editor-store.test.ts` (신규 또는 기존 파일에 추가)

### 수동 테스트

- [ ] freeform 모드: 섹션 캡처 버튼 클릭 → 영역 드래그 → 이미지 삽입 확인
- [ ] element 모드: drafting 단계에서 캡처 → 이미지 삽입 → "스타일링으로 돌아가기" 동작 확인
- [ ] screenshot 모드: 메인 스크린샷 + 인라인 캡처 공존 확인
- [ ] 취소 플로우: 버튼 취소 + ESC 취소 각각 확인
- [ ] 연속 캡처: 같은 섹션에 2회 이상 캡처 → 이미지 누적 확인
- [ ] 이슈 제출: 인라인 캡처 이미지가 Jira/GitHub/Linear/Notion에 정상 첨부 확인
- [ ] 고해상도(2x DPR): 캡처 이미지 품질 + 압축 동작 확인

## 구현 순서 권장

```
Task 1 (store) → Task 2 (picker-control) → Task 3 (usePickerMessages)
                                                  ↓
                                    Task 5 (i18n) → Task 4 (UI)
```

- Task 1 → 2 → 3: 순차 의존 (store 필드 → 제어 함수 → 메시지 핸들러)
- Task 5: Task 4의 i18n 키 의존. Task 4보다 먼저 또는 동시 진행 가능.
- Task 4: 모든 태스크 완료 후 UI 통합. 수동 테스트 여기서 수행.
