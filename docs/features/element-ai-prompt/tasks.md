# Element mode AI draft — user prompt 입력 — 구현 태스크

## 선행 조건

- 새 권한·env·의존성 없음.
- 기존 `buildAiDraftPrompt`(single-shot) 함수와 `AiDraftContext` 타입을 제거하는 변경이 포함됨 — 호출자는 `DraftingPanel.handleAIDraft` 한 곳뿐. grep 재확인 필요.
- 테스트는 `/tdd interface` 흐름을 권장: `buildAiDraftSessionPrompt` element 케이스와 `getModeImages` 순수 함수 테스트를 먼저 작성하고 red 확인 후 구현.
- 단, Task 1 단계에서 red가 **expect 실패**로 명확히 나오도록 `AiDraftSessionContext` 시그니처(union 확장 + 옵셔널 필드)는 Task 1에서 먼저 박는다. 타입 에러로 막혀 red 의미가 모호해지는 것을 회피.

## 태스크

### Task 1: `buildAiDraftSessionPrompt` element 케이스 + `getModeImages` 테스트 추가 (TDD)

- **변경 대상**: `src/sidepanel/lib/__tests__/buildAiDraftPrompt.test.ts`, `src/sidepanel/tabs/__tests__/getModeImages.test.ts` (신규)
- **작업 내용**:
  - **시그니처 선행 확장**: 먼저 `AiDraftSessionContext.captureMode`를 `CaptureMode`로 넓히고 `selector?`/`tagName?`/`diffs?`/`tokens?`/`userPrompt?` 옵셔널 필드를 추가한다(Task 2의 일부를 앞당김). 이렇게 해야 Task 1 단계의 red가 **expect 실패**로 명확히 나타난다(타입 에러로 막히지 않음).
  - 기존 `describe("buildAiDraftSessionPrompt", ...)` 블록 안에 element 케이스 it 블록 추가.
  - 신규 케이스 (element):
    - element 모드 + selector/tagName/diff/token 모두 채워 호출 → 결과 prompt에 `<button>`, `div.card > button`, `border-radius: current="..."`, `--token: ...` 포함.
    - element 모드 + userPrompt 없음 → prompt에 `- User context:` 줄 없음.
    - element 모드 + userPrompt 있음 → prompt에 `- User context: ...` 줄 포함.
    - element 모드 + networkLogSummary/consoleLogSummary 채워도 prompt에 로그 줄 미포함 (element는 로그 분기 안 탐).
    - element 모드: 섹션 설명에 current/desired 힌트 포함.
  - **이전 케이스 보존 (구 `buildAiDraftPrompt` describe 블록에서 잘라 가져옴)**:
    - `enabledSections` 변형이 출력 JSON 키 지시에 반영되는 케이스.
    - `diffs` 20개 초과 시 절삭되는 케이스.
    - `tokens` 10개 초과 시 절삭되는 케이스.
    - 이 세 안전망은 element 케이스로 재구성해 Task 3의 구버전 describe 삭제로 누락되지 않게 한다.
  - **신규 케이스 (`getModeImages` 순수 함수)** — `src/sidepanel/tabs/__tests__/getModeImages.test.ts`:
    - `screenshot` 모드 + `screenshotAnnotated` 있음 → `[annotated]` 반환.
    - `screenshot` 모드 + `screenshotAnnotated` null + `screenshotRaw` 있음 → `[raw]`.
    - `screenshot` 모드 + 둘 다 null → `undefined`.
    - `element` 모드 + `[null, null]` → `undefined`.
    - `element` 모드 + `[before, null]` → `[before]`.
    - `element` 모드 + `[null, after]` → `[after]`.
    - `element` 모드 + `[before, after]` → `[before, after]`.
    - `video`/`freeform` 모드 → `undefined`.
- **검증**:
  - [ ] `pnpm test --run src/sidepanel/lib/__tests__/buildAiDraftPrompt.test.ts` → 시그니처 확장 후 expect 실패로 red 확인.
  - [ ] `pnpm test --run src/sidepanel/tabs/__tests__/getModeImages.test.ts` → 함수 미존재로 red(import 실패).

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
  - `captureMode` 추출 시 `as "screenshot" | "video" | "freeform"` narrowing 제거 → **컴포넌트 스코프 셀렉터로 한 번만 추출** (`const captureMode = useEditorStore(s => s.captureMode);`). disabled 계산과 `handleSubmit` 내부 모두 동일 변수를 참조해 출처를 통일한다 — `useEditorStore.getState().captureMode`를 다시 읽지 않는다.
  - `handleSubmit`의 빈 입력 가드: element 모드일 때만 우회.
    ```ts
    const msg = input.trim();
    if (!msg && captureMode !== "element") return;
    ```
  - `<Button disabled={!input.trim()}>` → `<Button disabled={captureMode !== "element" && !input.trim()}>`.
  - **세션 라이프사이클** — element 모드는 매 호출마다 새 세션:
    ```ts
    const isElement = captureMode === "element";
    if (isElement || !sessionRef.current) {
      sessionRef.current = await createSession(systemPrompt);
      isFirstMessageRef.current = true;
    }
    ```
    element는 캐싱 우회 + 항상 첫 메시지 취급 → 이미지도 매 호출마다 첨부된다. screenshot/video/freeform은 기존 캐싱 동작 유지.
  - `getScreenshotImages` 함수를 **모듈 스코프 순수 함수** `getModeImages(store, captureMode)`로 추출 (`src/sidepanel/tabs/AiDraftDialog.tsx`에 export — Task 1 테스트 import 대상):
    ```ts
    export function getModeImages(
      store: Pick<ReturnType<typeof useEditorStore.getState>,
        "screenshotAnnotated" | "screenshotRaw" | "beforeImage" | "afterImage">,
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
  - `images` 결정 로직 변경: `isFirstMessageRef.current`이면 `getModeImages`로 결정. element는 매 호출마다 첫 메시지이므로 사실상 항상 첨부.
  - `buildAiDraftSessionPrompt` 호출 시 element 필드 채움 — `diffs`는 store에 없으므로 **다이얼로그 내부에서 매번 `buildStyleDiff(selection, styleEdits)` 재계산**:
    ```ts
    const isElement = captureMode === "element";
    const diffs = isElement && store.selection
      ? buildStyleDiff(store.selection, store.styleEdits)
      : undefined;
    const systemPrompt = buildAiDraftSessionPrompt({
      captureMode,
      locale,
      url,
      pageTitle,
      selector: isElement ? store.selection?.selector : undefined,
      tagName: isElement ? store.selection?.tagName : undefined,
      diffs: diffs?.length ? diffs : undefined,
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
  - [ ] Task 1의 `getModeImages` 테스트 green.
  - [ ] 다이얼로그 열기 → element 모드일 때 textarea 비어도 "생성" 활성.
  - [ ] element 모드: 다이얼로그를 두 번 열어 호출해도 두 번째 호출에 이미지·갱신된 diff가 동봉되는지 (수동).

### Task 6: `DraftingPanel`의 element 분기 + handleAIDraft 제거

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**:
  - AI 버튼 onClick 핸들러의 `if (captureMode === "element") { void handleAIDraft(); } else { setAiDialogOpen(true); }`를 `setAiDialogOpen(true)` 단일 호출로 교체.
  - `handleAIDraft` 함수 본체 통째로 삭제.
  - **import 정리 (grep 사전 확인 결과 단정)**:
    - `buildAiDraftPrompt` — 제거.
    - `buildAiDraftSchema` / `parseAiDraftResponse` — `handleAIDraft` 전용, 제거.
    - `buildNetworkLogSummary` / `buildConsoleLogSummary` — `LogAttachmentCards`는 raw `networkLog`/`consoleLog`를 받아 가공하므로 summary 헬퍼는 `handleAIDraft` 외 사용처 없음, 제거.
    - `LlmQuotaError` / `LlmOverloadedError` — `handleAIDraft` 전용, 제거.
  - `aiError` state, `setAiError` 호출, `aiError` 표시 요소, 자동 dismiss `useEffect` 모두 제거. 에러는 `AiDraftDialog`의 `toast.error`로 일원화.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] Chrome에서 element mode → drafting → AI 버튼 클릭 → 다이얼로그가 뜨는지.
  - [ ] screenshot/video/freeform 회귀 없는지.

## 테스트 계획

### 단위 테스트

- **신규**: `buildAiDraftSessionPrompt` element 케이스 + 안전망 이전 케이스(enabledSections/diff 절삭/token 절삭) (Task 1).
- **신규**: `getModeImages` 순수 함수 케이스(screenshot/element 분기, null 필터링) (Task 1).
- **제거**: `buildAiDraftPrompt` 케이스 전체 (Task 3).
- **회귀**: `buildAiDraftSessionPrompt` screenshot/video/freeform 기존 케이스 전부 통과.
- **회귀**: `buildAiDraftSchema`, `parseAiDraftResponse` 케이스 전부 통과.

### 수동 테스트 (Chrome 재로드 후)

#### Element mode

- [ ] picker로 요소 선택 → 스타일 변경 → drafting 진입 → AI 버튼 클릭 → 다이얼로그가 뜬다.
- [ ] textarea 비운 채로 "생성" 클릭 → 비활성 아님(클릭 가능). LLM 호출 진행 → 초안 생성됨.
- [ ] textarea 비운 채로 **Enter 한 번** → 빈 입력에도 제출 트리거(1-click 회복 동작) 확인.
- [ ] textarea에 "다크 모드에서 텍스트 안 보임" 입력 후 "생성" → 초안 생성됨.
- [ ] **시나리오 1 vs 2 비교**: 같은 selection으로 (a) 빈 prompt 제출 → 초안 저장 → (b) "다크 모드에서 텍스트 안 보임" prompt 제출. (b)의 description에 "다크 모드"·"텍스트" 등 입력 키워드가 등장하는지 확인. (a)에는 등장하지 않아야 정상.
- [ ] LLM 응답 후 다이얼로그 닫기 → 다시 열어 prompt 입력 → 응답 받음. element 모드는 매 호출마다 새 세션이므로 이미지가 다시 첨부됨(개발자 도구 콘솔의 prompt 로그/네트워크 페이로드 확인).
- [ ] **backToStyling 왕복**: drafting에서 AI 한 번 호출 → backToStyling → 추가 스타일 변경 → drafting 재진입 → AI 다시 호출. 두 번째 호출의 시스템 prompt에 갱신된 diff/token이 반영되는지(stale 회피 검증).
- [ ] beforeImage가 없는 상태(직접 만들기 어려우면 스킵 OK): 이미지 없이 진행해도 에러 없이 초안 생성되는지.
- [ ] **다이얼로그 기본 동작 회귀**: Esc 키로 닫힘 / 외부 클릭으로 닫힘 / IME(한글) composing 중 Enter는 제출 트리거 안 함 / Shift+Enter는 줄바꿈.

#### 다른 모드 회귀

- [ ] screenshot 모드: 캡처 → drafting → AI 버튼 → 다이얼로그 → 빈 입력 시 "생성" 비활성 유지(기존 동작). prompt 입력 시 활성. 이미지 첨부 동작 동일.
- [ ] video 모드: 녹화 → drafting → AI 버튼 → 다이얼로그 → prompt 입력 → 콘솔/네트워크 로그가 시스템 prompt에 들어가는지 (개발자 도구 콘솔에 출력되는 prompt 확인).
- [ ] freeform 모드: drafting 진입 → AI 버튼 → 다이얼로그 → prompt 입력 → 환경 정보·로그 컨텍스트 동작 확인.

#### i18n 회귀

- [ ] ko/en 토글 후 element 다이얼로그의 placeholder/disclaimer/title/Generate 버튼 텍스트가 양쪽 모두 정상 노출되는지 (본 PR에서 키 변경 없으나 안전망).

#### 에러 경로

- [ ] LLM 쿼터 초과 흉내(작은 키 사용 등)로 LlmQuotaError → toast로 안내 메시지 뜨는지.
- [ ] AI 응답이 JSON 아님 → parse 실패 toast 뜨는지.
- [ ] **toast 연속 실패 동시성**: 짧은 간격으로 2번 연속 실패 시 toast가 쌓이는지/덮어쓰는지 sonner 기본 동작 확인 (기존 `aiError` 인라인은 자동 dismiss였으니 동작 차이 인지용).

## 구현 순서 권장

1. **Task 1** (테스트 추가, red 확인) →
2. **Task 2** (빌더 구현, Task 1 green) →
3. **Task 3** (구버전 테스트 제거) →
4. **Task 4** (구버전 함수 삭제) →
5. **Task 5** (AiDraftDialog 일반화) →
6. **Task 6** (DraftingPanel 정리)

Task 1-4는 빌더 모듈 안에서 닫혀 있어 한 번에 묶어도 OK. Task 5-6은 UI 변경이라 한 번에 묶어 검증하는 게 편하다. Task 4와 Task 6은 상호 의존 — 4 먼저 끝내야 6의 import 정리에서 잔존 에러가 정확히 보임.
