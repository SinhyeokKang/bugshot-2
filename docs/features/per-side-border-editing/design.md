# 변별 Border 편집 + border-color 버그 수정 — 기술 설계

## 개요

border 편집을 margin·padding과 같은 변별 패턴으로 통일한다. 데이터 레이어(`css-resolve.ts`의 캡처 목록·shorthand 확장)에 border 변별 longhand를 추가하고, 편집 UI(`QuadProp`)를 명시 prop 배열도 받을 수 있게 일반화한 뒤, 패널 container 섹션의 `border`/`border-color` 단일 필드를 width 4변 QuadProp + style 단일 Select + color 4변 QuadProp로 교체한다. diff 테이블의 shorthand collapse 목록에 border-width/border-color 그룹을 추가한다. `border-color` 캡처 누락 버그는 이 과정에서 변별 longhand가 `INTERESTING_PROPS`에 들어가며 자연히 해소된다.

적용(content `el.style.setProperty`)은 임의 prop을 이미 지원하므로 content 레이어 변경은 없다.

## 변경 범위

### `src/content/css-resolve.ts`
현재 역할: 선택 요소의 스타일을 수집(`INTERESTING_PROPS`만 computed/specified로 추림) + shorthand→longhand 확장 + var 체인 해석.

변경 내용:
- `INTERESTING_PROPS`에 추가: `border-style`, `border-top-width`·`border-right-width`·`border-bottom-width`·`border-left-width`, `border-top-color`·`border-right-color`·`border-bottom-color`·`border-left-color`. 기존 `border`(shorthand)·`border-radius`·코너 radius는 유지.
- `SHORTHAND_MAP`에 추가:
  - `"border-width": [border-top-width, border-right-width, border-bottom-width, border-left-width]`
  - `"border-color": [border-top-color, border-right-color, border-bottom-color, border-left-color]`
- `TRBL_SHORTHANDS`에 동일 두 항목 추가(`border-width`/`border-color`는 1~4값 TRBL 단축 표기를 변별로 분해해야 함 — 예 `border-color: red blue`).
- `border-style`은 shorthand 확장하지 않는다(단일 Select가 computed `border-style`를 읽음).

이로써:
- Tailwind `border-b`(longhand `border-bottom-width:1px` 직접 선언)는 그대로 `specifiedStyles["border-bottom-width"]`로 잡힌다.
- `border-color`/`border-width` shorthand 선언(예 `border-border` → `border-color: hsl(var(--border))`)은 `expandShorthands`가 변별 longhand로 펼쳐 var 참조를 보존한다.
- 페이지가 어디에도 선언 안 한 변은 computed 루프가 `cs.getPropertyValue("border-bottom-width")` 등으로 채워 placeholder가 정상 동작한다.

### `src/sidepanel/tabs/styleEditor/propMetadata.ts`
현재 역할: prop별 토큰 카테고리(`PROP_CATEGORY`)·기본값(`KNOWN_DEFAULTS`)·`isKnownDefault`.

변경 내용:
- `PROP_CATEGORY`에 추가: 4개 `border-{side}-width: "length"`, 4개 `border-{side}-color: "color"`. (기존 `"border-color": "color"`는 단일 필드 제거로 고아가 되므로 제거.)
- `KNOWN_DEFAULTS`에 추가: 4개 `border-{side}-width: ["0px", "medium"]`, 4개 `border-{side}-color: ["rgb(0, 0, 0)", "currentcolor"]`, `border-style: ["none"]`. (기존 `"border-color"` 항목 제거.)
- `isKnownDefault`의 `border` "0px none" 특례는 유지(전체 shorthand는 캡처 유지).

### `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx`
현재 역할: `QuadProp`(`prefix-side` 4변), `RadiusProp`, `GapPairProp`, `SelectProp`, `TextProp` 등 편집 컨트롤.

변경 내용 — `QuadProp` 일반화:
- 시그니처를 `{ label: string; prefix?: string; props?: [string, string, string, string] }`로 확장.
- 내부 `props`를 `explicitProps ?? [\`${prefix}-top\`, \`${prefix}-right\`, \`${prefix}-bottom\`, \`${prefix}-left\`]`로 계산(useMemo deps: `[explicitProps, prefix]`).
- 나머지(아이콘 top/right/bottom/left 순서, 링크 토글, `useLinkedProps`, `ValueCombobox`)는 불변. `ValueCombobox`는 `PROP_CATEGORY[prop]`로 카테고리를 잡으므로 width=length·color=color 동작이 자동.
- margin·padding은 `prefix` 경로를 그대로 쓰므로 회귀 없음.

### `src/sidepanel/tabs/StyleEditorPanel.tsx`
현재 역할: 패널 섹션 구성 + `SECTION_PROPS` 정의.

변경 내용:
- container 섹션의
  ```tsx
  <Row2>
    <TextProp label="border" prop="border" />
    <TextProp label="border-color" prop="border-color" />
  </Row2>
  ```
  를 다음으로 교체:
  ```tsx
  <QuadProp
    label="border-width"
    props={["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"]}
  />
  <SelectProp
    label="border-style"
    prop="border-style"
    options={["", "solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset", "none"]}
  />
  <QuadProp
    label="border-color"
    props={["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"]}
  />
  ```
  `<RadiusProp />`는 그대로 유지.
- `SECTION_PROPS.container`에서 `"border-color"`를 제거하고 변별 longhand 8개 + `"border-style"`를 추가. `"border"`(전체 shorthand)는 **유지**(AI가 적용한 border shorthand를 섹션 revert로 되돌릴 수 있게). 결과 목록:
  `background-color, background-image, opacity, border, border-style, border-{top,right,bottom,left}-width, border-{top,right,bottom,left}-color, border-radius, border-{tl,tr,br,bl}-radius`.
  이 목록은 `SectionRevertButton`의 revert 대상과 `defaultOpen={hasSpecified(...)}` 판정을 구동한다.

### `src/sidepanel/components/StyleChangesTable.tsx`
현재 역할: `buildStyleDiff`(편집→행) + `SHORTHAND_GROUPS`(네 변 동일 시 단일 행 collapse).

변경 내용:
- `SHORTHAND_GROUPS`에 추가:
  - `"border-width": [border-top-width, border-right-width, border-bottom-width, border-left-width]`
  - `"border-color": [border-top-color, border-right-color, border-bottom-color, border-left-color]`
- `buildStyleDiff`/`collapseShorthands` 로직 자체는 불변(데이터만 추가). `styleChangeGroups.ts`의 `removeDiffRow`와 `aiStylingPostProcess.ts`도 `SHORTHAND_GROUPS`를 재사용하므로 자동 반영(변별 행 삭제 시 longhand 동반 제거, AI 머지 시 중복 제거).

## 데이터 흐름

```
[content] css-resolve.collectSelection
  → computedStyles[border-*-width/color], specifiedStyles[...](shorthand는 expandShorthands로 변별 펼침)
  → PickerSelectionPayload
[sidepanel] usePickerMessages → editor-store.selection
  → StyleEditorPanel: QuadProp(width/color), SelectProp(style)
     useStyleProp(prop): placeholder = specified || computed, value = styleEdits.inlineStyle[prop]
  → 편집 set → editor-store.styleEdits.inlineStyle[prop] = value
     → picker-control.applyStyles → content handleApplyStyles → el.style.setProperty(prop, value) (라이브)
  → 진행 시 buildStyleDiff(selection, styleEdits) → SHORTHAND_GROUPS로 collapse → StyleChangesTable / 마크다운
```

## 인터페이스 설계

```ts
// StylePropEditors.tsx — QuadProp 일반화
export function QuadProp({
  label,
  prefix,
  props: explicitProps,
}: {
  label: string;
  prefix?: string;
  props?: [string, string, string, string];
}): JSX.Element;

// css-resolve.ts — 상수 확장 (타입 변화 없음, 항목 추가)
export const INTERESTING_PROPS: readonly string[]; // + border-style, border-{side}-width, border-{side}-color
// SHORTHAND_MAP / TRBL_SHORTHANDS: + "border-width", "border-color"

// StyleChangesTable.tsx
export const SHORTHAND_GROUPS: Record<string, string[]>; // + "border-width", "border-color"
```

타입 시그니처 변경 없음(전부 문자열 prop 기반의 데이터 추가). `QuadProp`만 prop 추가(선택적이라 기존 호출 호환).

## 기존 패턴 준수

- **변별 편집 = QuadProp + 링크 토글**: margin·padding·radius가 쓰는 동일 컴포넌트·`useLinkedProps`·`sidesAllEqual` 재사용.
- **토큰/카테고리**: `PROP_CATEGORY` 등록으로 ValueCombobox가 색/길이 토큰 제안을 자동 처리(색 칸에서 `--border` 등 디자인 토큰 매칭).
- **shorthand collapse 단일 출처**: `SHORTHAND_GROUPS`(StyleChangesTable) 한 곳만 확장하면 diff·removeDiffRow·AI 머지가 일관 동작.
- **UI 라벨**: 기존 container 필드 라벨(`bg-color`/`opacity`/`border` 등)이 literal 영문이므로 신규 라벨도 `border-width`/`border-style`/`border-color` literal 영문(별도 i18n 키 불필요). 변별 칸 툴팁은 기존 `prop.side.*`(위/오른쪽/아래/왼쪽) 재사용.
- **테스트 우선**: 순수 함수(`buildStyleDiff` collapse, `isKnownDefault`) 단위 테스트를 먼저 갱신/추가.
- **외과적 변경**: content 적용부·radius·gap 미변경. 단일 필드 제거로 생긴 고아(`KNOWN_DEFAULTS["border-color"]`, `PROP_CATEGORY["border-color"]`)만 정리.

## 대안 검토

1. **세 축 전부 4변 QuadProp(width·style·color 각 4변)** — 가장 완전하나 좁은 사이드패널에 컨트롤 3개가 빽빽해지고, 변별 border-style 수요가 낮다. 채택 안 함(스타일 단일 Select).
2. **변별 shorthand 4변(`border-top`/…에 "1px solid red" 통째 입력)** — `QuadProp(prefix="border")`로 최소 변경 가능하나, 한 칸에 width/style/color가 섞여 토큰 제안·px 멀티플라이어 등 length 보조 기능이 무력화되고 값 파싱·diff가 거칠어진다. 채택 안 함.
3. **`border` 단일 필드 유지 + border-color만 버그 수정** — 변별 편집 요구(주 목표)를 충족 못 함. 채택 안 함.

## 위험 요소

- **전체 `border` shorthand 선언의 변별 source 누락**: 페이지가 `border: 1px solid red`(전체 shorthand)로 선언하면 `expandShorthands`는 `border`를 변별로 분해하지 않으므로(SHORTHAND_MAP 미포함, 파싱이 TRBL이 아님) `specifiedStyles`엔 변별 항목이 없다. 값 자체는 computed 루프가 채워 placeholder로 보이지만 source 툴팁·토큰 역추적은 생략될 수 있다. 비목표로 명시. (대다수 케이스인 Tailwind `border-b`/`border-{side}-*`·`border-color` shorthand는 정상 동작.)
- **변별 `border-style` 혼재**: 변마다 스타일이 다르면 computed `border-style`가 `"solid none none none"` 형태라 단일 Select 옵션과 매칭되지 않아 placeholder로 표시된다(편집은 네 변 일괄 적용). 드문 케이스 — 수용.
- **jsdom 한계**: `collectSpecifiedStylesWithSources`/computed 캡처는 CSSOM·`getComputedStyle` 의존이라 단위 테스트가 까다롭다. 캡처 정확성은 실제 Chrome(e2e/수동)으로 검증하고, 단위 테스트는 순수 함수(`buildStyleDiff` collapse 등)에 집중한다.
- **QuadProp 일반화 회귀**: `prefix` 경로를 보존해야 margin·padding·radius·gap이 안 깨진다. 일반화 후 해당 사용처를 회귀 확인.
- **빈 값 처리**: `ValueCombobox`/`useStyleProp.set`은 빈 문자열 시 inlineStyle에서 prop을 delete → content가 원본으로 원복 후 잔여만 재적용하므로 한 변만 지워도 정상. 기존 동작 재사용.
