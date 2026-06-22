# 캡처 단축키 제거 — 기술 설계

## 개요

순수 **삭제 작업**이다. manifest `commands` 3개 제거 → 그 command를 받던 `background` onCommand 리스너 제거 → sidepanel 디스패치 훅(`useCaptureShortcuts`)·표기 훅(`useCommandShortcuts`)·`ShortcutTooltip` 제거 → `capture-commands.ts`에서 단축키 관련 export만 제거(게이트 `isCaptureEntryScreen`은 보존) → `public/_locales` 메시지 3개 제거 → 문서 정리. 캡처 버튼 동작과 진입 게이트는 불변. 영속 데이터가 없어 마이그레이션 코드는 없고, "Chrome 키바인딩 무손실"을 문서로 명시한다.

## 변경 범위

### `manifest.config.ts`
- 현재 역할: `commands`에 `_execute_action` + `capture-element`/`capture-screenshot`/`capture-video` 4개 선언.
- 변경: 캡처 command 3개 객체 제거. `_execute_action` 블록은 **그대로**(suggested_key Cmd/Ctrl+Shift+E 불변).

### `src/background/index.ts`
- 현재 역할: `chrome.commands.onCommand.addListener`(`:112-122`)가 캡처 command를 받아 `runtime.sendMessage({ type: CAPTURE_SHORTCUT_MSG, command, tabId })`로 sidepanel에 중계. `getActionShortcut()`는 context menu에서 `_execute_action` 키 조회.
- 변경: `onCommand.addListener` 블록(`:112-122`) **전체 제거**. import에서 `CAPTURE_SHORTCUT_MSG`/`CAPTURE_COMMANDS`/`CaptureCommand` 제거. `getActionShortcut()`·`setupContextMenu`는 **보존**(`_execute_action` 조회는 `commands.getAll()`이라 무관).

### `src/lib/capture-commands.ts`
- 현재 역할: 단축키 상수·타입·`resolveCaptureShortcut` + UI 게이트 `isCaptureEntryScreen`.
- 변경: 아래 **제거** — `CAPTURE_SHORTCUT_MSG`, `CaptureCommand`, `CaptureAction`, `CAPTURE_COMMANDS`, `COMMAND_ACTION`, `CaptureShortcutMessage`, `resolveCaptureShortcut`. **보존** — `CaptureGateState` 인터페이스, `isCaptureEntryScreen`. (파일은 유지 — 사용자 결정. 리네임 안 함, import 경로 불변.)

### `src/sidepanel/hooks/useCaptureShortcuts.ts`
- 현재 역할: `CAPTURE_SHORTCUT_MSG` 메시지를 받아 에디터 상태로 `resolveCaptureShortcut` → `startPicker`/`startAreaCapture`/`startVideoCapture` 디스패치.
- 변경: **파일 전체 삭제.**

### `src/sidepanel/hooks/useCommandShortcuts.ts`
- 현재 역할: `chrome.commands.getAll()` 1회 조회로 캡처 command별 단축키 표기 반환(ShortcutTooltip용).
- 변경: **파일 전체 삭제.** (유일 소비자 IssueTab의 ShortcutTooltip이 사라지므로 불필요.)

### `src/sidepanel/tabs/DebugTab.tsx`
- 현재 역할: `useCaptureShortcuts({ active: ..., tabId })` 호출(`:35`).
- 변경: import(`:9`)·호출(`:35`) 제거.

### `src/sidepanel/tabs/IssueTab.tsx`
- 현재 역할: `useCommandShortcuts()`로 `shortcuts` 취득 → `ShortcutTooltip` 정의 → 진입 화면 버튼 중 **일부**를 `ShortcutTooltip`으로 감쌈.
- **진입 화면 버튼은 총 5개**(라인 아닌 testid 기준으로 식별 — 라인은 변동 가능): `mode-element`, `mode-element-shot`, `mode-screenshot`, `mode-video`, `mode-screen-record`. 이 중 **ShortcutTooltip로 감싼 건 3개**(`mode-element`/`mode-screenshot`/`mode-video`). `mode-element-shot`·`mode-screen-record`는 **원래 툴팁이 없다**. (`mode-screenshot`은 `mode-element-shot`과, `mode-video`는 `mode-screen-record`와 각각 `ButtonGroup` 형제다.)
- 변경:
  - `useCommandShortcuts` import·호출 제거, `ShortcutTooltip` 함수 정의 제거.
  - **ShortcutTooltip wrapper 3개만 벗기고** `<Button>`만 남긴다(testid·onClick·className 유지). **나머지 2개 버튼과 ButtonGroup 구조는 손대지 않는다.**
  - `isCaptureEntryScreen`(EmptyState 렌더 게이트) import·사용은 **보존** — 변경 대상 아님(보존 확인 체크는 tasks).
  - `TooltipProvider`는 **보존** — `ReplayButton`의 replay 툴팁이 여전히 사용.
  - `Tooltip`/`TooltipTrigger`/`TooltipContent` import는 ReplayButton이 계속 쓰므로 유지(ShortcutTooltip만 제거).
  - 참고: `delayDuration={0}`는 원래 ShortcutTooltip 즉시 표기용 설정이나, ReplayButton 상태 툴팁에 그대로 남는다. **외과적 원칙상 변경하지 않는다**(메모).

### `public/_locales/ko/messages.json`, `public/_locales/en/messages.json`
- 변경: `CMD_CAPTURE_ELEMENT`/`CMD_CAPTURE_SCREENSHOT`/`CMD_CAPTURE_VIDEO` 제거(ko/en 대칭). `CMD_TOGGLE_PANEL`·`EXT_NAME`·`EXT_NAME_SHORT` 보존.

### `src/lib/__tests__/capture-commands.test.ts`
- 변경: `resolveCaptureShortcut` describe + `CAPTURE_COMMANDS` describe 블록 제거. `isCaptureEntryScreen` describe **보존**(필요시 케이스 보강).

### 문서
- `CLAUDE.md` 게이트웨이 "단축키" 항목: 4개→1개, 캡처 단축키 문구 제거.
- `PERMISSION.md` §8 commands: 테이블 3행 제거, "캡처 단축키 흐름"·"단축키 미할당 대응" 섹션 제거, "4개"→"1개". + **마이그레이션 무손실** 한 줄 추가.
- `guide/`(ko·en): quick-start, video/record, screenshot/capture, element/picker, AUTHORING의 캡처 단축키 표기 제거. → `/guide`로 처리(tasks 참조).

## 데이터 흐름

```
[제거 전]
chrome.commands.onCommand (background) → sendMessage(CAPTURE_SHORTCUT_MSG)
  → useCaptureShortcuts(sidepanel) → resolveCaptureShortcut(state)
  → startPicker / startAreaCapture / startVideoCapture

[제거 후]
(캡처 단축키 경로 없음)
캡처 버튼 클릭 → startPicker / startAreaCapture / startVideoCapture  (불변)
_execute_action → chrome.action.onClicked (Chrome 내부, 불변)
```

## 인터페이스 설계

타입 추가 없음. `capture-commands.ts`에서 아래만 잔존:
```ts
interface CaptureGateState { phase: string; captureMode: string; selection: unknown | null; }
export function isCaptureEntryScreen(state: CaptureGateState): boolean;
```

## 기존 패턴 준수

- **외과적 변경**: `capture-commands.ts`는 단축키 관련만 제거하고 파일·게이트 함수 유지(리네임·이동 안 함). `TooltipProvider`/`Tooltip*`는 ReplayButton 의존이라 보존. ButtonGroup 형제 버튼(`mode-element-shot`·`mode-screen-record`)은 손대지 않음.
- **시각 일관성 향상**: 현재 진입 화면 5개 버튼 중 3개만 ShortcutTooltip이 붙은 **비대칭** 상태다. wrapper 3개를 제거하면 캡처 버튼군이 전부 "툴팁 없음"으로 균일해지고, 진입 화면에서 툴팁이 뜨는 건 ReplayButton 상태 툴팁 하나만 남는다 — 일관성이 오히려 개선된다.
- **i18n 동시 갱신**: `public/_locales` ko/en 대칭 제거. (이건 Chrome i18n으로 `src/i18n/__tests__/locales.test.ts` 검사 대상 아님 — 수동 대칭 확인.)
- **테스트 우선**: 신규 함수 없음. 기존 `isCaptureEntryScreen` 테스트 보존, 제거 대상 함수의 테스트 삭제.
- **권한·게이트웨이 문서화**: CLAUDE.md·PERMISSION.md 동기 갱신(command 표면 축소).

## 대안 검토

1. **`capture-commands.ts` 파일을 `capture-entry.ts`로 리네임**: `isCaptureEntryScreen`만 남으면 파일명이 안 맞지만, import 경로 일괄 수정 + diff 확대. 외과적 원칙·사용자 결정에 따라 **기각**(파일 유지).
2. **`ShortcutTooltip` 컴포넌트 정의 보존(사용처만 제거)**: 향후 재사용 여지가 있으나 현재 dead code가 된다. 사용자 결정으로 **완전 제거**.
3. **`_execute_action` 키를 더 쉬운 키로 이전**: 캡처 키가 비니 Shift+S 등으로 토글을 옮길 수 있으나, suggested_key 변경은 사용자 커스텀 키바인딩을 리셋시킬 위험 → **기각**(불변 유지).

## 위험 요소

- **마이그레이션 무손실 확인**: 단축키는 manifest로만 관리되고 chrome.storage/zustand에 영속값이 없다(스캔 확인). manifest에서 command 제거 시 Chrome이 해당 키바인딩만 자동 정리하고 `_execute_action`은 보존 — 데이터 손실·코드 마이그레이션 불필요. 문서에 명시.
- **recording-mode-setting feature와 IssueTab 충돌**: 두 feature가 `IssueTab.tsx`의 `EmptyState`를 동시 수정한다. recording-mode-setting design은 "녹화 버튼에 `capture-video` ShortcutTooltip 유지"를 전제하는데, 이 feature가 `ShortcutTooltip`을 통째로 제거한다. **둘 중 먼저 머지되는 쪽 기준으로 나중 것을 rebase**하고, recording-mode-setting의 "단축키 툴팁 유지" 항목은 이 feature 적용 후 무효가 됨을 양쪽 구현 시 인지. (권장: 이 feature를 먼저 적용 → recording-mode-setting은 ShortcutTooltip 없는 깨끗한 EmptyState 위에서 작업.)
- **버튼 testid 회귀**: `mode-element`/`mode-screenshot`/`mode-video` testid를 `capture-modes-layout.spec.ts`가 의존. ShortcutTooltip wrapper만 벗기고 testid·onClick은 유지 → 회귀 없음.
- **`_locales` 빌드**: Chrome은 manifest `commands[].description`이 `__MSG_CMD_CAPTURE_*__`를 참조했을 수 있다 — command를 지우면 참조도 사라지므로 메시지 제거가 안전. 단 메시지만 지우고 command를 안 지우는 순서 실수 시 빌드 경고 가능 → manifest와 _locales를 같은 변경에서 처리.
- **잔여 참조**: 삭제 후 아래 식별자 전역 grep 0건 확인(테스트·문서·feature docs 제외). `capture-element`·`capture-screenshot`·`capture-video`는 **하이픈 포함 정확 매칭**(testid `mode-element`·i18n 키 `issue.mode.element`와 오탐 구분):
  - `capture-element` `capture-screenshot` `capture-video` `CAPTURE_SHORTCUT_MSG` `CAPTURE_COMMANDS` `COMMAND_ACTION` `CaptureCommand` `CaptureAction` `CaptureShortcutMessage` `resolveCaptureShortcut` `useCaptureShortcuts` `useCommandShortcuts` `ShortcutTooltip`
  - **보존이므로 grep 대상 제외**: `CaptureGateState`, `isCaptureEntryScreen`.
- **삭제 순서**: `capture-commands.ts`의 export 제거를 **먼저** 하면 아직 살아있는 소비자(background·두 훅)가 깨진 import를 가져 중간 `typecheck`가 빨강이 된다. **소비자 제거(background onCommand·훅 삭제·IssueTab)를 먼저**, `capture-commands.ts` export 제거를 **마지막**에 둔다(tasks 구현 순서 참조).
