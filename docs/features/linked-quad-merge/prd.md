# Linked 4면 속성 병합 필드

## 배경

스타일 편집 패널의 박스모델 속성(margin, padding, border-width/color/style, border-radius, gap)은
`QuadProp`·`QuadStyleProp`·`RadiusProp`·`GapPairProp`가 4면(또는 4코너·2축) 필드를 `grid-cols-4`로
나란히 보여준다. 각 묶음에는 `LinkToggle`(체인 아이콘)이 있어 linked 모드를 켜면 한 면을 고쳐도
4면이 동시에 같은 값으로 바뀐다(`useLinkedProps.setAllProps`).

문제: **linked 모드여도 4개 필드가 그대로 다 보인다.** 4면이 항상 같은 값으로 묶여 있는데
입력칸이 4개라 시각적으로 중복되고, 좁은 사이드패널에서 폭을 낭비한다. 4면을 한 값으로 다루는
상황이라면 필드도 하나면 충분하다.

부수 문제(diff 가독성): border를 4면 동일하게 width/style/color 셋 다 바꾸면 이슈 본문 diff에
`border-width`/`border-style`/`border-color` **3줄**이 장황하게 나온다. 박스모델을 한 값으로 묶어
다루는 같은 맥락의 UX 개선이라 같은 PR로 묶는다 — 단, 구현은 UI 병합(`StylePropEditors.tsx`)과
완전히 독립한 diff 직렬화(`StyleChangesTable.tsx`) 변경이며 linked 토글과도 무관하다(아래 비목표·목표 참조).

## 목표

- linked 모드일 때 4면(/4코너/2축) 필드를 **단일 입력 필드 1개로 병합**해 보여준다.
- unlinked 모드일 때는 **지금과 동일하게** per-side 4개 필드를 보여준다.
- 단일 필드에서 값을 입력하면 기존 `setAllProps`로 4면 동시 반영(동작 변화 없음).
- `LinkToggle`은 두 모드 모두에서 그대로 노출돼 모드 전환이 가능하다.
- 4면 값이 서로 다른 상태에서 linked를 켜면 단일 필드는 값을 비우고 placeholder를 `mixed`로 표시한다
  (사용자가 새 값을 입력해야 4면이 통일된다 — 기존 값을 임의로 덮어쓰지 않는다).
- **(추가) 이슈 draft diff의 `border` 완전 통합**: `border-width`·`border-style`·`border-color`가
  **셋 다 4면 동일값으로 변경**됐을 때, 3줄(`border-width`/`border-style`/`border-color`) 대신
  `border: <width> <style> <color>` **한 줄**로 합쳐 출력한다.

## 비목표 (Non-goals)

- 기존 shorthand 축약의 트리거 조건(linked 토글 무관, "4면 값이 동일")은 바꾸지 않는다.
  `padding`/`margin`/`border-width`/`border-color`/`border-style`/`border-radius` 1차 축약은 현행 유지.
- linked 초기 자동 판정 로직(`sidesAllEqual` — 선택 요소의 4면이 같으면 linked로 시작)은 바꾸지 않는다.
- (UI) 상태/스토리지/메시지 모델 변경 없음. UI 측은 순수 표현 변경. 저장 모델은 면별 longhand 유지.

## 사용자 시나리오

1. 요소를 선택하고 스타일 패널을 연다. padding 4면이 모두 `8px`인 요소 → padding 묶음이 자동으로
   linked로 시작하고 **단일 필드 하나**에 `8px`가 보인다(미편집 요소라면 회색 placeholder로 표시 —
   편집값 없이 specified/computed 유래라 value가 아니라 placeholder다. 기존 per-side 필드와 동일 동작).
   LinkToggle은 켜진(체인) 상태.
2. 단일 필드에 `16px` 입력 → 4면 모두 `16px`로 적용되고 페이지에 라이브 반영.
3. LinkToggle을 끈다(unlink) → 필드가 **4개(top/right/bottom/left)**로 펼쳐지고 각 면을 개별 편집 가능.
4. 4면 값이 제각각인 요소(예: `padding-top: 4px`, 나머지 `0`)를 선택 → 묶음이 unlinked로 시작,
   4개 필드 노출.
5. (엣지) 4면이 다른 unlinked 상태에서 LinkToggle을 켠다 → 단일 필드로 접히고, 값은 비어 있으며
   placeholder가 `mixed`. 사용자가 값을 입력하면 4면 통일.
6. border 묶음: width/color는 `QuadProp`, style은 `QuadStyleProp`(select). linked면 각각 단일
   필드/단일 select로 접힌다. border-style 단일 select가 4면 불일치(mixed)면 trigger 라벨에
   `혼합`/`Mixed`를 muted 텍스트로 표시(input placeholder와 동일 문구·시각).
7. gap 묶음(`row-gap`/`column-gap` 2축): linked면 단일 필드 1개로 접히고, unlinked면 2개 필드.
   두 축 값이 다른 상태에서 linked를 켜면 다른 4면 묶음과 동일하게 `mixed` placeholder.
8. (diff) border-width `2px`·border-style `solid`·border-color `red`를 모두 4면 동일하게 바꾼 뒤
   이슈를 만들면 본문 diff에 `border | … | 2px solid red` 한 줄이 나온다. 셋 중 일부만 바꿨다면
   바뀐 것만 개별 줄(`border-width: 2px` 등)로 나온다.

## 성공 기준

- linked 묶음은 입력 필드가 1개만 렌더된다(아이콘+값).
- unlinked 묶음은 입력 필드가 4개(gap은 2개) 렌더되며 동작이 기존과 동일하다.
- 단일 필드 입력 → 4면 동시 반영(`setAllProps` 경로 그대로).
- 4면 불일치 + linked → 단일 필드 placeholder가 `mixed`, value는 빈 값.
- border-style 단일 select가 4면 불일치(mixed)면 trigger 라벨에 `혼합`/`Mixed`(muted), select value는 빈 값.
- 적용 대상: margin, padding, border-width, border-color, border-style, border-radius, gap 전부.
- diff: border width/style/color 셋 다 4면 동일 변경 시 `border: W S C` 한 줄. 일부만 변경 시 개별 줄.
  padding/margin 등 기존 1차 축약은 회귀 없음.
- 단위 테스트(공통값/mixed 판정 + border 2차 통합)·기존 테스트 모두 통과.
