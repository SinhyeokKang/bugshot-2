# 녹화 모드 설정 — 구현 태스크

## 선행 조건

- `RecordingSource` 타입은 `src/store/editor-store.ts:17`에 이미 존재 (재사용).
- shadcn 컴포넌트: 설정 컨트롤은 **Tabs**(`src/components/ui/tabs.tsx`), 녹화 버튼은 **Button**(absolute ⚙ 오버레이) 사용 — 둘 다 설치 확인됨. (ButtonGroup split·ToggleGroup은 채택 안 함 — design 결정.)
- 권한·env 변경 없음.
- 캡처 단축키는 **이미 제거됨**(`remove-capture-shortcuts` 머지). `useCaptureShortcuts.ts`/`useCommandShortcuts.ts`/`ShortcutTooltip`은 코드에 없으며, `capture-commands.ts`는 `isCaptureEntryScreen`만 남았다. 이 feature는 단축키를 다루지 않는다.
- testid 의존 grep은 확인 완료: `mode-video`/`mode-screen-record`는 `capture-modes-layout.spec.ts` 1개 파일에만 의존(Task 7 갱신 대상 확정). `replay-button`은 `replay-action-log.spec.ts`·`action-log-coverage.spec.ts`도 의존(클릭만, testid 유지 필요).

## 태스크

### Task 1: `recordModeMeta` 순수 함수 + 단위 테스트
- **변경 대상**: `src/sidepanel/lib/recordModeMeta.ts` (신규), `src/sidepanel/lib/__tests__/recordModeMeta.test.ts` (신규)
- **작업 내용**: `recordModeMeta(mode: RecordingSource): { icon, labelKey }` 구현. 테스트를 먼저 작성 (CLAUDE.md 테스트 우선).
- **검증**:
  - [ ] `recordModeMeta("tab")` → `{ icon: "appWindow", labelKey: "issue.mode.video" }`
  - [ ] `recordModeMeta("screen")` → `{ icon: "monitorPlay", labelKey: "issue.mode.screenRecord" }`
  - [ ] `pnpm test` green

### Task 2: settings-ui-store에 recordingMode 추가 + 마이그레이션 (+ 단위 테스트 필수)
- **변경 대상**: `src/store/settings-ui-store.ts`, `src/store/__tests__/settings-ui-store.test.ts`(있으면 갱신, 없으면 신규)
- **작업 내용**: `import type { RecordingSource }`, `recordingMode`/`setRecordingMode` 상태 추가, 초기값 `"tab"`, version 5→6, migrate에 `state.recordingMode = state.recordingMode ?? "tab"` 한 줄. migrate 로직은 회귀 핵심이라 **단위 테스트 필수**(설계 "테스트 우선").
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] migrate 단위 테스트: `recordingMode` 부재 객체 → `"tab"` 부여
  - [ ] migrate 단위 테스트: 기존 `recordingMode: "screen"` → 보존(덮어쓰지 않음)
  - [ ] 새 설치 시 기본 `"tab"`
  - [ ] `pnpm test` green

### Task 3: i18n 키 추가 (ko/en, 플랫 문자열 키)
- **변경 대상**: `src/i18n/namespaces/settings.ts`
- **작업 내용**: `"settings.recordingMode.label"`/`".help"`/`".tab"`/`".screen"`를 **플랫 문자열 키**(점 포함 문자열, 중첩 객체 금지 — `locales.test.ts`가 `Object.keys` 평탄 비교라 중첩이면 검사 우회)로 ko/en 양쪽 추가.
- **검증**:
  - [ ] PostToolUse 훅(locales.test.ts) 통과 — ko/en 키 대칭·빈 값 없음
  - [ ] 키가 플랫 문자열인지(중첩 아님) 확인
  - [ ] `pnpm test` green

### Task 4: 설정 캡처 섹션에 녹화 모드 Tabs
- **변경 대상**: `src/sidepanel/tabs/SettingsTab.tsx`
- **작업 내용**: 캡처 설정 Card 안 replay 행 위에 녹화 모드 행 + Separator 추가. 좌측 아이콘(`Video`)+라벨+help, 우측에 shadcn **Tabs**(`TabsList` + `TabsTrigger` 2개, 아이콘+텍스트, `TabsContent` 없음)를 값 컨트롤로. `value={recordingMode}` / `onValueChange={setRecordingMode}`. `recordingMode`/`setRecordingMode` 구독.
- **검증**:
  - [ ] 설정 화면에 "녹화 모드" 행 노출, 현재 값이 활성 탭에 반영
  - [ ] 탭 클릭 시 값 변경·영속화 (리로드 후 유지)
  - [ ] `pnpm typecheck` 통과

### Task 5: 캡처 그리드 Row 3 재구성 (1×2×2)
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**: `EmptyState`에서 `recordingMode` 구독. [탭][화면] ButtonGroup 제거 → `<div flex gap-2>` 안에 [`<div relative min-w-0 flex-1>`[녹화 `<Button w-full pr-9 mode-record>` + ⚙ `<Button>` absolute 오버레이(`right-2 top-1/2 -translate-y-1/2 h-7 w-7`, `variant="ghost" size="icon"`, `mode-record-settings`)]][`ReplayButton` `min-w-0 flex-1`]. 녹화 버튼 아이콘/라벨은 `recordModeMeta`로, **onClick 분기는 인라인 if**(`recordingMode === "screen" ? onStartScreenRecord() : onStartVideo()`). 라벨은 `<span className="truncate">`. ⚙는 `onClick={(e)=>{e.stopPropagation(); navTo("settings","issue");}}`. `ReplayButton`에 `className` prop 추가(내부 `w-full` → `cn(..., className)`), `data-testid="replay-button"`·클릭 동작 유지.
- **검증**:
  - [ ] 캡처 진입 화면이 3행으로 렌더 (element / [요소캡처·범위캡처] / [녹화(우측 ⚙) · 리플레이])
  - [ ] `recordingMode`에 따라 녹화 버튼 아이콘·라벨 즉시 전환(리로드 불필요)
  - [ ] 녹화 버튼 본체 클릭 → 해당 모드 녹화 시작
  - [ ] ⚙ 클릭 → 설정 탭(이슈 sub-tab) 열림, **녹화는 시작되지 않음**(stopPropagation)
  - [ ] 좁은 폭에서 라벨 truncate(⚙ 자리 `pr-9` 확보)·⚙ 우측 중앙 정렬·클릭 분리 (**수동**)

> 단축키 분기 태스크 없음 — 캡처 단축키는 `remove-capture-shortcuts`로 이미 제거됨(`useCaptureShortcuts` 파일 없음). 녹화는 버튼 전용.

### Task 6: e2e 레이아웃 spec 갱신
- **변경 대상**: `e2e/capture-modes-layout.spec.ts` (의존 spec은 이 1개로 확정 — 선행 grep)
- **작업 내용**: `1×2×2` 검증으로 갱신. `mode-record`/`mode-record-settings`/`replay-button`이 같은 행, `mode-video`/`mode-screen-record` 동시 노출 단언 제거. 모드 전환 시나리오 추가 — `recordingMode`는 `chrome.storage.local` persist이나 store 라이브 구독이라 **리로드 없이** 즉시 반영(replay-action-log 패턴과 동일). 라벨 단언은 `getByText(t("issue.mode.screenRecord"))` 등 i18n 함수 기준.
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e` green
  - [ ] `replay-action-log.spec.ts`·`action-log-coverage.spec.ts` 회귀 없음(replay-button)

## 테스트 계획

- **단위 테스트**:
  - `recordModeMeta`: tab/screen 두 케이스 (Task 1)
  - settings-ui-store migrate v5→v6: `recordingMode` 부재 → `"tab"`, 기존 값 보존 (Task 2, **필수**)
- **e2e 시나리오** (`/e2e-write` 입력, 리로드 없이 라이브 반영):
  - 캡처 진입 화면은 정확히 3행이고 Row 3에 녹화 버튼·⚙·리플레이가 같은 행에 있다
  - 설정에서 녹화 모드를 "화면 녹화"로 바꾸면 캡처 화면 녹화 버튼 라벨이 `t("issue.mode.screenRecord")`로 바뀐다
  - 녹화 버튼 옆 ⚙를 누르면 설정 탭(이슈 sub-tab)이 열린다
- **수동 테스트** (자동화 불가):
  - 녹화 버튼 우측 ⚙ absolute 오버레이 — 우측 중앙 정렬(`right-2 top-1/2`), 본체와 클릭 분리(⚙ 클릭 시 녹화 안 됨)
  - 좁은 폭(~288px)에서 한국어 라벨 truncate 시 아이콘·⚙ 클릭 영역 유지(`pr-9`)
  - 녹화 중 설정에서 모드 변경 → 진행 중 녹화 무영향, 다음 녹화에 반영
  - 탭/화면 실제 녹화 산출물 정상 (그리드 버튼 클릭 경로)

## 구현 순서 권장

- Task 1 · 2 · 3 병렬 가능 (서로 독립).
- Task 4(설정 Tabs)는 Task 2·3 완료 후. Task 5(그리드)는 Task 1·2 완료 후. 4·5 병렬 가능.
- Task 6(e2e)은 마지막 (4·5 완료 후).
- 단축키 태스크 없음(캡처 단축키는 이미 제거됨).

## 가이드 영향

사용자 노출 UX 변경 — 구현 후 `/guide`로 처리:
- `guide/ko/video/record.md`·`guide/en/video/record.md` — 캡처 진입 화면 그리드(1×2×2) 설명, 녹화 모드를 설정에서 고른다는 안내, ⚙ 오버레이 설명. (단축키 표기는 `remove-capture-shortcuts`로 이미 제거됨 — 추가 작업 없음.)
- 설정 가이드에 캡처 설정 섹션 녹화 모드 항목이 있으면 갱신 (없으면 record.md에서 링크)
- `guide/AUTHORING.md` — 그리드 행 구성(1×2×2)·녹화 모드 설정 스냅샷 갱신. (캡처 단축키 항목은 이미 "버튼 전용"으로 갱신됨.)
