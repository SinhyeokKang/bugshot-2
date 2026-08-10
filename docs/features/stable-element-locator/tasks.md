# 안정적 요소 selector 생성 — 구현 태스크

> **스코프 축소 (2026-08-10)**: 표시 재설계 태스크(display model, 플랫폼 본문 빌더,
> Jira ADF·Notion, UI 렌더, 골든 일괄 갱신, i18n·가이드·privacy)는 드랍했다. 사유는
> [`docs/features/DROPPED.md`](../DROPPED.md) 2026-08-10 항목. 12개 → 5개.

## 선행 조건

- 착수 전 `docs/POSTMORTEM.md`를 `selector`, `bufferedElements`, `styleElements`,
  `frameId`, `contextSelector`, `골든`으로 grep한다. 특히 2026-08-03 Chrome CSSOM
  직렬화, 2026-08-06 골든 diff 집계, 2026-08-07 `sendResponse` 필드 유실 회귀를 확인한다.
- 신규 권한·env·OAuth·외부 API·의존성 없음. `@medv/finder` 4.0.2를 유지한다.
- privacy·가이드·i18n 갱신 없음. 사용자에게 보이는 라벨·화면·조작이 바뀌지 않고
  수집 항목도 늘지 않는다(design.md "문서" 절 참조).
- 구현은 TDD 순서로 진행하고 빌드는 실행하지 않는다.

## 태스크

### Task 0: jsdom `CSS.escape` 폴리필 (선행)

- **변경 대상**: `src/test/setup-dom.ts`
- **작업 내용**: finder가 `CSS.escape`를 무조건 호출하는데 jsdom 29에는 `window.CSS`
  전역 자체가 없다. Task 2 이후의 모든 jsdom 테스트가 이 폴리필 없이는 첫 finder
  호출에서 `ReferenceError`로 죽는다. 기존 테스트가 `dom-describe.ts`를 한 번도 태우지
  않아 아직 드러나지 않은 결손이다.
- **검증**:
  - [x] 폴리필 추가 후 jsdom에서 `finder(el)`가 예외 없이 문자열을 반환
  - [x] 기존 `*.test.tsx` 전부 green (폴리필이 다른 테스트를 깨지 않음)
  - [x] 폴리필은 Chrome 실동작과 다르다는 주석을 남기고, 특수문자 escaping의 최종 그물은
    e2e·수동임을 명시

### Task 1: 안정성 분류와 후보 비교 순수 함수 (TDD)

- **변경 대상**: `src/content/__tests__/element-locator.test.ts` →
  `src/content/element-locator.ts`(신규)
- **작업 내용**: test attribute allowlist, 동적 ID/class/attribute 거부, selector의 위치
  토큰 판정, `(positional, stage, length)` 비교를 테스트 먼저 작성한 뒤 구현한다.
- **검증**:
  - [x] `data-testid`, `data-test-id`, `data-test`, `data-e2e`, `data-cy`, `data-qa`,
    `data-automation-id`, `data-pw`만 test contract로 분류
  - [x] 그중 `data-e2e`·`data-cy`·`data-qa`·`data-pw`·`data-test-id`·`data-automation-id`
    6개는 finder 기본 `wordLike` 게이트에 막히므로 stable 단계 `attr` 훅이 명시적으로
    통과시켜야 후보가 생김을 단언
  - [x] 임의 `data-user-id`, `data-index`, `data-selected`는 test contract로 승격되지 않음
  - [x] UUID·긴 숫자·hex/hash·React useId·framework 생성 ID/class 거부
  - [x] `className` 훅이 선택 요소가 가진 class 이름을 **전역 거부**하고, 조상이 같은
    이름을 써도 함께 배제된다는 한계를 테스트로 고정
  - [x] 비교가 위치토큰 유무 → 단계(stable 0 / compat 1) → 길이 순
  - [x] 위치 없는 compat 후보가 위치 있는 stable 후보를 이긴다

### Task 2: 2단계 후보 생성과 fallback (TDD)

- **변경 대상**: `src/content/__tests__/element-locator.test.tsx` →
  `src/content/element-locator.ts`, `src/content/dom-describe.ts`
- **작업 내용**: jsdom DOM에서 stable/compat 2단계 finder 후보를 만들고 최적 후보를
  선택한다. 공유 500ms deadline, path check 1000/1000, 직전 선택 1건 기억을 구현한다. `pathSelector`를 `element-locator.ts`로 옮기고 `dom-describe.ts`가
  역import하되 DOM Tree의 `buildSelector`는 기존 단일 finder 경량 경로를 유지한다.
  finder 호출은 주입 가능한 seam으로 두어 fake clock/mock으로 검증한다.
- **검증**:
  - [x] 예시 DOM에서 `[data-e2e="enrollment-card"] span`이 채택되고, 선택 요소 자신의
    class(`.text-semantic-…`)와 `nth-of-type` 후보를 이긴다
  - [x] 반복 `data-e2e`만으로 비유일한 후보는 finder가 애초에 반환하지 않음
  - [x] 반복 카드의 동일 descendant는 위치 fallback으로 현재 target 하나만 선택
  - [x] 동적 ID와 해시 class보다 안정 attribute/class 후보 우선
  - [x] **단계별 개별 try/catch**: stable 단계가 `Error("Timeout: …")`를 던져도 compat
    단계가 실행된다
  - [x] `unique()`의 `Error("Can't select any node with this selector")`도 같은 경로로 흡수
  - [x] 모든 후보가 실패하면 `pathSelector` 반환
  - [x] **결정성**: 예산이 중간에 끊기면 부분 결과를 채택하지 않고 항상 `pathSelector`로
    수렴한다. 같은 요소·같은 DOM에 대해 fake clock 값을 바꿔도 결과가 동일
  - [x] 남은 예산이 0 이하이면 finder를 **호출하지 않는다**(`timeoutMs: 0`을 넘기지 않음)
  - [x] mock finder에 전달된 timeout은 공용 500ms deadline의 남은 값이고 path check 합계는
    1000+1000=2000
  - [x] 보강 호출(`reuseStableSelector`)은 직전 선택과 같은 요소면 finder를 안 돌린다
  - [x] 재선택(`buildStableSelector`)은 항상 다시 계산한다 — DOM 재배치 후 캐시된 위치
    selector가 다른 요소를 가리키는 것을 막는다
  - [x] 특수문자 ID/class/attribute가 `CSS.escape` 후 query 가능 — **jsdom 폴리필 기준**
    (Chrome 실동작은 e2e·수동으로 확인)
  - [x] `html`, body 직계 자식, SVG element 방어
  - [x] disconnected element는 유일성 계약을 가장하지 않고, 호출 전 `isConnected` 확인과
    예외 매핑으로 기존 selection-detached 세션 만료 경로가 처리
  - [x] DOM Tree 초기/자식 확장은 안정 selector 탐색을 호출하지 않아 기존 비용 계약 유지
    (`buildSelector` 호출 경로에 mock spy)

> `buildInitialTree`·`buildChildrenResponse`의 기존 selector 소비 테스트는 **존재하지
> 않는다**(`dom-describe.ts` 커버리지 0/119). 이 축의 회귀 확인은 e2e
> `dom-tree-nav.spec.ts`와 아래 수동 테스트가 담당한다.

### Task 3: picker 선택 경로 배선과 selector 일관성

- **변경 대상**: `src/content/picker.ts`, `src/sidepanel/tabs/DomTreeDialog.tsx` 및 인접
  테스트 (`css-resolve.ts`는 이미 builder를 인자로 받아 변경 0줄)
- **작업 내용**: `collectSelection`이 selector builder를 받도록 시그니처를 조정하고,
  요소 선택 경로만 새 빌더를 쓴다. **`emitSelected`는 `buildStableSelector`,
  `postSelectionUpdate`(`picker.ts:1129`)는 `reuseStableSelector`**로 갈라 한 선택 안에서
  같은 문자열을 보장한다.
  DOM Tree 경로와 `contextSelector` 조상 경로(`picker.ts:456`)는 기존 `buildSelector`
  유지.
- **검증**:
  - [x] `postSelectionUpdate`가 만드는 selector가 `emitSelected`와 동일 문자열이라
    `updateSelectionStyles`(`editor-store.ts:697`)의 `sameElementKey` stale 가드를 통과한다
    — cross-origin 스타일 보강이 드랍되지 않음
  - [x] 한 번의 선택에서 finder 실행이 선택 시점 1회뿐(보강은 재사용)
  - [x] `contextSelector`가 기존 경량 경로를 유지하고 값이 바뀌지 않음
  - [x] payload 조립이 **필드를 골라 담지 않고 스프레드**로 펼쳐 `contextSelector` 등
    기존 필드가 유실되지 않음 (`grep -n "sendResponse({ " src/content/*.ts`로 전수 확인)
  - [ ] **선택 요소 class 삭제·교체 뒤에도** 현재 편집·버퍼 승격·재선택·패널 재오픈
    rebind·캡처가 같은 요소를 유지한다. compat fallback이 불가피하게 그 class를 쓴
    경우만 예외이고 기존 세션 만료 경로로 처리됨을 단언
  - [x] `sameElementKey`는 selector+frameId 그대로

> styling session rebind·`applyEditsBySelector`·`prepareCaptureBySelector`의 기존 테스트는
> **존재하지 않는다**(`picker.ts` 커버리지 0/828, 해당 심볼 언급 테스트 0건). 이 축은 e2e
> `buffered-reselect-edit.spec.ts`와 수동 테스트로 확인한다.

### Task 4: 골든 스냅샷 갱신과 전체 회귀

- **변경 대상**: `src/sidepanel/lib/__tests__/__snapshots__/bodyOutputGolden.test.ts.snap`
  및 selector 문자열을 하드코딩한 기존 테스트
- **작업 내용**: 표시 형식은 안 바뀌지만 **selector 값이 바뀌므로** 골든과 selector를
  단언하는 테스트가 흔들린다. 일괄 갱신 후 diff를 검토하고 typecheck를 실행한다.
  빌드는 실행하지 않는다.
- **검증**:
  - [ ] 골든 diff를 줄 단위로 집계해 **selector 문자열 변경만** 있는지 확인. 구조·순서·
    라벨이 바뀐 줄이 있으면 원인 규명 전까지 커밋하지 않음(POSTMORTEM 2026-08-06)
  - [x] `pnpm test` 통과
  - [x] `pnpm typecheck` 통과
  - [x] git diff에서 manifest/권한/env/외부 fetch 변경 없음
  - [x] `docs/privacy.*`·`guide/`·`src/i18n/`·`src/log-viewer/` diff가 **0**임을 확인
    (스코프 축소의 사후 검증 — 하나라도 걸리면 표시 절반이 새어 들어온 것이다)

## 테스트 계획

### 단위 테스트

- `element-locator.test.ts`: attribute/class/id 안정성 분류, 2필드 비교.
- `element-locator.test.tsx`: 실제 jsdom DOM에서 단일·반복 앵커, 동적 token, escaping,
  detached/SVG, 단계별 try/catch, 예산 소진 결정성, 메모이즈.
- `editor-store.test.ts`: `updateSelectionStyles` stale 가드가 같은 selector로 통과.

### e2e 시나리오

`/e2e-write` 입력 후보. **게이트는 전용 marker prop으로 걸고 selector 문자열은 단언에만
쓴다** — `e2e/GOTCHAS.md:35`가 "`@medv/finder`는 최단 유니크를 고르므로 selector 줄을
게이트로 쓰지 말라"를 이미 못박았다. selector를 대기 조건으로 쓰면 실패가 assertion이
아니라 timeout으로 나온다.

**작성 완료 — `e2e/stable-locator.spec.ts` + `e2e/fixtures/pages/stable-locator.html`(serial 4).**

- [x] 형제 카드가 있을 때 조상 `[data-e2e]`가 위치 표현·타깃 class를 이긴다
- [x] 타깃의 의심스러운 id(`#deadbeef` — finder 기본은 penalty 0으로 최우선 채택)·해시
  class 대신 조상 `[data-testid]`를 쓴다
- [x] test contract 이름이어도 PII 값(`data-testid="user-jane@acme.com"`)은 selector에
  실리지 않는다
- [x] 타깃 class 삭제 후에도 selector 불변 + `.chip{color}` 소실이 패널에 반영된다
  (= `picker.selectionUpdated`가 stale 가드에 안 걸림)

**픽스처는 대상마다 형제를 둔다** — 얕은 경로가 이미 유일하면 finder가 가장 싼 후보로
끝내 앵커가 나올 자리가 없고, 그러면 제품이 정상인데 spec만 red가 된다.

원래 시나리오 3(cross-origin 보강 왕복)은 **자동화 불가**다. e2e 서버가 loopback이라
SSRF 가드(`isFetchableSheetUrl`)가 외부 시트 fetch를 막아 2차 `selectionUpdated`가 아예
발화하지 않는다(`style-cross-origin-section.spec`와 같은 사유). 위 4번이 1차(CSS 캐시)
경로로 같은 계약을 태우고, 실제 cross-origin 왕복은 수동 잔여로 옮겼다.

### 수동 테스트

- [ ] 고정 픽스처(대형 상용 페이지 1개)에서 DOM Tree 열기 3회 중앙값이 변경 전 대비
  **+20% 이내**이고, 선택 selector 생성이 500ms 안에 끝난다
- [ ] Chrome DevTools console에서 생성된 selector를 해당 frame document에 실행하면 현재
  캡처 시점 target 하나만 매치 (jsdom 폴리필이 아닌 실제 `CSS.escape` 경로 확인 —
  특수문자 class·ID가 있는 요소 포함)
- [ ] 선택 요소의 class를 편집기로 지운 뒤 재선택·버퍼 승격·before/after 재캡처가 같은
  요소를 유지
- [ ] CSS CodeMirror selector 1행·DOM Tree 이동·버퍼 재선택 정상
- [ ] `data-testid`만 있는 사이트, test attribute가 전혀 없는 사이트 각각에서 회귀 없음

## 구현 순서

Task 0 → 1 → 2 → 3 → 4 순차. 각 TDD 태스크는 대상 테스트 red 확인 → 최소 구현 → 대상
테스트 green 순서로 닫는다.

## 가이드 영향

**없음.** 사용자에게 보이는 화면·라벨·조작이 바뀌지 않는다. `DOM` 행에 표시되는
selector 문자열 값만 달라지므로 가이드 스크린샷도 다시 찍지 않는다.
