# z-index 속성 편집 — 기술 설계

## 개요
z-index는 스타일 에디터의 **일반 inlineStyle 파이프라인**(수집 → UI → useStyleProp → applyStyles → content 적용 → buildStyleDiff)에 이미 올라타기만 하면 동작한다. 신규 상태/메시지/적용 로직은 불필요하고, **속성 메타데이터 3곳 + 수집 화이트리스트 + UI 1줄**만 추가하면 끝나는 외과적 변경이다.

## 변경 범위

### 1. `src/content/css-resolve.ts` — 수집 화이트리스트
- **현재 역할**: `INTERESTING_PROPS` 배열을 순회해 선택 요소의 computed/specified 스타일을 수집(`collectSelection`, `collectSpecifiedStylesWithSources`). 이 배열에 없는 속성은 수집되지 않아 사이드패널에 값이 전달되지 않는다.
- **변경**: 배열에 `"z-index"` 1개 추가(`"position"` 인접 위치 권장 — 의미상 그룹핑). z-index는 상속 속성이 아니므로 `INHERITED_PROPS`에는 추가하지 않는다.

### 2. `src/sidepanel/tabs/styleEditor/propMetadata.ts` — 카테고리·기본값
- **현재 역할**: `PROP_CATEGORY`(토큰 자동완성 필터링 카테고리), `KNOWN_DEFAULTS`(값이 기본값과 같으면 "기본값" UI로 표시), `isKnownDefault()`.
- **변경**:
  - `PROP_CATEGORY`에 `"z-index": "number"` 추가. `number` 카테고리는 `finalizeValue`에서 **px 자동부착을 하지 않으므로**(`length`만 부착) `auto`/정수/음수가 그대로 통과. font-weight·opacity와 동일한 처리.
  - `KNOWN_DEFAULTS`에 `"z-index": ["auto"]` 추가. 미지정 요소의 computed z-index는 `auto`이므로 이를 기본값으로 인식시켜 "기본값" 표시.

### 3. `src/sidepanel/tabs/StyleEditorPanel.tsx` — UI 노출
- **현재 역할**: 섹션별 속성 편집 UI 렌더 + `SECTION_PROPS`(섹션 펼침 기본값·SectionRevertButton 대상 판정용 속성 목록).
- **변경**:
  - `SECTION_PROPS.layout` 배열에 `"z-index"` 추가(`"position"` 다음). → 선택 요소에 z-index가 지정돼 있으면 Layout 섹션이 기본 펼침되고, 섹션 revert 버튼이 z-index도 되돌린다.
  - Layout 섹션 JSX에서 display/position `Row2` **바로 아래**(StyleEditorPanel.tsx의 position 포함 Row2 닫힘 직후, flex-direction/flex-wrap Row2 위)에 z-index `TextProp`을 **full-width 단독 행**으로 추가.
    ```tsx
    <Row2>
      <SelectProp label="display" prop="display" options={...} />
      <SelectProp label="position" prop="position" options={...} />
    </Row2>
    <TextProp label="z-index" prop="z-index" />
    {/* ↓ 기존 flex-direction/flex-wrap Row2 */}
    ```
    - `TextProp`을 `Row2`로 감싸지 않고 단독으로 둔다 → `PropRow`가 `flex flex-col`이라 부모가 grid가 아니면 자동 full-width가 된다. 빈 스페이서 div 불필요. position과 한 줄에 묶지 않는 이유: position(SelectProp)과 z-index(TextProp)는 컨트롤 종류가 달라 같은 줄에 섞기보다 바로 아래 줄에 두는 편이 정렬·가독성이 낫다.
    - **기존 단독 prop 배치 패턴과 일치**: `bg-image`(L259)·`overflow`(L316)·`filter`(L392)·`backdrop-filter`(L393)·`transition-property`(L423) 등 단독 prop은 전부 `Row2` 없이 full-width로 둔다. `Row2`(`grid-cols-2`)는 항상 실제 prop 2개를 짝으로 채우고 빈 셀 사례는 코드 전체에 0건. ~400px 좁은 폭에서도 z-index 입력이 절반으로 쪼그라들지 않아 `9999` 같은 값 가독성이 유지된다.

### 변경하지 않는 것 (일반 파이프라인 재사용)
- `src/store/editor-store.ts` `EditorStyleEdits.inlineStyle`은 `Record<string, string>`이라 임의 prop 수용 — 변경 불필요.
- `src/sidepanel/tabs/styleEditor/styleHooks.ts` `useStyleProp` — prop 문자열만 받으므로 변경 불필요.
- `src/sidepanel/picker-control.ts` `applyStyles` / `src/types/picker.ts` `picker.applyStyles` — `inlineStyle` 통째 전송, 변경 불필요.
- `src/content/picker.ts` `handleApplyStyles` — `Object.entries(inlineStyle)` 순회 적용, 변경 불필요.
- `src/sidepanel/components/StyleChangesTable.tsx` `buildStyleDiff` — inlineStyle 전 키 순회 diff, 변경 불필요.
- AI 스타일링(`src/sidepanel/lib/buildAiStylingPrompt.ts`) — `DENIED_STYLE_PROPS` allow-by-default라 z-index 자동 허용, 변경 불필요.

## 데이터 흐름
```
요소 선택
  → content collectSelection: INTERESTING_PROPS(+z-index) 순회로 computed/specified 수집
  → picker.selected → editor-store.selection.{computed,specified}Styles["z-index"]
사용자 입력 (TextProp → ValueCombobox)
  → finalizeValue("number", "9999", "z-index") = "9999" (px 부착 X)
  → useStyleProp set → styleEdits.inlineStyle["z-index"]="9999"
  → applyStyles(tabId, inlineStyle) → picker.applyStyles
  → content handleApplyStyles: el.style.setProperty("z-index","9999")
비교
  → buildStyleDiff: before(specified/computed) vs after(inlineStyle) → "z-index: auto → 9999" 행
```

## 인터페이스 설계
신규 타입/시그니처 없음. 데이터 추가만:
- `INTERESTING_PROPS`: `readonly string[]`에 `"z-index"` 1개 추가(상수 배열 멤버).
- `PROP_CATEGORY["z-index"]: TokenCategory = "number"`.
- `KNOWN_DEFAULTS["z-index"]: string[] = ["auto"]`.
- `SECTION_PROPS.layout`에 `"z-index"` 멤버 추가.

## 기존 패턴 준수
- **prop 메타데이터 3종 동기 추가**: 새 편집 속성은 (1) `INTERESTING_PROPS`(수집), (2) `SECTION_PROPS`(섹션 매핑), (3) `PROP_CATEGORY`/`KNOWN_DEFAULTS`(카테고리·기본값) 세트를 함께 갱신해야 일관 동작. 기존 모든 속성이 이 패턴.
- **i18n**: prop label은 `t()`가 아닌 리터럴 문자열(`label="z-index"`)로 표기 — 기존 모든 prop label과 동일하므로 i18n 키 추가 불필요.
- **테스트 우선**: 순수 함수(`INTERESTING_PROPS` 포함 여부, `isKnownDefault("z-index","auto")`)에 단위 테스트 추가 후 구현.

## 대안 검토
- **(A) position이 positioned일 때만 z-index 표시**: z-index는 static에서 효과 없으므로 조건부 렌더가 "정확"하지만, position 값을 구독해 분기하는 로직이 추가되고 다른 속성(항상 표시)과 패턴이 어긋난다. static에서 효과 없는 건 CSS 일반 상식이고, position을 동시에 바꾸는 워크플로우도 흔해 항상 표시가 더 단순·일관. → **채택 안 함.**
- **(B) SelectProp(auto/정수 프리셋)**: z-index는 임의 정수가 필요해 드롭다운 부적합. TextProp(자유 입력 + 토큰 자동완성)이 유일하게 합당. → TextProp 채택.
- **(C) PROP_CATEGORY 생략(카테고리 undefined)**: 동작은 하나 토큰 자동완성이 전 카테고리 토큰을 보여줘 노이즈. `number`로 지정해 숫자 토큰 우선 노출 + 일관성 확보. → `number` 채택.

## 위험 요소
- **px 자동부착 회귀**: 카테고리를 실수로 `length`로 넣으면 `9999` → `9999px`로 변질돼 z-index가 무효화된다. 반드시 `number`. 단위 테스트로 `finalizeValue("number","5","z-index")==="5"` 고정 권장.
- **수집 누락**: `INTERESTING_PROPS`에 추가하지 않으면 UI는 떠도 선택 요소의 현재 z-index 값이 채워지지 않는다(specified/computed 모두 빈 값). 3종 동기 추가 필수.
- **placeholder vs 입력값 구분**: 미지정 요소의 computed z-index는 `auto`이고 `KNOWN_DEFAULTS`에 등록돼 "기본값"으로 placeholder 처리된다(입력칸은 빈 값, `auto`는 회색 힌트). 반대로 specified 값(예: `10`)이 있으면 그 값이 실제 입력값으로 채워진다. `isKnownDefault` 분기에 의존하며 구현 시 실제 탭에서 미지정 요소 선택 → `auto`가 placeholder로, 지정 요소 → 값이 채워지는지 1회 확인.
- **stacking context 함정 미안내**: 부모 transform/filter/opacity로 z-index가 무력화되는 케이스는 안내하지 않음(비목표). 사용자가 적용 후 화면 미변화로 혼란할 수 있으나 이번 스코프 밖.
