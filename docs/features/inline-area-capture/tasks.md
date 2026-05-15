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
    - `appendInlineImage(sectionId, refId)`: `draft.sections[sectionId]` 마크다운 끝에 `\n\n![](inline:<refId>)` 추가. 빈 문자열이면 `\n\n` 없이. `draft === null`이면 no-op.
  - `reset()` 시 `inlineCaptureTarget: null`로 초기화 확인 (initial에 포함되면 자동)
  - `inlineCaptureTarget`은 `EditorSnapshot`에 포함하지 않음 (세션 영속화 제외)
- **검증**:
  - [ ] `startInlineCapture("description")` 호출 후 `inlineCaptureTarget === "description"`
  - [ ] `appendInlineImage("description", "test-ref")` 호출 후 `draft.sections.description`이 `![](inline:test-ref)`를 포함
  - [ ] `appendInlineImage` — `draft === null`이면 상태 변경 없음
  - [ ] `appendInlineImage` — 기존 텍스트 있는 섹션에서 `\n\n`으로 구분되어 추가
  - [ ] `appendInlineImage` — 연속 호출 시 각 이미지가 `\n\n`으로 구분
  - [ ] `cancelInlineCapture()` 호출 후 `inlineCaptureTarget === null`
  - [ ] `reset()` 호출 후 `inlineCaptureTarget === null`

### Task 2: picker-control에 인라인 캡처 시작 함수 추가

- **변경 대상**: `src/sidepanel/picker-control.ts`
- **작업 내용**:
  - `startInlineAreaCapture(tabId: number)` 함수 export:
    1. `chrome.tabs.get(tabId)` + `isSupportedUrl(tab.url)` 검사 (기존 `startAreaCapture` 패턴 준수)
    2. `ensureContentScript(tabId)` 호출
    3. `chrome.tabs.sendMessage(tabId, { type: "picker.startAreaSelect", restoreAfter: captureMode === "element" })` 전송
    4. 에러 시 `PickerUnavailableError`면 `onPickerUnavailable.fire()`, 그 외 console.error + `cancelInlineCapture()`
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
    **⚠️ 구현 주의**: `inlineCaptureTarget` 체크를 기존 `phase === "capturing"` 분기보다 **반드시 앞에** 배치해야 한다. 인라인 캡처 시 phase는 `"drafting"`이므로 기존 else 분기(`cancelPicking() → ...initial`)를 타면 **작성 중인 draft 전체가 유실**된다.
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
  - AI Draft 로딩 중(`aiLoading || aiDraftLoading`) 캡처 시작 방지: `captureAndInsertInline` 진입 시 AI 로딩 상태 확인 불필요 (UI에서 버튼 disabled로 차단)
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
  - `Camera` 아이콘 import (lucide-react)
  - ImagePlus 버튼 좌측에 캡처 버튼 추가:
    ```tsx
    <Button
      size="icon"
      variant="outline"
      className="h-8 w-8 shrink-0"
      title={t("draft.captureArea")}
      disabled={aiLoading || aiDraftLoading}
      onClick={() => {
        useEditorStore.getState().startInlineCapture(section.id);
        const tabId = useEditorStore.getState().target?.tabId;
        if (tabId) void startInlineAreaCapture(tabId);
      }}
    >
      <Camera />
    </Button>
    ```
  - 버튼 순서: `[Camera] [ImagePlus]` (좌→우, Section의 action 영역은 `flex items-center gap-1`)
  - `aiLoading`/`aiDraftLoading` 상태를 SectionTextarea에 prop으로 전달하거나 store에서 직접 구독

  **DraftingPanel 본체 변경**:
  - `inlineCaptureTarget` 구독: `const inlineCaptureTarget = useEditorStore(s => s.inlineCaptureTarget);`
  - 캡처 다이얼로그 전환 전 PageScroll의 `scrollTop`을 ref에 저장, 복귀 시 복원
  - `inlineCaptureTarget`이 non-null이면 캡처 다이얼로그 렌더링 (정상 콘텐츠 대신):
    ```tsx
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
  - `handleCancelInlineCapture` 핸들러: `cancelInlineCapture()` + `cancelAreaCapture(tabId)` 호출
  - import 추가: `Camera`, `ImageIcon` from lucide-react, `startInlineAreaCapture` from picker-control, `cancelAreaCapture` from picker-control

- **검증**:
  - [ ] paragraph 섹션 헤더에 Camera 버튼이 ImagePlus 좌측에 표시
  - [ ] orderedList 섹션에는 캡처 버튼 미표시
  - [ ] AI Draft 로딩 중 캡처 버튼 disabled
  - [ ] 캡처 버튼 클릭 시 DraftingPanel이 캡처 다이얼로그(ImageIcon)로 전환
  - [ ] 취소 버튼 클릭 시 정상 drafting 뷰로 복귀 + 스크롤 위치 복원
  - [ ] 영역 드래그 완료 후 이미지가 해당 섹션 에디터에 표시

### Task 5: content script — element 모드 overlay 복원

- **변경 대상**: `src/content/picker.ts`, `src/types/picker.ts`
- **작업 내용**:
  - `picker.startAreaSelect` 메시지 타입에 `restoreAfter?: boolean` 옵션 추가 (`src/types/picker.ts`)
  - `handleStartAreaSelect`에서 `restoreAfter` 분기:
    - `restoreAfter === true`: area-select 완료/취소 시 `handleClear()` 대신:
      1. `cancelAreaSelect(areaHandle)` → area-select UI 제거
      2. `setMode("selected")` → blocker cursor 원복
      3. `render()` → selectedEl 아웃라인·배지 재렌더
    - `restoreAfter` 미지정/false: 기존 동작 (`handleClear()`)
  - `selectedEl`은 `handleStartAreaSelect`에서 클리어하지 않으므로 area-select 중에도 보존됨
- **검증**:
  - [ ] element 모드 drafting에서 인라인 캡처 → 완료 후 선택 요소의 아웃라인·배지 복원
  - [ ] element 모드 drafting에서 인라인 캡처 취소(ESC) → 아웃라인·배지 복원
  - [ ] screenshot/freeform/video 모드에서 인라인 캡처 → 기존 동작 유지 (handleClear)
  - [ ] `pnpm test` 통과

### Task 6: i18n 키 추가

- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**:
  - `"draft.captureArea"` 키 추가:
    - ko: `"영역 캡처"`
    - en: `"Capture area"`
- **검증**:
  - [ ] Camera 버튼 호버 시 올바른 tooltip 표시
  - [ ] `pnpm typecheck` 통과 (i18n 키 타입 정합)

## 테스트 계획

### 단위 테스트

- `appendInlineImage`: 빈 섹션, 기존 텍스트 있는 섹션, 줄바꿈으로 끝나는 섹션, draft null, 연속 호출(복수 ref) 각각에서 올바른 마크다운 생성 확인
  - 파일 위치: `src/store/__tests__/editor-store.test.ts` (신규 또는 기존 파일에 추가)

### 수동 테스트

- [ ] freeform 모드: 섹션 캡처 버튼 클릭 → 영역 드래그 → 이미지 삽입 확인
- [ ] element 모드: drafting 단계에서 캡처 → 이미지 삽입 → overlay 복원 → "스타일링으로 돌아가기" 정상 동작
- [ ] screenshot 모드: 메인 스크린샷 + 인라인 캡처 공존 확인
- [ ] 취소 플로우: 버튼 취소 + ESC 취소 각각 확인 (overlay 복원 포함)
- [ ] 연속 캡처: 같은 섹션에 2회 이상 캡처 → 이미지 누적 확인
- [ ] 이슈 제출: 인라인 캡처 이미지가 Jira/GitHub/Linear/Notion에 정상 첨부 확인
- [ ] 고해상도(2x DPR): 캡처 이미지 품질 + 압축 동작 확인
- [ ] 인라인 캡처 중 탭 전환/페이지 이동 → 복귀 시 취소 버튼 동작 확인
- [ ] AI Draft 로딩 중 캡처 버튼 disabled 확인

## 구현 순서 권장

```
Task 1 (store) ─→ Task 2 (picker-control) ─→ Task 3 (usePickerMessages)
                                                       │
Task 5 (content script) ───────────────────────────────┤
                                                       │
Task 6 (i18n) ─────────────────────────────────────────┤
                                                       ↓
                                              Task 4 (UI 통합)
```

- Task 1 → 2 → 3: 순차 의존 (store 필드 → 제어 함수 → 메시지 핸들러)
- Task 5 (content script): Task 2와 병렬 가능. `restoreAfter` 메시지 옵션을 content에서 처리.
- Task 6 (i18n): Task 4의 i18n 키 의존. 독립 진행 가능.
- Task 4: 모든 태스크 완료 후 UI 통합. 수동 테스트 여기서 수행.
