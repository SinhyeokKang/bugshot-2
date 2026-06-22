# 캡처 단축키 제거 — 구현 태스크

## 선행 조건

- 영속 데이터 마이그레이션 없음(스캔 확인 — 단축키는 manifest 전용).
- `recording-mode-setting` feature와 `IssueTab.tsx` EmptyState 충돌 가능 — **이 feature를 먼저 적용**하면 recording-mode-setting이 ShortcutTooltip 없는 EmptyState 위에서 작업하게 돼 깔끔(design 위험 요소).
- **삭제 순서 주의**: `capture-commands.ts` export 제거를 먼저 하면 살아있는 소비자가 깨진 import를 가져 중간 typecheck 빨강. **소비자(background·훅·IssueTab·DebugTab) 제거를 먼저, `capture-commands.ts` export 제거를 마지막에.** 아래 Task 순서가 그 의존을 반영.
- 진입 화면 버튼은 **5개**(`mode-element`/`mode-element-shot`/`mode-screenshot`/`mode-video`/`mode-screen-record`), 그중 ShortcutTooltip은 **3개**(element/screenshot/video)에만. **나머지 2개와 ButtonGroup 구조는 보존.**
- 제거 대상 식별자(grep 사후 0건): `capture-element` `capture-screenshot` `capture-video` `CAPTURE_SHORTCUT_MSG` `CAPTURE_COMMANDS` `COMMAND_ACTION` `CaptureCommand` `CaptureAction` `CaptureShortcutMessage` `resolveCaptureShortcut` `useCaptureShortcuts` `useCommandShortcuts` `ShortcutTooltip`. (하이픈 정확 매칭) **보존이라 grep 제외**: `CaptureGateState` `isCaptureEntryScreen`.

## 태스크

> **순서 원칙**: 소비자 먼저(Task 1→2→3), 소스 export 제거 마지막(Task 4). 단일 PR이라 최종 typecheck만 green이면 되지만, 단계별 검증을 위해 중간 typecheck도 통과하도록 배치.

### Task 1: background onCommand 리스너 제거
- **변경 대상**: `src/background/index.ts`
- **작업 내용**: `chrome.commands.onCommand.addListener` 블록(캡처 command 중계) 제거. import에서 `CAPTURE_SHORTCUT_MSG`/`CAPTURE_COMMANDS`/`CaptureCommand` 제거(`capture-commands.ts` export는 아직 존재 → typecheck 통과). `getActionShortcut`/`setupContextMenu` 보존.
- **검증**:
  - [ ] `pnpm typecheck` 통과(고아 import 0)
  - [ ] context menu(`_execute_action` 조회) 동작 불변 — 빌드 후 수동

### Task 2: IssueTab ShortcutTooltip + DebugTab 훅 사용 제거
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`, `src/sidepanel/tabs/DebugTab.tsx`
- **작업 내용**:
  - IssueTab: `useCommandShortcuts` import·호출 제거, `ShortcutTooltip` 함수 정의 제거. **testid 기준**으로 `mode-element`·`mode-screenshot`·`mode-video` 3개 버튼에서만 wrapper를 벗기고 `<Button>`만 남김(testid·onClick·className 유지). **`mode-element-shot`·`mode-screen-record`와 ButtonGroup 구조·`isCaptureEntryScreen`·`TooltipProvider`·`Tooltip*`은 보존.**
  - DebugTab: `useCaptureShortcuts` import·호출 제거.
  - (이 시점에 두 훅은 소비자 0이 됨 → Task 3에서 파일 삭제.)
- **검증**:
  - [ ] 진입 화면 **5버튼 전부** 정상 렌더·클릭(단축키 툴팁 없음, 형제 버튼 보존)
  - [ ] ReplayButton 상태 툴팁 정상(보존 확인)
  - [ ] `isCaptureEntryScreen` 게이트로 EmptyState 진입 정상
  - [ ] `pnpm typecheck` 통과

### Task 3: 디스패치/표기 훅 파일 삭제
- **변경 대상**: `src/sidepanel/hooks/useCaptureShortcuts.ts`, `src/sidepanel/hooks/useCommandShortcuts.ts` (둘 다 삭제)
- **작업 내용**: 두 훅 파일 삭제(Task 1·2에서 소비자 제거 완료). `useCaptureShortcuts`가 import하던 `startPicker`/`startAreaCapture`/`startVideoCapture`는 IssueTab의 `onStart*` 핸들러가 직접 호출하므로 **고아 안 됨**(보존 확인).
- **검증**:
  - [ ] `pnpm typecheck` 통과(삭제 파일 참조 0)
  - [ ] `startPicker`/`startAreaCapture`/`startVideoCapture` export 고아 아님(IssueTab에서 사용 grep)

### Task 4: capture-commands.ts 단축키 export 제거 (마지막)
- **변경 대상**: `src/lib/capture-commands.ts`, `src/lib/__tests__/capture-commands.test.ts`
- **작업 내용**: `CAPTURE_SHORTCUT_MSG`/`CaptureCommand`/`CaptureAction`/`CAPTURE_COMMANDS`/`COMMAND_ACTION`/`CaptureShortcutMessage`/`resolveCaptureShortcut` 제거. `CaptureGateState`·`isCaptureEntryScreen` 보존. 테스트에서 `resolveCaptureShortcut`·`CAPTURE_COMMANDS` describe 제거, `isCaptureEntryScreen` describe 보존. (이 시점 소비자 0 → typecheck 통과.)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` — `isCaptureEntryScreen` 테스트 green, 제거 함수 테스트 사라짐
  - [ ] `capture-commands.ts`에 단축키 식별자 0건

### Task 5: manifest + _locales 정리
- **변경 대상**: `manifest.config.ts`, `public/_locales/ko/messages.json`, `public/_locales/en/messages.json`
- **작업 내용**: manifest `commands`에서 캡처 3개 제거(`_execute_action` 유지). 캡처 command description이 참조하던 `__MSG_CMD_CAPTURE_*__` 메시지(`CMD_CAPTURE_ELEMENT`/`SCREENSHOT`/`VIDEO`)를 `_locales` ko/en에서 **같은 변경에서** 대칭 제거(부분 적용 시 `__MSG__` dangling 경고 위험). `CMD_TOGGLE_PANEL`·`EXT_NAME*` 보존.
- **검증**:
  - [ ] `pnpm build` 성공, manifest `__MSG__` dangling 경고 없음
  - [ ] `pnpm build:store`(manifest `key` 제거 경로)에서도 commands 정상
  - [ ] 빌드 산출 manifest `commands`에 `_execute_action`만
  - [ ] `_locales` ko/en 키 대칭(`CMD_CAPTURE_*` 양쪽 제거)
  - [ ] `chrome://extensions/shortcuts`에 1개만 노출(수동, 빌드 후 리로드)

### Task 6: 문서 정리 (CLAUDE·PERMISSION)
- **변경 대상**: `CLAUDE.md`, `PERMISSION.md`
- **작업 내용**: CLAUDE.md 게이트웨이 단축키 항목 4개→1개. PERMISSION.md §8 테이블 3행·"캡처 단축키 흐름"·"단축키 미할당 대응" 섹션 제거, "1개"로 수정, **Chrome 키바인딩 무손실(영속 설정·`_execute_action` 보존, 캡처 커스텀 키만 정리)** 한 줄 추가.
- **검증**:
  - [ ] 두 문서에 캡처 단축키 잔여 언급 0
  - [ ] 마이그레이션 무손실 설명 존재

### Task 7: 잔여 참조 grep + 최종 검증
- **작업 내용**: 선행 조건의 식별자(13개) 전역 grep으로 로직 코드 0건 확인(테스트·문서·feature docs 제외). 보존 식별자(`CaptureGateState`·`isCaptureEntryScreen`)는 제외. `capture-element` 등은 하이픈 정확 매칭.
- **검증**:
  - [ ] grep 0건(보존 식별자 제외)
  - [ ] `pnpm typecheck` / `pnpm test` green
  - [ ] `pnpm build:e2e && pnpm test:e2e` green (`capture-modes-layout.spec.ts` 그룹 구조 회귀 없음)

## 테스트 계획

- **단위 테스트**: 신규 없음. `capture-commands.test.ts`에서 `isCaptureEntryScreen` 보존, 제거 함수 테스트 삭제.
- **e2e 시나리오**: 단축키는 자동화로 트리거 불가 — 신규 e2e 없음. 기존 `capture-modes-layout.spec.ts`가 버튼 testid로 green 유지되는지가 회귀 게이트.
- **수동 테스트**(Chrome):
  - `chrome://extensions/shortcuts`에 `_execute_action` 1개만 노출, Cmd/Ctrl+Shift+E로 사이드패널 토글 동작
  - 진입 화면 캡처 버튼 **5종** 클릭 → 각 캡처 정상(툴팁 없음, ButtonGroup 정렬 유지)
  - context menu(_execute_action 조회) 정상
  - **업데이트/무손실 재현 절차** (dev `key` 유지 빌드 필수 — extension ID 고정이라야 키바인딩 보존):
    1. 구버전(`pnpm build`, 캡처 command 있는 dist)을 unpacked 로드 → extension ID 확인
    2. `chrome://extensions/shortcuts`에서 캡처 command에 커스텀 키 할당, `_execute_action`도 커스텀 키로 변경
    3. 신버전(`pnpm build`, 이 feature 적용 dist)으로 **같은 폴더 덮어쓰기 + 리로드**(ID 동일)
    4. 확인: `_execute_action` 커스텀 키 **유지**, 캡처 command 항목만 사라짐, 영속 설정(테마·연동 등) 보존

## 구현 순서 권장

- **Task 1 → 2 → 3 → 4** (소비자 먼저 → 소스 export 마지막). 각 단계 typecheck 통과 가능.
- Task 5(manifest+_locales)·Task 6(문서)는 1~4와 독립, 병렬 가능.
- Task 7(grep+최종 e2e)은 전부 후 마지막.

## 가이드 영향

사용자 노출 단축키 제거 — 구현 후 `/guide`로 처리:
- `guide/ko/quick-start.md`·`guide/en/quick-start.md` — 캡처 단축키 표기 제거
- `guide/ko/video/record.md`·`guide/en/video/record.md` — 녹화 단축키(Shift+X) 표기 제거
- `guide/ko/screenshot/capture.md`(+en) — 캡처 단축키(Shift+F/S) 표기 제거
- `guide/ko/element/picker.md`(+en) — 요소 캡처 단축키(Shift+S) 표기 제거
- `guide/AUTHORING.md` — 단축키 스냅샷/표를 `_execute_action` 1개로 갱신
- (사이드패널 토글 Cmd/Ctrl+Shift+E 표기는 **유지**)
