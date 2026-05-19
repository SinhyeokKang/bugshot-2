# 캡처 모드 키보드 단축키 — 기술 설계

## 개요

`manifest.commands`에 캡처 커맨드 3개를 등록하고, background service worker의 `chrome.commands.onCommand` 리스너가 이를 수신한다. 리스너는 활성 탭 정보를 실어 `chrome.runtime.sendMessage`로 브로드캐스트하고, 각 사이드패널의 `useCaptureShortcuts` 훅이 자기 `boundTabId`와 일치하는 메시지만 받아 게이트 통과 시 기존 `picker-control` 함수(`startPicker`/`startAreaCapture`/`startVideoCapture`)를 호출한다. 단축키 = 캡처 진입 버튼 클릭과 동치.

## 데이터 흐름

```
키 입력
  → Chrome
  → background: chrome.commands.onCommand(command, tab)
  → chrome.runtime.sendMessage({ type: CAPTURE_SHORTCUT_MSG, command, tabId: tab.id })  // 브로드캐스트
  → 각 사이드패널: useCaptureShortcuts 훅의 chrome.runtime.onMessage 리스너
       ├ tabId !== boundTabId         → 무시 (다른 창의 패널)
       ├ active === false             → 무시 (디버그>이슈작성 서브탭 아님)
       ├ resolveCaptureShortcut → null → 무시 (진입 화면 아님)
       └ 통과 → startPicker / startAreaCapture / startVideoCapture
```

`chrome.commands.onCommand`는 service worker가 보장된 수신 컨텍스트라 background를 경유한다. 리스너 2번째 인자 `tab`은 단축키를 누른 시점의 활성 탭(Chrome 105+ 제공, `minimum_chrome_version: 116`이라 안전). 패널이 닫혀 있으면 `sendMessage` 수신자가 없어 자연히 no-op.

## 변경 범위

### 1. `manifest.config.ts`
- 현재 역할: MV3 매니페스트 정의. `commands`에 `_execute_action` 하나만 존재.
- 변경: `commands`에 3개 추가. `_execute_action` 포함 총 4개 = Chrome `suggested_key` 상한.
```ts
"capture-element":    { suggested_key: { default: "Ctrl+Shift+1", mac: "Command+Shift+1" }, description: "__MSG_CMD_CAPTURE_ELEMENT__" },
"capture-screenshot": { suggested_key: { default: "Ctrl+Shift+2", mac: "Command+Shift+2" }, description: "__MSG_CMD_CAPTURE_SCREENSHOT__" },
"capture-video":      { suggested_key: { default: "Ctrl+Shift+3", mac: "Command+Shift+3" }, description: "__MSG_CMD_CAPTURE_VIDEO__" },
```

### 2. `public/_locales/{ko,en}/messages.json`
- 현재 역할: Chrome 매니페스트용 i18n (`CMD_TOGGLE_PANEL` 등). React UI i18n(`src/i18n/`)과 별개.
- 변경: `CMD_CAPTURE_ELEMENT` / `CMD_CAPTURE_SCREENSHOT` / `CMD_CAPTURE_VIDEO` 메시지를 ko·en 양쪽에 추가. `chrome://extensions/shortcuts`의 커맨드 설명에 표시된다.

### 3. `src/lib/capture-commands.ts` (신규)
- 역할: background·hook 공용 상수/타입 + 순수 게이트 함수. 두 곳에서 커맨드 문자열이 어긋나지 않게 단일 출처화.
- `resolveCaptureShortcut`는 순수 함수라 단위 테스트로 게이트 로직을 검증한다.

### 4. `src/lib/__tests__/capture-commands.test.ts` (신규)
- 역할: `resolveCaptureShortcut` 단위 테스트 (Vitest).

### 5. `src/sidepanel/picker-control.ts`
- 현재 역할: picker/캡처 제어 함수 모음 (`startPicker`, `startAreaCapture`, `startFreeformDraft` 등).
- 변경: `startVideoCapture(tabId)` 추가. `IssueTab.tsx`의 모듈 레벨 `handleStartVideo`(142–173행) + `isTabCaptureUnavailable`(175–183행)를 그대로 이관 — 영상 녹화 시작 로직이 버튼·단축키 양쪽에서 호출 가능해진다. `video-recorder.ts`는 `picker-control.ts`를 import하지 않아 순환 없음(확인 완료).

### 6. `src/sidepanel/tabs/IssueTab.tsx`
- 현재 역할: 이슈 작성 서브탭. `EmptyState`에 캡처 버튼 4개, 모듈 레벨 `handleStartVideo` 보유.
- 변경: 인라인 `handleStartVideo`·`isTabCaptureUnavailable` 제거, `picker-control`에서 `startVideoCapture` import. `onStartVideo={() => void startVideoCapture(tabId)}`. 이관 후 안 쓰이는 import(`activateNetworkRecorder`/`activateConsoleRecorder`/`clearNetworkRecorder`/`clearConsoleRecorder`/`deleteNetworkLog`/`deleteConsoleLog`/`onVideoRecordingUnavailable`/`videoRecorder` 중 잔여분) 정리.

### 7. `src/sidepanel/hooks/useCaptureShortcuts.ts` (신규)
- 역할: 사이드패널에서 캡처 단축키 메시지를 수신·게이트·디스패치하는 훅. `active && tabId != null`일 때만 `chrome.runtime.onMessage` 리스너 등록, cleanup에서 제거.

### 8. `src/sidepanel/tabs/DebugTab.tsx`
- 현재 역할: 디버그 메인탭. 서브탭 state `sub`(`issue`/`console`/`network`) 보유.
- 변경: `activeMainTab: string` prop 추가, `useCaptureShortcuts({ active: activeMainTab === "debug" && sub === "issue", tabId })` 호출.

### 9. `src/sidepanel/App.tsx`
- 현재 역할: 메인탭 4개 렌더. 메인탭 state `tab` 보유.
- 변경: `<DebugTab activeMainTab={tab} />`로 메인탭 값 전달.

### 10. `src/background/index.ts`
- 현재 역할: service worker 진입점. 메시지 라우터·탭 바인딩·컨텍스트 메뉴.
- 변경: top-level에 `chrome.commands.onCommand` 리스너 추가. 캡처 커맨드면 `chrome.runtime.sendMessage`로 브로드캐스트.

## 인터페이스 설계

```ts
// src/lib/capture-commands.ts
export const CAPTURE_SHORTCUT_MSG = "shortcut.capture";

export type CaptureCommand =
  | "capture-element"
  | "capture-screenshot"
  | "capture-video";

export type CaptureAction = "element" | "screenshot" | "video";

export const CAPTURE_COMMANDS: readonly CaptureCommand[];

export interface CaptureShortcutMessage {
  type: typeof CAPTURE_SHORTCUT_MSG;
  command: CaptureCommand;
  tabId: number;
}

interface CaptureGateState {
  phase: string;
  captureMode: string;
  selection: unknown | null;
}

/**
 * 커맨드 + 에디터 상태 → 실행할 캡처 액션, 또는 게이트 미통과/미지 커맨드면 null.
 * 게이트: 캡처 진입 화면이 보일 때만 (phase==="idle" || (captureMode==="element" && !selection)).
 */
export function resolveCaptureShortcut(
  command: string,
  state: CaptureGateState,
): CaptureAction | null;
```

```ts
// src/sidepanel/hooks/useCaptureShortcuts.ts
export function useCaptureShortcuts(opts: {
  active: boolean;
  tabId: number | null;
}): void;
```

```ts
// src/sidepanel/picker-control.ts
export async function startVideoCapture(tabId: number): Promise<void>;
```

## 기존 패턴 준수

- **탭별 메시지 필터링**: `useCaptureShortcuts`는 수신 메시지의 `tabId`를 패널 `boundTabId`와 비교해 다른 창의 패널을 걸러낸다 — `usePickerMessages`(`sender.tab?.id !== myTabId` 무시)와 동일한 패턴.
- **picker-control 레이어**: 캡처 시작 함수는 모두 `picker-control.ts`에 모은다 (`startPicker`/`startAreaCapture`/`startFreeformDraft`). `startVideoCapture` 추가로 일관성 유지.
- **순수 함수 + 단위 테스트**: 게이트 판정은 `resolveCaptureShortcut` 순수 함수로 분리, `__tests__/`에 Vitest 테스트.
- **Chrome i18n 분리**: 매니페스트 커맨드 설명은 `public/_locales/`(Chrome i18n), React UI 문자열은 `src/i18n/`. 이 기능은 UI 문자열이 없어 `public/_locales/`만 갱신.

## 대안 검토

**대안 A — 사이드패널이 `chrome.commands.onCommand`를 직접 수신.** background 경유 없이 패널 훅에서 바로 `onCommand` 리스너를 단다. 코드는 더 짧지만, `chrome.commands.onCommand`가 service worker 외 확장 페이지(side panel) 컨텍스트에 확실히 디스패치되는지 공식 문서로 보장되지 않는다. background는 보장된 수신 컨텍스트이고 리스너 `tab` 인자로 활성 탭도 얻을 수 있어, 결정성과 탭 타겟팅 양쪽에서 background 경유를 채택했다.

**대안 B — background가 포트로 특정 패널에 직접 전송.** `PANEL_PORT_PREFIX` 포트를 `Map<tabId, Port>`로 관리해 대상 패널에만 보낸다. 정확하지만 포트 생명주기 관리 코드가 늘어난다. `chrome.runtime.sendMessage` 브로드캐스트 + 패널의 `tabId` 자가 필터링이 기존 패턴과 일치하고 더 단순해 채택하지 않았다.

## 위험 요소

- **Chrome `suggested_key` 상한 4개 도달**: `_execute_action` + 캡처 3개. 이후 단축키 추가 시 `suggested_key` 없는 커맨드로만 가능(사용자 수동 배정).
- **`handleStartVideo` 이관**: `IssueTab.tsx`에서 안 쓰이게 된 import를 정리하지 않으면 lint/타입 경고. `pnpm typecheck`로 검출.
- **게이트 중복**: 진입 화면 조건(`phase==="idle" || (captureMode==="element" && !selection)`)이 `IssueTab.tsx:108`과 `resolveCaptureShortcut`에 각각 존재. 불리언 한 줄 수준이라 공유 헬퍼로 묶지 않고 의도적으로 중복 둔다(외과적 범위 유지).
