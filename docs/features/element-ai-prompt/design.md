# Element mode AI draft — user prompt 입력 — 기술 설계

## 개요

`AiDraftDialog`를 element 모드까지 처리하는 단일 진입점으로 일반화한다. `DraftingPanel`의 AI 버튼 분기(`captureMode === "element" ? handleAIDraft() : setAiDialogOpen(true)`)를 제거하고, 항상 다이얼로그를 띄운다. 프롬프트 빌더 `buildAiDraftSessionPrompt`를 element 모드까지 처리하도록 확장하고, 이미지 첨부 헬퍼를 모드 무관 형태로 일반화한다. 결과적으로 `DraftingPanel.handleAIDraft`와 `buildAiDraftPrompt`(single-shot 버전) 함수는 호출자가 사라져 제거된다.

## 변경 범위

### `src/sidepanel/lib/buildAiDraftPrompt.ts`

- 현재 역할: 두 가지 프롬프트 빌더(`buildAiDraftPrompt`: element single-shot용, `buildAiDraftSessionPrompt`: screenshot/video/freeform session용) 공존. `buildAiDraftSchema` / `parseAiDraftResponse`는 공유.
- 변경 내용:
  - `AiDraftSessionContext.captureMode` union에 `"element"` 추가.
  - `AiDraftSessionContext`에 element용 옵셔널 필드 추가: `selector?`, `tagName?`, `diffs?`, `tokens?`, `userPrompt?`.
  - `buildAiDraftSessionPrompt` 함수에 element 분기 추가 — 기존 `buildAiDraftPrompt`의 element 블록(`L.85-101`)을 거의 그대로 가져옴: tagName/selector, diff 라인업, token 라인업. element 모드일 때 콘솔/네트워크 로그 분기는 타지 않는다.
  - 시스템 prompt에 `userPrompt`가 비어 있지 않으면 `- User context: <userPrompt>` 한 줄 추가. element 모드에서 prompt가 비어 있을 때는 이 줄이 빠진다.
  - `buildAiDraftPrompt`(single-shot) 함수, `AiDraftContext` 타입 **삭제** — 호출자가 사라진다.
- 검증: 단위 테스트로 element 모드 케이스의 prompt 문자열 검증.

### `src/sidepanel/tabs/AiDraftDialog.tsx`

- 현재 역할: screenshot/video/freeform 모드용 prompt 입력 다이얼로그.
- 변경 내용:
  - `captureMode` 타입 narrowing 제거(`as "screenshot" | "video" | "freeform"` → `as CaptureMode`).
  - `handleSubmit`의 빈 입력 가드(`if (!msg) return;`)를 element 모드일 때만 우회. 다른 모드는 기존대로 빈 제출 금지.
  - "생성" 버튼 `disabled={!input.trim()}`을 `disabled={captureMode !== "element" && !input.trim()}`으로 완화.
  - `getScreenshotImages`를 `getModeImages(store, captureMode)`로 일반화:
    - `screenshot`: 기존 그대로 `screenshotAnnotated ?? screenshotRaw` 1장.
    - `element`: `[beforeImage, afterImage]` 중 non-null만.
    - 그 외: `undefined`.
  - `buildAiDraftSessionPrompt` 호출 시 element 케이스용 필드 채우기 — `store.selection?.selector`, `store.selection?.tagName`, `store.diffs`, `store.tokens`, `userPrompt: msg`.
  - element 모드일 때 콘솔/네트워크 로그는 첨부하지 않음(기존 video/freeform용 분기 `includeLogCtx`가 이미 `captureMode === "video" || "freeform"` 조건으로 제한 — 추가 작업 없음).
- 검증: 다이얼로그에서 element 모드 진입 시 textarea 빈 상태에서도 "생성" 버튼이 활성.

### `src/sidepanel/tabs/DraftingPanel.tsx`

- 현재 역할: 초안 작성 메인 패널. AI 버튼 분기, element 직접 호출 경로 보유.
- 변경 내용:
  - AI 버튼 onClick(`L.332-338`)에서 mode 분기 제거. `setAiDialogOpen(true)`만 호출.
  - `handleAIDraft` 함수(`L.128-184`) **삭제**.
  - 더 이상 쓰지 않는 import 정리: `buildAiDraftPrompt`(single-shot), `buildAiDraftSchema`/`parseAiDraftResponse`는 AiDraftDialog로만 옮겨가니 DraftingPanel 측 import에서 제거. `buildLogSummary`(`buildNetworkLogSummary`/`buildConsoleLogSummary`)는 LogAttachmentCards 등에서 여전히 쓰일 수 있어 확인 후 정리.
  - `aiError` 로컬 state도 handleAIDraft 전용이라 삭제 가능 여부 확인. AiDraftDialog는 자체적으로 `toast.error`로 에러 노출하므로 DraftingPanel의 `aiError` 표시 영역은 제거 — 다만 이미 element 모드는 다이얼로그 경유로 일원화되므로 일관됨.
- 검증: 각 모드 AI 버튼 클릭 시 다이얼로그가 뜨는지.

### `src/sidepanel/lib/__tests__/buildAiDraftPrompt.test.ts`

- 현재 역할: 기존 buildAiDraftPrompt / buildAiDraftSessionPrompt / parseAiDraftResponse 테스트가 있는지 확인. 없으면 신규 생성.
- 변경 내용:
  - 기존에 `buildAiDraftPrompt`(single-shot) 케이스가 있으면 element 케이스를 `buildAiDraftSessionPrompt`로 이전.
  - 신규 케이스: `buildAiDraftSessionPrompt` element 모드 — selector/tagName/diff/token 포함, userPrompt 비어 있을 때 prompt 줄 부재, userPrompt 있을 때 `- User context:` 줄 포함, 로그 첨부 X 확인.

## 데이터 흐름

```
[사용자] AI 버튼 클릭
  ↓ (모든 모드 동일)
DraftingPanel: setAiDialogOpen(true)
  ↓
AiDraftDialog: open=true 렌더, textarea 자동 포커스
  ↓
[사용자] (선택) prompt 입력
  ↓
[사용자] "생성" 클릭
  ↓
AiDraftDialog.handleSubmit:
  - msg = input.trim()  // element면 빈 문자열 OK
  - useEditorStore.getState()에서 captureMode, selection, diffs, tokens, networkLog, consoleLog, beforeImage, afterImage 등 수집
  - buildAiDraftSessionPrompt(ctx) → systemPrompt
  - createSession(systemPrompt) → AISession 캐싱 (첫 호출)
  - getModeImages(store, captureMode) → string[] | undefined
  - session.prompt(msg, { responseSchema, images })
  - parseAiDraftResponse → setDraft
```

session/캐싱·후속 prompt 동작은 기존 그대로. element 모드도 첫 메시지에만 이미지 동봉(`isFirstMessageRef`).

## 인터페이스 설계

```ts
// src/sidepanel/lib/buildAiDraftPrompt.ts

export interface AiDraftSessionContext {
  captureMode: CaptureMode; // "element" | "screenshot" | "video" | "freeform"
  locale: LocaleMode;
  url: string;
  pageTitle: string;
  // element only (optional)
  selector?: string;
  tagName?: string;
  diffs?: StyleDiffRow[];
  tokens?: { name: string; value: string }[];
  // user free-form prompt (모든 모드, element만 빈 문자열 허용)
  userPrompt?: string;
  // video/freeform only (기존 그대로)
  networkLogSummary?: NetworkLogSummary;
  consoleLogSummary?: ConsoleLogSummary;
  enabledSections: { id: IssueSectionId }[];
}

export function buildAiDraftSessionPrompt(ctx: AiDraftSessionContext): string;

// buildAiDraftPrompt / AiDraftContext 는 삭제
```

```ts
// src/sidepanel/tabs/AiDraftDialog.tsx

function getModeImages(
  store: ReturnType<typeof useEditorStore.getState>,
  captureMode: CaptureMode,
): string[] | undefined;
// screenshot: [screenshotAnnotated ?? screenshotRaw]
// element: [beforeImage, afterImage] non-null만
// 그 외: undefined
```

`AiDraftDialog`의 props는 변경 없음. 내부 state도 추가하지 않는다 (`input` 외).

## 기존 패턴 준수

- **세션 캐싱**: `sessionRef`/`isFirstMessageRef` 패턴 그대로. 첫 메시지에만 이미지 첨부.
- **세션 진입은 captureMode 고정**: drafting phase는 mode가 바뀌지 않음. `AiDraftDialog`가 열린 상태에서 captureMode가 바뀔 시나리오 없음.
- **에러 처리**: `LlmQuotaError` / `LlmOverloadedError` / 일반 에러를 `toast.error`로 표시. DraftingPanel 측 `aiError` state는 제거.
- **i18n**: 신규 문자열 없음 — `aiDraft.placeholder` / `aiDraft.disclaimer` / `aiDraft.generate` / `aiDraft.title` 모두 기존 키. element 케이스에서 placeholder를 더 적절히 바꿀지는 가능하지만 본 스코프 밖.
- **store 접근**: `useEditorStore.getState()` 패턴(이벤트 핸들러 내부). 재렌더 트리거가 필요 없는 단발성 접근.
- **CLAUDE.md의 "테스트 우선"**: 새 prompt 빌더 분기는 단위 테스트로 시그니처를 굳힌 뒤 구현.

## 대안 검토

### 대안 A: 기존 `handleAIDraft`(single-shot)에 prompt 입력만 추가

DraftingPanel 안에 element 전용 inline textarea + AI 버튼을 두고, 다이얼로그 없이 진행. 한 클릭 UX는 유지하지만 모드 간 UX 비대칭이 그대로 남고, 화면 공간을 영구히 차지한다. 사용자 답변(질문 1)이 "AiDraftDialog 띄움"이라 채택하지 않음.

### 대안 B: element 전용 별도 다이얼로그

`ElementAiDraftDialog`를 새로 만들고 `AiDraftDialog`와 분리. 스타일 diff 미리보기 같은 element 특화 UI를 추가하기 쉽지만 코드 중복(세션 관리·에러 핸들링·이미지 첨부)이 발생한다. 사용자 답변(질문 4)이 통합이라 채택하지 않음.

### 대안 C: `buildAiDraftPrompt`(single-shot) 유지

두 빌더를 그대로 두고 AiDraftDialog 내부에서 captureMode === "element" 일 때만 다른 빌더를 호출. 함수 두 개의 prompt 헤더/푸터 규칙이 갈리면 결과 일관성이 깨질 위험이 있어 한 빌더로 통합. 호출자가 단 한 곳(AiDraftDialog)이라 통합 비용은 작다.

### 대안 D: 이미지 첨부를 prompt 입력 시에만

비용 절감 목적이지만 사용자 답변(빈 prompt에도 항상 첨부)이라 채택하지 않음.

## 위험 요소

- **LLM 비용·지연**: element 모드 AI 호출에 이미지 2장(before/after)이 동봉돼 토큰·전송 시간이 늘어난다. 사용자가 이를 인지하고 선택한 trade-off — 별도 가드 없음.
- **이미지 미지원 LLM 프로바이더**: chrome on-device, 일부 BYOK 모델은 이미지 입력을 지원하지 않을 수 있다. `AISession.prompt`의 `images` 옵션이 지원되지 않으면 어떻게 처리되는지 provider 측에서 확인 — 무시되거나 에러일 수 있다. 기존 screenshot 모드가 이미 같은 경로를 거치므로 새로 도입되는 위험은 아니다.
- **element snapshot 부재**: `beforeImage`/`afterImage`가 null일 수 있음. `getModeImages`에서 non-null 필터링으로 처리.
- **회귀: 빈 prompt 가드**: `disabled` 조건 완화 시 screenshot/video/freeform에서 의도치 않게 빈 제출이 허용되지 않도록 조건을 `captureMode !== "element" && !input.trim()`으로 정확히 박는다.
- **`handleAIDraft` 제거로 사라지는 inline 에러 표시**: 다이얼로그는 toast 기반. 사용자가 다이얼로그를 닫은 뒤 발생하는 에러도 toast로 보여진다. UX 영향 미미.
- **`buildAiDraftPrompt` 제거 시 잔존 import**: 다른 파일에서 import하지 않는지 grep 확인 필요.
