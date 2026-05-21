# Element mode AI draft — user prompt 입력 — 구현 태스크

## 선행 조건

- 새 권한·env·의존성 없음.
- 기존 `buildAiDraftPrompt`(single-shot) 함수와 `AiDraftContext` 타입을 제거하는 변경이 포함됨 — 호출자는 `DraftingPanel.handleAIDraft` 한 곳뿐. grep 재확인 필요.
- 테스트는 `/tdd interface` 흐름을 권장: `buildAiDraftSessionPrompt`의 element 케이스 테스트를 먼저 작성하고 red 확인 후 구현.

## 태스크

### Task 1: `buildAiDraftSessionPrompt`에 element 케이스 테스트 추가 (TDD)

- **변경 대상**: `src/sidepanel/lib/__tests__/buildAiDraftPrompt.test.ts`
- **작업 내용**:
  - 기존 `describe("buildAiDraftSessionPrompt", ...)` 블록 안에 element 케이스 it 블록 추가.
  - 시그니처 결정: `AiDraftSessionContext`에 `selector?`, `tagName?`, `diffs?`, `tokens?`, `userPrompt?` 옵셔널 필드.
  - 케이스:
    - element 모드 + selector/tagName/diff/token 모두 채워 호출 → 결과 prompt에 `<button>`, `div.card > button`, `border-radius: current="..."`, `--token: ...` 포함.
    - element 모드 + userPrompt 없음 → prompt에 `- User context:` 줄 없음.
    - element 모드 + userPrompt 있음 → prompt에 `- User context: ...` 줄 포함.
    - element 모드 + networkLogSummary/consoleLogSummary 채워도 prompt에 로그 줄 미포함 (element는 로그 분기 안 탐).
    - element 모드: 섹션 설명에 current/desired 힌트 포함.
- **검증**:
  - [ ] `pnpm test --run src/sidepanel/lib/__tests__/buildAiDraftPrompt.test.ts` → 새 케이스 red 확인 (`buildAiDraftSessionPrompt`가 element 모드 미지원 → 시그니처/expect 불일치).

### Task 2: `buildAiDraftSessionPrompt` element 케이스 구현

- **변경 대상**: `src/sidepanel/lib/buildAiDraftPrompt.ts`
- **작업 내용**:
  - `AiDraftSessionContext.captureMode` union을 `CaptureMode`로 변경 (`element` 포함).
  - 옵셔널 필드 추가: `selector?`, `tagName?`, `diffs?`, `tokens?`, `userPrompt?`.
  - `buildAiDraftSessionPrompt` 본문에 element 분기 추가 — 기존 `buildAiDraftPrompt`(single-shot)의 element 블록을 그대로 가져옴 (selector/tagName 줄, diff 줄, token 줄).
  - 모든 모드 공통으로 `userPrompt?.trim()`이 있으면 `- User context: <userPrompt>` 한 줄 push.
  - `MODE_HINTS`의 element 힌트는 그대로 적용 (current/desired).
- **검증**:
  - [ ] Task 1 테스트 green.
  - [ ] 기존 `buildAiDraftSessionPrompt` 케이스(screenshot/video/freeform) 회귀 없음.

### Task 3: `buildAiDraftPrompt`(single-shot) 함수 + 테스트 제거 준비

- **변경 대상**: `src/sidepanel/lib/__tests__/buildAiDraftPrompt.test.ts`
- **작업 내용**:
  - `describe("buildAiDraftPrompt", ...)` 블록과 `describe("buildAiDraftPrompt — freeform", ...)` 블록을 통째로 제거.
  - `BASE_CTX`와 `AiDraftContext` import 제거.
  - (`buildAiDraftSchema` / `parseAiDraftResponse` 테스트는 보존 — 이 함수들은 계속 사용)
- **검증**:
  - [ ] `pnpm test --run src/sidepanel/lib/__tests__/buildAiDraftPrompt.test.ts` → Task 1·2 통과분 외에는 모두 그대로 또는 적게.
  - [ ] `pnpm typecheck` 통과.

### Task 4: `buildAiDraftPrompt`(single-shot) 함수 + 타입 삭제

- **변경 대상**: `src/sidepanel/lib/buildAiDraftPrompt.ts`
- **작업 내용**:
  - `export function buildAiDraftPrompt(...)` 함수 본체 삭제.
  - `export interface AiDraftContext { ... }` 삭제.
  - 두 export가 사라져도 다른 export(`getSectionDesc`, `buildAiDraftSchema`, `parseAiDraftResponse`, `buildAiDraftSessionPrompt`)는 유지.
- **검증**:
  - [ ] `pnpm typecheck`로 잔존 import 검사. `buildAiDraftPrompt`/`AiDraftContext`를 import하는 파일이 없음을 확인.

### Task 5: `AiDraftDialog`에서 모드 일반화

- **변경 대상**: `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**:
  - `captureMode` 추출 시 `as "screenshot" | "video" | "freeform"` narrowing 제거 → `CaptureMode`.
  - `handleSubmit`의 빈 입력 가드: element 모드일 때만 우회.
    ```ts
    const captureMode = useEditorStore.getState().captureMode;
    const msg = input.trim();
    if (!msg && captureMode !== "element") return;
    ```
  - `<Button disabled={!input.trim()}>` → `<Button disabled={captureMode !== "element" && !input.trim()}>`. captureMode를 store에서 컴포넌트 스코프로 끌어와 disabled 계산에 사용.
  - `getScreenshotImages` 함수를 `getModeImages(store, captureMode)`로 일반화:
    ```ts
    function getModeImages(
      store: ReturnType<typeof useEditorStore.getState>,
      captureMode: CaptureMode,
    ): string[] | undefined {
      if (captureMode === "screenshot") {
        const img = store.screenshotAnnotated ?? store.screenshotRaw;
        return img ? [img] : undefined;
      }
      if (captureMode === "element") {
        const imgs = [store.beforeImage, store.afterImage].filter(
          (s): s is string => !!s,
        );
        return imgs.length > 0 ? imgs : undefined;
      }
      return undefined;
    }
    ```
  - `images` 결정 로직 변경: `isFirstMessageRef.current` 일 때만 `getModeImages`로 결정 (screenshot의 기존 동작과 동일하게 첫 메시지에만 첨부).
  - `buildAiDraftSessionPrompt` 호출 시 element 필드 채움:
    ```ts
    const isElement = captureMode === "element";
    const systemPrompt = buildAiDraftSessionPrompt({
      captureMode,
      locale,
      url,
      pageTitle,
      selector: isElement ? store.selection?.selector : undefined,
      tagName: isElement ? store.selection?.tagName : undefined,
      diffs: isElement && store.diffs?.length ? store.diffs : undefined,
      tokens: isElement && store.tokens?.length
        ? store.tokens.map((tk) => ({ name: tk.name, value: tk.value }))
        : undefined,
      userPrompt: msg || undefined,
      networkLogSummary: ...,  // 기존 로직 (video/freeform에만)
      consoleLogSummary: ...,
      enabledSections,
    });
    ```
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] 다이얼로그 열기 → element 모드일 때 textarea 비어도 "생성" 활성.

### Task 6: `DraftingPanel`의 element 분기 + handleAIDraft 제거

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**:
  - AI 버튼 onClick의 `if (captureMode === "element") { void handleAIDraft(); } else { setAiDialogOpen(true); }`를 `setAiDialogOpen(true)` 단일 호출로 교체.
  - `handleAIDraft` 함수 본체 통째로 삭제 (`L.128-184`).
  - 관련 import 정리:
    - `buildAiDraftPrompt` import 제거.
    - `buildAiDraftSchema`, `parseAiDraftResponse`도 DraftingPanel 측에서 안 쓰면 제거 (AiDraftDialog에 이미 import됨).
    - `buildNetworkLogSummary` / `buildConsoleLogSummary`는 LogAttachmentCards 등에서 props 가공에 쓰일 가능성 있어 grep 후 결정.
    - `LlmQuotaError` / `LlmOverloadedError`는 handleAIDraft에서만 쓰였으면 제거.
  - `aiError` state와 관련 UI(`setAiError`, `<p className="...">{aiError}</p>` 같은 표시 요소가 있으면 모두 제거 — 에러 표시는 AiDraftDialog의 toast로 일원화. (`L.109-112`의 `useEffect`도 제거)
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] Chrome에서 element mode → drafting → AI 버튼 클릭 → 다이얼로그가 뜨는지.
  - [ ] screenshot/video/freeform 회귀 없는지.

## 테스트 계획

### 단위 테스트

- **신규**: `buildAiDraftSessionPrompt` element 케이스 (Task 1).
- **제거**: `buildAiDraftPrompt` 케이스 전체 (Task 3).
- **회귀**: `buildAiDraftSessionPrompt` screenshot/video/freeform 기존 케이스 전부 통과.
- **회귀**: `buildAiDraftSchema`, `parseAiDraftResponse` 케이스 전부 통과.

### 수동 테스트 (Chrome 재로드 후)

#### Element mode

- [ ] picker로 요소 선택 → 스타일 변경 → drafting 진입 → AI 버튼 클릭 → 다이얼로그가 뜬다.
- [ ] textarea 비운 채로 "생성" 클릭 → 비활성 아님(클릭 가능). LLM 호출 진행 → 초안 생성됨.
- [ ] textarea에 "다크 모드에서 텍스트 안 보임" 입력 후 "생성" → 초안 description에 입력 맥락이 반영되는지 확인.
- [ ] LLM 응답 후 다이얼로그 재열기 → 같은 세션에서 추가 prompt(예: "더 친절한 어조로 다시") → 두 번째 응답이 받아지는지 (session 캐싱 동작 확인).
- [ ] beforeImage가 없는 상태(직접 만들기 어려우면 스킵 OK): 이미지 없이 진행해도 에러 없이 초안 생성되는지.

#### 다른 모드 회귀

- [ ] screenshot 모드: 캡처 → drafting → AI 버튼 → 다이얼로그 → 빈 입력 시 "생성" 비활성 유지(기존 동작). prompt 입력 시 활성. 이미지 첨부 동작 동일.
- [ ] video 모드: 녹화 → drafting → AI 버튼 → 다이얼로그 → prompt 입력 → 콘솔/네트워크 로그가 시스템 prompt에 들어가는지 (개발자 도구 콘솔에 출력되는 prompt 확인).
- [ ] freeform 모드: drafting 진입 → AI 버튼 → 다이얼로그 → prompt 입력 → 환경 정보·로그 컨텍스트 동작 확인.

#### 에러 경로

- [ ] LLM 쿼터 초과 흉내(작은 키 사용 등)로 LlmQuotaError → toast로 안내 메시지 뜨는지.
- [ ] AI 응답이 JSON 아님 → parse 실패 toast 뜨는지.

## 구현 순서 권장

1. **Task 1** (테스트 추가, red 확인) →
2. **Task 2** (빌더 구현, Task 1 green) →
3. **Task 3** (구버전 테스트 제거) →
4. **Task 4** (구버전 함수 삭제) →
5. **Task 5** (AiDraftDialog 일반화) →
6. **Task 6** (DraftingPanel 정리)

Task 1-4는 빌더 모듈 안에서 닫혀 있어 한 번에 묶어도 OK. Task 5-6은 UI 변경이라 한 번에 묶어 검증하는 게 편하다. Task 4와 Task 6은 상호 의존 — 4 먼저 끝내야 6의 import 정리에서 잔존 에러가 정확히 보임.
