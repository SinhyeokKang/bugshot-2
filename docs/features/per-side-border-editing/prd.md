# 변별(side별) Border 편집 + border-color 캡처 버그 수정

## 배경

디자인 QA는 종종 "아래 테두리만 1px이 아니라 2px여야 한다", "이 카드 좌측 보더 색이 틀렸다"처럼 **특정 변(side) 단위의 픽셀 피드백**을 다룬다. BugShot 사용자는 picker로 잡은 요소를 그 자리에서 고쳐 before/after로 리포트하려 하지만, 정작 그 한 변을 조정할 입력칸이 편집기에 없다. margin·padding은 네 변을 개별 편집할 수 있는데 border만 못 한다.

요소 스타일 편집기의 container 섹션은 border를 "네 변 한 덩어리"로만 다룬다. 현재 필드는 `border`(전체 shorthand) · `border-color` · `radius`(4코너)뿐이다.

두 가지 문제가 있다.

1. **변별 border 미지원.** `border-bottom: 1px solid` 처럼 한 변에만 윤곽선이 있거나 변마다 두께가 다른 경우, 편집기에 입력칸이 없다. 유일한 후보인 `border` 전체 shorthand 필드는 `getComputedStyle(el).border`가 네 변이 다르면 빈 문자열을 돌려줘 placeholder가 비고, 따라서 화면에 아무것도 안 나온다. margin·padding은 `QuadProp`으로 4변을 개별 편집(+ 링크 토글)하는데 border만 그 패턴이 없다.

2. **`border-color` 필드가 항상 빈 채로 렌더(버그).** 패널에는 `border-color` 입력칸이 분명히 있는데(`StyleEditorPanel.tsx:248`), 스타일 수집 목록 `INTERESTING_PROPS`(`src/content/css-resolve.ts:9`)에 `border-color`가 빠져 있다. placeholder는 `specifiedStyles[prop] || computedStyles[prop]`인데 둘 다 이 prop을 수집하지 않아 늘 비어 있다. 예: Tailwind `border-border`(= `border-color: hsl(var(--border))`)를 줘도 필드에 아무 값이 안 잡힌다.

## 목표

- container 섹션의 border 편집을 margin·padding과 동일한 변별 편집 패턴으로 바꾼다.
  - **border-width**: 4변 개별 편집(`QuadProp`) + 링크 토글.
  - **border-color**: 4변 개별 편집(`QuadProp`) + 링크 토글. 이로써 캡처 버그도 해소된다.
  - **border-style**: 단일 `Select`(solid/dashed/dotted/double/none 등). 변별 스타일은 드물어 단일로 둔다.
- 기존 `border`(전체 일괄) shorthand 입력칸은 **제거**한다(margin·padding 섹션에 일괄 shorthand 필드가 없는 것과 동일).

> **변경되는 동작(사용자 영향)**: 지금까지 `border` 한 줄에 `1px solid red`를 통째로 넣던 *빠른 일괄 입력*은 사라진다. 네 변을 한 번에 같은 값으로 주려면 각 QuadProp의 **링크 토글**을 켜고 한 칸만 입력하면 된다(margin·padding과 동일한 조작). 이 트레이드오프(통합 입력 → 링크 토글 일괄)를 수용한다.

> **버그 수정 묶음 정당화**: `border-color` 캡처 버그(단독으론 `INTERESTING_PROPS`에 한 줄 추가)는 변별 longhand를 캡처 목록에 넣는 과정에서 자연히 해소되므로, 별도 핫픽스로 분리하지 않고 이 기능에 포함한다(사용자 명시 요청).
- 변별 border 값이 실제로 캡처되어 패널 placeholder·source 툴팁·토큰 매칭에 정상 표시된다. (Tailwind `border-b`·`border-border`가 각각 두께·색 필드에 나타난다.)
- 변별 값을 페이지에 라이브 반영하고, before/after diff 테이블에 정확히 표기한다(네 변이 같으면 `border-width`/`border-color`로 collapse).

## 비목표 (Non-goals)

- border-radius는 변경하지 않는다(이미 코너별 편집 지원).
- 변별 `border-style`(top/right/bottom/left 각각 다른 스타일)은 지원하지 않는다(단일 Select).
- `border-image`, `outline`, `box-shadow` 등 다른 윤곽 속성은 범위 밖.
- 페이지가 `border: 1px solid red` 같은 **전체 shorthand**로 선언한 경우의 변별 source/토큰 역추적까지 완벽히 하지는 않는다(computed로 값은 보이되 source 툴팁은 생략될 수 있음 — design.md 위험 요소 참조).

## 사용자 시나리오

1. 사용자가 `border-bottom: 1px solid #ccc`만 있는 요소를 선택한다.
   - container 섹션을 열면 border-width 4칸 중 **아래(bottom)** 칸에 `1px`, 나머지 변은 computed 기본값 `0px`가 흐리게(default-dimmed) 표시된다.
   - border-color 4칸의 아래 칸에 `#ccc`(또는 매칭되는 토큰)가 보인다.
   - border-style Select에 `solid`가 보인다.
2. 사용자가 아래 칸 두께를 `2px`로 바꾸면 페이지에 즉시 반영된다.
3. 링크 토글을 켜고 한 칸을 `1px`로 입력하면 네 변이 모두 `1px`가 된다.
4. **변경사항 보기**를 누르면, 네 변이 같을 때 `border-width: ... → ...` 한 줄로, 다르면 변별 행으로 표기된다.
5. Tailwind `border-border` 요소를 선택하면 border-color 4칸에 `--border` 토큰이 표시된다(현재는 아무것도 안 보임 → 버그 수정 확인).

## 성공 기준

- `border-bottom-width`·`border-{side}-color`가 패널 필드에 표시·편집되고 페이지에 라이브 반영된다.
- `border-color`(예: `border-border`) 값이 필드에 정상 표시된다(회귀 버그 해소).
- 네 변이 동일한 border-width/border-color 편집이 diff 테이블에서 단일 shorthand 행으로 collapse된다.
- margin·padding·radius·gap 등 기존 `QuadProp`/`GapPairProp` 사용처가 회귀 없이 동작한다.
- **실페이지 대표 케이스(수동/e2e)**: Tailwind `border border-b-2`(아래만 두꺼운 보더) 요소에서 변별 두께가 정확히 표시·편집되고, 일반 `border: 1px solid red`(전체 shorthand) 요소에서 네 변 값이 모두 표시된다.
- `pnpm test` 통과(아래 단위 테스트 포함), `pnpm typecheck` 통과.
