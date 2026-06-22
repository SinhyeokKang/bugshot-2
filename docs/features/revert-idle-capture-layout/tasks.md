# Idle 캡처 진입 레이아웃 원복 (1x2x2) — 구현 태스크

## 선행 조건
- 권한·env·의존성 변경 없음. 순수 UI/핸들러 수정.
- 현재 브랜치 `dev`.

## 태스크

### Task 1: `RecordingSettingsDialog` 삭제 + IssueTab import 정리
- **변경 대상**: `src/sidepanel/components/RecordingSettingsDialog.tsx`(삭제), `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**:
  - `RecordingSettingsDialog.tsx` 파일 삭제.
  - IssueTab에서 `RecordingSettingsDialog` import 제거, `useTabNav` import 추가(`@/sidepanel/tab-nav`).
- **검증**:
  - [ ] `grep -rn "RecordingSettingsDialog" src/ e2e/` 결과 0.
  - [ ] `pnpm typecheck` 통과(잔존 import 없음).

### Task 2: `EmptyState` 1x2x2 재구성
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx` `EmptyState`
- **작업 내용**:
  - `recSettingsOpen` `useState`·`RecordingSettingsDialog` JSX 제거.
  - 버튼 컨테이너 3행:
    - Row1: `<Button className="w-full" onClick={onStartElement} data-testid="mode-element">` (primary) + `<Crosshair/>` + `{t("issue.mode.element")}`.
    - Row2: `<ButtonGroup className="w-full">` → 요소 캡처(`mode-element-shot`, outline, `flex-1`) + 범위 캡처(`mode-screenshot`, outline, `flex-1`).
    - Row3: `<ButtonGroup className="w-full">` → 녹화 버튼(`mode-record`, outline, `min-w-0 flex-1`, `RecordIcon`+`t(meta.labelKey)`, onClick 모드 분기) + `<ReplayButton className="min-w-0 flex-1" />`.
  - `meta`/`RecordIcon`/`recordingMode` 셀렉터 유지.
- **검증**:
  - [ ] idle 화면이 3행으로 렌더, Row1이 primary 단독.
  - [ ] `mode-record-settings` testid가 DOM에 없음.
  - [ ] 녹화 버튼이 `recordingMode`에 따라 아이콘 분기(tab→AppWindow, screen→MonitorPlay).

### Task 3: `ReplayButton` 동작 원복
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx` `ReplayButton`
- **작업 내용**:
  - props에서 `onConfigure` 제거, `className?: string`만.
  - `const navTo = useTabNav();` 도입.
  - 비활성 분기 버튼 `onClick`을 `() => navTo("settings", "issue")`로.
  - 주석도 "다이얼로그를 연다" → "설정의 캡처 sub-tab으로 보낸다"로 원복.
- **검증**:
  - [ ] replayEnabled=off 상태에서 리플레이 클릭 → 설정 탭 이슈 sub-tab 활성.
  - [ ] replayEnabled=on 상태에서 capture 동작·encoding 표시 정상.

### Task 4: 잔존 참조·orphan 확인
- **변경 대상**: 없음(검증 전용)
- **작업 내용**: 삭제·변경 후 잔존 참조 스윕.
- **검증**:
  - [ ] `grep -rn "mode-record-settings\|onConfigure\|RecordingSettingsDialog" src/` 결과 0.
  - [ ] `RecordingSettingsCard`는 `SettingsTab` 단일 사용처로 유지(삭제 금지).
  - [ ] `pnpm typecheck` 통과.

## 테스트 계획
- **단위 테스트**: 순수 함수 신규/변경 없음(`recordModeMeta`는 변경 안 함, 기존 `recordModeMeta.test.ts` 유지). 레이아웃은 컴포넌트라 단위 테스트 대상 아님 — e2e로 커버.
- **e2e 시나리오** (`/e2e-write` 입력 — `e2e/capture-modes-layout.spec.ts` 재작성):
  - idle에 `mode-element`/`mode-element-shot`/`mode-screenshot`/`mode-record`/`replay-button` 노출, `mode-record-settings`·`mode-video`·`mode-screen-record` 부재.
  - Row1: `mode-element`가 단독(ButtonGroup 밖). Row2 ButtonGroup에 `mode-element-shot`+`mode-screenshot`. Row3 ButtonGroup에 `mode-record`+`replay-button`(균등 너비 ±2px).
  - 기본 모드 tab → 녹화 버튼 `svg.lucide-app-window` 1개.
  - 설정 탭에서 `recording-mode-screen` 선택 → idle 복귀 시 녹화 버튼 `svg.lucide-monitor-play` 1개로 전환.
  - 비활성 리플레이 클릭(force) → 설정 탭(`tab-settings` data-state active) + 이슈 sub-tab 노출, 다이얼로그 안 뜸(`getByRole("dialog")` count 0).
- **수동 테스트** (Chrome):
  - [ ] idle 시각 정합 — primary 요소 편집이 가장 강조, 3행 정렬·균등 너비.
  - [ ] 녹화 버튼 클릭 시 설정 모드대로 탭/화면 녹화 시작(자동화 불가).
  - [ ] 설정 탭에서 모드 전환 후 idle 아이콘·레이블 반영.

## 구현 순서 권장
Task 1 → 2 → 3 → 4 순차(1이 import 토대, 2·3은 같은 파일이라 함께 편집 가능). e2e 재작성은 구현 후 `/e2e-write`.

## 가이드 영향
사용자 노출 UX 변경(idle 레이아웃·⚙ 제거·비활성 리플레이 동작). `guide/AUTHORING.md` 규칙대로 `/guide`로 ko·en 동시 갱신:
- `guide/ko/video/record.md` · `guide/en/video/record.md` — ⚙ 녹화 설정 다이얼로그 진입 설명 제거, 녹화 모드는 설정 탭에서 변경하는 흐름으로. 단일 녹화 버튼 모드 분기 유지 설명.
- `guide/ko/video/replay.md` · `guide/en/video/replay.md` — 비활성 리플레이 클릭이 설정 탭으로 이동(다이얼로그 아님)으로 정정.
- `guide/ko/quick-start.md` · `guide/en/quick-start.md` / `guide/ko/element/picker.md` · `guide/en/element/picker.md` — idle 진입 화면 스크린샷·버튼 배치 설명이 1x2x2를 반영하는지 대조.
- `guide/ko/settings/issue.md` · `guide/en/settings/issue.md` — 녹화 설정 진입점이 설정 탭 단일임을 반영(다이얼로그 캡처 제거 여부 확인).
