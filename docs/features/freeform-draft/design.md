# 자유 작성 (Freeform Draft) — 기술 설계

## 개요

`CaptureMode` 유니온에 `"freeform"`을 추가하고, 캡처 단계를 건너뛰어 `phase: "drafting"`으로 직행하는 경로를 만든다. DraftingPanel에서 미디어 블록을 렌더링하지 않고, 기존 이슈 섹션 + 로그 카드만 노출한다. 출력 빌더(Markdown/ADF/GitHub/Linear/Notion)와 AI 드래프트 프롬프트에 freeform 분기를 추가한다.

## 변경 범위

### 1. `src/store/editor-store.ts` — 타입 + 액션

**현재**: `CaptureMode = "element" | "screenshot" | "video"`, 캡처 시작 액션 3개.

**변경**:
- `CaptureMode`에 `"freeform"` 추가.
- `EditorState`에 `freeformViewport: { width: number; height: number } | null`과 `freeformCapturedAt: number | null` 추가.
- `startFreeform(target: EditorTarget)` 액션 추가 — `{ ...initial, captureMode: "freeform", phase: "drafting", target }` 세팅.
- `confirmDraft()` — freeform 분기 추가. 미디어 blob 저장 없이 draft + 로그만 persist.

### 2. `src/sidepanel/tabs/IssueTab.tsx` — EmptyState 버튼 추가

**현재**: `EmptyState`가 element/screenshot/video 3개 버튼을 `grid-cols-2` 레이아웃으로 렌더링.

**변경**:
- `onStartFreeform` prop 추가.
- 버튼 그리드 하단에 `col-span-2` 아웃라인 버튼 추가: 아이콘 `PenLine`, 라벨 `t("issue.mode.freeform")`.
- 핸들러: 현재 탭 정보 조회 → `startFreeform(target)` 호출 + 뷰포트 조회.

```
[ DOM 요소 선택  (col-span-2, solid)  ]
[ 화면 캡처     |   영상 녹화         ]
[ 자유 작성     (col-span-2, outline) ]
```

### 3. `src/sidepanel/picker-control.ts` — startFreeformDraft 헬퍼

**현재**: `startPicker`, `startAreaCapture` 등 캡처 시작 함수 정의.

**변경**: `startFreeformDraft(tabId: number)` 추가.
- `chrome.tabs.get(tabId)` → URL/title 조회
- `isSupportedUrl(url)` 체크 — unsupported여도 진입 허용(freeform은 DOM 캡처 없음), 단 뷰포트 조회 스킵
- supported URL인 경우 `chrome.scripting.executeScript({ target: { tabId }, func: () => ({ width: window.innerWidth, height: window.innerHeight }) })` → 뷰포트 획득
- `useEditorStore.getState().startFreeform({ tabId, url, title })` 호출
- 뷰포트/capturedAt 세팅: `useEditorStore.setState({ freeformViewport, freeformCapturedAt: Date.now() })`
- 로그 동기화: `syncNetworkRecorder(tabId)` + `syncConsoleRecorder(tabId)` 호출하여 최신 로그를 store에 반영

### 4. `src/sidepanel/tabs/DebugTab.tsx` — 서브탭 전환 콜백

**현재**: `sub` 로컬 상태로 issue/console/network 탭 전환. ConsoleSubTab/NetworkSubTab에 `active` prop만 전달.

**변경**:
- `handleStartFreeform` 콜백 정의: `setSub("issue")` → `startFreeformDraft(tabId)` 호출.
- `ConsoleSubTab`과 `NetworkSubTab`에 `onStartFreeform` prop 전달.

### 5. `src/sidepanel/tabs/ConsoleSubTab.tsx` — PageFooter 추가

**현재**: `ConsoleLogContent`만 렌더링하는 패시브 뷰어.

**변경**:
- `onStartFreeform` prop 추가.
- 하단에 `PageFooter` 래퍼 + 버튼 추가. 아이콘 `PenLine`, 라벨 `t("issue.mode.freeform")`.
- `PageScroll`로 로그 콘텐츠 감싸기 (스크롤 + 고정 footer 레이아웃).

### 6. `src/sidepanel/tabs/NetworkSubTab.tsx` — PageFooter 추가

**현재**: `NetworkLogContent`만 렌더링하는 패시브 뷰어.

**변경**: ConsoleSubTab과 동일 패턴.

### 7. `src/sidepanel/tabs/DraftingPanel.tsx` — freeform 미디어 블록 제거

**현재**: captureMode에 따라 VideoPreview/StyleChangesTable/Screenshot 중 하나를 `mediaBlock`에 할당.

**변경**:
- `isFreeformMode = captureMode === "freeform"` 플래그 추가.
- `mediaBlock`: freeform이면 `null`.
- `showLogCards` 조건은 변경 불필요 — 이미 `captureMode !== "element"`로 필터링하므로 freeform은 통과.
- AI 드래프트 버튼: freeform은 screenshot/video와 같이 `AiDraftDialog` 방식 사용 (`captureMode !== "element"` 분기).

### 8. `src/sidepanel/lib/buildIssueMarkdown.ts` — freeform 출력

**현재**: `emitMedia()` 안에서 video/screenshot/element 분기. Environment 섹션에서 screenshot/video일 때 DOM 생략.

**변경**:
- `emitMedia()`: freeform이면 미디어 섹션 생략 (빈 배열 반환).
- Environment 섹션: freeform도 DOM 생략 (`captureMode !== "screenshot" && captureMode !== "video"` 조건에 freeform 추가).
- 뷰포트가 null이면 Viewport 줄 생략.
- HTML 빌더(`buildIssueHtml`)도 동일 패턴 적용.

### 9. `src/sidepanel/lib/buildIssueAdf.ts` — freeform ADF 출력

**현재**: video/screenshot/element 분기로 미디어 ADF 노드 생성.

**변경**: freeform이면 미디어 heading/content 노드 생략. Environment에서 DOM 생략.

### 10. `src/sidepanel/lib/buildGithubIssueBody.ts` — freeform GitHub 출력

**현재**: `isElement` 플래그 기반 분기.

**변경**: `isFreeform` 플래그 추가. `emitMedia()`: freeform이면 미디어 섹션 생략. Environment: DOM 생략.

### 11. `src/sidepanel/lib/buildLinearIssueBody.ts` — freeform Linear 출력

**변경**: 위와 동일 패턴.

### 12. `src/sidepanel/lib/buildNotionIssueBody.ts` — freeform Notion 출력

**변경**: 위와 동일 패턴.

### 13. `src/sidepanel/lib/buildAiDraftPrompt.ts` — freeform AI 컨텍스트

**현재**: element/video/screenshot별로 다른 컨텍스트 포함. `MODE_HINTS`에 모드별 섹션 힌트.

**변경**:
- freeform 컨텍스트: URL + viewport + 네트워크 에러 + 콘솔 에러/경고 (video 모드의 로그 컨텍스트 로직 재사용).
- `MODE_HINTS.freeform` 추가: `{ ko: { description: " (URL, 로그 등 재현 환경 정보 기반)" }, en: { description: " (based on URL, logs, and environment)" } }`.
- `buildAiDraftSessionPrompt`: freeform 분기 추가. screenshot/video와 유사하게 설명 입력 + 로그 기반.

### 14. `src/store/issues-store.ts` — IssueRecord freeform 지원

**현재**: `IssueRecord.captureMode`는 `CaptureMode` 타입.

**변경**: 타입이 자동으로 확장됨 (`CaptureMode` 유니온 변경으로). freeform IssueRecord는:
- `snapshot: { before: false, after: false }`
- `selector`, `styleEdits`, `selectionSnapshot`, `tokensSnapshot` 없음
- `networkLogBlobKey`, `consoleLogBlobKey`는 로그 첨부 시 존재

### 15. `src/i18n/ko.ts` + `src/i18n/en.ts` — 신규 키

```typescript
// ko.ts
"issue.mode.freeform": "자유 작성",

// en.ts
"issue.mode.freeform": "Free write",
```

## 데이터 흐름

```
[EmptyState "자유 작성" 클릭]        [콘솔/네트워크 탭 PageFooter 클릭]
        │                                     │
        ▼                                     ▼
startFreeformDraft(tabId)              setSub("issue") + startFreeformDraft(tabId)
        │
        ├─ chrome.tabs.get(tabId) → url, title
        ├─ chrome.scripting.executeScript → viewport (optional)
        ├─ syncNetworkRecorder(tabId) + syncConsoleRecorder(tabId)
        └─ store.startFreeform({ tabId, url, title })
           store.setState({ freeformViewport, freeformCapturedAt })
                │
                ▼
        phase: "drafting", captureMode: "freeform"
                │
                ▼
        IssueTab renders <DraftingPanel>
        ├─ mediaBlock = null (미디어 없음)
        ├─ 이슈 섹션 편집 (Tiptap WYSIWYG)
        ├─ 로그 카드 (수동 토글)
        └─ AI 초안 (AiDraftDialog)
                │
                ▼
        confirmDraft()
        ├─ saveDraft() — IssueRecord 저장
        ├─ persistAttachedLogs() — 로그 blob 저장
        └─ (미디어 blob 저장 없음)
                │
                ▼
        phase: "previewing" → PreviewPanel → 제출
```

## 인터페이스 설계

```typescript
// editor-store.ts
export type CaptureMode = "element" | "screenshot" | "video" | "freeform";

// EditorState 추가 필드
freeformViewport: { width: number; height: number } | null;
freeformCapturedAt: number | null;

// 새 액션
startFreeform: (target: EditorTarget) => void;

// picker-control.ts
export async function startFreeformDraft(tabId: number): Promise<void>;
```

## 기존 패턴 준수

- **캡처 모드 분기 패턴**: 기존 `isVideoMode ? ... : isElementMode ? ... : ...` 체인에 `isFreeformMode` 분기를 앞에 추가.
- **PageFooter 패턴**: `Section.tsx`의 `PageFooter` 컴포넌트 그대로 사용.
- **로그 동기화 패턴**: `useBackgroundRecorder`가 이미 recorders를 주입·동기화하므로, freeform 진입 시 명시적 `syncNetworkRecorder`/`syncConsoleRecorder`만 호출.
- **i18n 동시 갱신**: ko.ts/en.ts 모두 신규 키 추가.
- **blob-db 패턴**: `persistAttachedLogs()`는 모드 무관하게 동작.
- **환경 정보 뷰포트 조회**: `chrome.scripting.executeScript`로 ISOLATED world에서 `window.innerWidth/Height` 조회 — content script 주입 없이 동작.

## 대안 검토

### 대안: `"note"` 모드명 + 기존 notes 섹션 확장

notes 섹션을 기본 활성화하고 단일 섹션 에디터로 제공하는 방안. 기각 이유: 기존 이슈 섹션 구조(description, stepsToReproduce 등)를 유지하는 것이 이슈 트래커 제출 시 더 유용하고, AI 초안 생성과도 일관된다. "자유 작성"이라는 이름이 캡처 없는 모드를 더 잘 표현한다.

### 대안: 로그 자동 첨부 (진입 경로별 분기)

콘솔 탭에서 진입 시 콘솔 로그 자동 첨부, 네트워크 탭에서 진입 시 네트워크 로그 자동 첨부하는 방안. 기각 이유: 진입 경로에 따른 암묵적 동작 차이는 혼란을 줄 수 있고, 수동 토글이 명시적이며 일관된다.

## 위험 요소

1. **unsupported URL에서의 뷰포트 조회 실패**: content script 주입이 불가한 페이지에서 `chrome.scripting.executeScript`가 실패할 수 있다. try-catch로 감싸고 viewport를 null로 처리 → 마크다운 출력에서 Viewport 줄 생략.
2. **기존 모드 분기 누락**: 5개 출력 빌더 + AI 프롬프트 + DraftingPanel + confirmDraft 모두 freeform 분기를 추가해야 한다. 하나라도 누락하면 screenshot 모드 fallback으로 빈 미디어 섹션이 렌더링될 수 있다. 각 빌더별 테스트 케이스로 검증.
3. **로그 동기화 타이밍**: freeform 진입 시 최신 로그가 store에 반영되어 있어야 한다. `startFreeformDraft`에서 명시적 sync 호출로 해결.
