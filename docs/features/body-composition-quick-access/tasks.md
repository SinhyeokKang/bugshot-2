# 본문 구성 빠른 접근 — 구현 태스크

## 선행 조건

- 새 권한·env·의존성 없음. `@dnd-kit/*`·shadcn `Dialog`·`Switch`·`Card` 모두 설치돼 있다.
- 새 i18n 키 없음 — `settings.bodyComposition` / `settings.reorder.reset` / `common.ok` 가 ko/en 양쪽에 존재하는지만 확인.
- 착수 전 `docs/POSTMORTEM.md`를 `dnd-kit`·`reproPrefill`·`issueSections`로 grep해 과거 함정 소환.

## 태스크

### Task 1: `isDefaultSectionOrder` 순수 함수 승격 (TDD)

- **변경 대상**: `src/sidepanel/lib/issueSectionOrder.ts`(신규), `src/sidepanel/lib/__tests__/issueSectionOrder.test.ts`(신규)
- **작업 내용**: `SettingsTab.tsx:168-170`의 인라인 판정을 순수 함수로 옮긴다. 순서만 보고 `enabled`는 무시한다(`resetIssueSectionOrder`의 대칭). 테스트를 먼저 작성한다.
- **검증**:
  - [ ] 기본 순서 그대로 → `true`
  - [ ] 두 항목을 바꾼 배열 → `false`
  - [ ] 순서는 같고 `enabled`만 다른 배열 → `true`
  - [ ] 길이가 다른 배열(레거시/오염) → `false`
  - [ ] `pnpm test` 통과

### Task 2: `BodyCompositionCard` 공용 컴포넌트 승격

- **변경 대상**: `src/sidepanel/components/BodyCompositionCard.tsx`(신규), `src/sidepanel/tabs/SettingsTab.tsx`
- **작업 내용**: `SettingsTab.tsx`의 `IssueSectionRow`(`:385-456`), sensors·announcements(`:121-165`), DndContext/SortableContext 카드 블록(`:213-242`)을 새 파일로 이동. 스토어 구독은 카드가 직접 한다(props 없음). `CSS.Translate`·미디어 스위치 예외·구분선 border 주석을 그대로 가져간다. `SettingsTab`은 `<BodyCompositionCard />` 한 줄로 대체하고, `isDefaultOrder`는 Task 1의 함수 호출로 교체. 미사용 import 정리.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과 (`e2e/body-composition-reorder.spec.ts`가 의존하는 `data-testid`가 그대로인지 코드상 확인 — `issue-section-row-*`, `issue-section-handle-*`, `reset-body-composition`, `settings-section-body-composition`)
  - [ ] 설정 탭 본문 구성 UI가 시각·동작상 이전과 동일

### Task 3: `BodyCompositionDialog`

- **변경 대상**: `src/sidepanel/components/BodyCompositionDialog.tsx`(신규)
- **작업 내용**: `Dialog` + `DialogHeader`(제목 `settings.bodyComposition`) + `BodyCompositionCard` + `DialogFooter`(좌 `settings.reorder.reset` outline / 우 `common.ok`). 복원 버튼은 `isDefaultSectionOrder`면 `disabled`, 클릭 시 `resetIssueSectionOrder()`. 확인은 `onOpenChange(false)`. `DraftEditDialog.tsx`의 다이얼로그 구성 패턴을 따른다. `data-testid="body-composition-dialog"` 부여.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 컴포넌트 테스트(Task 6)로 토글·복원 disabled 판정 확인

### Task 4: drafting 푸터 진입점

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**: 로컬 `bodyCompositionOpen` state 추가. 푸터 우측 그룹(`:439-458`)에 `[뒤로] [⚙] [미리보기]` 순으로 `Settings2` 아이콘 버튼(`size="icon" variant="outline"`, `title`/`aria-label` = `settings.bodyComposition`, `data-testid="open-body-composition"`) 삽입. `disabled={aiDraftLoading || reproPrefillLoading}` — **`titleMissing`은 포함하지 않는다.** 다이얼로그는 기존 `LogPreviewDialog`·`AiDraftDialog`와 같은 위치(`:463-479`)에 마운트.
- **검증**:
  - [ ] 제목이 빈 상태에서도 버튼이 눌린다
  - [ ] AI 초안/자동채움 로딩 중 `disabled`
  - [ ] 다이얼로그에서 섹션을 끄면 뒤 패널의 해당 입력 영역이 사라진다

### Task 5: preview 푸터 진입점

- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**: 동일 패턴. 푸터 우측 그룹(`:415-424`)에 `[뒤로] [⚙] [이슈 제출(IssueCreateModal)]` 순으로 삽입 + 다이얼로그 마운트. 프리뷰에는 AI 로딩 플래그가 없으므로 `disabled` 없음.
- **검증**:
  - [ ] 섹션을 끄면 프리뷰 본문에서 해당 섹션(`(없음)` 포함)이 즉시 사라진다
  - [ ] 순서를 바꾸면 프리뷰 본문 순서가 바뀐다

### Task 6: 다이얼로그 컴포넌트 테스트

- **변경 대상**: `src/sidepanel/components/__tests__/BodyCompositionDialog.test.tsx`(신규)
- **작업 내용**: jsdom + `@testing-library/react`(+ `user-event`). 스위치 토글 → 스토어 반영, 미디어 행에 스위치 없음, 기본 순서에서 복원 버튼 `disabled`, 순서를 바꾼 상태에서 활성 → 클릭 시 기본 순서 복귀. 드래그는 검증하지 않는다(브라우저 실동작 — e2e 담당).
- **검증**:
  - [ ] 위 4개 케이스 green
  - [ ] `pnpm test` 통과

### Task 7: `useReproPrefill` 게이트 진입 시점 고정 (회귀 테스트 동반)

- **변경 대상**: `src/sidepanel/hooks/useReproPrefill.ts`
- **작업 내용**: `autoEnabledRef`(`:69`)와 같은 방식으로 `sectionEnabledRef`를 두고 deps(`:155`)에서 `sectionEnabled`를 제거. 게이트 판정(`:88`)은 ref를 읽는다. "진입 시점 고정, 켜는 쪽·끄는 쪽 모두 이번 세션 미반영" 주석을 기존 `autoEnabledRef` 주석과 같은 톤으로 남긴다.
- **검증**:
  - [ ] 진입 시 재현 과정이 **켜져 있으면** 기존대로 자동채움 발화 (정상 경로 회귀 없음)
  - [ ] 진입 시 **꺼져 있었다면** 작성 중 켜도 발화하지 않는다
  - [ ] 발화 후 껐다 켜도 재발화하지 않는다(`reproPrefillDone` 래치 유지)
  - [ ] `pnpm test` 통과

### Task 8: e2e spec

- **변경 대상**: `e2e/body-composition-quick-access.spec.ts`(신규)
- **작업 내용**: `body-composition-reorder.spec.ts`의 헬퍼·키보드 재정렬 패턴을 재사용한다(마우스 드래그 금지 — GOTCHAS "pointer capture"). **`finally`에서 순서·enabled를 반드시 복원**한다.
- **검증**: 아래 "e2e 시나리오" 참조

## 테스트 계획

### 단위 테스트

- `issueSectionOrder.test.ts` — Task 1의 4케이스.
- `BodyCompositionDialog.test.tsx` — Task 6의 4케이스.
- `useReproPrefill` 관련 — Task 7의 3케이스(기존 훅 테스트가 있으면 확장, 없으면 게이트 판정 부분만 커버 가능한 범위에서).

### e2e 시나리오

- 이슈 작성 패널 푸터의 본문 구성 버튼을 누르면 본문 구성 다이얼로그가 열린다.
- 다이얼로그에서 비고 스위치를 켜고 확인을 누르면 작성 패널에 비고 입력 영역이 나타난다.
- 다이얼로그에서 설명 스위치를 끄고 확인을 누르면 작성 패널에서 설명 입력 영역이 사라진다.
- 설명에 텍스트를 입력한 뒤 껐다가 다시 켜면 입력해 둔 텍스트가 그대로 남아 있다.
- 다이얼로그에서 키보드로 미디어를 최상단으로 옮기고 확인을 누르면 작성 패널의 섹션 순서가 그대로 바뀐다.
- 순서를 바꾼 뒤 다이얼로그를 닫으면 이동한 섹션의 입력창에 이어서 타이핑할 수 있고 앞서 친 텍스트가 유지된다. *(Tiptap DOM 이동 검증 — design.md 위험 요소)*
- 프리뷰 패널 푸터의 본문 구성 버튼으로 기대 결과를 끄면 프리뷰 본문에서 해당 섹션이 사라진다.
- 다이얼로그에서 끈 섹션은 설정 > 이슈 > 본문 구성에서도 꺼져 있다.
- 기본 순서 상태에서는 다이얼로그의 기본 순서 복원 버튼이 비활성이고, 순서를 바꾸면 활성화된다.
- 이슈 제목이 비어 있어도 본문 구성 버튼은 눌린다.

### 수동 테스트 (Chrome)

- [ ] 사이드패널 **최소 폭**에서 element 모드 drafting 푸터의 컨트롤 4개(취소·뒤로·⚙·미리보기)가 겹치거나 줄바꿈되지 않는다.
- [ ] 프리뷰 푸터 3개 버튼 정렬·높이(h-9)가 어긋나지 않는다.
- [ ] 다크 모드에서 다이얼로그 카드·구분선 대비 확인.
- [ ] 다이얼로그를 열어 둔 채 다른 탭으로 전환했다 돌아왔을 때 상태가 깨지지 않는다.
- [ ] video 모드로 캡처 → 재현 과정이 꺼진 상태로 진입 → 다이얼로그에서 켜도 AI 자동채움이 발화하지 않는다(Task 7 실동작 확인).

> 수동 확인 전에 `pnpm build`가 필요하다(dist가 stale이면 헛테스트).

## 구현 순서 권장

1. **Task 1** (순수 함수 + 테스트) — 나머지가 의존.
2. **Task 2** (카드 승격) — Task 3·4·5의 전제.
3. **Task 3** (다이얼로그) → **Task 6**(컴포넌트 테스트)와 함께.
4. **Task 4 / Task 5** — 서로 독립, 병렬 가능.
5. **Task 7** — 위와 독립, 언제든 병렬 가능.
6. **Task 8** (e2e) — Task 4·5 완료 후.

## 가이드 영향

- `guide/ko/settings/issue.md` · `guide/en/settings/issue.md` — "본문 구성" 섹션(ko 기준 `:32-67`)에 **이슈 작성·프리뷰 화면 푸터에서도 열 수 있다**는 안내 추가. "기타 > 재현 과정 채우기" 항목(`:80`)에는 작성 중에 재현 과정을 켜면 이번 이슈에는 자동채움이 적용되지 않는다는 설명을 덧붙인다.
- `guide/ko/element/issue.md` · `guide/ko/screenshot/issue.md` · `guide/ko/video/issue.md`(+ en 4벌) — 이슈 작성 화면 설명에 푸터 본문 구성 버튼 언급. 스크린샷 자산(`guide/*/assets/`)이 푸터를 담고 있으면 교체 대상.
- 작성 전 `guide/AUTHORING.md`를 먼저 읽는다. 구현 후 `/guide`로 처리.
