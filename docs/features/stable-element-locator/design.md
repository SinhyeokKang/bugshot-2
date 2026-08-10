# 안정적 요소 selector 생성 — 기술 설계

> **스코프 축소 (2026-08-10)**: 이슈 본문 표시 재설계 절반은 드랍했다. 사유는
> [`docs/features/DROPPED.md`](../DROPPED.md) 2026-08-10 항목. 그에 따라 초안에 있던
> `ElementLocator` 타입·`elementLocatorFormat.ts`·플랫폼 본문 빌더·UI 렌더·저장 초안
> 영속화·i18n 절은 전부 제거했다. 남은 것은 selector 문자열 생성 하나다.

## 개요

`@medv/finder`를 폐기하지 않고 후보 생성기로 유지한다. finder는 후보를 **누적 penalty
오름차순으로 yield하고 유일한 첫 후보를 반환**하므로 주어진 훅 구성에서 이미 "가장 싼
유일 selector"를 준다. 사람이 다시 정렬할 이유는 하나뿐이다 — penalty가 하드코딩
(id 0 / class 1 / attr 2 / tag 5 / `nth-of-type` 10 / `nth-child` 50)이라 test attribute가
흔한 스타일 class에 진다는 것. 그래서 새 `content/element-locator.ts`는 finder를 **2회**
실행하고 **2필드**로 비교한다.

1. **stable**: 안정성 필터 훅(신뢰 test attribute + semantic attribute / 동적 거부 ID /
   동적·해시·타깃 소유 class 거부)
2. **compat**: 현행 `buildSelector`와 동일한 finder 기본 필터

비교 tuple은 `(positional: 0|1, stage: 0|1, length)` 오름차순이다. 두 후보 모두 실패하면
`pathSelector` fallback을 쓴다.

반환값은 **문자열 하나**다. 구조화 메타데이터(anchor·targetTag)는 표시 절반이 소비처였고
그 절반이 드랍됐으므로 만들지 않는다.

## 변경 범위

### `src/content/element-locator.ts` (신규)

- test attribute·ID·class/attribute 값의 안정성 판정 순수 함수와 2단계 finder 후보 생성.
- 후보 비교와 `pathSelector` fallback.
- **직전 선택 1건**만 기억한다. `buildStableSelector`(선택 시점)는 항상 계산하고,
  `reuseStableSelector`(보강 시점)는 같은 요소면 그 값을 재사용한다. 페이지 수명
  캐시가 아니다 — 이유는 아래 "결정성".
- `@medv/finder` 외 신규 의존성 없음.

```typescript
export function buildStableSelector(el: Element): string;  // 선택 시점 — 항상 계산
export function reuseStableSelector(el: Element): string;  // 보강 시점 — 직전 선택 재사용
```

### `src/content/dom-describe.ts` (수정)

- DOM Tree의 `buildSelector(el)`은 기존 단일 finder 경량 경로를 **유지**한다. ancestor와
  lazy child마다 안정 selector 탐색을 반복하지 않는다.
- **`pathSelector`는 현재 모듈 private다**(`dom-describe.ts:119`). `element-locator.ts`가
  재사용해야 하므로 `pathSelector`를 `element-locator.ts`로 옮기고 `dom-describe.ts`가
  역import한다 — 순수 함수라 커버리지 로직 스코프에 포함되는 쪽이 맞다
  (`dom-describe.ts`는 `BROWSER_BOUND_EXACT` 등록으로 분모 제외 상태다).
- DOM Tree의 `TreeNode.selector` 계약은 유지한다. **그 귀결로 `TreeNode.selector`(compat)와
  `selection.selector`(stable)는 더 이상 같은 문자열이 아니다.** 둘을 등가 비교하던 곳은
  `DomTreeDialog.tsx`의 현재 노드 하이라이트 하나이고, 스토어 대신 트리 응답
  `ancestorPath`의 마지막 항목을 쓰도록 바꿔 compat끼리 비교하게 한다
  (`dom-describe.test.tsx`가 이 불변식을 고정).

### `src/content/css-resolve.ts`·`src/content/picker.ts` (수정)

- `collectSelection`은 **이미 selector builder를 인자로 받는다**(`css-resolve.ts`의
  `buildSelectorFn`). 요소 선택 경로에만 `buildStableSelector`를 주입하고 DOM Tree
  경로는 기존 `buildSelector`를 계속 쓴다 — `css-resolve.ts` 변경은 0줄이다.
- **`emitSelected`(pick/navigate/rebind 3소스)와 `postSelectionUpdate`(cross-origin 스타일
  보강, 선택당 최대 2회 추가 발화, `picker.ts:1129`)가 같은 요소에 대해 같은 selector를
  내야 한다.** 사이드패널 `updateSelectionStyles`(`editor-store.ts:697`)가
  `sameElementKey`로 stale 가드를 걸기 때문에, 두 경로의 selector가 갈리면 보강이 무음
  드랍된다. `emitSelected`는 `buildStableSelector`, `postSelectionUpdate`는
  `reuseStableSelector`를 써서 한 선택 안에서 같은 문자열을 보장한다.
- payload 조립은 **필드를 골라 담지 않고 스프레드로 펼친 뒤 바꿀 것만 덮어쓴다**
  (POSTMORTEM 2026-08-07 `contextSelector` 유실 재발 방지).
- `picker.ts:456`의 `buildSelector(ancestor)`(캡처 basis 조상 = `contextSelector`)는
  **기존 경량 경로를 유지**한다. 조상 컨테이너는 편집 대상이 아니라 캡처 범위 판정용이라
  안정성 요구가 없고, 선택당 finder 실행 횟수를 늘리지 않는다.

### 테스트 인프라 (수정)

- **`src/test/setup-dom.ts`에 `CSS.escape` 폴리필을 추가한다.** finder는 `CSS.escape`를
  무조건 호출하는데 jsdom 29에는 `window.CSS` 전역 자체가 없어, 폴리필 없이는
  `element-locator.test.tsx`가 첫 finder 호출에서 `ReferenceError`로 죽는다. 기존 테스트가
  `dom-describe.ts`를 한 번도 태우지 않아 아직 드러나지 않은 결손이다.
- 폴리필은 Chrome 실동작과 다르므로(POSTMORTEM 2026-08-03의 CSSOM 직렬화 사고와 같은
  성질) 특수문자 escaping 검증은 "jsdom 폴리필 기준"임을 명시하고 실제 escaping은
  e2e·수동으로 확인한다.

### 문서 (구현 후 수정)

- `docs/ARCHITECTURE.md`: selector 생성 우선순위, 실행 키로서의 selector 계약, 결정성
  규칙, iframe scope를 기록.
- `docs/DIRECTORY.md`: 신규 `element-locator.ts` 역할 추가.
- **privacy는 갱신하지 않는다.** 수집·전달 항목이 늘지 않는다 — 조상 test attribute 값은
  finder 기본 `data-*` 허용(`wordLike` 통과분)으로 오늘도 selector에 실려 나가고
  `privacy.ko.md` L42가 "요소를 고른 경우 그 요소의 CSS selector"로 이미 공개한다. 새
  데이터 범주가 아니라 같은 범주의 다른 문자열이다. (초안이 근거로 들었던 iframe origin
  host 노출은 표시 절반에 속했고 함께 드랍됐다.)
- 가이드는 갱신하지 않는다. 사용자에게 보이는 화면·라벨·조작이 바뀌지 않는다.

## 데이터 흐름

```text
사용자 요소 선택 (해당 frame document)
  → collectSelection에서 buildStableSelector(element)
      ├─ (보강 경로는 reuseStableSelector로 직전 선택 값을 그대로 재사용)
      ├─ stage 1 stable / stage 2 compat, 각각 try/catch
      ├─ (positional, stage, length) 비교
      └─ 예산 소진·전부 실패 시 pathSelector fallback
  → picker.selected { selector }
  → EditorSelection.selector
      ├─ sameElementKey(selector, frameId)로 버퍼 dedup·재선택 편집 복원
      ├─ rebindStylingSession → document.querySelector(selector)
      └─ applyEditsBySelector / prepareCaptureBySelector
  → picker.selectionUpdated { selector }   // 같은 문자열이어야 stale 가드 통과
```

`selector`의 역할은 초안과 동일하다. 표시 형식·소비처는 아무것도 바뀌지 않고 값만
바뀐다.

## selector 후보 및 비교

### 2단계 실행

동일한 finder를 두 가지 훅 구성으로 실행한다. wall-clock deadline은 호출 시작부터 500ms
하나를 공유하고, `maxNumberOfPathChecks`는 1000/1000으로 나눠 합계가 현행 2000을 넘지
않게 한다. 각 단계 `timeoutMs`에는 deadline까지 남은 시간을 넣는다. **남은 시간이 0
이하이면 finder를 아예 호출하지 않는다** — `timeoutMs: 0`을 넘기면 finder는 중단이 아니라
첫 후보에서 곧장 위치 체인 fallback을 반환하기 때문이다.

1. **stable**: `attr`은 신뢰 test attribute allowlist(아래) + finder 기본 semantic
   (`role`, `name`, `aria-label`, `rel`, `href`)에 `for`를 더한 목록만 허용.
   `idName`은 동적 값 거부 휴리스틱 통과분만. `className`은 동적·해시 거부 + **선택
   요소가 가진 class 이름 전역 거부**.
2. **compat**: finder 현행 기본 필터. 기존 사이트 호환과 후보 부재 방어.

> **finder 훅의 한계**: `className: (name: string) => boolean`, `attr: (name, value) => boolean`
> 시그니처에 **element 인자가 없다.** `tie()`가 조상과 타깃을 순회하며 같은 술어를
> 호출하므로 훅 안에서 "이 class가 타깃 것인가"를 알 방법이 없다. 따라서 "조상 class는
> 허용, 선택 요소 class만 제외"는 구현 불가이고, 호출 전 `new Set(el.classList)`를
> 클로저에 잡아 **이름 기준으로 전역 거부**하는 근사만 가능하다. 조상이 같은 이름의
> class를 쓰면 함께 배제되며(디자인 시스템에서 흔하다), 그 손실은 compat 단계가 보전한다.

각 단계는 **개별 try/catch**로 감싼다. finder는 예산 초과 시 `fallback()`(순수
`nth-of-type` 체인)을 시도하고 그것도 유일하지 않으면 `Error("Timeout: …")`를 던진다.
`maxNumberOfPathChecks` 초과도 같은 분기·같은 메시지다. 별도로 `unique()`는
`querySelectorAll(...).length === 0`이면 `Error("Can't select any node with this selector")`를
던진다(detached/shadow). stable 단계의 throw가 compat 단계를 낙태시키면 안 된다.

### 신뢰 test attribute

다음 exact name만 test contract로 분류한다. 이 중 `data-e2e`·`data-cy`·`data-qa`·
`data-pw`·`data-test-id`·`data-automation-id` 6개는 finder 기본 `wordLike` 게이트에
막혀 있어, **stable 단계의 `attr` 훅이 이 allowlist를 명시적으로 통과시켜야 후보로
생성된다**.

```text
data-testid, data-test-id, data-test, data-e2e,
data-cy, data-qa, data-automation-id, data-pw
```

값은 비어 있지 않고 100자 이하여야 하며 제어문자를 포함하지 않고 아래 동적 값 거부
휴리스틱도 통과해야 한다. `data-testid="user-550e8400-e29b-41d4-a716-446655440000"`처럼
이름만 test contract이고 값은 런타임 식별자인 후보를 승격하지 않는다. 속성명 패턴을
넓혀 모든 `data-*`를 승격하지 않는다. 임의 `data-*`는 compat 단계 후보에는 남을 수 있다.

### 동적 값 거부 휴리스틱

ID·class·attribute 값에 다음 중 하나가 맞으면 stable 단계에서 제외한다. compat 단계
사용은 허용한다.

- UUID 전체 형태, 10자리 이상 숫자열, epoch-like 숫자
- 8자 이상 연속 hex 또는 base64-like 무구분 문자열
- `:r<number>:` 등 React `useId`, `__id_<number>`, `ember<number>`, `mui-<number>` 형태
- (attribute **이름**은 allowlist라 `data-reactid`·`data-index`·`data-selected` 같은 건
  애초에 stable 후보가 되지 않는다 — 거부 게이트에 도달조차 안 한다)
- class 끝의 6자 이상 hash suffix(`Component_ab12cd34` 등). 단 사람이 명시한 BEM/semantic
  class를 과도하게 배제하지 않도록 전체 class가 일반 단어·하이픈 조합이면 허용한다.

휴리스틱은 안정성을 증명하지 않는다. false positive보다 false negative를 택한다. 즉
의심 후보를 stable 단계에서 빼더라도 compat과 위치 fallback으로 실행 가능성은 보존한다.

### 후보 비교

두 단계 출력만 채점한다. `pathSelector`는 후보가 아니라 폴백이다 — 둘 다 실패하거나
예산이 끊기면 그걸로 끝낸다. 중복 문자열 제거도 하지 않는다(동점이면 stage가 두 번째
키라 stable이 이겨 결과가 같다). 다음 tuple로 오름차순 비교한다.

```typescript
type SelectorScore = readonly [
  positional: 0 | 1,   // :nth-child( 또는 :nth-of-type( 포함 여부
  stage: 0 | 1,        // 0 = stable, 1 = compat
  length: number,
];
```

`nth-child`는 훅과 무관하게 finder가 항상 push하므로 stable 단계도 위치 후보를 낼 수
있다. 위치 사용 여부를 첫 키로 두면 "안정적이고 비위치적인 후보를 모두 소진한 뒤
`nth-*`를 쓴다"가 자연히 성립한다. 그 밖의 정렬은 finder가 이미 누적 penalty
오름차순으로 처리한다 — 사람이 risk tier·base tier·unstable token count를 다시 매길 필요가
없다.

PRD 예시 DOM 검증: `.text-semantic-informative-primary-low`는 타깃 자신의 class라 stable
단계에서 거부되고, `[data-e2e="enrollment-card"] span`(penalty 2+5=7)이
`article:nth-of-type(1) span`(10+5=15)을 이긴다. 정렬은 finder가 한다.

**유일성 검증을 위한 추가 `querySelectorAll`은 0회다.** finder는 반환 전에 이미
`unique()`로 `querySelectorAll(...).length === 1`을 통과시키고 `optimize()`가 추가로
`querySelector(...) === input`까지 본다. 동기 코드라 그 사이 DOM 변이도 없다.
`pathSelector`는 documentElement까지 `nth-of-type` 체인이라 **구성상 항상 유일**하므로
검증할 것이 없다. 절대 매치 개수·DOM 비율 임계값도 쓰지 않는다.

### 결정성

selector 문자열은 `sameElementKey(selector, frameId)`의 동등성 키다. 같은 요소가 다른
문자열을 얻으면 버퍼에 두 번 쌓이고 이전 편집이 소실된다. 다만 **보증 범위는 한 선택
안으로 한정한다.**

- **한 선택 안**: `picker.selected`가 만든 문자열을 `picker.selectionUpdated`가 그대로
  재사용한다(`reuseStableSelector`). 갈리면 보강이 stale 가드에 무음 드랍된다.
- **한 호출 안**: 중간 단계에서 예산이 끊기면 부분 결과를 채택하지 않고 `pathSelector`로
  수렴한다. `pathSelector`는 시간 예산과 무관한 순수 경로 계산이라 결정적이다.
- **재선택·rebind는 다시 계산한다.** 페이지 수명 캐시(WeakMap)를 두면 리스트가 재배치돼
  같은 노드가 다른 위치로 옮겨간 뒤 캐시된 위치 selector가 **다른 요소**를 가리켜
  `applyEditsBySelector`·`prepareCaptureBySelector`가 무음으로 엉뚱한 요소를 편집·캡처한다.
  잘못된 요소를 건드리는 쪽이 버퍼 중복보다 나쁘다는 판단이고, 재계산은 DOM이 안 바뀐
  동안에는 어차피 같은 문자열을 낸다.

### 값 정책 (privacy 경계)

selector는 이슈 본문·8개 플랫폼 제출 페이로드·저장 초안·사용자가 고른 LLM endpoint로
나간다. `data-testid`가 "개발자가 붙인 계약"이라는 전제는 틀렸다 — 리스트 행마다
`data-testid={user.email}`로 값을 넣는 코드가 흔하다. `isHandWrittenIdentifier`가
trusted·semantic·**id**를 같은 게이트에 태운다: ASCII 식별자 모양, 3자 초과 순수 숫자
세그먼트 금지, 긴 영숫자 혼합 토큰 금지(단어 사이 숫자 1~2자는 허용 — `oauth2button`).
id를 빼먹으면 finder penalty 0이라 `#user-jane@acme.com`이 stage 0에서 최우선 채택된다.
거부된 값은 compat 단계로 떨어져 **변경 전 동작 그대로**라, 이 게이트는 기능을 죽이지
않고 앵커만 포기한다.

### 비용 상한

- selector 후보 최대 2개 + 최종 path fallback 1개.
- `document.querySelectorAll` 추가 호출 0회(finder 자체 보장 + `pathSelector`는 구성상 유일).
- class별 `querySelectorAll` 반복이나 DOM 전체 대비 비율 계산은 하지 않는다.
- 전체 finder 예산은 기존 500ms/2000 path check를 넘기지 않는 것을 목표로 하되,
  **정밀 보증이 아니라 상한 근사**다. `optimize()` 단계의 쿼리는 `maxNumberOfPathChecks`
  카운터에 잡히지 않고 `timeoutMs`로만 묶이며, 시간은 후보 사이에서만 샘플링되므로 느린
  단일 쿼리 하나가 예산을 초과할 수 있다. 검증 가능한 계약은 **"예산 소진이 감지되면
  후속 단계를 호출하지 않는다"**이고 성공 기준·태스크 검증도 그 문장을 쓴다.
- 이 예산은 `collectSelection`의 선택 요소 1개, 선택 1회당 한 번만 적용한다.
  `postSelectionUpdate` 보강과 `contextSelector` 조상 경로는 재실행하지 않는다. DOM
  Tree의 ancestor·형제·lazy child selector는 기존 단일 finder 경량 경로를 유지한다.

## 기존 패턴 준수

- 신규 판정은 `element-locator.ts` 순수 helper + jsdom 통합 테스트로 분리한다.
  jsdom 실행에는 `CSS.escape` 폴리필이 선행 조건이다.
- `picker.ts`는 coverage 로직 스코프 제외이므로 후보 분류·비교 판정을 그 안에 두지 않는다.
- frame 동등성은 `sameElementKey(selector, frameId)`를 유지한다.
- 새 권한·스토리지 종류·외부 fetch·서버가 없다. 기존 클라이언트 온리 경계를 유지한다.

## 대안 검토

1. **finder를 `unique-selector`·`optimal-select`·DevTools DOMPath로 교체** — 기각. 모두
   현재 DOM 유일성/경로 최적화가 주목적이며 "test contract 우선, 타깃 class 배제"를
   해결하지 않는다. 이미 설치된 finder의 allow hook을 활용하는 변경이 작다.
2. **4단계 실행 + 6요소 `SelectorScore` 사전식 비교** — 기각(초안에서 철회). risk tier가
   이미 base 안정성과 위치 사용 여부를 인코딩해 6필드 중 3개가 자기 파티션 안에서 상수가
   되고, 단계 인덱스가 곧 risk tier였다. 무엇보다 finder가 누적 penalty 오름차순으로
   유일한 첫 후보를 반환하므로 사람이 다시 정렬할 이유는 "test attribute(2)가 class(1)에
   진다" 하나뿐이다. 그건 훅 필터 한 겹과 2필드 비교로 해결된다.
3. **`attr` predicate만 열고 1회 실행** — 부분 채택. 실제로 헤드라인 예시는 이것만으로
   풀린다. 다만 동적 ID·해시 class 거부와 타깃 class 배제가 빠져 PRD 목표 2를 만족하지
   못하고, 필터가 후보를 0개로 만드는 사이트에서 방어가 없다. 그래서 stable 1단계 +
   compat 1단계 구성으로 최소 확장한다.
4. **모든 `data-*`를 ID보다 우선** — 기각. 상태, 인덱스, React 내부값, 사용자/세션
   식별자가 섞인다. exact test attribute만 최고 신뢰로 분류한다.
5. **전역 match count가 적은 class에 연속 가중치 부여** — 기각. 현재 희소성은 재빌드
   안정성과 무관하고, 큰 DOM에서 비율은 희석된다. 완성 selector의 유일성만 hard gate로
   쓰고 안정성은 token 의미/형태로 판정한다.
6. **설명용 비유일 selector로 기존 `selector` 교체** — 기각. 현재 필드는 DOM Tree 이동,
   재바인딩, 편집 적용, 캡처, 버퍼 dedup의 실행 키다. 유일성 계약을 깰 수 없다.
7. **`ElementLocator` 구조화 메타데이터를 지금 함께 넣기** — 기각. 유일한 소비처가
   표시 재설계였고 그 절반이 드랍됐다. 소비처 없는 필드를 영속 스키마에 넣지 않는다.
   표시 기획이 다시 열리면 그때 추가한다.
8. **DOM Tree 경로에도 안정 selector 적용** — 기각. `buildSelector`는 `describeShallow`를
   통해 **노드마다** 호출되고 각 호출이 자체 500ms/2000 check 예산을 가지며,
   `buildInitialTree`는 조상 체인 + 각 레벨 형제 전체를 도는데 총량 캡이 없다. 다단계
   탐색을 얹으면 트리 열기가 초 단위로 늘어난다.

## 위험 요소

- **안정성 오판**: 단일 DOM snapshot으로 장기 안정성을 증명할 수 없다. 의심 token은
  stable 단계에서 제외하되 compat fallback으로 실행 가능성을 유지한다.
- **selector 값 변경 자체가 회귀 표면**: 표시를 안 바꿔도 문자열이 바뀌므로
  `sameElementKey` 소비처(버퍼 dedup, 버퍼 재선택 편집 복원, `mergeStyleElements` dedup)와
  골든 스냅샷이 영향을 받는다. 골든 diff는 줄 단위로 집계해 의도한 selector 변경만
  있는지 확인한다(POSTMORTEM 2026-08-06).
- **selector 비결정성**: 예산 소진 여부로 결과가 갈리면 `sameElementKey` 동등성이 깨져
  버퍼 중복·편집 소실이 생긴다. 예산 소진 시 항상 `pathSelector`로 수렴하고 요소별
  메모이즈로 반복 호출을 고정한다.
- **`postSelectionUpdate` 무음 드랍**: `emitSelected`만 새 빌더로 바꾸면 cross-origin 스타일
  보강이 stale 가드에 걸려 100% 드랍된다. 반대로 양쪽 다 재계산하면 선택 1회당 finder가
  최대 3회 돈다. 메모이즈로 둘 다 막는다.
- **finder 훅의 소유자 구분 불가**: 타깃 class 제외가 이름 기준 전역 거부로만 가능해
  조상의 동명 class도 함께 빠진다. compat 단계가 보전한다.
- **finder throw**: 예산 초과·detached는 중단이 아니라 예외다. 단계별 개별 try/catch가
  없으면 stable 단계의 throw가 compat 단계를 낙태시킨다.
- **jsdom `CSS.escape` 부재**: 폴리필 없이는 finder를 쓰는 테스트가 전부 죽는다. 폴리필은
  Chrome 실동작과 다르므로 escaping 검증의 최종 그물은 e2e·수동이다.
- **유일성 scope 오류**: iframe selector를 top document에서 검사하면 항상 실패하거나
  같은 selector를 잘못 합친다. content script가 실행 중인 자기 document에서 검증하고
  sidepanel은 sender frame 정보를 보강한다.
- **escaping**: ID/class/attribute name/value는 반드시 `CSS.escape`를 거친다.
- **`contextSelector` 유실**: `collectSelection` 시그니처를 바꾸면 `picker.ts`의 payload
  조립부를 건드리게 된다. 필드를 골라 담지 말고 스프레드로 펼친다(POSTMORTEM 2026-08-07).
- **편집으로 인한 selector 무효화**: 선택 요소가 가진 class 이름은 stable 후보에서
  제외한다. compat fallback에서 불가피하게 그 class를 쓴 경우만 기존 best-effort 세션
  만료로 남기고, class 삭제·교체 뒤 재바인딩·버퍼·캡처 경로를 회귀 테스트한다.
- **DOM 교체 race**: selector 생성 직전 `isConnected`를 확인하고 실패를 기존
  `selection-detached` 세션 만료 경로로 변환해 uncaught rejection을 막는다.
- **CSS 편집기 표시**: CSS CodeMirror 1행은 `selection.selector`를 사용한다. selector
  생성 결과가 바뀌어도 selector lock·parse 왕복 계약이 깨지지 않는지 확인한다.
