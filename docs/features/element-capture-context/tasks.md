# Element 캡처 컨텍스트 확장 — 구현 태스크

## 선행 조건

- 권한·env·외부 API 변경 **없음**. `manifest.config.ts` 손대지 않는다.
- i18n 사전 변경 **없음** (라벨 유지 + 스피너만 추가).
- 착수 전 `docs/POSTMORTEM.md`를 `picker`·`capture`·`crop`·`iframe`으로 grep해 과거 함정을 소환한다.
- `src/content/picker.ts`는 pre-arm 제약이 걸린 `recorders-entry`와 **다른 파일**이라(`content_scripts[0]` ISOLATED/`document_idle` vs `[2]` MAIN/`document_start`) self-contained 청크 제약과 무관하다. `capture-context.ts`를 `picker.ts`가 static import 하는 것은 정상 경로다.
- `picker.ts`는 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT` 등재 파일이라 **유닛 테스트를 붙일 수 없다.** 판정 로직은 전부 `capture-context.ts`의 순수 함수로 내려야 테스트로 고정된다.

## 태스크

### Task 1: 확장 판정 순수 함수 테스트 작성 (TDD red)

- **변경 대상**: `src/content/__tests__/capture-context.test.ts` (신규), `src/content/__tests__/capture-context.test.tsx` (신규)
- **작업 내용**: 구현 전에 테스트를 먼저 작성한다. 두 트랙으로 나눈다.
  - `.test.ts` (node) — `passesContextGates` 산술 검증
  - `.test.tsx` (jsdom) — `findContextAncestor` DOM 탐색 + `resolveContextRect` after 재검증
  - `findContextAncestor`는 computed style을 읽지 않으므로 **인라인 스타일 지정이 불필요**하다. "셀렉터 목록에 없는 태그·role은 후보가 아니다"를 검증하는 형태로 쓴다.
- **검증**:
  - [ ] `pnpm test` 실행 시 두 파일이 "함수 없음"으로 실패한다(red 확인)
  - [ ] 아래 테스트 계획의 케이스가 모두 포함돼 있다
  - [ ] 대조군 확인 — `STRUCTURE_SELECTOR`에 `div`를 임시로 추가하면 "시맨틱 없는 div 체인" 케이스가 red가 된다(가드를 무력화해 red를 확인)

### Task 2: `capture-context.ts` 구현 (green)

- **변경 대상**: `src/content/capture-context.ts` (신규)
- **작업 내용**: `CONTEXT_MAX_VIEWPORT_RATIO`(=0.4), `OVERLAY_SELECTOR`, `STRUCTURE_SELECTOR`, `findContextAncestor`, `passesContextGates`, `resolveContextRect`를 design.md 시그니처대로 구현. rect 측정·DOM 조회는 하지 않는다(인자로 받는다).
  - G2는 `elementRect`가 0×0이면 생략한다(`display:none`·detach). DOM 포함 검증은 `resolveContextRect`가 `found.contains(target)`으로 맡는다.
- **검증**:
  - [ ] Task 1의 테스트가 전부 통과
  - [ ] `pnpm typecheck` 통과
  - [ ] 모달 안 `<tr>` 케이스에서 다이얼로그가 아니라 `<tr>`이 반환됨(최근접 우선)
  - [ ] `form`·landmark·`[role="group"]`·시맨틱 없는 div는 후보가 아님
  - [ ] `elementRect` 0×0이면 G2를 건너뛰고 G1·G3만 적용

### Task 3: picker 타입 확장

- **변경 대상**: `src/types/picker.ts`
- **작업 내용**:
  - `CaptureContext` 인터페이스 정의 (`contextSelector: string | null`, `rect`, `viewport`, `scrollX`, `scrollY`)
  - `PrepareCaptureResponse`에 `scrollX`·`scrollY` 추가, `contextSelector?: string | null` 추가
  - `PickerMessage` 유니온의 `picker.prepareCapture`에 `expandContext?: boolean`·`contextSelector?: string` 추가. **`prepareCaptureBySelector`에는 추가하지 않는다**(확장 미적용 경로)
- **검증**:
  - [ ] `pnpm typecheck` 통과 (기존 호출부가 optional이라 깨지지 않음)
  - [ ] `PickerMessage`에 `| null` 필드를 넣지 않았다 — 호출부에서 `?? undefined` 변환

### Task 4: picker.ts에 확장 판정 통합

- **변경 대상**: `src/content/picker.ts`
- **작업 내용**:
  - `handlePrepareCapture(msg)`가 메시지를 받도록 시그니처 변경 (`:353`, 호출부 `:241~246`)
  - **iframe(`window.top !== window`)이면 확장 판정을 하지 않는다.** 요소 rect + `contextSelector: null`로 즉시 반환
  - `msg.expandContext`가 false/미지정이면 확장 판정을 하지 않는다 (element-shot·기타 호출부 무회귀)
  - `msg.contextSelector`가 있으면 `document.querySelector`로 조상을 찾아 `viewportRectOf`로 재측정한 뒤 `resolveContextRect`에 넘긴다. 판정은 순수 함수가 하고 picker는 조회·측정만 한다
  - 없으면 `findContextAncestor` → `passesContextGates` 순으로 판정. 통과 시 조상 rect + `buildSelector(조상)`(`src/content/dom-describe.ts:10`), 미달 시 요소 rect + `null`
  - 응답에 `scrollX`·`scrollY`(`window.scrollX/scrollY`)를 싣는다
  - `handlePrepareCaptureBySelector`(`:369`)는 **손대지 않는다** — 확장 미적용. `scrollX`·`scrollY` 추가만
  - `respondWithTopRect`(`:325~346`)의 응답 조립 4경로 중 3개(`:335`·`:342`·`:345`)가 객체를 새로 만들므로 새 필드를 각각 명시적으로 넣는다
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] iframe 경로에서 확장 판정이 호출되지 않음
  - [ ] `respondWithTopRect`의 3개 조립 분기 모두 `scrollX`·`scrollY`를 실음
  - [ ] `expandContext`가 없으면 `findContextAncestor`를 호출하지 않음
  - [ ] `contextSelector`가 주어지면 `findContextAncestor`를 호출하지 않음(판정 재실행 없음)

### Task 5: capture.ts 반환 타입 변경 + 0×0 폴백

- **변경 대상**: `src/sidepanel/capture.ts`, `src/sidepanel/picker-control.ts`
- **작업 내용**:
  - `CaptureResult` 타입 export (`CaptureContext`는 `types/picker.ts`에서 re-export하거나 직접 import)
  - `captureElementSnapshot`에 `expandContext?: boolean`·`context?: CaptureContext` 옵션 추가, 반환을 `CaptureResult | null`로 변경
  - `captureElementSnapshotBySelector`도 반환 타입만 변경 (확장 옵션 없음)
  - `prepareCapture` 호출 시 `expandContext`·`contextSelector` 전달 (`picker-control.ts:492` 시그니처 확장). `prepareCaptureBySelector`(`:505`)는 시그니처 변경 없음
  - `captureWithPrep`에서 rect가 0×0이면 `context`의 **viewport·scrollX·scrollY가 전부 일치할 때만** `context.rect`로 대체. 하나라도 다르면 null 반환(이미지 없음)
- **검증**:
  - [ ] `pnpm typecheck`가 호출부 5곳에서 타입 에러를 낸다(다음 태스크가 고칠 지점 확인)
  - [ ] **0×0 대체 시 rect만 바꾸고 viewport는 `prep.viewport`를 쓴다** — `cropImage`의 `scale = naturalWidth / viewport.width`에서 `img`는 지금 찍은 캡처이므로 배율은 현재 뷰포트로 유도해야 한다. `context.viewport`를 쓰면 배율이 어긋난다
  - [ ] scroll·viewport 불일치 시 stale rect를 쓰지 않고 null로 간다

### Task 6: store에 캡처 컨텍스트 저장

- **변경 대상**: `src/store/editor-store.ts`, `src/store/issues-store.ts`, `src/sidepanel/hooks/useEditorSessionSync.ts`
- **작업 내용**:
  - `EditorState`에 `captureContext: CaptureContext | null` 추가, 초기값 `null`
  - `setCaptureContext` 액션 추가
  - `BufferedElement`에 `captureContext?: CaptureContext` 추가
  - `bufferCurrentElement(afterImage, context?)`로 시그니처 확장 (`:234`, `:645`)
  - `bufferCurrentElement` **재편집 병합**(`:~675`)에서 `beforeImage`와 함께 `captureContext`도 기존 값을 유지 (before와 짝이므로)
  - `patchBufferedElement`(`:238`)의 patch 화이트리스트에 `captureContext` 추가
  - 새 요소 선택·전체 `reset` 시 `captureContext` 초기화. `backToStyling`(`:709`)에서는 before 이미지와 함께 유지
  - 버퍼 승격 경로(`:580~`)에서 `beforeImage`·`afterImage`와 함께 복원
  - **`EditorSnapshot` Pick 목록(`:269~302`)에 `captureContext` 추가**
  - **`snapshotFromState()`(`useEditorSessionSync.ts:67~102`) 필드 나열에 `captureContext` 추가**
  - `issues-store.ts`의 `IssueRecord`(`:180`)·`IssueBufferedElement`(`:166~`)에 `captureContext?` 추가
  - `IssueRecord` 직렬화(`editor-store.ts:852~`, buffered 매핑 `:888~911`)에서 명시적으로 직렬화·복원. 레거시는 `?? null` 폴백하고 persist 버전은 올리지 않음
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 `src/store/__tests__/editor-store.test.ts` 111개 테스트가 계속 통과 (`bufferCurrentElement` 호출 20곳이 전부 1-arg — optional 인자라 무영향)
  - [ ] 요소 재선택 후 `captureContext`가 `null`로 초기화됨
  - [ ] `backToStyling`에서는 기존 context 유지
  - [ ] 세션 스냅샷 왕복(`snapshotFromState` → `hydrate`) 후 `captureContext` 유지
  - [ ] `toLiteSnapshot`(quota 폴백)에서 이미지가 null이 되어도 `captureContext`는 살아남음
  - [ ] draft 저장·복원 후 현재 요소와 버퍼 context 유지, context 없는 레거시는 폴백

### Task 7: 호출부 연결

- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/tabs/StyleEditorPanel.tsx`, `src/sidepanel/hooks/useBufferThenSwitch.ts`, `src/sidepanel/tabs/styleEditor/StyleChangesDialog.tsx`, `src/sidepanel/lib/styleChangeGroups.ts`, `src/sidepanel/picker-control.ts`
- **작업 내용**:
  - `usePickerMessages.ts:143` (before) — `expandContext: true` 전달, `result.image`를 `setBeforeImage`에, `result.context`를 `setCaptureContext`에
  - **in-flight 잠금**: 캡처를 실제로 발행하는 지점(`:142`의 `if (!wasBuffered && !beforeImage)` 안)에서만 플래그를 세우고 `.finally`에서 내린다. 실패 시 `setCaptureContext(null)` + 플래그 해제
  - `usePickerMessages.ts:321~329` `captureElementShot` — **스코프 밖**. `expandContext`를 켜지 않고 `.image`만 꺼내 쓰도록 최소 수정
  - `StyleEditorPanel.tsx:156` (after) — **`await` 전에** `getState().captureContext`를 떠서 `context`로 전달, `expandContext: true`. `result.image`를 `setAfterImage`에
  - `StyleEditorPanel.tsx` `[다음]` 버튼 — in-flight면 `aria-disabled` + `Loader2 animate-spin`, `aria-disabled:opacity-50` 제외 (`docs/DESIGN.md:293`)
  - `useBufferThenSwitch.ts:22` — **`await` 전에** context를 떠서 전달(`usePickerMessages.ts:129~133`의 `sameSelection()` 방어와 같은 이유). 버퍼에는 `after.context`가 아니라 before에서 확정한 `captureContext` 저장
  - `styleChangeGroups.ts:15~26` — `ChangeGroup`에 `captureContext` 필드 추가 + `buildChangeGroups`에서 통과
  - `StyleChangesDialog.tsx:95` — 반환 타입 변경만 흡수(`.image`). **`expandContext`를 켜지 않는다**
  - `picker-control.ts:478` `rebindStylingSession` — `bufferCurrentElement(state.afterImage, state.captureContext ?? undefined)`로 2-arg 호출
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 전체 통과
  - [ ] `captureElementShot`이 `<tr>` 안 요소에서도 요소 bbox만 찍는다(확장 미적용)
  - [ ] `StyleChangesDialog` 재캡처가 확장 없이 현행과 동일하게 동작
  - [ ] `wasBuffered` 재선택 시 `[다음]`이 즉시 활성 (잠금 미진입)
  - [ ] `backToStyling` 후 `[다음]`이 활성
  - [ ] before 캡처 실패 시에도 `[다음]`이 활성 — 현행(before 없이 진행) 무회귀
  - [ ] 패널 닫았다 열기(rebind) 후 before/after가 같은 기준을 쓴다
  - [ ] `next-step`을 쓰는 기존 e2e spec 5개(`style-edit-flow`·`log-insert`·`action-log-scope`·`body-composition-reorder`·`style-code-view`) 무회귀

### Task 8: e2e spec 작성

- **변경 대상**: `e2e/` (신규 spec + 신규 fixture 페이지), 필요 시 `src/`에 `data-testid` 추가만
- **작업 내용**: 아래 e2e 시나리오 3개를 Playwright spec으로 작성한다. `/e2e-write`로 처리.
- **전제 (반드시 지킨다)**:
  - `e2e/GOTCHAS.md:9` — 캡처 관문 `captureOwnedTab`이 요소 캡처 포함 모든 경로에서 `tab.active`를 재확인한다. `fixture.bringToFront()` **후** `next.evaluate(el => el.click())` 순서여야 한다
  - `e2e/GOTCHAS.md:38` — `captureVisibleTab` 쿼터(~2회/초)는 **확장 전역이라 spec 경계를 넘는다.** 1초 간격 spaced 재시도(`captureUntilDrafting` 패턴) 필수. 이 함정으로 30s Replay 캡처 spec 5개가 전량 삭제된 전례가 있다(`GOTCHAS.md:8`)
  - **단위 환산**: `naturalWidth`는 `captureVisibleTab`의 device px, 요소 폭은 CSS px이다. `capture-methods.spec.ts:95`처럼 `scale = naturalWidth / window.innerWidth`로 환산하고 허용 오차를 둔다
  - `StyleChangesTable.tsx`의 `SnapshotCell` `<img>`에 `data-testid="snapshot-before"`/`"snapshot-after"` 부착이 선행돼야 한다(alt는 i18n이라 텍스트 단언 금지 — `GOTCHAS.md:64`)
  - **신규 fixture 페이지**가 필수다. `basic.html`에 `position:fixed; inset:0` 백드롭을 넣으면 `pickElement`를 쓰는 20여 개 spec의 클릭을 전부 가로챈다. `fixtureTabId("http://127.0.0.1/capture-context.html")`처럼 URL 패턴을 명시한다(`GOTCHAS.md:14`)
- **검증**:
  - [ ] `pnpm build:e2e` 후 `pnpm test:e2e` green
  - [ ] 1회 재실행에서도 green (플레이크 확인)

## 테스트 계획

### 단위 테스트

**`capture-context.test.tsx` (jsdom) — `findContextAncestor`**

| 케이스 | 기대 |
|---|---|
| Radix형 모달: `[role="dialog"]` 안 버튼 | 다이얼로그 반환 |
| `<table><tr><td>` 안 배지 | `<tr>` 반환 |
| **모달 안 테이블 셀** | `<tr>` 반환 (다이얼로그 아님 — 최근접 우선) |
| `<li>` 안 버튼 | `<li>` 반환 |
| `<form>` 안 input | `null` (셀렉터 목록에 없음 — 민감정보 범위 확대 방지) |
| `[role="tabpanel"]` 안 요소 | tabpanel 반환 |
| 시맨틱 없는 div 체인 | `null` |
| 손수 백드롭: `<div>` 부모 + 안쪽 `<div>` + 버튼 | `null` (셀렉터 목록에 없음) |
| 요소 자신이 `<li>`이고 상위에 아무것도 없음 | `null` (자신 제외) |
| `section`·`nav`·`aside`·`header`·`footer`·`[role="group"]` | `null` (셀렉터 목록에 없음) |

**`capture-context.test.tsx` (jsdom) — `resolveContextRect`**

| 케이스 | 기대 |
|---|---|
| `found`가 `target`을 포함 + 게이트 통과 | 조상 rect + 저장 selector |
| `found`가 `null` (selector 소실) | 요소 rect + `null` |
| `found`가 `target`을 포함하지 않음 (다른 형제에 재결합) | 요소 rect + `null` |
| `found`는 포함하지만 재측정 rect가 40% 초과 | 요소 rect + `null` |
| `found`는 포함하지만 재측정 rect가 뷰포트를 벗어남 | 요소 rect + `null` |
| `target`이 0×0(`display:none`) + `found`가 DOM 포함 + 게이트 통과 | 조상 rect (G2 생략) |

**`capture-context.test.ts` (node) — `passesContextGates`**

| 케이스 | 기대 |
|---|---|
| 뷰포트 안 + 완전 포함 + 면적 30% | `true` |
| 뷰포트 안 + 완전 포함 + 면적 50% | `false` (40% 초과) |
| 면적 정확히 40% | `true` (경계 포함) |
| 요소가 컨테이너 밖으로 삐져나감 | `false` |
| **`elementRect`가 0×0 + 컨테이너 정상** | `true` (G2 생략) |
| **컨테이너 상단이 뷰포트 위로 벗어남(음수 y)** | `false` (G1 — 클램프하지 않는다) |
| **컨테이너 하단이 뷰포트 아래로 벗어남** | `false` (G1) |
| **컨테이너가 뷰포트보다 크지만 잘라내면 40% 이하** | `false` (G1이 면적보다 먼저) |
| `viewport.width` 0 | `false` |

**`editor-store.test.ts` 추가**

- 요소 재선택 시 `captureContext`가 `null`로 초기화된다
- `bufferCurrentElement(image, context)`가 버퍼 항목에 `captureContext`를 실는다
- `bufferCurrentElement` 재편집 병합에서 `beforeImage`와 `captureContext`가 함께 유지된다
- 버퍼 승격 시 `captureContext`가 복원된다
- `backToStyling`은 before 이미지와 `captureContext`를 함께 유지한다
- `EditorSnapshot` 왕복 후 `captureContext`가 복원된다
- `toLiteSnapshot` 후에도 `captureContext`가 살아남는다
- `IssueRecord` 왕복 후 현재 요소·버퍼 context가 복원되고 레거시 context 부재는 안전하게 폴백한다

### e2e 시나리오

`/e2e-write`의 입력. 신규 픽스처 페이지(`capture-context.html`)에 모달·반복 `<tr>`·시맨틱 없는 div·풀스크린 백드롭을 배치한다. **재정렬 시나리오를 쓸 경우 `<tr>`·`<li>`에 id·고유 class를 두지 않는다** — `buildSelector`가 `@medv/finder`라 id/class를 우선해서 재정렬해도 같은 노드를 따라가므로 시나리오가 공허해진다.

1. 모달 다이얼로그 안 버튼을 편집하고 다음 단계로 진행하면, after 이미지 폭(CSS px 환산)이 **다이얼로그 폭 ± 허용오차**에 수렴한다
2. 시맨틱 컨테이너가 없는 div 안 요소를 편집하면, after 이미지 폭이 **요소 폭 + 48px ± 허용오차**다 (폴백 확인)
3. before 캡처 응답을 지연시키면 완료 전 `[다음]`이 비활성이고, 완료 후 같은 컨테이너로 진행된다
   - 지연 주입은 패널 컨텍스트에서 `chrome.tabs.sendMessage`를 스파이로 덮는 방식(`GOTCHAS.md:51`의 `chrome.runtime.sendMessage` 선례를 옮긴다). **pick 이전에 패치를 깔아야** before 캡처를 잡을 수 있고, 지연을 걷어내지 않으면 후속 spec까지 오염된다

**e2e에서 뺀 것과 그 이유** — 은폐된 축소가 아니라 명시적 이관이다.

- 테이블 행 확장·`display:none`·과확장 차단·selector 재결합: 판정 자체는 `capture-context.test.*` 단위로 고정된다. e2e로 옮기면 `captureVisibleTab` 호출이 18회+로 늘어 30s Replay와 같은 플레이크 위험을 진다
- "`display:none` 후 after가 24×24보다 크다"는 **현행 폴백에서도 통과하는 공허한 단언**이다(rect 0×0 + margin 24 → `clampCropRect`가 `48*scale` 이미지를 만든다). 수동 테스트로 육안 확인한다
- draft 재개 후 행 초기화 재캡처: **경로 자체가 없다.** `IssueRecord` → `useEditorStore` 복원 코드가 코드베이스에 없고(`hydrate` 호출은 세션 스냅샷 경로 하나뿐), 저장 draft는 `DraftDetailDialog`로 읽고 제출만 한다. 대응하는 실제 경로(패널 닫았다 열기 → 재캡처)는 수동 테스트로 옮겼다

### 수동 테스트

`pnpm build` 선행 필요 (dist stale 방지).

- [ ] 실제 사이트의 모달(예: GitHub 삭제 확인 다이얼로그)에서 버튼 편집 → 다이얼로그 전체가 담기는지 시각 확인
- [ ] 실제 테이블(예: GitHub 파일 목록)에서 셀 편집 → 행 전체가 담기는지
- [ ] `display:none` 편집 후 before/after를 나란히 보고 "빠져서 당겨진" 모습이 읽히는지
- [ ] `display:none` 편집 전후로 **스크롤을 바꾸면** after 이미지가 없어지는지(stale rect를 쓰지 않는지)
- [ ] iframe(1-depth) 내부 요소 편집 → 확장이 걸리지 않고 현행과 동일한 이미지가 나오는지
- [ ] 여러 요소를 버퍼에 담고 이슈 본문의 요소별 before/after 표가 각각 올바른 기준으로 찍혔는지
- [ ] 버퍼된 요소를 다시 선택했을 때 `[다음]`이 즉시 눌리는지
- [ ] 패널을 닫았다 열어(세션 rebind) 진행했을 때 before/after 기준이 갈리지 않는지
- [ ] `StyleChangesDialog`에서 행 초기화 후 재캡처된 after가 현행과 동일한지(확장 미적용)
- [ ] 요소 단일 캡처(element-shot)를 `<tr>` 안 요소에 실행했을 때 요소만 찍히는지
- [ ] 40% 상한 검증 — 넓은 모니터·좁은 창 양쪽에서 확인. **조정 방향은 조이는 쪽만** 검토한다(P1·P2). 판정 기준: 확장 이미지에서 편집 대상 요소가 눈에 띄지 않을 만큼 작아지면 과확장으로 보고 상한을 낮춘다. 발동률이 낮다는 이유로는 올리지 않는다
- [ ] 이슈 트래커에 업로드된 결과 이미지에서 대상 다이얼로그·행을 식별 가능한지 (사이드패널 표는 이미지 실효 폭 ~105px이라 범위 확인용)
- [ ] 확장 이미지에 인접 개인정보가 불필요하게 포함되지 않는지
- [ ] 대표 DOM(깊은 트리·반복 행)에서 조상 selector 생성 지연을 측정한다. **페이지 멈춤이 체감되면** `WeakMap<Element,string>` 캐시를 후속 과제로 등록
- [ ] 실사이트 표본(모달·테이블·리스트가 있는 페이지 여러 곳)에서 확장 발동을 관찰한다. 0건이면 게이트 점검 후 출시 가치 재판단

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
- Task 5가 타입 에러를 의도적으로 발생시키고 Task 7이 해소하므로, **Task 5~7은 하나의 커밋으로 묶는다.** 중간 커밋을 만들지 않으면 CI `verify`(typecheck 필수)나 `git bisect`가 빨간 커밋에 착지할 일이 없다.
- Task 4까지 끝나면 picker 단독으로 확장이 동작하므로, Task 5~7 전에 임시로 `console.log`를 넣어 판정 결과를 눈으로 확인할 수 있다.

## 가이드 영향

**본문 텍스트 변경 없음.** `guide/ko/element/`·`guide/en/element/`는 before/after 개념만 설명하고 캡처 범위를 구체적으로 명시한 문장이 없다(`README.md:3,5`, `issue.md:15~21`, `styling.md:97` 확인).

다만 `guide/ko/assets/element-issue-2.jpg`(before/after 스타일 비교 예시 스크린샷)가 새 캡처 범위와 달라질 수 있다. 실물 확인 후 예시 이미지가 눈에 띄게 어긋나면 `/guide`로 재촬영을 검토한다 — 텍스트 수정은 불필요하므로 우선순위는 낮다.
