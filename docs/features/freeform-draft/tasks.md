# 자유 작성 (Freeform Draft) — 구현 태스크

## 선행 조건

- 없음. 기존 코드에 신규 의존성·권한·env 추가 불필요.

## 태스크

### Task 1: 타입 + 스토어 기반

- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**:
  1. `CaptureMode` 유니온에 `"freeform"` 추가.
  2. `EditorState` 인터페이스에 `freeformViewport: { width: number; height: number } | null`과 `freeformCapturedAt: number | null` 추가.
  3. `initial` 객체에 `freeformViewport: null`, `freeformCapturedAt: null` 추가.
  4. `startFreeform(target: EditorTarget)` 액션 추가 — `set({ ...initial, captureMode: "freeform", phase: "drafting", target })`.
  5. `confirmDraft()` 내 freeform 분기를 video 분기 앞에 추가. video 분기의 `saveDraft()` + `persistAttachedLogs()` 로직을 재사용하되, 미디어 blob 저장(videoBlob/screenshotImage)과 스냅샷 처리를 제거. selection 없이도 정상 동작해야 한다.
  6. `EditorSnapshot` Pick 타입에 `freeformViewport`, `freeformCapturedAt` 포함 — 세션 영속화 시 소실 방지.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `startFreeform` 호출 시 phase가 "drafting", captureMode가 "freeform"으로 세팅

### Task 2: startFreeformDraft 헬퍼

- **변경 대상**: `src/sidepanel/picker-control.ts`
- **작업 내용**:
  1. `startFreeformDraft(tabId: number)` async 함수 추가. freeform도 기존 `isSupportedUrl` 가드를 따르므로 supported URL에서만 호출된다.
  2. `chrome.tabs.get(tabId)` → URL/title 조회.
  3. `chrome.scripting.executeScript` → 뷰포트 획득.
  4. `useEditorStore.getState().startFreeform({ tabId, url, title })` 호출 (phase를 `"drafting"`으로 먼저 전환 — 로그 클리어 방지).
  5. viewport/capturedAt을 `useEditorStore.setState()`로 세팅.
  6. `syncNetworkRecorder(tabId)` + `syncConsoleRecorder(tabId)` 호출 (phase 전환 후).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] supported URL 탭에서 호출 시 viewport가 세팅됨

### Task 3: i18n 키 추가

- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**:
  1. `"issue.mode.freeform"`: "자유 작성" / "Freeform"
- **검증**:
  - [ ] `pnpm typecheck` 통과 (i18n 타입 체크가 있다면)

### Task 4: EmptyState 버튼 추가

- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**:
  1. `EmptyState` props에 `onStartFreeform` 추가.
  2. 기존 3버튼 그리드 하단에 freeform 버튼 추가: `col-span-2`, `variant="outline"`, 아이콘 `PenLine` (lucide-react), 라벨 `t("issue.mode.freeform")`.
  3. EmptyState 렌더 위치에서 `onStartFreeform={() => void startFreeformDraft(tabId)}` 전달.
- **검증**:
  - [ ] EmptyState에 4번째 버튼 노출, 클릭 시 DraftingPanel 진입
  - [ ] 아이콘·라벨·스타일이 기존 버튼과 일관

### Task 5: 콘솔/네트워크 탭 PageFooter

- **변경 대상**: `src/sidepanel/tabs/DebugTab.tsx`, `src/sidepanel/tabs/ConsoleSubTab.tsx`, `src/sidepanel/tabs/NetworkSubTab.tsx`
- **작업 내용**:
  1. **DebugTab**: `handleStartFreeform` 콜백 정의 — `setSub("issue")` + `startFreeformDraft(tabId)`. ConsoleSubTab/NetworkSubTab에 `onStartFreeform` prop 전달.
  2. **ConsoleSubTab**: `onStartFreeform` prop 수신. `PageShell`로 전체를 감싸고 `ConsoleLogContent`가 `flex-1`로 공간 차지 + 하단에 `PageFooter` + 버튼 추가. `ConsoleLogContent`는 이미 내부에 `ScrollArea`가 있으므로 `PageScroll` 중첩은 피한다. 아이콘 `PenLine`, 라벨 `t("issue.mode.freeform")`, `variant="outline"`.
  3. **NetworkSubTab**: ConsoleSubTab과 동일 패턴.
- **검증**:
  - [ ] 콘솔 탭 하단에 PageFooter + 버튼 노출
  - [ ] 네트워크 탭 하단에 PageFooter + 버튼 노출
  - [ ] 클릭 시 이슈 서브탭으로 전환 + DraftingPanel 진입
  - [ ] 이미 drafting 중이면 기존 작업 유지/확인 패턴 따름

### Task 6: DraftingPanel freeform 렌더링

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**:
  1. `isFreeformMode = captureMode === "freeform"` 플래그 추가.
  2. `mediaBlock`: freeform이면 `null` (미디어 섹션 렌더링 안 함).
  3. `showLogCards` 조건 확인 — 이미 `captureMode !== "element"`이므로 freeform에서 로그 카드 표시됨.
  4. AI 드래프트 버튼: 기존 `captureMode === "element"` 분기에서 freeform은 else 쪽(`AiDraftDialog`)으로 자연스럽게 빠짐. 확인만.
- **검증**:
  - [ ] freeform 모드에서 미디어 블록 없이 섹션만 노출
  - [ ] 로그 카드가 존재하면 토글 가능
  - [ ] AI 초안 버튼 클릭 시 AiDraftDialog 열림

### Task 6-1: PreviewPanel freeform 프리뷰

- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**:
  1. `isFreeformMode` 플래그 추가.
  2. `handleCopyMarkdown`: freeform 분기 추가. video 모드의 ctx 생성 로직을 기반으로 미디어 관련 필드를 제거한 ctx 생성.
  3. `showLogCards`: `isVideoMode || isFreeformMode`로 확장하여 freeform에서도 로그 카드 노출.
  4. 환경 정보 렌더링: freeform일 때 DOM 섹션 생략.
- **검증**:
  - [ ] freeform 프리뷰에서 미디어 블록 없이 섹션만 노출
  - [ ] 마크다운 복사 정상 동작 (미디어 섹션 없는 출력)
  - [ ] 로그 카드 토글 표시됨

### Task 6-2: IssueCreateModal + DraftDetailDialog freeform 제출/재제출

- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**:
  1. **IssueCreateModal**: `buildCtx()`에 freeform 분기를 video 분기 앞에 추가. 미디어 관련 필드 없이 환경 정보 + 로그만 포함하는 `MarkdownContext` 생성. selection 없이도 정상 동작.
  2. **DraftDetailDialog**: `isFreeform` 플래그 추가. `buildCtxForSubmit()`에 freeform 분기 추가 (IssueCreateModal과 동일 패턴). 로그 로딩 조건을 `isVideo || isFreeform`으로 확장.
- **검증**:
  - [ ] freeform 이슈 4개 플랫폼(Jira/GitHub/Linear/Notion) 제출 정상
  - [ ] IssueListTab에서 freeform 이슈 클릭 후 DraftDetailDialog에서 재제출 정상
  - [ ] 로그가 재제출 시에도 포함됨

### Task 6-3: IssueListTab freeform 노출

- **변경 대상**: `src/sidepanel/tabs/IssueListTab.tsx`
- **작업 내용**:
  1. `displayable` 필터 조건에 `|| i.captureMode === "freeform"` 추가.
- **검증**:
  - [ ] freeform draft 이슈가 IssueListTab 목록에 노출됨
  - [ ] freeform submitted 이슈도 정상 노출

### Task 7: 출력 빌더 freeform 분기 (Markdown + HTML)

- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`
- **작업 내용**:
  1. `MarkdownContext.captureMode` 인라인 유니온(`"element" | "screenshot" | "video"`)에 `"freeform"` 추가. (현재 `CaptureMode` 타입을 import하지 않고 하드코딩되어 있음.)
  2. `emitMedia()`: freeform이면 미디어 섹션 생략 (빈 배열).
  3. Environment 섹션: freeform일 때 DOM 줄 생략 + viewport가 null이면 Viewport 줄 생략.
  4. `buildIssueHtml()`에도 동일 로직 적용.
  5. 메타 코멘트(JSON): freeform이면 selector/tagName/classListBefore/After/specifiedStyles/cssChanges/tokens 생략.
  6. `buildAiMetaAttachment(ctx)`: viewport가 null일 때 `ctx.viewport.width` 접근에서 런타임 에러 방지. null 체크 추가.
- **검증**:
  - [ ] freeform 컨텍스트로 `buildIssueMarkdown` 호출 시 미디어 섹션 없는 마크다운 출력
  - [ ] `buildIssueHtml` freeform 케이스 정상
  - [ ] viewport null일 때 Viewport 줄 없음
  - [ ] `buildAiMetaAttachment` viewport null에서 에러 없음
  - [ ] 단위 테스트 추가 (buildIssueMarkdown + buildIssueHtml 모두)

### Task 8: 출력 빌더 freeform 분기 (ADF)

- **변경 대상**: `src/sidepanel/lib/buildIssueAdf.ts`
- **작업 내용**: Task 7과 동일 패턴 — freeform이면 미디어 heading/content 노드 생략, DOM 생략.
- **검증**:
  - [ ] freeform 컨텍스트로 `buildIssueAdf` 호출 시 미디어 노드 없는 ADF 출력
  - [ ] 단위 테스트 추가

### Task 9: 출력 빌더 freeform 분기 (GitHub / Linear / Notion)

- **변경 대상**: `src/sidepanel/lib/buildGithubIssueBody.ts`, `src/sidepanel/lib/buildLinearIssueBody.ts`, `src/sidepanel/lib/buildNotionIssueBody.ts`
- **작업 내용**: 각 빌더에 freeform 분기 추가. 공통: 미디어 섹션 생략, DOM 생략, viewport null 처리.
- **검증**:
  - [ ] 3개 빌더 모두 freeform 컨텍스트에서 미디어 없는 정상 출력
  - [ ] 단위 테스트 추가

### Task 10: AI 드래프트 프롬프트 + AiDraftDialog freeform 분기

- **변경 대상**: `src/sidepanel/lib/buildAiDraftPrompt.ts`, `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**:
  1. `AiDraftSessionContext.captureMode` 유니온에 `"freeform"` 추가 (`"screenshot" | "video"` → `"screenshot" | "video" | "freeform"`).
  2. `buildAiDraftPrompt()`: freeform 컨텍스트 추가. video 모드의 로그 컨텍스트 로직(네트워크 에러, 콘솔 에러/경고)을 freeform에서도 사용.
  3. `MODE_HINTS`에 freeform 추가: `{ ko: { description: " (URL, 로그 등 재현 환경 정보 기반)" }, en: { description: " (based on URL, logs, and environment)" } }`.
  4. `buildAiDraftSessionPrompt()`: freeform 분기 추가. video와 유사하게 설명 입력 기반 + 로그 포함. 미디어 참조 제거.
  5. **AiDraftDialog**: `store.captureMode as "screenshot" | "video"` 캐스팅 제거. 유니온을 `"screenshot" | "video" | "freeform"`으로 확장. freeform 분기에서 video와 같이 로그 컨텍스트를 포함.
- **검증**:
  - [ ] freeform 컨텍스트로 프롬프트 생성 시 로그 요약 포함 확인
  - [ ] AiDraftDialog에서 freeform 모드일 때 세션 프롬프트 정상 생성
  - [ ] 단위 테스트 추가

## 테스트 계획

### 단위 테스트

아래 순수 함수에 freeform 케이스를 추가:

| 대상 함수 | 테스트 파일 | 케이스 |
|-----------|------------|--------|
| `buildIssueMarkdown` | `src/sidepanel/lib/__tests__/buildIssueMarkdown.test.ts` | freeform: 미디어 섹션 없음, DOM 없음, viewport null 처리 |
| `buildIssueHtml` | `src/sidepanel/lib/__tests__/buildIssueMarkdown.test.ts` | freeform: 미디어 없음, viewport null 처리 |
| `buildIssueAdf` | `src/sidepanel/lib/__tests__/buildIssueAdf.test.ts` | freeform: 미디어 노드 없음 |
| `buildGithubIssueBody` | `src/sidepanel/lib/__tests__/buildGithubIssueBody.test.ts` | freeform: 미디어 없음 |
| `buildLinearIssueBody` | `src/sidepanel/lib/__tests__/buildLinearIssueBody.test.ts` | freeform: 미디어 없음 |
| `buildNotionIssueBody` | `src/sidepanel/lib/__tests__/buildNotionIssueBody.test.ts` | freeform: 미디어 없음 |
| `buildAiDraftPrompt` | `src/sidepanel/lib/__tests__/buildAiDraftPrompt.test.ts` | freeform: 로그 컨텍스트 포함 |

테스트 파일이 없으면 신규 생성. 기존 테스트가 있으면 freeform 케이스 추가.

### 수동 테스트 (Chrome 확장 로드)

- [ ] EmptyState에서 "자유 작성" 클릭 → DraftingPanel 진입, 미디어 블록 없음
- [ ] 콘솔 탭에서 "자유 작성" 클릭 → 이슈 탭 전환 + DraftingPanel 진입
- [ ] 네트워크 탭에서 "자유 작성" 클릭 → 이슈 탭 전환 + DraftingPanel 진입
- [ ] 제목 입력 + 섹션 편집 + 인라인 이미지 드래그 앤 드롭 정상 동작
- [ ] 로그 카드 토글 ON/OFF + 프리뷰에서 로그 요약 노출/비노출
- [ ] AI 초안 생성: 환경 정보 + 로그 기반 초안 생성 확인
- [ ] 프리뷰 → 마크다운 복사: 미디어 섹션 없는 올바른 마크다운
- [ ] Jira 제출: ADF에 미디어 노드 없음
- [ ] GitHub 제출: 이미지/비디오 없이 텍스트만
- [ ] Linear 제출: 미디어 섹션 없음
- [ ] Notion 제출: 미디어 블록 없음
- [ ] IssueListTab에서 freeform 이슈(draft/submitted) 목록 노출 정상
- [ ] IssueListTab에서 freeform 이슈 클릭 → DraftDetailDialog에서 재편집·재제출 정상
- [ ] 다른 모드로 drafting 중일 때 freeform 버튼 동작 확인
- [ ] 세션 영속화: freeform drafting 중 사이드패널 닫았다 열면 viewport 정보 유지

## 구현 순서 권장

```
Task 1 (타입+스토어) → Task 2 (헬퍼) → Task 3 (i18n)
                                         ↓
                              Task 4 (EmptyState)    ─┐
                              Task 5 (PageFooter)     │
                              Task 6 (DraftingPanel)  ├─ 병렬 가능
                              Task 6-1 (PreviewPanel) │
                              Task 6-3 (IssueListTab) ┘
                                         ↓
                    Task 7~9 (출력 빌더) ─── 병렬 가능
                                         ↓
                    Task 6-2 (IssueCreateModal+DraftDetailDialog)
                    Task 10 (AI 프롬프트+AiDraftDialog)
```

Task 1~3이 기반 인프라. Task 4~6, 6-1, 6-3은 UI로 서로 독립적이므로 병렬 가능. Task 7~9도 빌더별 독립이므로 병렬 가능. Task 6-2는 빌더 시그니처(`MarkdownContext`)에 의존하므로 빌더 이후. Task 10은 AI 관련 변경으로 마지막.
