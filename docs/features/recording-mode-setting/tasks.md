# 녹화 모드 설정 — 구현 태스크

## 선행 조건

- `RecordingSource` 타입은 `src/store/editor-store.ts:17`에 이미 존재 (재사용).
- ToggleGroup·ButtonGroup shadcn 컴포넌트 설치 확인됨 (`src/components/ui/toggle-group.tsx`, `button-group.tsx`).
- 권한·env 변경 없음.
- 다른 spec이 `mode-video`/`mode-screen-record` testid에 의존하는지 사전 grep:
  `grep -rn "mode-video\|mode-screen-record" e2e`

## 태스크

### Task 1: `recordModeMeta` 순수 함수 + 단위 테스트
- **변경 대상**: `src/sidepanel/lib/recordModeMeta.ts` (신규), `src/sidepanel/lib/__tests__/recordModeMeta.test.ts` (신규)
- **작업 내용**: `recordModeMeta(mode: RecordingSource): { icon, labelKey }` 구현. 테스트를 먼저 작성 (CLAUDE.md 테스트 우선).
- **검증**:
  - [ ] `recordModeMeta("tab")` → `{ icon: "appWindow", labelKey: "issue.mode.video" }`
  - [ ] `recordModeMeta("screen")` → `{ icon: "monitorPlay", labelKey: "issue.mode.screenRecord" }`
  - [ ] `pnpm test` green

### Task 2: settings-ui-store에 recordingMode 추가 + 마이그레이션
- **변경 대상**: `src/store/settings-ui-store.ts`
- **작업 내용**: `RecordingSource` import, `recordingMode`/`setRecordingMode` 상태 추가, 초기값 `"tab"`, version 5→6, migrate에 기본값 부여.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 설정(v5)에서 로드 시 `recordingMode === "tab"` (마이그레이션 단위 테스트 또는 수동)
  - [ ] 새 설치 시 기본 `"tab"`

### Task 3: i18n 키 추가 (ko/en)
- **변경 대상**: `src/i18n/namespaces/settings.ts`
- **작업 내용**: `settings.recordingMode.label`/`.help`/`.tab`/`.screen` ko/en 양쪽 추가.
- **검증**:
  - [ ] PostToolUse 훅(locales.test.ts) 통과 — ko/en 키 대칭·빈 값 없음
  - [ ] `pnpm test` green

### Task 4: 설정 캡처 섹션에 녹화 모드 ToggleGroup
- **변경 대상**: `src/sidepanel/tabs/SettingsTab.tsx`
- **작업 내용**: 캡처 설정 Card 안 replay 행 위에 녹화 모드 행 + Separator 추가. 우측 ToggleGroup(type=single, tab/screen, 아이콘 AppWindow/MonitorPlay). `recordingMode`/`setRecordingMode` 구독.
- **검증**:
  - [ ] 설정 화면에 "녹화 모드" 행 노출, 현재 값이 세그먼트에 반영
  - [ ] 세그먼트 클릭 시 값 변경·영속화 (리로드 후 유지)
  - [ ] `pnpm typecheck` 통과

### Task 5: 캡처 그리드 Row 3 재구성 (1×2×2)
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**: `EmptyState`에서 `recordingMode` 구독. [탭][화면] ButtonGroup 제거 → `<div flex gap-2>` 안에 [ButtonGroup [녹화(mode-record)|⚙(mode-record-settings)]][ReplayButton(flex-1)]. 녹화 버튼은 `recordModeMeta`로 아이콘/라벨 분기, onClick은 모드에 맞는 start 호출. ⚙는 `navTo("settings","issue")`. ReplayButton에 `flex-1` 적용(props 또는 래퍼).
- **검증**:
  - [ ] 캡처 진입 화면이 3행으로 렌더 (element / [요소캡처·범위캡처] / [녹화+⚙ · 리플레이])
  - [ ] `recordingMode`에 따라 녹화 버튼 아이콘·라벨 전환
  - [ ] 녹화 버튼 클릭 → 해당 모드 녹화 시작
  - [ ] ⚙ 클릭 → 설정 캡처 섹션 이동

### Task 6: 단축키 분기
- **변경 대상**: `src/sidepanel/hooks/useCaptureShortcuts.ts`
- **작업 내용**: `action === "video"` 분기에서 `useSettingsUiStore.getState().recordingMode` 읽어 `startScreenCapture`/`startVideoCapture` 선택. `startScreenCapture` import 추가.
- **검증**:
  - [ ] 탭 모드 + Cmd/Ctrl+Shift+X → 탭 녹화 시작
  - [ ] 화면 모드 + 단축키 → 화면 녹화 시작 (**user activation 실측** — 위험 요소)

### Task 7: e2e 레이아웃 spec 갱신
- **변경 대상**: `e2e/capture-modes-layout.spec.ts` (+ Task 1 사전 grep으로 발견된 의존 spec)
- **작업 내용**: `1×2×2` 검증으로 갱신. `mode-record`/`mode-record-settings`/`replay-button` 같은 행 단언. 설정에서 모드 변경 시 녹화 버튼 전환 시나리오 추가.
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e` green

## 테스트 계획

- **단위 테스트**:
  - `recordModeMeta`: tab/screen 두 케이스 (Task 1)
  - settings-ui-store migrate v5→v6: `recordingMode` 부재 → `"tab"` 부여 (Task 2, store라 선택적)
- **e2e 시나리오** (`/e2e-write` 입력):
  - 캡처 진입 화면은 정확히 3행이고 Row 3에 녹화 버튼·⚙·리플레이가 같은 행에 있다
  - 설정에서 녹화 모드를 "화면 녹화"로 바꾸면 캡처 화면 녹화 버튼 라벨이 `issue.mode.screenRecord`로 바뀐다
  - 녹화 버튼 옆 ⚙를 누르면 설정 캡처 섹션으로 이동한다
- **수동 테스트** (자동화 불가):
  - 단축키 → 화면 녹화 시 `getDisplayMedia` user activation 동작 (Task 6 위험)
  - split 버튼 [녹화|⚙] border-radius 시각 정합
  - 탭/화면 실제 녹화 산출물 정상

## 구현 순서 권장

- Task 1 → 2 → 3 (서로 독립, 1·3은 병렬 가능. 2는 1의 타입과 무관해 병렬 가능)
- Task 4·5는 Task 2·3 완료 후 (store·i18n 의존). 4와 5는 병렬 가능하나 5가 `recordModeMeta`(Task 1) 의존.
- Task 6은 Task 2 후 가능.
- Task 7은 마지막 (4·5·6 완료 후).

## 가이드 영향

사용자 노출 UX 변경 — 구현 후 `/guide`로 처리:
- `guide/ko/video/record.md`·`guide/en/video/record.md` — 캡처 진입 화면 그리드(1×2×2) 설명, 녹화 모드를 설정에서 고른다는 안내, split 버튼 ⚙ 설명, 단축키가 선택된 모드를 시작
- 설정 가이드에 캡처 설정 섹션 녹화 모드 항목이 있으면 갱신 (없으면 record.md에서 링크)
- `guide/AUTHORING.md` — 캡처 모드/단축키 매핑 스냅샷 표에서 capture-video가 "선택된 녹화 모드"를 트리거하도록, 그리드 행 구성(1×2×2) 갱신
