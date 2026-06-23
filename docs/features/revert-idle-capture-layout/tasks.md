# Idle 캡처 진입 레이아웃 원복 (1x2x2) — 구현 태스크

## 선행 조건
- 권한·env·의존성 변경 없음. 순수 UI/핸들러 수정.
- 현재 브랜치 `dev`.

## 태스크

### Task 0: Row1 레이블 i18n 값 변경
- **변경 대상**: `src/i18n/namespaces/issue.ts`
- **작업 내용**: `issue.mode.element` 값을 ko "요소 편집"→"요소 스타일 편집", en "Edit element"→"Edit element style"로 수정. 키 추가·삭제·구조 변경 없음. ko/en 동시.
- **검증**:
  - [x] `src/i18n/__tests__/locales.test.ts` 자동 실행(Edit 시 PostToolUse 훅) 통과 — 키 대칭·placeholder 일치.
  - [x] `pnpm test` 통과 (1941 green).

### Task 1: `RecordingSettingsDialog` 삭제 + IssueTab import 정리
- **변경 대상**: `src/sidepanel/components/RecordingSettingsDialog.tsx`(삭제), `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**:
  - `RecordingSettingsDialog.tsx` 파일 삭제.
  - IssueTab에서 `RecordingSettingsDialog` import 제거, `useTabNav` import 추가(`@/sidepanel/tab-nav`).
- **검증**:
  - [x] `grep -rn "RecordingSettingsDialog" src/ e2e/` 결과 0 (src 0; e2e는 /e2e-write 대상).
  - [x] `pnpm typecheck` 통과(잔존 import 없음).

### Task 2: `EmptyState` 1x2x2 재구성
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx` `EmptyState`
- **작업 내용**:
  - `recSettingsOpen` `useState`·`RecordingSettingsDialog` JSX 제거.
  - 버튼 컨테이너 3행(footer의 가이드·`mode-freeform` 버튼은 손대지 않음):
    - Row1: `<Button className="w-full" onClick={onStartElement} data-testid="mode-element">` (primary) + `<Crosshair/>` + `{t("issue.mode.element")}`.
    - Row2: `<ButtonGroup className="w-full">` → 요소 캡처(`mode-element-shot`, outline, `flex-1`) + 범위 캡처(`mode-screenshot`, outline, `flex-1`).
    - Row3: `<ButtonGroup className="w-full">` → 녹화 버튼(`mode-record`, outline, `min-w-0 flex-1`, `RecordIcon`+`t(meta.labelKey)`, onClick 모드 분기) + `<ReplayButton className="min-w-0 flex-1" />`.
  - `meta`/`RecordIcon`/`recordingMode` 셀렉터 유지.
- **검증**:
  - [x] idle 화면이 3행으로 렌더, Row1이 primary 단독(ButtonGroup 밖).
  - [x] `mode-record-settings` testid가 DOM에 없음.
  - [x] 녹화 버튼이 `recordingMode`에 따라 아이콘 분기(tab→AppWindow, screen→MonitorPlay).
  - [x] footer의 `mode-freeform`·가이드 버튼 그대로 노출.

### Task 3: `ReplayButton` 동작 원복
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx` `ReplayButton`
- **작업 내용**:
  - props에서 `onConfigure` 제거, `className?: string`만.
  - `const navTo = useTabNav();` 도입.
  - 비활성 분기 버튼 `onClick`을 `() => navTo("settings", "issue")`로.
  - 주석도 "다이얼로그를 연다" → "설정의 캡처 sub-tab으로 보낸다"로 원복.
- **검증**:
  - [x] replayEnabled=off 상태에서 리플레이 클릭 → `navTo("settings","issue")` (코드 확인).
  - [x] replayEnabled=on capture·encoding 경로 무변경 유지.

### Task 4: 잔존 참조·orphan 확인
- **변경 대상**: 없음(검증 전용)
- **작업 내용**: 삭제·변경 후 잔존 참조 스윕.
- **검증**:
  - [x] `grep -rn "mode-record-settings\|onConfigure\|RecordingSettingsDialog\|recSettingsOpen\|setRecSettingsOpen" src/ e2e/` 결과 0(`e2e/README.md` 포함).
  - [x] `RecordingSettingsCard`는 `SettingsTab` 단일 사용처로 유지(삭제 안 함).
  - [x] `pnpm typecheck` 통과.

## 테스트 계획
- **단위 테스트**: 순수 함수 신규/변경 없음(`recordModeMeta`는 변경 안 함, 기존 `recordModeMeta.test.ts` 유지). i18n 값 변경은 `locales.test.ts`가 커버(키 대칭). 레이아웃은 컴포넌트라 단위 테스트 대상 아님 — e2e로 커버.
- **e2e 시나리오** (`/e2e-write` 입력 — `e2e/capture-modes-layout.spec.ts` 재작성):
  - idle에 `mode-element`/`mode-element-shot`/`mode-screenshot`/`mode-record`/`replay-button` 노출, `mode-record-settings`·`mode-video`·`mode-screen-record` 부재(`toHaveCount(0)`).
  - Row1: `mode-element`가 단독 — `mode-element`를 has하는 `[data-slot="button-group"]`가 **없음**(ButtonGroup 밖) 또는 Row1에 다른 mode testid 0개.
  - Row2 ButtonGroup(`mode-element-shot` has): `mode-screenshot` count 1, `mode-element` count 0(음성 단언).
  - Row3 ButtonGroup(`mode-record` has): `replay-button` count 1, `mode-record-settings` count 0. `mode-record`·`replay-button` 균등 너비 ±2px.
  - 기본 모드 tab → 녹화 버튼 `svg.lucide-app-window` 1개(라벨 텍스트 단언 금지 — locale 비결정).
  - 설정 탭에서 `recording-mode-screen` 선택 → idle 복귀 시 녹화 버튼 `svg.lucide-monitor-play` 1개로 전환.
  - 비활성 리플레이 클릭(force) → 설정 탭(`tab-settings` data-state active) + 이슈 sub-tab 노출, 다이얼로그 안 뜸(`getByRole("dialog")` count 0).
  - **afterAll 복원 보존 필수**(README "설정 영속 오염" 규칙): `tab-settings → settings-sub-issue → recording-mode-tab` 클릭으로 모드를 tab으로 되돌린다. 다이얼로그 삭제 후 `recording-mode-*` testid는 SettingsTab 단일이라 `getByRole("dialog")` 스코프 불필요. 리플레이 토글 접근 시 `#replay-enabled`(id, testid 아님) 셀렉터 사용.
- **수동 테스트** (Chrome):
  - [ ] idle 시각 정합 — primary 요소 스타일 편집이 가장 강조, 3행 정렬·균등 너비.
  - [ ] Row1 레이블이 ko "요소 스타일 편집" / en "Edit element style"로 표시(언어 전환 후 양쪽 확인).
  - [ ] 리플레이 **활성 + 인코딩 중** Row3 레이아웃 — 스피너+레이블이 좁은 칸에서 깨지지 않고 truncate.
  - [ ] 녹화 버튼 클릭 시 설정 모드대로 탭/화면 녹화 시작(자동화 불가).
  - [ ] 설정 탭에서 모드 전환 후 idle 아이콘·레이블 반영.

## 구현 순서 권장
Task 0(i18n, 독립) → 1 → 2 → 3 → 4 순차(1이 import 토대, 2·3은 같은 파일이라 함께 편집 가능). Task 0은 다른 태스크와 병렬 가능. e2e 재작성은 구현 후 `/e2e-write`.

## 가이드 영향
사용자 노출 UX 변경(idle 레이아웃·⚙ 제거·비활성 리플레이 동작·**Row1 레이블 "요소 편집"→"요소 스타일 편집"**). `guide/AUTHORING.md` 규칙대로 `/guide`로 ko·en 동시 갱신. 레이블 변경은 가이드 본문·UI 라벨 표·스크린샷 캡션 전반의 "요소 편집" 표기를 점검:
- `guide/ko/video/record.md` · `guide/en/video/record.md` — ⚙ 녹화 설정 다이얼로그 진입 설명 제거, 녹화 모드는 설정 탭에서 변경하는 흐름으로. 단일 녹화 버튼 모드 분기 유지 설명.
- `guide/ko/video/replay.md` · `guide/en/video/replay.md` — 비활성 리플레이 클릭이 설정 탭으로 이동(다이얼로그 아님)으로 정정.
- `guide/ko/quick-start.md` · `guide/en/quick-start.md` / `guide/ko/element/picker.md` · `guide/en/element/picker.md` — idle 진입 화면 스크린샷·버튼 배치 설명이 1x2x2를 반영하는지 대조.
- `guide/ko/settings/issue.md` · `guide/en/settings/issue.md` — 녹화 설정 진입점이 설정 탭 단일임을 반영(다이얼로그 캡처 제거 여부 확인).
