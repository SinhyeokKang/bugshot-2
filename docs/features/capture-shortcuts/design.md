# 캡처 모드 키보드 단축키 — 기술 설계

## 개요

`manifest.commands`에 캡처 커맨드 3개를 등록하고, background service worker의 `chrome.commands.onCommand` 리스너가 이를 수신한다. 리스너는 활성 탭 정보를 실어 `chrome.runtime.sendMessage`로 브로드캐스트하고, 각 사이드패널의 `useCaptureShortcuts` 훅이 자기 `boundTabId`와 일치하는 메시지만 받아 게이트 통과 시 캡처 시작 함수(`startPicker`/`startAreaCapture`는 `picker-control.ts`, `startVideoCapture`는 신규 `video-capture.ts`)를 호출한다. 단축키 = 캡처 진입 버튼 클릭과 동치.

추가로, 캡처 진입 화면(`EmptyState`)의 버튼 3개는 `chrome.commands.getAll()`로 실시간 조회한 현재 단축키를 shadcn `Tooltip`으로 호버 시 노출한다.

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

브로드캐스트한 `CAPTURE_SHORTCUT_MSG`는 background 자신의 `onMessage` 리스너에도 도달하지만, `BG_REQUEST_TYPES` Set에 없어 `return false`로 즉시 무시된다 — 별도 가드 불필요.

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

### 5. `src/sidepanel/video-capture.ts` (신규)
- 역할: 영상 녹화 시작 로직 단일 출처. `export async function startVideoCapture(tabId)`.
- `IssueTab.tsx`의 모듈 레벨 `handleStartVideo`(142–173행) + `isTabCaptureUnavailable`(175–183행)를 그대로 이관 — 영상 녹화 시작 로직이 버튼·단축키 양쪽에서 호출 가능해진다.
- **신규 모듈로 분리한 이유**: `startVideoCapture`는 `video-recorder.ts`(`startRecording` 등)에 의존하는데, `video-recorder.ts`가 이미 `picker-control.ts`를 import하고 있어 `startVideoCapture`를 `picker-control.ts`에 두면 `picker-control → video-recorder → picker-control` 순환이 생긴다. 별도 모듈로 분리해 순환을 원천 차단한다. `picker-control.ts`는 이 기능에서 **수정하지 않는다**.

### 6. `src/sidepanel/tabs/IssueTab.tsx`
- 현재 역할: 이슈 작성 서브탭. `EmptyState`에 캡처 버튼 4개, 모듈 레벨 `handleStartVideo` 보유.
- 변경:
  - 인라인 `handleStartVideo`·`isTabCaptureUnavailable` 제거, `video-capture.ts`에서 `startVideoCapture` import. `onStartVideo={() => void startVideoCapture(tabId)}`. 이관 후 안 쓰이는 import(`activateNetworkRecorder`/`activateConsoleRecorder`/`clearNetworkRecorder`/`clearConsoleRecorder`/`deleteNetworkLog`/`deleteConsoleLog`/`onVideoRecordingUnavailable`/`videoRecorder` 중 잔여분) 정리.
  - 진입 화면 게이트 조건(108행)을 `capture-commands.ts`의 `isCaptureEntryScreen` 헬퍼 호출로 교체 — `resolveCaptureShortcut`과 같은 함수를 공유해 게이트 단일 출처화.
  - `EmptyState`에서 `useCommandShortcuts()`로 커맨드→단축키 맵을 받고, 요소/스샷/영상 버튼 3개를 로컬 `ShortcutTooltip` 컴포넌트로 감싼다. 버튼 그리드를 `TooltipProvider`로 감싼다. 자유 작성 버튼은 단축키가 없어 툴팁 없이 그대로 둔다.

### 6b. `src/components/ui/tooltip.tsx`
- 현재 역할: shadcn Tooltip 컴포넌트. **이미 설치돼 있으나 코드베이스에서 미사용.**
- 변경: 없음. 신규 설치 불필요 — 그대로 import해서 사용.

### 7. `src/sidepanel/hooks/useCaptureShortcuts.ts` (신규)
- 역할: 사이드패널에서 캡처 단축키 메시지를 수신·게이트·디스패치하는 훅. `active && tabId != null`일 때만 `chrome.runtime.onMessage` 리스너 등록, cleanup에서 제거.

### 7b. `src/sidepanel/hooks/useCommandShortcuts.ts` (신규)
- 역할: `chrome.commands.getAll()`을 1회 조회해 `{ [captureCommand]: shortcut }` 맵을 반환하는 훅. `CAPTURE_COMMANDS`에 속한 커맨드만 남기고(캡처 외 `_execute_action` 등 제외), `shortcut`이 빈 문자열인 커맨드(키 미배정)도 제외. `EmptyState`가 이 맵으로 툴팁에 표시할 키를 얻는다. 사이드패널 컨텍스트에서 `chrome.commands.getAll()` 호출 가능.
- `getAll()`이 반환하는 `shortcut`은 이미 OS별 표기(mac `⌘⇧1`, Windows/Linux `Ctrl+Shift+1`)가 적용된 문자열이라 **가공 없이 그대로** 툴팁에 노출한다 — 별도 심볼 변환·라벨 불필요.

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
 * 캡처 진입 화면이 보이는 상태인지 판정하는 게이트 단일 출처.
 * 진입 화면 = phase==="idle" || (captureMode==="element" && !selection).
 * IssueTab.tsx(EmptyState 렌더 분기)와 resolveCaptureShortcut 양쪽이 공유한다.
 */
export function isCaptureEntryScreen(state: CaptureGateState): boolean;

/**
 * 커맨드 + 에디터 상태 → 실행할 캡처 액션, 또는 게이트 미통과/미지 커맨드면 null.
 * 게이트는 isCaptureEntryScreen(state)로 판정.
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
// src/sidepanel/hooks/useCommandShortcuts.ts
// 반환: 캡처 커맨드별 단축키 표기 문자열. 키 미배정 커맨드는 키 없음.
export function useCommandShortcuts(): Partial<Record<CaptureCommand, string>>;
```

```tsx
// src/sidepanel/tabs/IssueTab.tsx — EmptyState 내부 로컬 컴포넌트
// shortcut이 있으면 버튼을 Tooltip으로 감싸고, 없으면 children 그대로 반환
function ShortcutTooltip(props: {
  shortcut: string | undefined;
  children: React.ReactNode;
}): JSX.Element;
```

```ts
// src/sidepanel/video-capture.ts
export async function startVideoCapture(tabId: number): Promise<void>;
```

## 기존 패턴 준수

- **탭별 메시지 필터링**: `useCaptureShortcuts`는 수신 메시지 **body의 `tabId`**를 패널 `boundTabId`와 비교해 다른 창의 패널을 걸러낸다. `usePickerMessages`는 content script가 보낸 메시지라 `sender.tab?.id`로 필터하지만, 이 기능의 메시지는 background가 `chrome.runtime.sendMessage`로 보낸 브로드캐스트라 `sender.tab`이 **없다** — 따라서 sender가 아닌 message body의 `tabId`를 비교하는 것이 올바른 접근이다.
- **순수 함수 + 단위 테스트**: 게이트 판정은 `isCaptureEntryScreen`/`resolveCaptureShortcut` 순수 함수로 분리, `__tests__/`에 Vitest 테스트.
- **Chrome i18n 분리**: 매니페스트 커맨드 설명은 `public/_locales/`(Chrome i18n), React UI 문자열은 `src/i18n/`. 이 기능은 UI 문자열이 없어 `public/_locales/`만 갱신. 툴팁 내용은 Chrome이 반환하는 단축키 문자열뿐이라 신규 i18n 키 불필요.

`startVideoCapture`는 기존 `picker-control.ts` 레이어 대신 신규 `video-capture.ts`에 둔다 (위 변경 범위 5번 참조 — `video-recorder` 의존성으로 인한 순환 회피). `picker-control.ts`는 picker/area 시작만 담당하고 이 기능에서 손대지 않는다.

**신규 도입 패턴 — shadcn Tooltip**: 툴팁은 `src/components/ui/tooltip.tsx`를 그대로 사용한다(직접 스타일링 없음). 단 이 컴포넌트는 설치돼 있으나 **코드베이스 어디에서도 아직 쓰이지 않아** 이 기능이 최초 사용처다 — "기존 패턴 준수"가 아니라 신규 패턴 도입임을 명확히 한다. Radix 기본 `delayDuration`·포털 렌더로 인한 패널 경계 잘림 여부를 구현·검증 단계에서 확인해야 한다.

## 대안 검토

**대안 A — 사이드패널이 `chrome.commands.onCommand`를 직접 수신.** background 경유 없이 패널 훅에서 바로 `onCommand` 리스너를 단다. 코드는 더 짧지만, `chrome.commands.onCommand`가 service worker 외 확장 페이지(side panel) 컨텍스트에 확실히 디스패치되는지 공식 문서로 보장되지 않는다. background는 보장된 수신 컨텍스트이고 리스너 `tab` 인자로 활성 탭도 얻을 수 있어, 결정성과 탭 타겟팅 양쪽에서 background 경유를 채택했다.

**대안 B — background가 포트로 특정 패널에 직접 전송.** `PANEL_PORT_PREFIX` 포트를 `Map<tabId, Port>`로 관리해 대상 패널에만 보낸다. 정확하지만 포트 생명주기 관리 코드가 늘어난다. `chrome.runtime.sendMessage` 브로드캐스트 + 패널의 `tabId` 자가 필터링이 기존 패턴과 일치하고 더 단순해 채택하지 않았다.

## 위험 요소

- **Chrome `suggested_key` 상한 4개 도달**: `_execute_action` + 캡처 3개. 이후 단축키 추가 시 `suggested_key` 없는 커맨드로만 가능(사용자 수동 배정).
- **단축키 배정 실패**: `suggested_key`는 best-effort라 `⌘⇧1~3`이 OS·다른 확장과 충돌하면 Chrome이 해당 커맨드를 **미배정 상태로 등록**한다. 미배정 시 `onCommand`가 안 와 단축키는 no-op이고, `useCommandShortcuts`가 빈 `shortcut`을 제외해 툴팁도 안 뜬다 — graceful하게 닫히지만 PRD 성공 기준의 "3개 자동 배정"이 환경에 따라 깨질 수 있다.
- **`tabCapture` user gesture**: 영상 캡처(`⌘⇧3`)는 단축키 → background `onCommand` → `runtime.sendMessage` 브로드캐스트 → 패널 핸들러라는 비동기 체인을 거친다. 이 과정에서 user gesture 컨텍스트가 소실되면 `chrome.tabCapture.getMediaStreamId`가 실패할 수 있다. 실패 시 기존 `isTabCaptureUnavailable` 가드가 `onVideoRecordingUnavailable` 다이얼로그로 잡아주지만, 그 경우 "버튼 클릭과 완전히 동일"하진 않게 된다 — 구현 시 실제 탭에서 PoC 확인 필요.
- **`handleStartVideo` 이관**: `handleStartVideo`는 `useEditorStore`/`blob-db`/`video-recorder`/`@/types/messages` 등 다수 모듈에 의존 → 신규 `video-capture.ts`에 import가 추가된다. `IssueTab.tsx`에서 안 쓰이게 된 import를 정리하지 않으면 lint/타입 경고 — `pnpm typecheck`로 검출. `video-recorder.ts`가 `video-capture.ts`를 import하는 경로는 없어 순환은 생기지 않는다.
- **게이트 단일 출처**: 진입 화면 조건은 `capture-commands.ts`의 `isCaptureEntryScreen` 헬퍼로 단일화하고 `IssueTab.tsx`(EmptyState 렌더 분기)와 `resolveCaptureShortcut`이 같은 함수를 호출한다 — 한쪽만 phase 조건을 바꿔 어긋나는 위험을 차단.
- **초기 발견성**: 단축키 존재를 알리는 트리거가 호버 툴팁뿐이라, 사용자가 버튼에 호버하기 전엔 단축키를 모른다(닭-달걀). 인앱 배지·온보딩을 비목표로 닫은 의도된 트레이드오프지만 위험으로 기록한다. Radix Tooltip은 키보드 포커스 시에도 떠 호버 불가 사용자를 부분적으로 커버한다.
- **툴팁 키 신선도**: `useCommandShortcuts`는 마운트 시 1회만 `chrome.commands.getAll()`을 조회한다. 패널을 연 채로 `chrome://extensions/shortcuts`에서 키를 바꾸면 패널을 다시 열기 전까지 툴팁이 옛 키를 보여줄 수 있다 — 드문 케이스라 재조회 로직은 두지 않는다.
