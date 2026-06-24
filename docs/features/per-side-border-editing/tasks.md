# 변별 Border 편집 + border-color 버그 수정 — 구현 태스크

## 선행 조건

- 신규 의존성·권한·env 없음. 순수 프런트엔드 변경.
- content 적용부(`handleApplyStyles`)는 임의 prop을 이미 `setProperty`로 적용 → 변경 불필요.

## 태스크

### Task 1: diff collapse 테스트 선작성 (TDD)
- **변경 대상**: `src/sidepanel/lib/__tests__/styleChangeGroups.test.ts` (또는 신규 `StyleChangesTable` 테스트 파일)
- **작업 내용**: `buildStyleDiff`가 네 변 동일한 `border-top/right/bottom/left-width` 편집을 단일 `border-width` 행으로 collapse, 변별일 땐 개별 행 유지하는 케이스 추가. `border-color`도 동일. `removeDiffRow("border-width", ...)`가 4개 width longhand를 inlineStyle에서 제거하는지.
- **검증**:
  - [ ] 테스트가 추가되고, 구현 전이라 collapse 케이스는 실패(red)한다.

### Task 2: 데이터 레이어 — 캡처 + shorthand 확장
- **변경 대상**: `src/content/css-resolve.ts`
- **작업 내용**:
  - `INTERESTING_PROPS`에 `border-style`, `border-{top,right,bottom,left}-width`, `border-{top,right,bottom,left}-color` 추가.
  - `SHORTHAND_MAP`에 `border-width`·`border-color`(→ 각 4 longhand) 추가.
  - `TRBL_SHORTHANDS`에 `border-width`·`border-color` 추가.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] (실제 Chrome) `border-bottom: 1px solid #ccc` 요소 선택 시 payload의 `specifiedStyles`/`computedStyles`에 `border-bottom-width`·`border-bottom-color`가 잡힘.
  - [ ] `border-border`(border-color shorthand+var) 요소에서 변별 color에 `hsl(var(--border))` 보존(specified) 또는 resolved 값(computed).

### Task 3: prop 메타데이터
- **변경 대상**: `src/sidepanel/tabs/styleEditor/propMetadata.ts`
- **작업 내용**: `PROP_CATEGORY`에 4 width(`length`)·4 color(`color`) 추가, 고아가 된 `border-color` 제거. `KNOWN_DEFAULTS`에 4 width(`["0px","medium"]`)·4 color(`["rgb(0, 0, 0)","currentcolor"]`)·`border-style: ["none"]` 추가, 고아 `border-color` 제거. `isKnownDefault`의 `border` 특례 유지.
- **검증**:
  - [ ] `isKnownDefault("border-bottom-width","0px") === true` 단위 테스트 추가·통과.
  - [ ] `pnpm typecheck` 통과.

### Task 4: QuadProp 일반화
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx`
- **작업 내용**: `QuadProp` 시그니처에 `props?: [string,string,string,string]` 추가, 내부 `props`를 `explicitProps ?? prefix 기반`으로 계산. 나머지 불변.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] (실제 Chrome) margin·padding 변별 편집·링크 토글이 기존대로 동작(회귀 없음).

### Task 5: 패널 container 섹션 교체
- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`
- **작업 내용**: container 섹션의 `border`/`border-color` 두 `TextProp`을 width 4변 `QuadProp` + `border-style` `SelectProp` + color 4변 `QuadProp`로 교체(`RadiusProp` 유지). `SECTION_PROPS.container`에서 `border-color` 제거, 변별 longhand 8개 + `border-style` 추가, `border` 유지.
- **검증**:
  - [ ] (실제 Chrome) border-width/color 4칸 + style Select가 렌더되고, 입력이 페이지에 라이브 반영.
  - [ ] container 섹션 revert 버튼이 변별 border 편집을 모두 되돌림.
  - [ ] `border-bottom-width`만 있는 요소에서 섹션이 기본 펼침(`hasSpecified`).

### Task 6: diff collapse 그룹 추가 (Task 1 통과)
- **변경 대상**: `src/sidepanel/components/StyleChangesTable.tsx`
- **작업 내용**: `SHORTHAND_GROUPS`에 `border-width`·`border-color`(각 4 longhand) 추가.
- **검증**:
  - [ ] Task 1 테스트가 green.
  - [ ] `pnpm test` 전체 통과.
  - [ ] (실제 Chrome) 네 변 동일 편집 시 **변경사항 보기**·마크다운에 단일 `border-width`/`border-color` 행, 변별 시 개별 행.

## 테스트 계획

- **단위 테스트**:
  - `buildStyleDiff`/`SHORTHAND_GROUPS` collapse: border-width·border-color 네 변 동일→단일 행, 변별→개별 행 (Task 1).
  - `removeDiffRow("border-width")`가 width longhand 4개 제거 (Task 1).
  - `isKnownDefault` border-side-width 0px (Task 3).
- **e2e 시나리오** (`/e2e-write` 입력):
  - 요소를 선택하고 border-width의 아래 칸에 `2px`를 입력하면 해당 요소의 `border-bottom-width`가 `2px`로 바뀐다.
  - border-width 링크 토글을 켜고 한 칸에 `1px`를 입력하면 네 칸이 모두 `1px`가 된다.
  - 네 변을 같은 두께로 바꾼 뒤 **변경사항 보기**를 열면 `border-width` 단일 행이 보인다.
  - (data-testid: `QuadProp` 칸/ValueCombobox에 식별자가 없으면 e2e용 `data-testid` 추가 — src 변경은 testid 한정.)
- **수동 테스트** (실제 Chrome, CSSOM/getComputedStyle 의존):
  - [ ] Tailwind `border-b border-border` 요소 선택 → border-width 아래 칸 `1px`, border-color 칸에 `--border` 토큰 표시(현재 버그: 아무것도 안 보임).
  - [ ] `border-color: red` 단일 shorthand 요소 → color 4칸에 red 표시.
  - [ ] 변마다 두께가 다른 요소 → 각 칸에 다른 값 표시, style Select에 solid.
  - [ ] margin/padding/radius/gap 회귀 없음.

## 구현 순서 권장

Task 1(red) → Task 2 → Task 3 → Task 4 → Task 5 → Task 6(green). Task 2·3은 데이터 레이어로 병렬 가능, Task 4는 5의 선행. Task 6은 1의 구현 짝이라 마지막.

## 가이드 영향

사용자 노출 UX 변경(스타일 패널 border 편집 방식) → `/guide`로 갱신:
- `element/styling.md`(ko·en) — "스타일 패널 섹션"의 Container 설명에 border 변별 편집(두께·색 4변 + 스타일) 반영. 스크린샷 `element-styling-1.jpg`는 패널 변경 시 교체 대상(수동, 비목표).
- `guide/AUTHORING.md` — "사실 대조 소스"의 "스타일 패널 섹션·순서"(StyleEditorPanel) 항목과 일치하므로 별도 표 변경 불필요. Container 필드 구성이 바뀌었으니 본문 갱신 시 함께 확인.
