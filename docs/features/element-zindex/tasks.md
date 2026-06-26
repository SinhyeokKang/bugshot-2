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
  - `isKnownDefault("z-index", "auto") === true` 검증.
  - `finalizeValue("number", "9999", "z-index") === "9999"`(px 미부착), `finalizeValue("number", "auto", "z-index") === "auto"`, `finalizeValue("number", "-1", "z-index") === "-1"` 검증.
- **검증**:
  - [ ] 추가한 테스트가 구현 전엔 실패(red)한다.
  - [ ] `pnpm test`로 신규 케이스만 골라 실행해 의도대로 떨어지는지 확인.

### Task 2: 수집 화이트리스트에 z-index 추가
- **변경 대상**: `src/content/css-resolve.ts`
- **작업 내용**: `INTERESTING_PROPS` 배열에 `"position"` 다음 줄에 `"z-index"` 추가. `INHERITED_PROPS`에는 추가하지 않는다.
- **검증**:
  - [ ] Task 1의 `INTERESTING_PROPS.includes("z-index")` 테스트 green.
  - [ ] `pnpm typecheck` 통과.

### Task 3: 카테고리·기본값 메타데이터 추가
- **변경 대상**: `src/sidepanel/tabs/styleEditor/propMetadata.ts`
- **작업 내용**:
  - `PROP_CATEGORY`에 `"z-index": "number"` 추가.
  - `KNOWN_DEFAULTS`에 `"z-index": ["auto"]` 추가.
- **검증**:
  - [ ] Task 1의 `isKnownDefault`·`finalizeValue` 테스트 green.
  - [ ] `pnpm typecheck` 통과.

### Task 4: Layout 섹션에 z-index 입력 노출
- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`
- **작업 내용**:
  - `SECTION_PROPS.layout`에 `"z-index"` 추가(`"position"` 다음).
  - Layout 섹션 JSX에서 display/position `Row2` 직후에 z-index `TextProp`을 추가:
    ```tsx
    <Row2>
      <TextProp label="z-index" prop="z-index" />
      <div aria-hidden />
    </Row2>
    ```
  - `TextProp`은 이미 import되어 있음(import 추가 불필요 확인).
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] (수동) Chrome에서 요소 선택 시 Layout 섹션에 z-index 입력 노출, 현재 값 채워짐.

### Task 5: 전체 회귀 확인
- **변경 대상**: 없음(검증만).
- **작업 내용**: `pnpm test` 전체 + `pnpm typecheck`.
- **검증**:
  - [ ] `pnpm test` 전체 green.
  - [ ] `pnpm typecheck` 클린.

## 테스트 계획
- **단위 테스트**:
  - `css-resolve.test.ts`: `INTERESTING_PROPS`에 `z-index` 포함.
  - `propMetadata.test.ts`: `isKnownDefault("z-index","auto")` true, `isKnownDefault("z-index","10")` false.
  - `valueFormat.test.ts`: `number` 카테고리 z-index 값(정수/auto/음수) px 미부착.
- **e2e 시나리오** (`/e2e-write` 입력):
  - element mode로 요소를 선택하고 Layout 섹션을 펼치면 `z-index` 입력 컨트롤이 보인다.
  - z-index 입력에 `9999`를 입력하면 변경 비교(StyleChangesDialog)에 `z-index … → 9999` 행이 나타난다.
  - z-index 입력을 비우면 해당 변경 행이 사라진다.
  - (data-testid 필요 시 `TextProp`/`ValueCombobox`에 prop 기반 testid가 있는지 `/e2e-write`에서 확인 — src 수정은 testid 추가만 허용)
- **수동 테스트** (Chrome):
  - 겹침이 있는 실제 요소에서 z-index 조정 시 화면 stacking이 즉시 바뀌는지(captureVisibleTab/라이브 적용 의존).
  - 좁은 사이드패널·다이얼로그 컨테이너 폭에서 z-index 행(빈 스페이서 포함) 정렬이 어색하지 않은지. 어색하면 full-width 단독 행으로 조정.

## 구현 순서 권장
Task 1(테스트) → Task 2·3(메타데이터, 병렬 가능) → Task 4(UI) → Task 5(회귀). Task 2와 3은 서로 독립이라 병렬 가능.

## 가이드 영향
사용자 노출 UX 추가(편집 가능 속성 1개 증가). 영향 페이지:
- `guide/ko/element/styling.md`·`guide/en/element/styling.md`(또는 스타일 편집 속성 목록을 다루는 해당 페이지) — z-index 편집 가능 속성으로 언급/표 갱신. 정확한 파일·표 위치와 작성 기준은 `guide/AUTHORING.md` 확인 후 `/guide`로 처리.
- 편집 속성을 개별 나열하지 않는 가이드라면 갱신 불필요할 수 있음 — `/guide`에서 판단.
