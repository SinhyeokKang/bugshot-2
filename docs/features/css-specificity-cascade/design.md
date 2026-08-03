# CSS specificity 판정 정밀화 — 기술 설계

## 개요

specified 수집의 유일한 규칙 순회 지점인 `collectRulesForElement()`(`css-resolve.ts:813`)
에서 규칙당 specificity를 1회 계산해 `noteClaim()`까지 내려보낸다. `noteClaim`은
후보 비교에 specificity를 편입해 승자를 확정하고, **승자 verdict를 반환**해 쓰기
경로(`applyDeclarations`·`claimSpecified`)가 패자 값의 out 덮어쓰기를 막게 한다.
specificity를 신뢰할 수 없는 규칙(`:is()` 등 미지원 셀렉터·`@layer`/`@scope` 소속·`el.matches()`
throw)은 `null`로 전달돼 기존 uncertain 경로를 그대로 탄다.

두 소비 경로(`collectSpecifiedStylesWithSources` = 편집/CSS 뷰, `collectInspectorSpecRefs`
= 인스펙터)는 모두 `collectRulesForElement`를 경유하므로(POSTMORTEM 2026-08-01
"화면 간 불일치는 경로가 갈렸다는 신호" 함정 회피) 통합 지점은 하나다. 조상 순회(상속 prop)도 같은 함수를 요소만 바꿔 호출하므로
자동으로 같은 판정을 탄다.

인스펙터는 `uncertain`을 computed로 치환하지 않고 색상·토큰 참조만 소비한다. 툴팁의
색·표시값은 computed 직접 읽기(`formatColor(cs.*)`)라 이번 변경과 무관하고, specified
`refs`에서 취하는 var() 토큰 **이름**(`firstVarName`)만 verdict 게이트로 처음 영향을
받는다 — var vs var 충돌의 승자 토큰 이름 교정(의도된 부수 개선, 리뷰 확정). 편집/CSS
뷰의 `[computed]` 폴백과 동일하다고 표현하지 않는다.

`collectRulesForElement`의 나머지 호출부(`collectCustomPropsFor` :1710 — customPropsOnly,
`collectTokens` 경유)는 claims를 호출마다 새로 만들어 판정 상태가 새지 않고,
customPropsOnly 경로는 일반 prop이 전부 `wantedProps` 필터에서 탈락해 `noteClaim` 도달
선언이 0개다 — 아래 가드로 specificity 계산 자체를 건너뛴다.

## 변경 범위

### `src/content/css-resolve.ts` (수정)

- **`Specificity = readonly [number, number, number]`** (신규 export): ID·class/attribute/
  pseudo-class·type/pseudo-element 성분을 보존한다. `compareSpecificity()`가 사전식으로
  비교해 임의 cap이나 스칼라 충돌을 만들지 않는다.
- **`selectorSpecificity(selector: string): Specificity | null`** (신규 export, 순수):
  단일 셀렉터(콤마 없음)의 specificity 튜플. 판정 불가면 `null`.
- **`matchedSpecificity(el, selectorText): Specificity | null`** (신규 export):
  `splitSelectorList()`로 나눈 뒤 `el.matches()`로 실제 매치되는 파트 중 최고
  specificity(CSS 사양과 동일). `el`은 `matches(sel: string): boolean`만 요구하는
  구조적 타입으로 받아 node 테스트에서 스텁 주입 가능하게 한다.
- **`hasOpaqueCascadeContext(rule: CSSStyleRule): boolean`** (신규, 내부): 정확한 승자
  판정을 별도 구현하지 않는 `@layer` 또는 `@scope` 소속 판정.
- **`ClaimState.candidates`** 항목에 `specificity: Specificity | null` 추가.
- **`noteClaim()`**: `specificity: Specificity | null = null` 파라미터 추가 + **boolean
  반환**(이 선언이 현재 승자인가). 기존 호출부(테스트 포함)는 기본값·반환 무시로
  컴파일 유지.
- **`applyDeclarations()`·`extractVarPropsFromCssText()`·`extractVarPropsFromMap()`**:
  `specificity` 파라미터 스레딩. `applyDeclarations`의 두 쓰기 지점은
  `noteClaim` verdict && `shouldOverwriteSpecified` 둘 다 통과해야 쓴다.
- **`collectRulesForElement()`**: 규칙당
  `hasOpaqueCascadeContext(rule) ? null : matchedSpecificity(el, rule.selectorText)` 1회 계산 후
  세 호출(`extractVarPropsFromMap`/`FromCssText`, `applyDeclarations`)에 전달.
  inline 패스는 `null` 전달(inline은 origin `"[inline]"` 분기가 이미 처리).
  **`customPropsOnly`면 계산을 건너뛰고 `null` 전달** — 그 경로(조상 custom prop
  순회)는 일반 prop이 전부 필터 탈락해 계산이 사장된다(비용 낭비 제거).
- `shouldOverwriteSpecified()`·`resolveUncertainSpecified()`·`claimBorderProp()`·
  shorthand split 파생 claim은 **무변경**(아래 "역할 분리" 참조).

### `src/content/__tests__/css-resolve.test.ts` (수정)

신규 describe: `selectorSpecificity`·`matchedSpecificity`·`noteClaim` specificity
시나리오. 기존 `noteClaim` 테스트는 시그니처 하위호환이라 그대로 green.

### `src/content/css-source-cache.ts` (무변경)

`splitSelectorList`를 css-resolve에서 import만 추가(이미 같은 모듈에서 다른 심볼
import 중).

## specificity 계산 사양

`selectorSpecificity` 는 한 패스 토크나이저로 `[a, b, c]`를 계산한다:

| 토큰 | 기여 |
|---|---|
| `#id` | a += 1 |
| `.class`, `[attr…]`(따옴표 인식 스킵), 함수형 아닌 pseudo-class(`:hover`) | b += 1 |
| 함수형 pseudo-class(`:nth-child(2n)` 등) | b += 1, 괄호 인자 스킵 |
| `:where(…)` | 0 기여, 인자 스킵 |
| type(`div`), pseudo-element(`::before` + 레거시 단일콜론 `:before/:after/:first-line/:first-letter`) | c += 1 |
| `*`, 결합자, `\` 이스케이프 다음 문자 | 0 기여 |

**`null` (판정 불가) 반환 조건** — 이 규칙의 충돌은 기존 uncertain 경로로:

- `:is(`/`:not(`/`:has(` 포함 — 인자 내부 specificity의 정확 재현(인자 중 최고값)이
  중첩·매치 판정까지 요구해 부담이므로 보수적으로 uncertain 처리(스펙이 허용한 판단
  — 코드 주석으로 남긴다).
- `::slotted(`/`::part(` — 인자가 specificity에 가산되는 특례.
- `&` 포함(CSS nesting — `:is(부모)` 상당이라 위와 같은 이유).
- `:nth-child(… of S)`/`:nth-last-child(… of S)` — `of` 셀렉터 인자 가산 특례.
  인자 내 최상위 ` of ` 감지 시 null.
- 최상위(대괄호 밖) `|` — 네임스페이스(`ns|div`)를 토크나이저가 type 2개로 오분류할
  수 있어 보수적 null. `[attr|=…]`는 대괄호 스킵에 흡수되므로 무관.
- `:host(`/`:host-context(` — 인자 specificity 가산 특례. document 시트만 순회하므로
  일반 요소엔 실도달이 없으나 방어적으로 등재.

`&`는 현행 인덱서가 nested rule 내부로 하강하지 않아(`walkRulesForIndex`는
CSSStyleRule이면 자식을 안 봄) `getMatchingRules` 경유로는 도달 불가 — null 등재는
방어용이다.

`matchedSpecificity` 추가 규칙:

- 파트별 `el.matches()`가 throw → 전체 `null`(그 파트가 승자인지 알 수 없다).
- 매치된 파트 중 하나라도 specificity `null` → 전체 `null`(그 파트가 최고일 수 있다).
- 매치 파트 0개(인덱스 손상 등 비정상) → `null`.

`hasOpaqueCascadeContext`:

- `rule.parentRule` 체인에 `CSSLayerBlockRule`(`typeof` 가드 — jsdom 부재 대비) 존재,
  또는 `rule.parentStyleSheet`의 `ownerRule` 체인에 `layerName != null`인
  `CSSImportRule`(익명 layer는 `""`라 `!= null` 판정) 존재 시 true.
- `rule.parentRule` 체인에 `CSSScopeRule`(`typeof` 가드) 존재 시 true. scope proximity는
  specificity 뒤·source order 앞의 별도 캐스케이드 축이라 현재 모델로 확정하지 않는다.

## noteClaim 판정 순서 (변경 후)

반환값은 "이 선언이 현재 승자로 남았는가":

1. 첫 후보 → 채택, `true`.
2. important 교차 → important 선언을 채택하고 각각 `true`/`false`. **채택 시
   `uncertain.delete`**(현행 코드 1084행 유지) — important는 이전의 모든 normal
   후보(candidates가 잊은 null-spec 패자 포함)를 specificity 무관하게 이기므로
   판정 불가 이력이 무효화된다. 누락하면 null-spec 충돌 후 important 도착 케이스가
   현행보다 computed 폴백으로 더 떨어지는 회귀.
3. inline 교차 → inline 선언을 채택하고 각각 `true`/`false`. 같은 이유로 **채택 시
   `uncertain.delete`**(현행 1089행 유지).
4. `previous.specificity != null && specificity != null`:
   - `compareSpecificity(specificity, previous.specificity) >= 0` → 채택(동률은 문서순 뒤 승 — 순회가
     `seq` 오름차순임을 `getMatchingRules`가 보장), `true`. **uncertain 추가 안 함.**
   - `<` → 이전 승자 유지, `false`. **`uncertain.delete` 하지 않는다** — 이 prop이
     앞서 null-spec 후보와의 충돌로 이미 uncertain이면 그 판정 불가 이력은 유효하다
     (candidates는 마지막 승자 1개만 기억하므로 삭제하면 이력을 잃는다). 보수 유지.
5. 같은 값 + 어느 한쪽 `null` → 값 자체는 확정이므로 uncertain을 늘리지 않고 이전
   후보를 유지, `false`. 출처를 알 수 없는데 뒤 선언을 승자로 단정하지 않는다.
6. 다른 값 + 어느 한쪽 `null` → 기존대로 채택 + `uncertain.add`, `true`.

같은 값도 2–4의 승자 비교를 먼저 탄다. 그렇지 않으면 낮은 specificity·일반 선언이
`true`를 받아 `sources[prop]`를 패자 셀렉터로 덮는 회귀가 생긴다.

## 역할 분리 (쓰기 게이트)

승자 판정과 표기 보호를 한 함수에 겸하게 하지 않는다(POSTMORTEM 2026-08-01 "한 대입문이
둘을 겸하면 조용히 하나를 버린다"):

- **`noteClaim` = 규칙 간 캐스케이드 승자** (important > inline > specificity > 문서순).
- **`shouldOverwriteSpecified` = 표기 보호** (var() 토큰 강등 방지·shorthand 파생
  양보·중요도) — 시그니처·동작 무변경.

`applyDeclarations`의 쓰기: `noteClaim` verdict가 `false`면 skip(패자 값이 out을
덮지 않는다 — 이게 없으면 uncertain만 줄고 out엔 여전히 마지막 규칙 값이 남아
**패자 원문이 확정 표시되는 더 나쁜 회귀**가 된다). verdict `true`면 기존
`shouldOverwriteSpecified` 게이트를 그대로 통과해야 쓴다(토큰 보호 규율 유지 —
specificity 승자가 리터럴이고 현재 값이 author var()면 여전히 안 덮는다. 이는
`resolveUncertainSpecified`의 기존 토큰 보존 트레이드오프와 같은 방향).

**verdict false가 막는 것은 out/sources 쓰기뿐이다** — `claims.important.add`
(954·975행)와 값 빈 pending longhand의 important 기록(932행)은 게이트 **밖**에
남긴다. 게이트 안으로 끌려 들어가면 이후 `shouldOverwriteSpecified`의 중요도 판정이
무너진다. "verdict && shouldOverwriteSpecified" 결합식이 쓰기 3지점(applyDeclarations
2곳 + var 직접 prop)에 반복되므로 Task 4가 부기 3지점의 게이트 밖 유지를 검증한다.

**var() 방향 전환(리뷰 확정)**: 낮은 specificity의 var() 선언은 현행에선 last-wins로
살아남아 토큰이 표시됐지만, 새 판정에선 verdict `false`로 쓰기가 막혀 승자 리터럴이
표시된다 — POSTMORTEM 2026-06-28 "토큰 우선은 specificity 무시하는 의도된 근사"의
절반(패자 토큰 노출)을 승자 정확성 쪽으로 뒤집는 결정이다. 반대 방향(현재 값이
author var()이고 뒤 승자가 리터럴)은 `shouldOverwriteSpecified`가 기존대로 보호한다
— 이때 out은 var, candidates 승자는 리터럴로 갈라지는 의도된 비대칭. 두 방향 모두
교차 테스트로 고정한다(Task 3·4).

var 경로(`extractVarPropsFromMap`)의 **직접 선언 prop**(shorthand 키 자체·var 낀
longhand)도 `claims`가 있으면 `noteClaim`을 먼저 태워 같은 verdict 게이트를 적용한다.
CSSOM 패스(`applyDeclarations`)가 같은 선언을 중복 등록해도 같은 값·origin·specificity라
동률 뒤 선언 분기로 무해하다. **파생 longhand claim(`claimBorderProp`·split 전개)은
`noteClaim`을 태우지 않는다(현행 유지)** — 파생값을 후보로 등록하면 직접 선언과의
교차에서 지금 없던 uncertain이 새로 생겨 computed 폴백이 늘어난다(회귀).

단, **직접 prop(shorthand 키)의 verdict가 `false`면 그 규칙의 파생 전개도 통째로
건너뛴다(리뷰 확정)**. 전개가 게이트 밖에 남으면 3규칙 교차 — 높은 spec 직접
`border-top-color` → 낮은 spec `border` shorthand(파생이 verdict 없이 out을 덮음) →
더 낮은 spec 패배(verdict false, 쓰기 skip) — 에서 candidates는 승자 확정인데 out은
파생 패자 값이 되는 desync가 생겨, uncertain 안전망 없이 "패자 원문 확정 표시"가
파생 경로에서 재현된다. 전개 스킵은 파생을 후보로 등록하지 않으므로 위의 "새
uncertain 증가" 없이 이 구멍만 막는다. 잔여 근사: **승자로 남은** shorthand의
파생값과 타 규칙 직접 선언 간 specificity 비교는 여전히 하지 않는다(POSTMORTEM
2026-06-28 "의도된 근사" 유지 — 한계로 명시).

## 데이터 흐름

```
collectRulesForElement(el, …)
  └ for rule of getMatchingRules(el)          // seq 오름차순 = 문서 순서
      spec = hasOpaqueCascadeContext(rule) ? null : matchedSpecificity(el, rule.selectorText)
      ├ extractVarPropsFromMap/FromCssText(…, spec)   // 직접 prop: noteClaim verdict → claimSpecified
      └ applyDeclarations(decl, …, spec)              // noteClaim verdict && shouldOverwriteSpecified → out 쓰기
  └ inline 패스: applyDeclarations(style, …, "[inline]", null)
  └ mergeCrossOriginDecls(…)                  // 무변경 (아래)
  └ return claims.uncertain                   // → resolveUncertainSpecified (무변경)
```

## 다운스트림 영향 (수용 결정)

uncertain 감소는 `specifiedStyles` 값(computed rgb → 승자 원문)과 **키 존재**(computed
빈값으로 delete되던 prop의 부활)를 바꾼다. 값 정규화 헬퍼가 코드베이스에 없어(rgb↔hex
비교 불가) 표기 변화가 소비처 판정에 그대로 노출된다. 소비처별 영향과 결정:

- **스와치·기본값 디밍 상실 — 수용**: `currentColor`·`color-mix()`·`light-dark()` 원문은
  `isRenderableColorLiteral`(`colorLiteral.ts`) 불통과로 ValueCombobox placeholder·diff
  표의 ColorSwatch가 사라지고, `0`·`black` 원문은 `isKnownDefault`(computed 표기 전제)
  매칭 실패로 디밍이 풀린다. 원문 우선이 목적이고 computed는 별도 표시가 유지되므로
  수용. colorLiteral·KNOWN_DEFAULTS 원문 표기 보강은 후속 작업 후보(hex 정규화와 인접).
- **리포트 as-is 계산 전 원문 — 수용(리뷰 확정)**: `buildStyleDiff`의 before
  (`specified ?? computed`)가 `calc(100% - 20px)`·`red`·`1.5em` 같은 원문으로 바뀐다.
- **`hasStyleChange`·`StyleChangesTable`의 원시 문자열 비교 — 의도된 개선**: 사용자가
  승자 원문과 같은 값을 입력하면 "변경 없음" 판정되는 집합이 확대된다(phantom diff
  제거).
- **`collapseShorthands` 4면 축약 풀림 — 수용**: computed는 `0px` 4면 균일이었지만
  원문이 `0` vs `0px`로 섞이면 축약이 풀려 리포트가 longhand 4행이 된다. Quad 필드
  링크 토글 초기 상태(`useLinkedProps`)도 같은 문자열 동일성에 걸린다. 수동 테스트로
  관찰.
- **`isCssDraftUnapplied` 배너 오탐 경로 확대 — 수용**: 재수집(`picker.selectionUpdated`)
  에서 승자 규칙이 바뀌면 손대지 않은 prop의 표기 변화로 "미적용 초안" 오탐 가능.
  기존에도 가능한 경로의 확대라 회귀는 아님 — 수동 테스트 항목으로 관찰.

## 인터페이스 설계

```typescript
export type Specificity = readonly [number, number, number];

// 단일 셀렉터(콤마 없음)의 specificity 튜플. 판정 불가면 null.
export function selectorSpecificity(selector: string): Specificity | null;

export function compareSpecificity(a: Specificity, b: Specificity): -1 | 0 | 1;

// selector list에서 el에 실제 매치되는 파트 중 최고 specificity. el은 구조적 타입.
export function matchedSpecificity(
  el: { matches(selectors: string): boolean },
  selectorText: string,
): Specificity | null;

export interface ClaimState {
  important: Set<string>;
  derived: Set<string>;
  candidates: Map<
    string,
    { value: string; important: boolean; origin: string; specificity: Specificity | null }
  >;
  uncertain: Set<string>;
}

// 반환: 이 선언이 현재 승자로 남았는가. false면 호출부가 out 쓰기를 건너뛴다.
export function noteClaim(
  claims: ClaimState,
  property: string,
  value: string,
  important: boolean,
  origin: string,
  specificity?: Specificity | null, // default null — 기존 호출부 하위호환
): boolean;
```

## cross-origin 경로 확인 결과 (스펙 지시 이행)

`mergeCrossOriginDecls()`(`css-resolve.ts:870`)는 `noteClaim`을 호출하지 않는다 —
same-origin이 채운 prop은 건드리지 않는 gap-fill이고, cross-origin 규칙끼리는 seq
오름차순 last-wins(`shouldOverwriteSpecified` 기본 플래그 호출)다. **uncertain 마킹
자체가 없어 computed 폴백 경로와 무관**하므로 스펙의 "같은 판정을 타면 동일 적용"
조건이 성립하지 않는다 → 무변경. cross-origin 파서(`indexCrossOriginRules`)는 `@layer`
블록을 평탄화해 layer 정보 자체가 소실되는 점도 동일 판정을 불가능하게 한다. 이
last-wins 근사는 POSTMORTEM 2026-06-28에 "의도된 근사"로 이미 수용돼 있다.

## 기존 패턴 준수

- 순수 함수 + node 트랙 테스트(`*.test.ts`), 같은 디렉터리 `__tests__/` (CLAUDE.md
  테스트 2트랙).
- 쓰기 판정 단일 출처 유지(POSTMORTEM 2026-07-31): `shouldOverwriteSpecified`/
  `claimSpecified` 경유 구조를 깨지 않고, 승자 판정만 `noteClaim`으로 분리 강화.
- 주석은 WHY 비자명한 곳 한 줄(보수적 null 처리 사유·uncertain 비삭제 사유·파생
  경로 제외 사유).

## 대안 검토

1. **`@layer` 순서까지 재현해 layer 규칙도 확정** — 기각. layer 트리 순서·중첩·
   `revert-layer`까지 필요해 스코프 대비 과대. 스펙이 명시적으로 제외.
2. **specificity를 cap 적용 스칼라로 반환** — 기각. CSS는 성분별 사전식 비교이고
   각 성분에 규격상 상한이 없어 cap 충돌이 가능하다. `[a,b,c]` 튜플로 정확히 비교한다.
3. **`shouldOverwriteSpecified`에 specificity 파라미터를 직접 추가** — 기각.
   candidates(이전 승자의 specificity)를 모르는 함수라 호출부마다 조회 코드가 복제돼
   POSTMORTEM의 "가드 복제 드리프트" 함정을 재현한다. verdict 반환으로 판정을
   `noteClaim` 한 곳에 모은다.
4. **`:is()`/`:not()` 인자 specificity 정확 재현** — 보류(보수적 null). 인자 최고값
   규칙 + 중첩 파싱이 필요하고, 실패 시 잘못된 확정(패자 표시)이 uncertain보다
   해롭다. 스펙이 보수 처리를 허용.

## 위험 요소

- **verdict 게이트 누락 회귀**: `noteClaim`만 고치고 쓰기 게이트를 빼먹으면 out에
  패자 값이 확정 표시된다(uncertain 감소가 오히려 해가 됨). Task 4의 수용 테스트가
  "uncertain 비움 + out 값 = 승자 값" **둘 다** 검증해야 한다.
- **매치 순회 비용**: 계산은 규칙당 1회지만 `collectRulesForElement`는 요소당 1회가
  아니라 **1 + 상속 조상 A + custom prop 조상 D회** 호출되므로 총량은 (호출 수 ×
  매치 규칙 수 × 파트별 `el.matches()`)다. 그래도 수용 — 기존 `getMatchingRules`가
  이미 호출당 후보 전수 + cross-origin 규칙에 `el.matches()`를 돌고 있어 추가분은
  수 % 수준. 예외 조건: cross-origin 시트가 없고 셀렉터 리스트가 긴 리셋 시트가
  많은 페이지에선 추가분이 +100~200%까지 갈 수 있다 — 그때도 customPropsOnly 가드
  (조상 D회 낭비 제거)가 하한을 지킨다. selectorText 단위 memoize는 측정 없이
  추가하지 않는다(요청 없는 유연성 금지).
- **테스트 시그니처 결합**: 기존 `noteClaim` 테스트가 positional 인자라 파라미터를
  중간에 끼우면 전부 깨진다 — 반드시 **마지막 optional**로 추가.
- **serialization 차이로 인한 자기 충돌**: 같은 규칙을 raw 파서와 CSSOM이 다른
  표기로 읽으면(공백 등) 동일 값 경로를 빠져나갈 수 있다. var 경로는 var() 값만
  다루고 `resolveUncertainSpecified`가 var() 값은 computed로 대체하지 않으므로
  (`css-resolve.ts:1049`) 실해 없음 — 주석으로 남긴다.
- **node/jsdom에 `CSSLayerBlockRule`/`CSSScopeRule` 부재**: `typeof` 가드 필수.
  단위 테스트는 `globalThis`에 동명 클래스를 세워 스텁한다.
