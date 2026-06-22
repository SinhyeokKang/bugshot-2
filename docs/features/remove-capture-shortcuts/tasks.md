# 캡처 단축키 제거 — 구현 태스크

## 선행 조건

- 영속 데이터 마이그레이션 없음(스캔 확인 — 단축키는 manifest 전용).
- `recording-mode-setting` feature와 `IssueTab.tsx` EmptyState 충돌 가능 — **이 feature를 먼저 적용**하면 recording-mode-setting이 ShortcutTooltip 없는 EmptyState 위에서 작업하게 돼 깔끔(design 위험 요소).
- 제거 대상 식별자(grep 사후 0건 확인용): `capture-element` `capture-screenshot` `capture-video` `CAPTURE_SHORTCUT_MSG` `CAPTURE_COMMANDS` `COMMAND_ACTION` `CaptureCommand` `CaptureAction` `resolveCaptureShortcut` `useCaptureShortcuts` `useCommandShortcuts` `ShortcutTooltip`.

## 태스크

### Task 1: capture-commands.ts에서 단축키 export 제거
- **변경 대상**: `src/lib/capture-commands.ts`, `src/lib/__tests__/capture-commands.test.ts`
- **작업 내용**: `CAPTURE_SHORTCUT_MSG`/`CaptureCommand`/`CaptureAction`/`CAPTURE_COMMANDS`/`COMMAND_ACTION`/`CaptureShortcutMessage`/`resolveCaptureShortcut` 제거. `CaptureGateState`·`isCaptureEntryScreen` 보존. 테스트에서 `resolveCaptureShortcut`·`CAPTURE_COMMANDS` describe 제거, `isCaptureEntryScreen` describe 보존.
- **검증**:
  - [ ] `pnpm test` — `isCaptureEntryScreen` 테스트 green, 제거 함수 테스트 사라짐
  - [ ] `capture-commands.ts`에 단축키 식별자 0건

### Task 2: background onCommand 리스너 제거
- **변경 대상**: `src/background/index.ts`
- **작업 내용**: `chrome.commands.onCommand.addListener` 블록(`:112-122`) 제거. import에서 `CAPTURE_SHORTCUT_MSG`/`CAPTURE_COMMANDS`/`CaptureCommand` 제거. `getActionShortcut`/`setupContextMenu` 보존.
- **검증**:
  - [ ] `pnpm typecheck` 통과(미사용 import 0)
  - [ ] context menu(`_execute_action` 조회) 동작 불변 — 빌드 후 수동

### Task 3: 디스패치/표기 훅 삭제
- **변경 대상**: `src/sidepanel/hooks/useCaptureShortcuts.ts`, `src/sidepanel/hooks/useCommandShortcuts.ts` (둘 다 파일 삭제), `src/sidepanel/tabs/DebugTab.tsx`
- **작업 내용**: 두 훅 파일 삭제. `DebugTab.tsx`에서 `useCaptureShortcuts` import(`:9`)·호출(`:35`) 제거.
- **검증**:
  - [ ] `pnpm typecheck` 통과(삭제 파일 참조 0)

### Task 4: IssueTab ShortcutTooltip 제거
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**: `useCommandShortcuts` import·호출 제거, `ShortcutTooltip` 함수 정의 제거, mode-element/screenshot/video 버튼에서 wrapper 벗기고 `<Button>`만 남김(testid·onClick 유지). `TooltipProvider`·`Tooltip*` import는 ReplayButton 의존이라 보존.
- **검증**:
  - [ ] 진입 화면 3버튼 정상 렌더·클릭(단축키 툴팁 없음)
  - [ ] ReplayButton 툴팁 정상(보존 확인)
  - [ ] `pnpm typecheck` 통과

### Task 5: manifest + _locales 정리
- **변경 대상**: `manifest.config.ts`, `public/_locales/ko/messages.json`, `public/_locales/en/messages.json`
- **작업 내용**: manifest `commands`에서 캡처 3개 제거(`_execute_action` 유지). `_locales` ko/en에서 `CMD_CAPTURE_*` 3개 대칭 제거.
- **검증**:
  - [ ] `pnpm build` 성공, 경고 없음
  - [ ] 빌드 산출 manifest `commands`에 `_execute_action`만
  - [ ] `chrome://extensions/shortcuts`에 1개만 노출(수동, 빌드 후 리로드)

### Task 6: 문서 정리 (CLAUDE·PERMISSION)
- **변경 대상**: `CLAUDE.md`, `PERMISSION.md`
- **작업 내용**: CLAUDE.md 게이트웨이 단축키 항목 4개→1개. PERMISSION.md §8 테이블 3행·"캡처 단축키 흐름"·"단축키 미할당 대응" 섹션 제거, "1개"로 수정, **마이그레이션 무손실** 한 줄 추가.
- **검증**:
  - [ ] 두 문서에 캡처 단축키 잔여 언급 0
  - [ ] 마이그레이션 무손실 설명 존재

### Task 7: 잔여 참조 grep + 최종 검증
- **작업 내용**: 선행 조건의 식별자 전역 grep으로 로직 코드 0건 확인(테스트·문서·feature docs 제외).
- **검증**:
  - [ ] grep 0건
  - [ ] `pnpm typecheck` / `pnpm test` green
  - [ ] `pnpm build:e2e && pnpm test:e2e` green (capture-modes-layout 회귀 없음)

## 테스트 계획

- **단위 테스트**: 신규 없음. `capture-commands.test.ts`에서 `isCaptureEntryScreen` 보존, 제거 함수 테스트 삭제.
- **e2e 시나리오**: 단축키는 자동화로 트리거 불가 — 신규 e2e 없음. 기존 `capture-modes-layout.spec.ts`가 버튼 testid로 green 유지되는지가 회귀 게이트.
- **수동 테스트**(Chrome):
  - `chrome://extensions/shortcuts`에 `_execute_action` 1개만 노출, Cmd/Ctrl+Shift+E로 사이드패널 토글 동작
  - 진입 화면 캡처 버튼 3종 클릭 → 각 캡처 정상(툴팁 없음)
  - context menu(_execute_action 조회) 정상
  - 업데이트 시나리오: 이전 버전에서 캡처 단축키 커스텀 후 새 빌드 로드 → `_execute_action` 유지·캡처 항목만 사라짐 확인

## 구현 순서 권장

- Task 1 → 2 → 3 → 4 (의존 체인: 타입 제거 → background → 훅 삭제 → UI). 
- Task 5(manifest+_locales)는 1~4와 독립, 병렬 가능하나 빌드 검증은 전부 후.
- Task 6(문서) 병렬 가능.
- Task 7(grep+최종)은 마지막.

## 가이드 영향

사용자 노출 단축키 제거 — 구현 후 `/guide`로 처리:
- `guide/ko/quick-start.md`·`guide/en/quick-start.md` — 캡처 단축키 표기 제거
- `guide/ko/video/record.md`·`guide/en/video/record.md` — 녹화 단축키(Shift+X) 표기 제거
- `guide/ko/screenshot/capture.md`(+en) — 캡처 단축키(Shift+F/S) 표기 제거
- `guide/ko/element/picker.md`(+en) — 요소 캡처 단축키(Shift+S) 표기 제거
- `guide/AUTHORING.md` — 단축키 스냅샷/표를 `_execute_action` 1개로 갱신
- (사이드패널 토글 Cmd/Ctrl+Shift+E 표기는 **유지**)
