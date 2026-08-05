# 피커 조준 UX — 구현 태스크

## 선행 조건

- **착수 전 `docs/POSTMORTEM.md`를 `picker`·`오버레이`·`Kbd`로 grep** — 특히 2026-07-18(`Kbd`에 `truncate`/`justify-center` 함정)·2026-07-20(mono 통일이 `Kbd` base에 가려진 칩을 빠뜨림)을 읽는다.
- **`e2e/GOTCHAS.md`를 읽는다** — picker 관련 spec은 재arm 레이스가 있어 `pickElement` 헬퍼가 클릭을 재시도한다.
- 권한·env·의존성 변경 **없음**.
- 다른 두 기능(`css-cascade-fidelity`·`ua-default-baseline`)과 **완전 독립**이다. `css-resolve.ts`를 공유하지만 건드리는 함수가 다르다(이쪽은 `collectInspectorInfo` 계열, 저쪽은 `collectRulesForElement`·`selectorSpecificity`).

---

## 태스크

### Task 1: DOM 탐색 순수 함수 (테스트 먼저)

- **변경 대상**: `src/content/dom-nav.ts`(신규), `src/content/__tests__/dom-nav.test.ts`(신규)
- **작업 내용**:
  - 테스트 먼저 작성해 red를 만든다.
  - `stepFrom(from, dir, skip)` — `parent`/`child`/`prev`/`next` 4방향. `skip(el)`이 true면 **그 방향으로 계속 진행**한다(건너뛰기이지 중단이 아니다). `child`는 `firstElementChild`에서 시작해 `nextElementSibling`으로 이어간다.
  - `isTextEntryTarget(target)` — `input`/`textarea`/`select`/`contenteditable` 판정.
  - **`document`·`window`에 접근하지 않는다** — 인자로 받은 요소의 프로퍼티만 읽어야 node 환경에서 스텁으로 테스트된다. 신규 파일은 **`BROWSER_BOUND_EXACT`에 넣지 않는다**(순수 로직이므로 커버리지 지표에 남긴다).
- **검증** — 단위 테스트:
  - [ ] `parent`: 부모 반환 / 부모 없으면 `null`
  - [ ] `child`: 첫 자식 반환 / 자식 없으면 `null`
  - [ ] `prev`/`next`: 형제 반환 / 없으면 `null`
  - [ ] `skip`이 true인 형제를 건너뛰고 그다음 형제를 반환
  - [ ] `skip`이 true인 첫 자식을 건너뛰고 다음 자식을 반환
  - [ ] 모든 후보가 `skip`이면 `null`
  - [ ] `isTextEntryTarget`: `input`/`textarea`/`contenteditable=true` → true, `div`/`button`/`null` → false
  - [ ] `pnpm test` + `pnpm typecheck` 통과

### Task 2: 키보드 탐색 + freeze 배선

- **변경 대상**: `src/content/picker.ts`, `src/content/overlay.ts`
- **작업 내용**:
  - `frozen` 모듈 상태 + `setFrozen` 추가. `setMode`·`handleClear`에서 `false`로 초기화.
  - `onKeyDown` 재작성 (design.md 골자). **modifier 키가 눌린 조합은 즉시 반환** — 페이지·브라우저 단축키 보존.
  - `navigateHover(dir)` — `stepFrom` 호출 + `setFrozen(true)` + `render()`.
  - `commitHover(target)` 추출 — `onClickCommit`의 커밋 본체를 함수로 빼서 클릭·Enter가 공유.
  - `onMouseMove` 첫 줄 다음 `if (frozen) return;`, `onMouseOut`에 `if (frozen) return;`.
  - `onClickCommit`의 target 획득을 `frozen ? lastHover : elementAtPoint(...)`로.
  - `overlay.ts`에 `setOutlineFrozen(h, on)` — `borderEl` stroke `#2563eb` ↔ `#f59e0b`, 배너 앞에 `⏸ `. frozen 상태를 overlay 모듈에 들고 있다가 `updateBanner`가 다시 쓸 때도 유지한다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: hover 중 <kbd>↑</kbd> 4회 → 조상 4단계까지 올라가고 테두리가 amber로 바뀐다
  - [ ] 수동: frozen 상태에서 마우스를 크게 움직여도 대상이 안 바뀐다
  - [ ] 수동: <kbd>Space</kbd>로 해제하면 다시 마우스를 따라간다
  - [ ] 수동: <kbd>Enter</kbd>로 확정하면 클릭 확정과 같은 결과(스타일 패널 진입)
  - [ ] **수동: picking 중 페이지 자체 단축키(예: 검색 사이트의 `/`)가 여전히 동작한다** — G5 검증
  - [ ] 수동: `<html>`에서 <kbd>↑</kbd>를 눌러도 오버레이 호스트가 선택되지 않는다 (E1)
  - [ ] `pnpm test:e2e -- picker-` green

### Task 3: 사이드패널 조작 힌트

- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`, `src/i18n/namespaces/issue.ts`
- **작업 내용**:
  - **먼저 `IssueTab.tsx:296-306`(capture-unsupported 분기)을 읽고 간격·타이포 패턴을 그대로 따른다.** `EmptyShell`은 제목↔본문 간격을 주지 않아 `mt-1`을 직접 붙여야 한다(그 자리 주석이 근거).
  - `PickingState`의 `EmptyShell`에 힌트 2줄을 `children`으로 추가.
  - 키 표기는 `src/components/ui/kbd.tsx`. **`Kbd`에 `truncate`·폭 제약을 걸지 않는다**(POSTMORTEM 2026-07-18 — `inline-flex`라 ellipsis가 안 뜨고 `justify-center`가 양끝을 자른다).
  - i18n 키 4개(`issue.picking.hint.navigate`·`.freeze`)를 **ko/en 동시** 추가.
- **검증**:
  - [ ] `src/i18n/` 저장 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행하고 통과 (키 대칭·빈 값·placeholder)
  - [ ] 사이드패널 폭을 최소까지 줄여도 `Kbd`가 잘리거나 줄바꿈이 깨지지 않는다
  - [ ] 다크 모드에서 힌트 텍스트 대비가 읽힌다
  - [ ] ko/en 전환 시 양쪽 문구가 뜬다

### Task 4: 실렌더 폰트 판정

- **변경 대상**: `src/content/css-resolve.ts`, `src/content/overlay.ts`, `src/content/__tests__/css-resolve.test.ts`
- **작업 내용**:
  - **테스트 먼저**: `parseFontStack`·`resolveRenderedFamily`를 red로 만든다.
  - `parseFontStack(declared)` — 콤마 분리 + 따옴표 제거 + 트림. 값 안 콤마(따옴표 내부)를 보존한다.
  - `resolveRenderedFamily(stack, isRendered)` — 첫 통과 family 반환. 전부 실패하면 마지막 항목 + `fallback: true`. 빈 스택이면 `{ family: "", fallback: false }`.
  - `makeFontProbe()` — canvas + `document.fonts.check` 조합. **모듈 스코프 lazy 캐시**(canvas 1개 재사용). 컨텍스트나 `document.fonts`가 없으면 `null` 반환 → 호출부가 오늘 동작으로 폴백(E7).
  - `InspectorInfo`에 `fontRendered`·`fontFallback` 추가하고 `collectInspectorInfo`가 채운다.
  - `buildInspectorHtml`이 `fontFallback`일 때 `선언 → 렌더` 표기.
- **검증** — 단위 테스트:
  - [ ] `parseFontStack('Pretendard, -apple-system, "Noto Sans KR", sans-serif')` → 4개, 따옴표 제거됨
  - [ ] `parseFontStack('"Font, With Comma", serif')` → 2개 (따옴표 안 콤마 보존)
  - [ ] `parseFontStack("")` → `[]`
  - [ ] `resolveRenderedFamily(["A","B"], f => f === "B")` → `{ family: "B", fallback: true }`
  - [ ] `resolveRenderedFamily(["A","B"], f => f === "A")` → `{ family: "A", fallback: false }`
  - [ ] `resolveRenderedFamily(["A","B"], () => false)` → `{ family: "B", fallback: true }`
  - [ ] `resolveRenderedFamily([], () => true)` → `{ family: "", fallback: false }`
  - [ ] 수동: 존재하지 않는 폰트를 선언한 fixture에서 카드에 `→`가 뜬다
  - [ ] 수동: 실제로 로드된 폰트(Pretendard가 있는 페이지)에서는 `→`가 뜨지 않는다

### Task 5: 오버레이 자가치유

- **변경 대상**: `src/content/picker.ts`
- **작업 내용**:
  - `startHostObserver`/`stopHostObserver`/`healOverlay` 추가 (design.md 골자).
  - `handleStart`에서 `startHostObserver()` + `healCount = 0`.
  - **`handleClear`에서 `stopHostObserver()`를 `destroyOverlay`보다 먼저** 부른다 — 순서가 뒤집히면 정상 종료를 탬퍼로 오인해 되살린다.
  - `healOverlay` 안에서 `removeHoverListeners()` → `destroyOverlay()` → `createOverlay()` → `addHoverListeners()` → `setMode(wasMode)` 순서를 지킨다 (리스너 이중 등록 방지).
  - `MAX_HEAL = 3` 초과 시 `handleClear()` + `picker.cancelled` 발신.
- **검증**:
  - [ ] 수동: picking 중 콘솔에서 `document.getElementById("__bugshot_picker_overlay__").remove()`(실제 `HOST_ID` 확인) → 오버레이가 되살아나고 마우스 추적이 이어진다
  - [ ] 수동: 되살아난 뒤 클릭 확정이 정상 동작한다 (리스너 재바인딩 확인)
  - [ ] 수동: 4회 연속 제거하면 picking이 종료되고 사이드패널이 취소 상태로 간다
  - [ ] **e2e: 세션 정상 종료 후 오버레이가 되살아나지 않는다** (탬퍼 오인 방지 — 위험 2)
  - [ ] `pnpm test:e2e -- picker-guard hover-shield` green

---

## 테스트 계획

### 단위 테스트

| 대상 | 파일 | 케이스 |
|---|---|---|
| `stepFrom` / `isTextEntryTarget` | `content/__tests__/dom-nav.test.ts` (신규) | Task 1 검증 항목 7건 |
| `parseFontStack` / `resolveRenderedFamily` | `content/__tests__/css-resolve.test.ts` | Task 4 검증 항목 7건 |

`frozen` 상태 전이·MutationObserver 자가치유는 `picker.ts` 안이고 브라우저 실동작에 걸려 **유닛 대상이 아니다**. e2e와 수동이 그물이다.

### e2e 시나리오 (`/e2e-write`의 입력)

신규 spec `e2e/picker-keyboard-nav.spec.ts`. fixture는 `e2e/fixtures/pages/basic.html`에 중첩 구조(`div > span > button`)와 형제 리스트를 추가한다.

1. picking 중 요소에 hover한 뒤 <kbd>ArrowUp</kbd>을 누르면 **하이라이트 대상이 부모 요소로 바뀐다**.
2. <kbd>ArrowUp</kbd> 후 마우스를 다른 요소 위로 옮겨도 **하이라이트 대상이 바뀌지 않는다** (freeze 자동 활성).
3. <kbd>Space</kbd>를 누른 뒤 마우스를 옮기면 **하이라이트가 다시 마우스를 따라간다**.
4. <kbd>ArrowRight</kbd>를 누르면 **다음 형제 요소로 이동한다**.
5. frozen 상태에서 <kbd>Enter</kbd>를 누르면 **클릭 확정과 같이 스타일 편집 패널로 진입한다** (`repick` 노출로 판정).
6. picking 중 <kbd>KeyF</kbd>처럼 우리가 안 쓰는 키를 누르면 **페이지의 keydown 핸들러가 그 키를 받는다** (fixture에 카운터를 두고 단언 — G5).
7. `<html>`까지 <kbd>ArrowUp</kbd>으로 올라간 뒤 <kbd>ArrowDown</kbd>을 눌러도 **오버레이 호스트가 선택되지 않는다** (`isOwnUi` 건너뛰기).
8. picking 세션을 정상 종료하면 **오버레이 호스트가 다시 나타나지 않는다** (자가치유 오작동 방지).
9. picking 중 오버레이 호스트를 스크립트로 제거하면 **오버레이가 다시 나타나고 이후 클릭 확정이 동작한다**.

기존 `picker-guard.spec.ts`·`picker-iframe.spec.ts`·`hover-shield.spec.ts`·`dom-tree-nav.spec.ts`는 무수정 green이 목표다.

### 수동 테스트 (Chrome)

`pnpm build` 선행 필요 — dist가 stale이면 헛테스트다.

- [ ] 아이콘 버튼(`<button><svg><path>`)에서 <kbd>↑</kbd> 2회로 `<button>`에 도달하는지
- [ ] 리스트에서 <kbd>←</kbd>/<kbd>→</kbd>로 형제를 훑을 때 인스펙터 카드가 매번 갱신되는지
- [ ] frozen 중 커서를 사이드패널로 옮겨도 하이라이트가 유지되는지 (`onMouseOut` 가드)
- [ ] 검색 사이트에서 picking 중 `/`·`j`·`k` 같은 페이지 단축키가 살아 있는지
- [ ] 스크롤 양보 창(휠 직후 120ms) 안에서 <kbd>Space</kbd>를 눌러도 페이지가 안 밀리는지 (위험 4)
- [ ] 웹폰트를 쓰는 사이트와 안 쓰는 사이트에서 `font` 행 표기 비교
- [ ] SPA(React Router 등)에서 라우트를 전환해 오버레이가 살아나는지
- [ ] 1-depth iframe 안에서 화살표 탐색이 그 프레임 안에서만 동작하는지 (E5)

## 구현 순서 권장

```
Task 1 (순수 탐색) ──► Task 2 (키보드 배선) ──► Task 3 (힌트 UI)
Task 4 (폰트)      ──┐
Task 5 (자가치유)  ──┴─ 독립, 언제든
```

- **Task 4·5는 Task 1~3과 완전 독립** — 병렬 가능하고 커밋도 따로 끊는다.
- Task 1→2는 순차 필수. Task 3은 2 이후(힌트가 실제 동작을 설명해야 하므로).
- **Task 2와 Task 5를 같은 커밋에 섞지 않는다.** 둘 다 `picker.ts`의 리스너 수명을 건드려서, 문제가 생기면 원인 분리가 어렵다.

## 가이드 영향

**있음.** 키보드 탐색과 freeze는 새로운 사용자 조작이다.

- `guide/ko/element/*` · `guide/en/element/*` — 요소 선택 절차에 화살표 탐색과 <kbd>Space</kbd> freeze를 추가. 실제 파일명은 작성 전 `guide/AUTHORING.md`를 읽고 IA에 맞춰 확정한다.
- 폰트 폴백 표기(`→`)는 인스펙터 카드 설명이 가이드에 있다면 함께 갱신.
- 오버레이 자가치유는 **사용자에게 안 보이는 개선**이라 가이드 대상 아님.

구현 후 `/guide`로 처리한다. 가이드 작성 전 **`guide/AUTHORING.md`를 먼저 읽는다**(CLAUDE.md — IA·톤·UI 라벨·검증 규칙의 단일 출처).

`docs/privacy.{ko,en}.md`는 새 수집·전송·저장 동작이 없어 대조 후 갱신 불필요로 예상된다. 다만 canvas `measureText` 프로브가 추가되므로 **"페이지에 canvas를 하나 만들지만 페이지 콘텐츠를 읽지 않는다"**는 사실을 확인하고 판단을 커밋 메시지에 남긴다.
