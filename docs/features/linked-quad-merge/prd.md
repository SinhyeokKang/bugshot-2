# Linked 4면 속성 병합 필드

## 배경

스타일 편집 패널의 박스모델 속성(margin, padding, border-width/color/style, border-radius, gap)은
`QuadProp`·`QuadStyleProp`·`RadiusProp`·`GapPairProp`가 4면(또는 4코너·2축) 필드를 `grid-cols-4`로
나란히 보여준다. 각 묶음에는 `LinkToggle`(체인 아이콘)이 있어 linked 모드를 켜면 한 면을 고쳐도
4면이 동시에 같은 값으로 바뀐다(`useLinkedProps.setAllProps`).

문제: **linked 모드여도 4개 필드가 그대로 다 보인다.** 4면이 항상 같은 값으로 묶여 있는데
입력칸이 4개라 시각적으로 중복되고, 좁은 사이드패널에서 폭을 낭비한다. 4면을 한 값으로 다루는
상황이라면 필드도 하나면 충분하다.

## 목표

- linked 모드일 때 4면(/4코너/2축) 필드를 **단일 입력 필드 1개로 병합**해 보여준다.
- unlinked 모드일 때는 **지금과 동일하게** per-side 4개 필드를 보여준다.
- 단일 필드에서 값을 입력하면 기존 `setAllProps`로 4면 동시 반영(동작 변화 없음).
- `LinkToggle`은 두 모드 모두에서 그대로 노출돼 모드 전환이 가능하다.
- 4면 값이 서로 다른 상태에서 linked를 켜면 단일 필드는 값을 비우고 placeholder를 `mixed`로 표시한다
  (사용자가 새 값을 입력해야 4면이 통일된다 — 기존 값을 임의로 덮어쓰지 않는다).

## 비목표 (Non-goals)

- **이슈 draft의 CSS diff shorthand 축약은 변경하지 않는다.** `collapseShorthands`(StyleChangesTable.tsx)가
  이미 4면 동일값을 `padding`/`margin`/`border-width`/`border-color`/`border-style`/`border-radius`
  한 줄로 합쳐 출력한다. 트리거 조건(linked 토글 무관, "4면 값이 동일")도 현행 유지.
- `border-width`+`border-style`+`border-color`를 완전한 `border: 2px solid red` 한 줄로 통합하지 않는다
  (3줄 유지).
- linked 초기 자동 판정 로직(`sidesAllEqual` — 선택 요소의 4면이 같으면 linked로 시작)은 바꾸지 않는다.
- 상태/스토리지/메시지 모델 변경 없음. 순수 UI 표현 변경.

## 사용자 시나리오

1. 요소를 선택하고 스타일 패널을 연다. padding 4면이 모두 `8px`인 요소 → padding 묶음이 자동으로
   linked로 시작하고 **단일 필드 하나**에 `8px`가 보인다. LinkToggle은 켜진(체인) 상태.
2. 단일 필드에 `16px` 입력 → 4면 모두 `16px`로 적용되고 페이지에 라이브 반영.
3. LinkToggle을 끈다(unlink) → 필드가 **4개(top/right/bottom/left)**로 펼쳐지고 각 면을 개별 편집 가능.
4. 4면 값이 제각각인 요소(예: `padding-top: 4px`, 나머지 `0`)를 선택 → 묶음이 unlinked로 시작,
   4개 필드 노출.
5. (엣지) 4면이 다른 unlinked 상태에서 LinkToggle을 켠다 → 단일 필드로 접히고, 값은 비어 있으며
   placeholder가 `mixed`. 사용자가 값을 입력하면 4면 통일.
6. border 묶음: width/color는 `QuadProp`, style은 `QuadStyleProp`(select). linked면 각각 단일
   필드/단일 select로 접힌다.

## 성공 기준

- linked 묶음은 입력 필드가 1개만 렌더된다(아이콘+값).
- unlinked 묶음은 입력 필드가 4개(gap은 2개) 렌더되며 동작이 기존과 동일하다.
- 단일 필드 입력 → 4면 동시 반영(`setAllProps` 경로 그대로).
- 4면 불일치 + linked → 단일 필드 placeholder가 `mixed`, value는 빈 값.
- 적용 대상: margin, padding, border-width, border-color, border-style, border-radius, gap 전부.
- 이슈 draft diff 출력은 변경 전과 동일(회귀 없음).
- 단위 테스트(공통값/mixed 판정)·기존 테스트 모두 통과.
