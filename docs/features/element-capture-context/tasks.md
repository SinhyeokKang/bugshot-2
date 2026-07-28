# Element 캡처 컨텍스트 확장 — 구현 태스크

## 선행 조건

- 권한·env·외부 API 변경 **없음**. `manifest.config.ts` 손대지 않는다.
- i18n 사전 변경 **없음** (UI 문구 추가 없음).
- 착수 전 `docs/POSTMORTEM.md`를 `picker`·`capture`·`crop`·`iframe`으로 grep해 과거 함정을 소환한다.
- `src/content/picker.ts`는 pre-arm 제약이 걸린 `recorders-entry`와 **다른 파일**이라 self-contained 청크 제약과 무관하다. 다만 `capture-context.ts`를 `picker.ts`가 static import 하는 것은 정상 경로다.

## 태스크

### Task 1: 확장 판정 순수 함수 테스트 작성 (TDD red)

- **변경 대상**: `src/content/__tests__/capture-context.test.ts` (신규), `src/content/__tests__/capture-context.test.tsx` (신규)
- **작업 내용**: 구현 전에 테스트를 먼저 작성한다. 두 트랙으로 나눈다.
  - `.test.ts` (node) — `passesContextGates` 산술 검증
  - `.test.tsx` (jsdom) — `findContextAncestor` DOM 탐색 검증. `position`·`z-index`는 인라인 스타일로 지정한다(jsdom stylesheet 해석 한계).
- **검증**:
  - [ ] `pnpm test` 실행 시 두 파일이 "함수 없음"으로 실패한다(red 확인)
  - [ ] 아래 테스트 계획의 케이스가 모두 포함돼 있다

### Task 2: `capture-context.ts` 구현 (green)

- **변경 대상**: `src/content/capture-context.ts` (신규)
- **작업 내용**: `CONTEXT_MAX_VIEWPORT_RATIO`, `OVERLAY_SELECTOR`, `STRUCTURE_SELECTOR`, `findContextAncestor`, `passesContextGates`를 design.md 시그니처대로 구현. rect 측정은 하지 않는다(인자로 받는다).
- **검증**:
  - [ ] Task 1의 테스트가 전부 통과
  - [ ] `pnpm typecheck` 통과
  - [ ] 모달 안 `<tr>` 케이스에서 다이얼로그가 아니라 `<tr>`이 반환됨(최근접 우선)

### Task 3: picker 타입 확장

- **변경 대상**: `src/types/picker.ts`
- **작업 내용**: `PrepareCaptureResponse`에 `contextSelector?: string | null` 추가. `PickerMessage` 유니온의 `picker.prepareCapture`에 `contextSelector?: string` 추가.
- **검증**:
  - [ ] `pnpm typecheck` 통과 (기존 호출부가 optional이라 깨지지 않음)

### Task 4: picker.ts에 확장 판정 통합

- **변경 대상**: `src/content/picker.ts`
- **작업 내용**:
  - `handlePrepareCapture(msg)`가 메시지를 받도록 시그니처 변경 (`:353`, 호출부 `:241~246`)
  - `msg.contextSelector`가 있으면 `document.querySelector`로 조상을 찾아 `viewportRectOf`로 재측정. 못 찾으면 폴백 경로로 진행
  - 없으면 `findContextAncestor` → `passesContextGates` 순으로 판정. 통과 시 조상 rect + `buildSelector(조상)`(`dom-describe.ts:10`), 미달 시 요소 rect + `null`
  - `handlePrepareCaptureBySelector`(`:369`)도 동일 판정을 적용한다 (StyleChangesDialog 재캡처 경로)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] iframe 경로에서 `respondWithTopRect`가 `contextSelector`를 소실시키지 않음 (`:325` 응답 조립 확인)
  - [ ] `contextSelector`가 주어지면 `findContextAncestor`를 호출하지 않음(판정 재실행 없음)

### Task 5: capture.ts 반환 타입 변경 + 0×0 폴백

- **변경 대상**: `src/sidepanel/capture.ts`
- **작업 내용**:
  - `CaptureContext`·`CaptureResult` 타입 export
  - `captureElementSnapshot`·`captureElementSnapshotBySelector`에 `context?: CaptureContext` 옵션 추가, 반환을 `CaptureResult | null`로 변경
  - `prepareCapture`/`prepareCaptureBySelector` 호출 시 `contextSelector` 전달 (`picker-control.ts:492`, `:505` 시그니처도 확장)
  - `captureWithPrep`에서 rect가 0×0이고 `options.context`가 있으면 `context.rect`·`context.viewport`로 대체
- **검증**:
  - [ ] `pnpm typecheck`가 호출부 5곳에서 타입 에러를 낸다(다음 태스크가 고칠 지점 확인)
  - [ ] 0×0 대체 시 `context.viewport`를 함께 쓴다(`cropImage`가 scale 유도에 viewport를 쓰므로 rect만 바꾸면 배율이 어긋남)

### Task 6: store에 캡처 컨텍스트 저장

- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**:
  - `EditorState`에 `captureContext: CaptureContext | null` 추가, 초기값 `null`
  - `setCaptureContext` 액션 추가
  - `BufferedElement`에 `captureContext?: CaptureContext` 추가
  - `bufferCurrentElement(afterImage, context?)`로 시그니처 확장 (`:234`, `:645`)
  - `reset`·`backToStyling`(`:709`)·요소 재선택 시 `captureContext` 초기화
  - 버퍼 승격 경로(`:580~`)에서 `beforeImage`·`afterImage`와 함께 복원
  - `IssueRecord` 직렬화(`:855~`)는 **손대지 않는다** — 이미지 자체가 boolean 플래그만 남기는 구조라 컨텍스트도 세션 한정으로 둔다
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 `src/store/__tests__/editor-store.test.ts`가 계속 통과 (`bufferCurrentElement` 인자 추가가 optional이라 기존 호출 유지)
  - [ ] 요소 재선택 후 `captureContext`가 `null`로 초기화됨을 단위 테스트로 확인

### Task 7: 호출부 연결

- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/tabs/StyleEditorPanel.tsx`, `src/sidepanel/hooks/useBufferThenSwitch.ts`, `src/sidepanel/tabs/styleEditor/StyleChangesDialog.tsx`
- **작업 내용**:
  - `usePickerMessages.ts:143` (before) — `result.image`를 `setBeforeImage`에, `result.context`를 `setCaptureContext`에
  - `usePickerMessages.ts:90` `captureElementShot` — **스코프 밖**. `.image`만 꺼내 쓰도록 최소 수정
  - `StyleEditorPanel.tsx:156` (after) — `context: store.captureContext` 전달, `result.image`를 `setAfterImage`에
  - `useBufferThenSwitch.ts:22` — `context` 전달 + `bufferCurrentElement(after.image, after.context)`
  - `StyleChangesDialog.tsx:95` — `group.captureContext` 전달, 재캡처 결과로 `afterImage` patch
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 전체 통과
  - [ ] `captureElementShot` 경로가 기존과 동일하게 동작(요소 단일 캡처 회귀 없음)

### Task 8: e2e spec 작성

- **변경 대상**: `e2e/` (신규 spec), 필요 시 `src/`에 `data-testid` 추가만
- **작업 내용**: 아래 e2e 시나리오를 Playwright spec으로 작성한다. `/e2e-write`로 처리.
- **검증**:
  - [ ] `pnpm build:e2e` 후 `pnpm test:e2e` green
  - [ ] 1회 재실행에서도 green (플레이크 확인)

## 테스트 계획

### 단위 테스트

**`capture-context.test.tsx` (jsdom) — `findContextAncestor`**

| 케이스 | 기대 |
|---|---|
| Radix형 모달: `[role="dialog"]` 안 버튼 | 다이얼로그 반환 |
| 손수 백드롭: `position:fixed; z-index:50` 부모 + 안쪽 static div + 버튼 | 백드롭 반환 (게이트가 이후 거름) |
| `<table><tr><td>` 안 배지 | `<tr>` 반환 |
| **모달 안 테이블 셀** | `<tr>` 반환 (다이얼로그 아님 — 최근접 우선) |
| `<li>` 안 버튼 | `<li>` 반환 |
| `<form>` 안 input | `<form>` 반환 |
| `[role="tabpanel"]` 안 요소 | tabpanel 반환 |
| 시맨틱 없는 div 체인 | `null` |
| 요소 자신이 `<li>`이고 상위에 아무것도 없음 | `null` (자신 제외) |
| `position:absolute`이지만 `z-index:auto` | 신호로 인정 안 함 |

**`capture-context.test.ts` (node) — `passesContextGates`**

| 케이스 | 기대 |
|---|---|
| 완전 포함 + 면적 30% | `true` |
| 완전 포함 + 면적 50% | `false` (40% 초과) |
| 면적 정확히 40% | `true` (경계 포함) |
| 요소가 컨테이너 밖으로 삐져나감 | `false` |
| 컨테이너가 뷰포트 위로 벗어나 클램프 후 요소 상단이 잘림 | `false` |
| `viewport.width` 0 | `false` |
| 컨테이너 rect가 음수 좌표에서 시작 | 클램프 후 판정 |

**`editor-store.test.ts` 추가**

- 요소 재선택 시 `captureContext`가 `null`로 초기화된다
- `bufferCurrentElement(image, context)`가 버퍼 항목에 `captureContext`를 실는다
- 버퍼 승격 시 `captureContext`가 복원된다

### e2e 시나리오

`/e2e-write`의 입력. 픽스처 페이지에 모달·테이블·시맨틱 없는 div를 배치한다.

- 모달 다이얼로그 안 버튼을 편집하고 다음 단계로 진행하면, after 이미지의 폭이 편집한 버튼 폭보다 크다
- 테이블 셀 안 요소를 편집하면, after 이미지의 폭이 테이블 행 폭 이상이다
- 시맨틱 컨테이너가 없는 div 안 요소를 편집하면, after 이미지 폭이 요소 폭 + 48px 이내다 (폴백 확인)
- 요소를 `display:none`으로 바꾸고 진행하면, after 이미지가 24×24보다 크다
- 풀스크린 백드롭(`fixed; inset:0`) 안 요소를 편집하면, after 이미지 폭이 뷰포트 폭보다 작다 (과확장 차단)
- 요소를 편집한 뒤 페이지를 스크롤하고 다음 단계로 진행해도, after 이미지에 편집한 요소가 포함된다

### 수동 테스트

`pnpm build` 선행 필요 (dist stale 방지).

- [ ] 실제 사이트의 모달(예: GitHub 삭제 확인 다이얼로그)에서 버튼 편집 → 다이얼로그 전체가 담기는지 시각 확인
- [ ] 실제 테이블(예: GitHub 파일 목록)에서 셀 편집 → 행 전체가 담기는지
- [ ] `display:none` 편집 후 before/after를 나란히 보고 "빠져서 당겨진" 모습이 읽히는지
- [ ] iframe(1-depth) 내부 요소 편집 → 확장이 iframe 문서 안에서 끝나고 좌표가 어긋나지 않는지
- [ ] 여러 요소를 버퍼에 담고 이슈 본문의 요소별 before/after 표가 각각 올바른 컨테이너로 찍혔는지
- [ ] `StyleChangesDialog`에서 행 초기화 후 재캡처된 after가 같은 컨테이너인지
- [ ] 40% 상한이 실제로 적정한지 — 넓은 모니터·좁은 창 양쪽에서 확인 후 필요 시 조정

## 구현 순서 권장

```
Task 1 (테스트 red)
   ↓
Task 2 (green)  ─┐
Task 3 (타입)   ─┴→ Task 4 (picker 통합)
                        ↓
                   Task 5 (capture.ts)
                        ↓
                   Task 6 (store)
                        ↓
                   Task 7 (호출부)
                        ↓
                   Task 8 (e2e)
```

- Task 2와 Task 3은 서로 독립이라 **병렬 가능**.
- Task 5가 타입 에러를 의도적으로 발생시키고 Task 7이 해소하므로, 두 태스크 사이에서는 `pnpm typecheck`가 실패하는 것이 정상이다.
- Task 4까지 끝나면 picker 단독으로 확장이 동작하므로, Task 5~7 전에 임시로 `console.log`를 넣어 판정 결과를 눈으로 확인할 수 있다.

## 가이드 영향

**본문 텍스트 변경 없음.** `guide/ko/element/`·`guide/en/element/`는 before/after 개념만 설명하고 캡처 범위를 구체적으로 명시한 문장이 없다(`README.md:3,5`, `issue.md:15~21`, `styling.md:97` 확인).

다만 `guide/ko/assets/element-issue-2.jpg`(before/after 스타일 비교 예시 스크린샷)가 새 캡처 범위와 달라질 수 있다. 실물 확인 후 예시 이미지가 눈에 띄게 어긋나면 `/guide`로 재촬영을 검토한다 — 텍스트 수정은 불필요하므로 우선순위는 낮다.
