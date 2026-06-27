# Linked 4면 속성 병합 필드 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변경 없음. 순수 프론트엔드 UI 변경.
- 대상 파일: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx`,
  `src/i18n/namespaces/editor.ts`, 새 테스트 파일.
- `ValueCombobox.tsx`는 `controlled` prop이 이미 있어 수정 불필요.

## 태스크

### Task 1: 공통값/mixed 순수 함수 + 단위 테스트 (TDD 먼저)

- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx`(함수 추출·export),
  `src/sidepanel/tabs/styleEditor/__tests__/linkedSides.test.ts`(신규)
- **작업 내용**:
  - `commonEditValue(props, inlineStyle)`, `commonBaseline(props, inlineStyle, selection)`,
    `sidesMixed(props, inlineStyle, selection)` 추출·export.
  - 기존 `sidesAllEqual`은 `commonBaseline(...) !== ""`로 재정의하거나 baseline 추출 헬퍼 공유
    (동작 보존).
  - 테스트 먼저 작성(`/tdd interface`):
    - 4면 편집값 동일 → `commonEditValue` 그 값
    - 일부 면만 편집값 존재 → `commonEditValue` ""
    - baseline(편집/specified/computed) 4면 동일 → `commonBaseline` 그 값
    - baseline 4면 불일치 → `sidesMixed` true, `commonBaseline` ""
    - selection null 처리
- **검증**:
  - [ ] `pnpm test linkedSides` 통과
  - [ ] 기존 `sidesAllEqual` 의존 동작(초기 linked 판정) 회귀 없음 — `pnpm test` 전체 green
  - [ ] `pnpm typecheck` 통과

### Task 2: i18n 키 추가

- **변경 대상**: `src/i18n/namespaces/editor.ts`
- **작업 내용**: ko/en 블록 양쪽에 동시 추가
  - `"prop.side.all"`: ko `"전체"` / en `"All sides"`
  - `"prop.mixed"`: ko `"혼합"` / en `"Mixed"`
- **검증**:
  - [ ] 저장 시 PostToolUse 훅 `locales.test.ts`(ko/en 대칭) 자동 통과
  - [ ] `pnpm test locales` 통과

### Task 3: `useLinkedProps` 확장 (merged 상태)

- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx`
- **작업 내용**:
  - `merged: { value; placeholder; mixed }`를 반환에 추가.
  - 공통값을 `useEditorStore((s) => ...)` 셀렉터로 구독 — inlineStyle 변경 시 단일 필드 리렌더 보장.
  - Task 1 순수 함수 사용.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 단일 필드 입력 후 값이 즉시 반영(수동 — Task 7)

### Task 4: `QuadProp`·`RadiusProp`·`GapPairProp` 단일 필드 분기

- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx`
- **작업 내용**:
  - `linked`면 통합 아이콘 + 단일 `ValueCombobox`(`controlled={{ value: merged.value,
    placeholder: merged.mixed ? t("prop.mixed") : merged.placeholder, set: setAllProps }}`) + `LinkToggle`.
  - `!linked`면 기존 `grid-cols-4`(gap은 `grid-cols-2`) 유지.
  - 통합 아이콘: lucide `Square`(또는 4면 합친 인라인 SVG), title `t("prop.side.all")`.
- **검증**:
  - [ ] linked → 입력 필드 1개, unlinked → 4개(gap 2개) 렌더
  - [ ] 단일 필드 입력 → 4면 동시 반영
  - [ ] `pnpm typecheck` 통과

### Task 5: `SideStyleSelect` controlled + `QuadStyleProp` 단일 select 분기

- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx`
- **작업 내용**:
  - `SideStyleSelect`에 `controlled?: { value; placeholder; set }` 추가. 주어지면 `useStyleProp` 대신
    controlled 값/placeholder 사용, `commit`이 `controlled.set` 호출.
  - `QuadStyleProp`: `linked`면 단일 `SideStyleSelect`(통합 모드), `!linked`면 기존 4-select grid.
  - 단일 select: 4면 불일치(mixed) 시 trigger 라벨에 `t("prop.mixed")` 또는 `—`, value 빈 문자열.
- **검증**:
  - [ ] border-style linked → 단일 select, unlinked → 4개 select
  - [ ] 단일 select 변경 → 4면 동시 반영
  - [ ] per-side(unlinked) 동작 회귀 없음
  - [ ] `pnpm typecheck` 통과

### Task 6: diff 회귀 확인 (변경 없음 검증)

- **변경 대상**: 없음(검증만)
- **작업 내용**: `collapseShorthands`가 단일/4필드 어느 경로로 편집했든 동일한 shorthand diff를
  내는지 확인. 저장 모델이 면별 longhand 그대로이므로 자동 보존돼야 함.
- **검증**:
  - [ ] `pnpm test styleChangeGroups` 통과
  - [ ] `pnpm test buildIssueMarkdown` 통과

### Task 7: 수동 시각 확인 (Chrome)

- **변경 대상**: 없음
- **작업 내용**: dev 빌드로 실제 페이지에서 패널 확인.
- **검증**:
  - [ ] padding 4면 동일 요소 → 자동 linked + 단일 필드
  - [ ] LinkToggle 끄면 4필드로 펼쳐짐, 켜면 단일로 접힘
  - [ ] 4면 다른 요소 → unlinked 시작(4필드), linked 토글 시 단일 필드 placeholder `Mixed`/`혼합`
  - [ ] 단일 필드 입력 → 페이지 라이브 반영 + 이슈 draft diff가 `padding: …` 한 줄
  - [ ] 좁은 사이드패널 폭에서 레이아웃 정상

## 테스트 계획

- **단위 테스트**: `__tests__/linkedSides.test.ts` — `commonEditValue`/`commonBaseline`/`sidesMixed`
  (Task 1 케이스). 기존 `sidesAllEqual` 동작 회귀 케이스 포함.
- **e2e 시나리오** (`/e2e-write` 입력):
  - "padding 4면이 같은 요소를 선택하면 padding 입력 필드가 1개만 보인다"
  - "padding LinkToggle을 끄면 입력 필드가 4개로 늘어난다"
  - "linked 단일 필드에 16px을 입력하면 4면 모두 16px이 된다"
  - "linked로 4면을 16px로 만든 뒤 이슈 본문을 만들면 diff에 `padding: 16px` 한 줄이 나온다"
  - ※ 필드 개수가 모드별 4↔1로 바뀌므로 안정적 셀렉터용 `data-testid`(예: linked 단일 필드,
    LinkToggle) 추가가 필요할 수 있다 — `/e2e-write`에서 src 수정은 `data-testid` 추가만 허용.
- **수동 테스트**: Task 7(시각 정합·좁은 폭 리플로우).

## 구현 순서 권장

1. **Task 1**(순수 함수 + 테스트) → **Task 2**(i18n): 독립, 병렬 가능.
2. **Task 3**(useLinkedProps merged): Task 1 의존.
3. **Task 4**(Quad/Radius/Gap) · **Task 5**(QuadStyle/SideStyleSelect): Task 2·3 의존, 서로 병렬 가능.
4. **Task 6**(diff 회귀) · **Task 7**(수동): 마지막.

## 가이드 영향

- `guide/ko/element/styling.md` · `guide/en/element/styling.md` — 박스모델 편집 시 linked 모드에서
  필드가 하나로 합쳐진다는 UX 변화. 4면 개별/일괄 편집 토글 설명이 있으면 단일 필드 동작으로 갱신.
  작성·판단 기준은 `guide/AUTHORING.md`. 구현 후 `/guide`로 처리.
