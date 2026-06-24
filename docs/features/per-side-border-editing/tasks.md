# 변별 Border 편집 + border-color 버그 수정 — 구현 태스크

## 선행 조건

- 신규 의존성·권한·env 없음. 순수 프런트엔드 변경.
- content 적용부(`handleApplyStyles`)는 임의 prop을 이미 `setProperty`로 적용 → 변경 불필요.

## 태스크

### Task 1: diff collapse 테스트 선작성 (TDD)
- **변경 대상**: `src/sidepanel/lib/__tests__/styleChangeGroups.test.ts` (기존 파일에 케이스 추가 — `buildStyleDiff`/`SHORTHAND_GROUPS`/`removeDiffRow`/`countChangeRows`가 모두 이 테스트에서 검증 가능. `src/sidepanel/components/__tests__/`는 없으므로 신규 파일 만들지 않음.)
- **작업 내용**: 다음 케이스 추가.
  - 네 변 동일한 `border-top/right/bottom/left-width` 편집 → 단일 `border-width` 행으로 collapse. `border-color`도 동일.
  - **부분 일치**(3변만 같고 1변 다름) → collapse 안 되고 개별 행 4개 유지.
  - 링크 끄고 **한 변만 빈 값으로 지우기** → 해당 longhand가 inlineStyle에서 빠지고 diff에 그 변 행 없음.
  - `removeDiffRow("border-width", ...)`가 4개 width longhand를 inlineStyle에서 제거.
  - `countChangeRows`가 네 변 동일 border-width 편집을 **1**로 센다(longhand 4가 아님).
- **검증**:
  - [x] 테스트가 추가되고, 구현 전이라 collapse/카운트 케이스는 실패(red)한다. (구현 후 green 전환 확인)

### Task 2: 데이터 레이어 — 캡처 + shorthand 확장
- **변경 대상**: `src/content/css-resolve.ts`
- **작업 내용**:
  - `INTERESTING_PROPS`에 `border-style`, `border-{top,right,bottom,left}-width`, `border-{top,right,bottom,left}-color` 추가. (`border` 전체 shorthand는 유지 — AI/diff 컨텍스트.)
  - `SHORTHAND_MAP`에 `border-width`·`border-color`(→ 각 4 longhand) 추가.
  - `TRBL_SHORTHANDS`에 `border-width`·`border-color` 추가.
- **검증**:
  - [x] `pnpm typecheck` 통과.
  - [x] **단위 테스트**(순수 함수): `splitTrblValue("red blue")`→`["red","blue","red","blue"]`, `splitTrblValue("hsl(var(--border))")`→색 함수 1토큰 보존 `[v,v,v,v]`. `splitTrblValue`/`splitCssTokens` export 후 `css-resolve.test.ts`에 케이스 추가·통과.
  - [ ] (실제 Chrome) `border-bottom: 1px solid #ccc` 요소 선택 시 payload의 `specifiedStyles`/`computedStyles`에 `border-bottom-width`·`border-bottom-color`가 잡힘.
  - [ ] `border-border`(border-color shorthand+var) 요소에서 변별 color에 `hsl(var(--border))` 보존(specified) 또는 resolved 값(computed).

### Task 3: prop 메타데이터
- **변경 대상**: `src/sidepanel/tabs/styleEditor/propMetadata.ts` + 신규 테스트 `src/sidepanel/tabs/styleEditor/__tests__/propMetadata.test.ts`
- **작업 내용**: `PROP_CATEGORY`에 4 width(`length`)·4 color(`color`) 추가, 고아가 된 `border-color` 제거. `KNOWN_DEFAULTS`에 4 width(`["0px"]`)·4 color(`["rgb(0, 0, 0)","currentcolor"]`)·`border-style: ["none"]` 추가, 고아 `border-color` 제거. `isKnownDefault`의 `border` 특례 유지(전체 shorthand 캡처 유지). **`"medium"`은 넣지 않는다**(computed가 `0px`로 resolve — design.md 참조).
- **검증**:
  - [x] 신규 `propMetadata.test.ts` 생성.
  - [x] `isKnownDefault("border-bottom-width","0px") === true`, `isKnownDefault("border-style","none") === true` 단위 테스트 통과.
  - [x] `pnpm typecheck` 통과.

### Task 4: QuadProp 일반화
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx`
- **작업 내용**: `QuadProp` 시그니처에 `props?: [string,string,string,string]` 추가, 내부 `props`를 `explicitProps ?? prefix 기반`으로 계산. 나머지 불변.
- **검증**:
  - [x] `pnpm typecheck` 통과.
  - [ ] (실제 Chrome) margin·padding 변별 편집·링크 토글이 기존대로 동작(회귀 없음).

### Task 5: 패널 container 섹션 교체
- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`
- **작업 내용**: container 섹션의 `border`/`border-color` 두 `TextProp`을 width 4변 `QuadProp` + `border-style` `SelectProp` + color 4변 `QuadProp`로 교체(`RadiusProp` 유지, 순서 width→style→color). `SECTION_PROPS.container`에서 `border`·`border-color`를 **모두 제거**, 변별 longhand 8개 + `border-style` 추가.
- **검증**:
  - [ ] (실제 Chrome) border-width/color 4칸 + style Select가 렌더되고, 입력이 페이지에 라이브 반영.
  - [ ] container 섹션 revert 버튼이 변별 border 편집을 모두 되돌림.
  - [ ] `border-bottom-width`만 있는 요소에서 섹션이 기본 펼침(`hasSpecified`).

### Task 6: diff collapse 그룹 추가 (Task 1 통과)
- **변경 대상**: `src/sidepanel/components/StyleChangesTable.tsx`
- **작업 내용**: `SHORTHAND_GROUPS`에 `border-width`·`border-color`(각 4 longhand) 추가.
- **검증**:
  - [x] Task 1 테스트가 green.
  - [x] `pnpm test` 전체 통과 (1969개).
  - [ ] (실제 Chrome) 네 변 동일 편집 시 **변경사항 보기**·마크다운에 단일 `border-width`/`border-color` 행, 변별 시 개별 행.

## 테스트 계획

- **단위 테스트**:
  - `buildStyleDiff`/`SHORTHAND_GROUPS` collapse: border-width·border-color 네 변 동일→단일 행, 변별→개별 행 (Task 1).
  - 부분 일치(3변만 같음)→개별 행 4개, 링크 끄고 한 변 빈 값 지우기→그 변 행 없음 (Task 1).
  - `removeDiffRow("border-width")`가 width longhand 4개 제거 (Task 1).
  - `countChangeRows`가 네 변 동일 border-width 편집을 1로 카운트 (Task 1).
  - `splitTrblValue`/`splitCssTokens`: `"red blue"` 2값 분해, `"hsl(var(--border))"` 색 함수 1토큰 보존 (Task 2).
  - `isKnownDefault` border-side-width `0px`, border-style `none` (Task 3).
- **e2e 시나리오** (`/e2e-write` 입력) — 기존 헬퍼(`e2e/fixtures/extension.ts`의 `propRow`/`setQuadSideValue`/`setQuadLinkedValue`/`selectStyleValue`)로 **data-testid 없이** 작성. src의 testid 추가 **불필요**(헬퍼가 label 텍스트 + 버튼 위치로 선택):
  - 요소를 선택하고 `setQuadSideValue(panel,"border-width",2,"2px")`로 아래 칸에 `2px`를 넣으면 해당 요소의 `border-bottom-width`가 `2px`로 바뀐다.
  - `setQuadLinkedValue`로 border-width 링크를 켜고 한 칸에 `1px`를 넣으면 네 칸이 모두 `1px`가 된다.
  - 네 변을 같은 두께로 바꾼 뒤 **변경사항 보기**를 열면 `border-width` 단일 행이 보인다.
  - `selectStyleValue(panel,"border-style","dashed")`로 style을 바꾸면 네 변에 일괄 적용된다.
- **수동 테스트** (실제 Chrome, CSSOM/getComputedStyle 의존):
  - [ ] Tailwind `border border-b-2`(또는 `border-b border-border`) 요소 선택 → border-width 아래 칸이 두꺼운 값, border-color 칸에 `--border` 토큰/색 표시(현재 버그: 아무것도 안 보임).
  - [ ] `border-color: red` 단일 shorthand 요소 → color 4칸에 red 표시.
  - [ ] `border: 1px solid red` 전체 shorthand 요소 → width/color 네 칸에 값 표시(source 툴팁은 생략될 수 있음 — 위험 요소).
  - [ ] 변마다 두께가 다른 요소 → 각 칸에 다른 값 표시, style Select에 solid.
  - [ ] **텍스트 색이 검정 아닌 요소**의 border-color 칸이 그 색의 rgb로 표시(currentcolor resolve 의도 확인). `transparent`(`rgba(0,0,0,0)`) 보더 색 표시 확인.
  - [ ] 변별 style 혼재 요소 → border-style Select가 빈(muted) 트리거로 보임(수용된 한계).
  - [ ] margin/padding/radius/gap 회귀 없음.

## 구현 순서 권장

Task 1(red) → Task 2 → Task 3 → Task 4 → Task 5 → Task 6(green). Task 2·3은 데이터 레이어로 병렬 가능, Task 4는 5의 선행. Task 6은 1의 구현 짝이라 마지막.

## 가이드 영향

사용자 노출 UX 변경(스타일 패널 border 편집 방식) → `/guide`로 갱신:
- `element/styling.md`(ko·en) — "스타일 패널 섹션"의 Container 설명에 border 변별 편집(두께·색 4변 + 스타일) 반영. 스크린샷 `element-styling-1.jpg`는 패널 변경 시 교체 대상(수동, 비목표).
- `guide/AUTHORING.md` — "사실 대조 소스"의 "스타일 패널 섹션·순서"(StyleEditorPanel) 항목과 일치하므로 별도 표 변경 불필요. Container 필드 구성이 바뀌었으니 본문 갱신 시 함께 확인.
