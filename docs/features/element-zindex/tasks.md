# z-index 속성 편집 — 구현 태스크

## 선행 조건
- 권한·env·OAuth·외부 API 변경 없음. 신규 의존성 없음.
- 변경 파일 4개: `css-resolve.ts`, `propMetadata.ts`, `StyleEditorPanel.tsx`, 그리고 테스트 2개(`css-resolve.test.ts`, `propMetadata.test.ts`).

## 태스크

### Task 1: 단위 테스트 먼저 작성 (TDD)
- **변경 대상**:
  - `src/content/__tests__/css-resolve.test.ts`
  - `src/sidepanel/tabs/styleEditor/__tests__/propMetadata.test.ts`
  - `src/sidepanel/tabs/styleEditor/__tests__/valueFormat.test.ts` (기존, 케이스 추가)
- **작업 내용**:
  - `INTERESTING_PROPS`가 `"z-index"`를 포함하는지 검증하는 케이스 추가.
  - `isKnownDefault("z-index", "auto") === true`, `isKnownDefault("z-index", "10") === false` 검증.
  - `finalizeValue("number", "9999", "z-index") === "9999"`(px 미부착), `finalizeValue("number", "auto", "z-index") === "auto"`, `finalizeValue("number", "-1", "z-index") === "-1"`, `finalizeValue("number", "0", "z-index") === "0"`(0이 빈 값으로 새지 않는 회귀 가드) 검증. ※ `valueFormat.test.ts`에 현재 `number` 카테고리 `finalizeValue` 직접 테스트가 0건이라 신규 커버리지로서 가치 있음.
- **검증**:
  - [x] 추가한 테스트가 구현 전엔 실패(red)한다.
  - [x] `pnpm test`로 신규 케이스만 골라 실행해 의도대로 떨어지는지 확인.

### Task 2: 수집 화이트리스트에 z-index 추가
- **변경 대상**: `src/content/css-resolve.ts`
- **작업 내용**: `INTERESTING_PROPS` 배열에 `"position"` 다음 줄에 `"z-index"` 추가. `INHERITED_PROPS`에는 추가하지 않는다.
- **검증**:
  - [x] Task 1의 `INTERESTING_PROPS.includes("z-index")` 테스트 green.
  - [x] `pnpm typecheck` 통과.

### Task 3: 카테고리·기본값 메타데이터 추가
- **변경 대상**: `src/sidepanel/tabs/styleEditor/propMetadata.ts`
- **작업 내용**:
  - `PROP_CATEGORY`에 `"z-index": "number"` 추가.
  - `KNOWN_DEFAULTS`에 `"z-index": ["auto"]` 추가.
- **검증**:
  - [x] Task 1의 `isKnownDefault`·`finalizeValue` 테스트 green.
  - [x] `pnpm typecheck` 통과.

### Task 4: Layout 섹션에 z-index 입력 노출
- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`
- **작업 내용**:
  - `SECTION_PROPS.layout`에 `"z-index"` 추가(`"position"` 다음).
  - Layout 섹션 JSX에서 **display/position `Row2`가 닫힌 직후**(flex-direction/flex-wrap Row2 위)에 z-index `TextProp`을 **full-width 단독**으로 추가:
    ```tsx
    </Row2>{/* display/position */}
    <TextProp label="z-index" prop="z-index" />
    <Row2>{/* flex-direction/flex-wrap */}
    ```
  - `Row2`로 감싸지 않는다 — `PropRow`가 `flex-col`이라 자동 full-width. 빈 스페이서 div 불필요. `bg-image`·`overflow`·`filter` 등 기존 단독 prop과 동일 패턴.
  - `TextProp`은 이미 import되어 있음(import 추가 불필요 확인).
- **검증**:
  - [x] `pnpm typecheck` 통과.
  - [ ] (수동) Chrome에서 요소 선택 시 Layout 섹션 position 바로 아래에 z-index 입력이 full-width로 노출, 현재 값(또는 `auto` placeholder) 표시.

### Task 5: 전체 회귀 확인
- **변경 대상**: 없음(검증만).
- **작업 내용**: `pnpm test` 전체 + `pnpm typecheck`.
- **검증**:
  - [x] `pnpm test` 전체 green.
  - [x] `pnpm typecheck` 클린.

## 테스트 계획
- **단위 테스트**:
  - `css-resolve.test.ts`: `INTERESTING_PROPS`에 `z-index` 포함.
  - `propMetadata.test.ts`: `isKnownDefault("z-index","auto")` true, `isKnownDefault("z-index","10")` false.
  - `valueFormat.test.ts`: `number` 카테고리 z-index 값(정수/auto/음수) px 미부착.
- **e2e 시나리오** (`/e2e-write` 입력):
  - element mode로 요소를 선택하고 Layout 섹션을 펼치면 `z-index` 입력 컨트롤이 보인다.
  - z-index 입력에 `9999`를 입력하면 변경 비교(StyleChangesDialog)에 `z-index … → 9999` 행이 나타난다.
  - z-index 입력을 비우면 해당 변경 행이 사라진다.
  - **셀렉터(testid 없음 — 기존 헬퍼 재사용)**: 스타일 prop 컨트롤엔 prop 기반 `data-testid`가 **하나도 없다**. 기존 e2e는 label 텍스트 기반 `propRow`/`typeStyleValue` 헬퍼(`e2e/fixtures/extension.ts`)로 동작하므로 `typeStyleValue(panel, "z-index", "9999")`를 그대로 쓴다. **src에 testid 추가 불필요.** 변경 행 판정은 StyleChangesDialog의 `[data-prop="z-index"]`를 `toHaveCount(1)`(입력 시)/`toHaveCount(0)`(비운 후)로 검증.
  - **확인 포인트**: ① `propRow(panel, "z-index")`가 단일 매치인지(label 텍스트 중복 없음 — placeholder는 `auto`라 충돌 없을 것). ② "비우기" 경로가 `useStyleProp.set("")` → `delete inlineStyle["z-index"]`까지 한 번에 green인지(ValueCombobox 비우기 타이밍 의존 — 기존 spec에 값 비우기 사례가 없으면 신규 경로라 첫 실행 red 가능, `/e2e-write` 루프에서 수렴).
- **수동 테스트** (Chrome):
  - 겹침이 있는 실제 요소에서 z-index 조정 시 화면 stacking이 즉시 바뀌는지(captureVisibleTab/라이브 적용 의존).
  - **stacking context 함정 확인**: 부모에 `transform`/`opacity`/`filter`가 걸린 요소에서 z-index를 올려도 화면이 안 바뀔 수 있음(정상 동작 — 안내는 비목표). 라이브 적용 자체(`el.style.zIndex` 반영)는 DevTools로 확인.
  - 미지정 요소 선택 시 `z-index` 입력에 `auto`가 placeholder(회색)로, 지정 요소 선택 시 값이 입력칸에 채워지는지.
  - 좁은 사이드패널·다이얼로그 컨테이너 폭에서 z-index full-width 단독 행 정렬·가독성 확인.

## 구현 순서 권장
Task 1(테스트) → Task 2·3(메타데이터, 병렬 가능) → Task 4(UI) → Task 5(회귀). Task 2와 3은 서로 독립이라 병렬 가능.

## 가이드 영향
사용자 노출 UX 추가(편집 가능 속성 1개 증가). 영향 페이지:
- `guide/ko/element/styling.md`·`guide/en/element/styling.md`(또는 스타일 편집 속성 목록을 다루는 해당 페이지) — z-index 편집 가능 속성으로 언급/표 갱신. 정확한 파일·표 위치와 작성 기준은 `guide/AUTHORING.md` 확인 후 `/guide`로 처리.
- 편집 속성을 개별 나열하지 않는 가이드라면 갱신 불필요할 수 있음 — `/guide`에서 판단.
