# CSS specificity 판정 정밀화 — 캐스케이드 승자 불확정 모수 축소

## 배경

편집 패널은 요소 스타일을 CSSOM 원문(specified) 우선으로 표시하고, 캐스케이드 승자를
확정 못 하면 computed로 폴백한다. 현재 `src/content/css-resolve.ts`의 `noteClaim()`은
같은 속성을 **다른 값**으로 선언한 규칙이 2개 이상 매치되면 specificity를 비교하지 않고
즉시 `uncertain`으로 마킹하고, `resolveUncertainSpecified()`가 그 속성을 computed 값
(출처 `[computed]`)으로 대체한다. 그 결과 규칙이 여러 개 걸리는 요소(예: google.com
검색 버튼의 `background-color: #f8f9fa`)에서 원문 hex 대신 `rgb(248, 249, 250)`이
표시된다.

## 목표

1. 매치된 셀렉터의 specificity를 계산해 캐스케이드 승자 판정에 편입, `uncertain`으로
   떨어지는 모수를 줄인다. **수용 기준**: "서로 다른 specificity의 규칙 2개가 다른
   값으로 같은 속성 선언" 케이스에서 specified 원문이 유지되고 `[computed]` 대체가
   일어나지 않는 테스트가 red→green 전환.
2. 같은 specificity + 다른 값은 문서 순서상 뒤가 승자 — **확정**이지 uncertain이 아니다.
3. 기존 규율 유지: `!important` > specificity, inline(`[inline]`) > 일반 규칙,
   author var() 토큰 강등 방지(`shouldOverwriteSpecified`).
4. computed 폴백 정책 자체는 유지 — specificity로도 확정 못 하는 케이스는 지금처럼
   `uncertain` → `[computed]` 경로를 탄다.

## 비목표 (Non-goals)

- `@layer` 순서 재현 — layer 소속 규칙 간 충돌은 기존 uncertain 경로 유지.
- `chrome.debugger`/CDP 사용.
- computed 폴백 표시값의 hex 정규화 (별도 작업).
- `resolveUncertainSpecified()` 동작 변경.
- cross-origin 규칙 경로의 판정 변경 — 탐색 결과 그 경로는 `noteClaim` 판정을 타지
  않는다(gap-fill + seq last-wins, uncertain 마킹 없음). design.md "cross-origin 경로
  확인 결과" 참조.

## 사용자 시나리오

1. 사용자가 element 모드로 규칙이 여러 개 걸린 요소(예: 리셋 규칙 `button` +
   구체 규칙 `.gNO89b`)를 선택한다.
2. 편집 패널·CSS 뷰에 `background-color`가 computed `rgb(…)`가 아니라 author가 쓴
   원문(`#f8f9fa`)으로 표시된다.
3. 인스펙터 툴팁도 같은 승자 판정을 공유해 색상·토큰 출처가 실제 승자 규칙을 따른다.
4. `:is()`/`:not()`/`@layer`/`@scope` 등 판정 불가 캐스케이드가 충돌에 끼면 기존대로 computed
   값이 표시된다(폴백 유지 — 회귀 아님).

## 성공 기준

- `pnpm test` + `pnpm typecheck` 통과, 기존 테스트 전부 green.
- specificity 역전·동률+문서순서·`!important` 교차·inline 교차·uncertain 잔존
  시나리오가 단위 테스트로 고정된다.
- 편집 탭·CSS 뷰·인스펙터 툴팁이 높은 specificity 규칙의 원문과 출처를 공통으로
  사용한다.
- 빌드는 돌리지 않는다.

## 가이드 영향: 없음

내부 판정 정밀화 — 레이아웃·라벨·조작 흐름은 불변이고 표시 값·출처의 정확도만 개선.
