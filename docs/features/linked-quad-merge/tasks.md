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
    - **`sidesAllEqual ⟺ commonBaseline(...) !== ""` 동치성 명시 테스트**: 경계 케이스(selection null,
      4면 모두 빈 값 → 둘 다 false, 편집값 일부만 존재, specified/computed 혼합)에서 두 함수 결과 일치 고정.
- **검증**:
  - [x] `pnpm test linkedSides` 통과
  - [x] 기존 `sidesAllEqual` 의존 동작(초기 linked 판정) 회귀 없음 — `pnpm test` 전체 green
  - [x] `pnpm typecheck` 통과

### Task 2: i18n 키 추가

- **변경 대상**: `src/i18n/namespaces/editor.ts`
- **작업 내용**: `prop.*` 블록 ko/en 양쪽에 동시 추가(키 4개)
  - `"prop.side.all"`: ko `"전체"` / en `"All sides"` (margin/padding/border-* 단일 필드)
  - `"prop.corner.all"`: ko `"전체 모서리"` / en `"All corners"` (radius)
  - `"prop.axis.all"`: ko `"양축"` / en `"Both axes"` (gap)
  - `"prop.mixed"`: ko `"혼합"` / en `"Mixed"` (단일 필드 placeholder + 단일 select trigger 라벨)
- **검증**:
  - [x] 저장 시 PostToolUse 훅 `locales.test.ts`(ko/en 대칭) 자동 통과
  - [x] `pnpm test locales` 통과

### Task 3: `useLinkedProps` 확장 (merged 상태)

- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx`
- **작업 내용**:
  - `merged: { value; placeholder; mixed }`를 반환에 추가.
  - 공통값을 **분리된 primitive 셀렉터**(`value`/`placeholder`/`mixed` 각각 별도 `useEditorStore((s)=>...)`)로
    구독 — inlineStyle 변경 시 단일 필드 리렌더 보장. 객체 단일 셀렉터 금지(`Object.is` 실패 → 매 변경
    리렌더 + "getSnapshot should be cached" 경고).
  - Task 1 순수 함수 사용.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] **코드 리뷰 체크: merged 구독이 분리 primitive 셀렉터(또는 useShallow)로 inlineStyle에 반응** —
    객체 단일 셀렉터/useMemo deps 누락 시 입력 후 값이 안 보이는 회귀(자동 테스트로 못 잡음)
  - [ ] 단일 필드 입력 후 값이 즉시 반영(수동 — Task 7 + e2e 왕복 케이스)

### Task 4: `QuadProp`·`RadiusProp`·`GapPairProp` 단일 필드 분기

- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx`
- **작업 내용**:
  - `linked`면 통합 아이콘 + 단일 `ValueCombobox`(`controlled={{ value: merged.value,
    placeholder: merged.mixed ? t("prop.mixed") : merged.placeholder, set: setAllProps }}`, **`compact` 미전달**) + `LinkToggle`.
  - `!linked`면 기존 `grid-cols-4`(gap은 `grid-cols-2`) 유지.
  - 통합 아이콘: **4면/4코너 균일 강조 인라인 SVG**(기존 `SIDE_LINES`/`CORNER_PATHS` 좌표 재사용). lucide `Square` 사용 안 함.
    title은 묶음별 — side `t("prop.side.all")` / radius `t("prop.corner.all")` / gap `t("prop.axis.all")`.
- **검증**:
  - [ ] linked → 입력 필드 1개, unlinked → 4개(gap 2개) 렌더
  - [ ] 단일 필드 입력 → 4면 동시 반영
  - [ ] 단일 필드 popover가 패널 폭 안에 정상 표시(non-compact 확인)
  - [x] `pnpm typecheck` 통과

### Task 5: `SideStyleSelect` controlled + `QuadStyleProp` 단일 select 분기

- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx`
- **작업 내용**:
  - `SideStyleSelect`에 `controlled?: { value; placeholder; set }` 추가. 주어지면 `useStyleProp` 대신
    controlled 값/placeholder 사용, `commit`이 `controlled.set` 호출.
  - `QuadStyleProp`: `linked`면 단일 `SideStyleSelect`(통합 모드), `!linked`면 기존 4-select grid.
  - 단일 select: 4면 불일치(mixed) 시 trigger 라벨에 `t("prop.mixed")`(`혼합`/`Mixed`, muted), value 빈 문자열. `—` 대시 미사용.
  - **border-color 단일 필드 mixed swatch 가드 확인**: color 필드 `ValueCombobox`가 placeholder를 swatch로
    파싱하면 `혼합`/`Mixed`에서 깨질 수 있다. swatch 파싱이 비유효 색에 가드되는지 확인, 없으면 mixed placeholder는 swatch 미표시.
- **검증**:
  - [ ] border-style linked → 단일 select, unlinked → 4개 select
  - [ ] 단일 select 변경 → 4면 동시 반영
  - [ ] mixed 시 단일 select trigger 라벨 `혼합`/`Mixed` 노출(e2e 1케이스 권장 — 단위 테스트 어려움)
  - [ ] per-side(unlinked) 동작 회귀 없음
  - [x] `pnpm typecheck` 통과

### Task 6: border 2차 통합 (collapseShorthands) + 테스트

- **변경 대상**: `src/sidepanel/components/StyleChangesTable.tsx`,
  `src/sidepanel/lib/__tests__/styleChangeGroups.test.ts`
- **작업 내용**:
  - `collapseShorthands`에 2차 패스 추가: 1차 결과에 `border-width`+`border-style`+`border-color`
    3행이 모두 있으면 `border: "${w.toBe} ${s.toBe} ${c.toBe}"`(asIs도 동일 조합)로 합치고 셋을 소비.
    **셋 다 asIs가 빈 값이면 결합 결과(`"  "`)를 `trim()`→`""`로 정규화**(개별 행 빈 asIs와 일관).
  - CSS 표준 순서 `width style color`. 명시 `border` 행 있으면 중복 생성 금지 — 가드는 `result.some(r => r.prop === "border")`(2차 패스가 도는 `result` 기준). 삽입 위치는 `border-color` 자리(정렬 유지).
  - 테스트 먼저(`/tdd`):
    - width/style/color 셋 다 4면 동일 변경 → `border: 2px solid red` 1행
    - color만 4면 불일치(개별 행 잔존) → border 통합 안 함, width/style만 개별 축약
    - style/color 미변경(width만) → `border-width` 한 줄(통합 없음)
    - asIs 전부 빈 값(baseline 없음) → asIs `""`로 정규화 고정(공백만 남지 않음)
    - 기존 padding/margin/border-radius 1차 축약 회귀 없음
- **검증**:
  - [x] `pnpm test styleChangeGroups` 통과(신규 케이스 포함)
  - [x] `pnpm test buildIssueMarkdown` 통과
  - [x] UI 편집 경로(단일/4필드) 무관하게 동일 diff — 저장 모델 longhand 보존 확인

### Task 7: 수동 시각 확인 (Chrome)

- **변경 대상**: 없음
- **작업 내용**: dev 빌드로 실제 페이지에서 패널 확인.
- **검증**:
  - [ ] padding 4면 동일 요소 → 자동 linked + 단일 필드
  - [ ] LinkToggle 끄면 4필드로 펼쳐짐, 켜면 단일로 접힘
  - [ ] 4면 다른 요소 → unlinked 시작(4필드), linked 토글 시 단일 필드 placeholder `Mixed`/`혼합`
  - [ ] **왕복 보존**: unlinked에서 4면 다르게 편집 → linked 토글(mixed) → unlink 복귀 시 4면 값 그대로(덮어쓰기 없음)
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
  - "border-width/style/color를 모두 linked로 동일 변경한 뒤 이슈 본문을 만들면 diff에
    `border: 2px solid red` 한 줄이 나온다"
  - ※ 필드 개수가 모드별 4↔1로 바뀌므로 안정적 셀렉터용 `data-testid`(예: linked 단일 필드,
    LinkToggle) 추가가 필요할 수 있다 — `/e2e-write`에서 src 수정은 `data-testid` 추가만 허용.
  - ※ diff 한 줄(`padding: 16px`/`border: 2px solid red`) 검증은 생성 markdown/draft diff 테이블을 DOM에서
    assert해야 한다. `/e2e-write`에서 기존 하니스에 본문/미리보기 노출 패턴이 있는지 먼저 확인 — 없으면 해당
    2개 시나리오는 단위 테스트(Task 6)로 커버되므로 e2e에선 보류 가능.
- **수동 테스트**: Task 7(시각 정합·좁은 폭 리플로우).

## 구현 순서 권장

- **Task 6**(border 2차 통합 diff)은 UI 트랙(Task 1~5)과 **완전히 독립** — 다른 파일·다른 관심사.
  병렬로 먼저 끝내도 된다.
- UI 트랙:
  1. **Task 1**(순수 함수 + 테스트) → **Task 2**(i18n): 독립, 병렬 가능.
  2. **Task 3**(useLinkedProps merged): Task 1 의존.
  3. **Task 4**(Quad/Radius/Gap) → **Task 5**(QuadStyle/SideStyleSelect): Task 2·3 의존. 둘 다 같은 파일
     (`StylePropEditors.tsx`)을 편집하므로 **순차 권장**(`/implement` 메인 단일이라 실제 순차).
- **Task 7**(수동 시각 확인): 전체 마지막.

## 가이드 영향

- `guide/ko/element/styling.md` · `guide/en/element/styling.md` — 박스모델 편집 시 linked 모드에서
  필드가 하나로 합쳐진다는 UX 변화. 4면 개별/일괄 편집 토글 설명이 있으면 단일 필드 동작으로 갱신.
  작성·판단 기준은 `guide/AUTHORING.md`. 구현 후 `/guide`로 처리.
