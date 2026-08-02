# 본문 구성 빠른 접근 — 구현 태스크

## 선행 조건

- 새 권한·env·의존성 없음. `@dnd-kit/*`·shadcn `Dialog`·`Switch`·`Card`·`TooltipIconButton` 모두 있다.
- 새 i18n 키 **1개**(`settings.bodyCompositionDescription`) — ko/en 동시 추가. 나머지(`settings.bodyComposition`·`settings.reorder.*`·`common.ok`)는 기존 키 재사용.
- 착수 전 `docs/POSTMORTEM.md`를 `dnd-kit`·`Tiptap`·`issueSections`·`Dialog`로 grep해 과거 함정 소환(특히 2026-07-22 modal Dialog × pointer/focus 소유권).
- **`useReproPrefill` 변경은 이번 스코프가 아니다** — 별도 티켓(design.md "후속 과제").

## 태스크

### Task 1: `isDefaultSectionOrder` 순수 함수 승격 (TDD)

- **변경 대상**: `src/sidepanel/lib/issueSectionOrder.ts`(신규), `src/sidepanel/lib/__tests__/issueSectionOrder.test.ts`(신규)
- **작업 내용**: `SettingsTab.tsx:167-170`의 인라인 판정을 순수 함수로 옮긴다. `DEFAULT_ISSUE_SECTIONS`(`settings-ui-store.ts:36`)에 **값 의존**한다. 순서만 보고 `enabled`는 무시한다(`resetIssueSectionOrder`의 대칭). 테스트를 먼저 작성한다.
- **검증**:
  - [ ] 기본 순서 그대로 → `true`
  - [ ] 두 항목을 바꾼 배열 → `false`
  - [ ] 순서는 같고 `enabled`만 다른 배열 → `true`
  - [ ] 길이가 다른 배열(레거시/오염) → `false`
  - [ ] `pnpm test` 통과

### Task 2: `BodyCompositionList` 공용 컴포넌트 승격

- **변경 대상**: `src/sidepanel/components/BodyCompositionList.tsx`(신규), `src/sidepanel/tabs/SettingsTab.tsx`
- **작업 내용**: `SettingsTab.tsx`의 `IssueSectionRow`(`:385-456`), sensors(`:121-125`)·announcements(`:127-156`)·`handleDragEnd`(`:158-165`), DndContext/SortableContext 블록(`:216-241`)을 새 파일로 이동. 스토어 구독은 목록이 직접 한다. **`Card`/`CardContent` 껍데기는 남기지 않고 `SettingsTab` 쪽에 유지**한다.
  - `idPrefix?: string` prop을 받아 `id`·`data-testid`에 접두를 붙인다. **설정 탭은 접두 미지정(무접두)**이라 기존 셀렉터가 그대로 유지된다.
  - **함께 옮길 것**: `screenReaderInstructions`(`:222-224`), `useSortable`의 `roleDescription` 오버라이드(`:399`), `CSS.Translate` 주석(`:411-413`), 미디어 행 스위치 예외, 구분선 border 주석, `useT`.
  - `SettingsTab`은 `isDefaultOrder`를 Task 1의 함수 호출로 교체. 미사용 import 정리.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과 — 특히 `src/sidepanel/lib/__tests__/bodyOutputGolden.test.ts`(8개 플랫폼 빌더 + 프리뷰 레이아웃 골든)가 무변경 green
  - [ ] 기존 e2e가 쓰는 셀렉터가 **설정 탭 쪽에서 접두 없이** 그대로 매칭: `issue-section-row-*`, `issue-section-handle-*`, `reset-body-composition`, `settings-section-body-composition`, `[id="issue-section-*"]` (코드상 확인)
  - [ ] (수동) 설정 탭 본문 구성이 이전과 동일 — 행 5개, 각 행 드래그 핸들, 미디어 행에만 스위치 없음, 헤더 우측 복원 버튼 위치·다크모드 구분선

### Task 3: `BodyCompositionDialog`

- **변경 대상**: `src/sidepanel/components/BodyCompositionDialog.tsx`(신규), `src/i18n/`(ko/en 키 1개)
- **작업 내용**: design.md "신규: BodyCompositionDialog"의 스니펫대로. **참조 패턴은 `StyleChangesDialog.tsx:154·162·172`**(`DraftEditDialog` 아님).
  - `DialogContent`에 `flex max-h-[80vh] flex-col`, 목록을 `min-h-0 flex-1 overflow-y-auto overscroll-contain` 래퍼에 넣는다 (없으면 잘려서 클릭 불가).
  - `DialogFooter`에 `!flex-row items-center !justify-between` (기본 `flex-col-reverse`의 `sm:`는 사이드패널에서 안 걸린다).
  - `DialogDescription` 추가 — **기능 설명만**, 전역 소급 경고는 넣지 않는다(PRD 비목표).
  - `onOpenAutoFocus`로 초기 포커스를 제목/첫 스위치로 보낸다(기본값이면 드래그 핸들에 착지).
  - `data-testid`: 다이얼로그 `body-composition-dialog`, 복원 버튼 `reset-body-composition-dialog`(설정 탭의 `reset-body-composition`과 구분).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] i18n 훅(`locales.test.ts`)이 ko/en 대칭 통과
  - [ ] 컴포넌트 테스트(Task 6)로 토글·복원 disabled 판정 확인

### Task 4: drafting 푸터 진입점

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**: 로컬 `bodyCompositionOpen` state 추가. 푸터 우측 그룹(`:439-458`)에 `[이전] [⚙] [이슈 프리뷰]` 순으로 `TooltipIconButton`(`Settings2`, `className="h-9 w-9"`, `label`=`settings.bodyComposition`, `testId="open-body-composition"`) 삽입. `disabled={aiDraftLoading || reproPrefillLoading}` — **`titleMissing`은 포함하지 않는다.**
  - **폭 대응 필수**: 우측 그룹 컨테이너에 `min-w-0`, 텍스트 버튼 라벨을 `<span className="truncate">`로 감싼다(선례 `IssueTab.tsx:322-343`, DESIGN.md:219).
  - 다이얼로그는 기존 `LogPreviewDialog`·`AiDraftDialog`와 같은 위치(`:463-479`)에 마운트.
- **검증**:
  - [ ] 제목이 빈 상태에서도 버튼이 눌린다
  - [ ] AI 초안/자동채움 로딩 중 `disabled`
  - [ ] 다이얼로그에서 섹션을 끄면 뒤 패널의 해당 입력 영역이 사라진다
  - [ ] 다이얼로그를 **열어 둔 채** AI가 시작돼도 조작이 가능하고 머지 결과가 손상되지 않는다

### Task 5: preview 푸터 진입점

- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**: 동일 패턴. 푸터 우측 그룹(`:415-424`)에 `[이전] [⚙] [이슈 제출(IssueCreateModal)]` 순으로 삽입 + `min-w-0`/`truncate` + 다이얼로그 마운트. 프리뷰에는 AI 로딩 플래그가 없으므로 `disabled` 없음.
- **검증**:
  - [ ] 섹션을 끄면 프리뷰 본문에서 해당 섹션(**"비어 있음"** 표기 포함)이 즉시 사라진다
  - [ ] 순서를 바꾸면 프리뷰 본문 순서가 바뀐다
  - [ ] media 제외 4개를 전부 끄면 본문이 미디어·로그만 남고 렌더가 깨지지 않는다

### Task 6: 다이얼로그 컴포넌트 테스트

- **변경 대상**: `src/sidepanel/components/__tests__/BodyCompositionDialog.test.tsx`(신규)
- **작업 내용**: jsdom + `@testing-library/react`(+ `user-event`). 케이스: 스위치 토글 → 스토어 반영 / 미디어 행에 스위치 없음 / 기본 순서에서 복원 버튼 `disabled` / 순서를 바꾼 상태에서 활성 → 클릭 시 기본 순서 복귀. 드래그는 검증하지 않는다(브라우저 실동작 — e2e 담당).
  - **선행 확인 2건**: ① 저장소에 **dnd-kit을 렌더한 테스트 선례가 0건**이고 `setup-dom.ts`에 PointerEvent 폴리필이 없다 — 렌더만으로 통과할 공산이 크나 미검증이다. 죽으면 폴백: 다이얼로그 셸만 렌더 + 토글 검증은 `settings-ui-store` 단위 테스트로 이관. ② 목록이 persist 스토어를 직접 구독하므로 `vi.stubGlobal("chrome", ...)`가 필요하다(선례 `src/store/__tests__/settings-ui-store.test.ts`).
  - `beforeEach`에서 `useSettingsUiStore.setState` 또는 리셋 액션으로 `issueSections`를 초기화한다(케이스 간 상태 누수 방지).
  - Radix `Dialog` 렌더 선례는 있다(`JiraSiteDialog.test.tsx`).
- **검증**:
  - [ ] 위 4개 케이스 green
  - [ ] `pnpm test` 통과

### Task 7: e2e 헬퍼 승격 (Task 8 선행)

- **변경 대상**: `e2e/helpers/` (신규 또는 기존 헬퍼 파일), `e2e/body-composition-reorder.spec.ts`
- **작업 내용**: `body-composition-reorder.spec.ts`의 로컬 `keyboardDragOnce`가 `panel.getByTestId(...)`를 하드코딩하고 있어 다이얼로그에 재사용할 수 없다. 로케이터 루트를 파라미터화해 공용 헬퍼로 승격하고 기존 spec을 그 헬퍼로 전환한다.
  - 시그니처 예: `keyboardDragOnce(root: Locator, sectionId: string, dir: "up" | "down")`
- **검증**:
  - [ ] `body-composition-reorder.spec.ts`가 전환 후에도 green (`pnpm build:e2e && pnpm test:e2e`)

### Task 8: e2e spec

- **변경 대상**: `e2e/body-composition-quick-access.spec.ts`(신규)
- **작업 내용**: 진입 경로는 **freeform**(`mode-freeform` → `drafting-panel`, `settings-sections.spec.ts` 패턴)을 쓴다 — 이 기능은 캡처 방식과 직교하므로 element 모드 픽커+스타일 입력을 거칠 이유가 없고 훨씬 덜 플레이키하다. 마우스 드래그 금지(GOTCHAS "pointer capture") — Task 7 헬퍼의 키보드 재정렬만. 로케이터는 **`body-composition-dialog` 하위로 스코프**를 좁힌다(설정 탭 목록이 항상 마운트돼 있다). **`finally`에서 순서·enabled를 반드시 복원**한다.
- **검증**: 아래 "e2e 시나리오" 참조

### Task 9: 문서 갱신

- **변경 대상**: `docs/DIRECTORY.md`, `e2e/COVERAGE.md`
- **작업 내용**: 신규 파일 3개(`lib/issueSectionOrder.ts`·`components/BodyCompositionList.tsx`·`components/BodyCompositionDialog.tsx`)를 DIRECTORY에, 신규 spec을 COVERAGE에 등재. `SettingsTab.tsx` 설명에서 본문 구성 인라인 언급이 있으면 갱신.
- **검증**:
  - [ ] `/push`의 문서 신선도 트라이아지 통과

## 테스트 계획

### 단위 테스트

- `issueSectionOrder.test.ts` — Task 1의 4케이스.
- `BodyCompositionDialog.test.tsx` — Task 6의 4케이스.

### e2e 시나리오

- 이슈 작성 패널 푸터의 본문 구성 버튼(`open-body-composition`)을 누르면 `body-composition-dialog`가 보인다.
- 다이얼로그에서 비고 스위치를 켜고 확인을 누르면 작성 패널에 비고 입력 영역이 나타난다.
- 다이얼로그에서 설명 스위치를 끄고 확인을 누르면 작성 패널에서 설명 입력 영역이 사라진다.
- 설명에 텍스트를 입력한 뒤 껐다가 다시 켜면 입력해 둔 텍스트가 그대로 남아 있다.
- 다이얼로그에서 키보드로 미디어를 최상단으로 옮기고 확인을 누르면 작성 패널 섹션 컨테이너의 순서가 그대로 바뀐다.
- 순서를 바꾼 뒤 다이얼로그를 닫고 이동한 섹션 입력창에 이어서 타이핑하면, **앞서 친 텍스트 + 새로 친 텍스트**가 이어진 전문이 된다. *(Tiptap DOM 이동 검증 — design.md 위험 요소)*
- 다이얼로그 안에서 키보드 드래그 중 Escape를 누르면 **드래그만 취소되고 다이얼로그는 열려 있다**. *(dnd-kit × Radix DismissableLayer)*
- 프리뷰 패널 푸터의 본문 구성 버튼으로 기대 결과를 끄면 프리뷰 본문에서 해당 섹션이 사라진다.
- 기본 순서 상태에서는 `reset-body-composition-dialog`가 비활성이고, 순서를 바꾸면 활성화된다. 누르면 기본 순서로 돌아온다.
- 이슈 제목이 비어 있어도 본문 구성 버튼은 눌린다.

> 삭제한 시나리오: "다이얼로그에서 끈 섹션은 설정 탭에서도 꺼져 있다" — 같은 스토어·같은 컴포넌트라 vacuous.

### 수동 테스트 (Chrome)

- [ ] **푸터 폭 3점 × 2로케일**: 사이드패널 **320 / 372 / 400px** × **ko·en** × element·screenshot·video 모드에서 drafting 푸터 컨트롤이 겹치거나 잘리지 않는다(`truncate`로 줄어드는 건 정상, 테두리를 뚫는 게 실패). preview 푸터도 동일.
- [ ] 푸터 버튼 높이(h-9)가 ⚙ 포함 어긋나지 않는다.
- [ ] 다이얼로그 스크롤: 창 높이를 줄여 목록이 넘칠 때 **잘리지 않고 스크롤**되며 푸터가 항상 보인다.
- [ ] 스크롤 컨테이너 안에서 마우스 드래그 재정렬이 정상 동작한다(auto-scroll·`CSS.Translate` 좌표계 — e2e 사각지대).
- [ ] 다크 모드에서 다이얼로그 목록 구분선·대비 확인.
- [ ] **en 로케일**로 전환해 다이얼로그 제목·설명·복원 버튼 라벨과 dnd-kit 공지문(`settings.reorder.*`)이 영문으로 나온다.
- [ ] VoiceOver: 다이얼로그 열림 시 초기 포커스가 드래그 핸들이 아니며, 제목·설명이 읽히고, 키보드 재정렬 공지가 들린다(모달 안 live region 실측).
- [ ] 다이얼로그를 열어 둔 채 다른 탭으로 전환했다 돌아왔을 때 상태가 깨지지 않는다.

> 수동 확인 전에 `pnpm build`가 필요하다(dist가 stale이면 헛테스트).

## 구현 순서 권장

1. **Task 1** (순수 함수 + 테스트) — 나머지가 의존.
2. **Task 2** (목록 승격) — Task 3·4·5의 전제.
3. **Task 3** (다이얼로그) → **Task 6**(컴포넌트 테스트)와 함께.
4. **Task 4 / Task 5** — 서로 독립, 병렬 가능.
5. **Task 7** (헬퍼 승격) — 언제든 병렬 가능, Task 8의 전제.
6. **Task 8** (e2e) — Task 4·5·7 완료 후.
7. **Task 9** (문서) — 마지막.

## 가이드 영향

- `guide/ko/settings/issue.md` · `guide/en/settings/issue.md` — "본문 구성" 섹션(ko 기준 `:32-67`)에 **이슈 작성·프리뷰 화면 푸터에서도 열 수 있다**는 안내 추가.
- `guide/ko/element/issue.md` · `guide/ko/screenshot/issue.md` · `guide/ko/video/issue.md`(+ en 4벌) — 이슈 작성 화면 설명에 푸터 본문 구성 버튼 언급. 스크린샷 자산(`guide/*/assets/`)이 푸터를 담고 있으면 교체 대상.
- 작성 전 `guide/AUTHORING.md`를 먼저 읽는다. 구현 후 `/guide`로 처리.
- *(재현 과정 자동채움 타이밍 관련 가이드 문구는 별도 티켓에서 다룬다 — 이번 변경은 현행 동작 유지.)*
