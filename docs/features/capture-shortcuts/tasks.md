# 캡처 모드 키보드 단축키 — 구현 태스크

## 선행 조건

- 새 권한 불필요 — `commands` 권한은 `manifest.config.ts`에 이미 존재.
- 새 의존성 불필요.
- 로컬 dev는 `pnpm dev` + 언팩 로드. 매니페스트 `commands` 변경은 확장 재로드 필요.

## 태스크

### Task 1: 공용 모듈 + 단위 테스트
- **변경 대상**: `src/lib/capture-commands.ts` (신규), `src/lib/__tests__/capture-commands.test.ts` (신규)
- **작업 내용**:
  - `CAPTURE_SHORTCUT_MSG` 상수, `CaptureCommand`/`CaptureAction`/`CaptureShortcutMessage` 타입, `CAPTURE_COMMANDS` 배열 export.
  - `isCaptureEntryScreen(state)` 순수 함수 export: 진입 화면 게이트(`phase==="idle" || (captureMode==="element" && !selection)`) 판정. `IssueTab.tsx`의 EmptyState 렌더 분기와 `resolveCaptureShortcut`이 공유하는 단일 출처.
  - `resolveCaptureShortcut(command, state)` 순수 함수: 커맨드를 액션으로 매핑하되, `isCaptureEntryScreen(state)` 미통과 시 `null`.
  - 테스트(`/tdd interface`로 먼저 작성 권장):
    - 3개 커맨드 → 각 액션 매핑 (진입 화면 상태에서)
    - `phase==="idle"` → 통과
    - `captureMode==="element" && selection===null` → 통과
    - `phase!=="idle" && captureMode==="element" && selection!==null` → `null` (요소 선택 완료, StyleEditorPanel 표시 중 — 진행 중 작업 보호 핵심 경로)
    - `captureMode==="screenshot" && phase!=="idle"` → `null`
    - `phase==="styling"`/`"drafting"`/`"recording"` → `null`
    - `state`가 빈/비정상 객체(빈 `phase` 문자열 등) → 방어적으로 `null`
    - 미지 커맨드 → `null`
- **검증**:
  - [ ] `pnpm test` — `capture-commands.test.ts` 통과
  - [ ] `pnpm typecheck` 클린

### Task 2: 영상 녹화 시작 로직 추출 → `video-capture.ts` 신규 모듈
- **변경 대상**: `src/sidepanel/video-capture.ts` (신규), `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**:
  - `IssueTab.tsx`의 모듈 레벨 `handleStartVideo`(142–173행)와 `isTabCaptureUnavailable`(175–183행)를 신규 `src/sidepanel/video-capture.ts`로 이관, `export async function startVideoCapture(tabId: number)`로 공개.
  - **`picker-control.ts`가 아닌 신규 모듈인 이유**: `video-recorder.ts`가 이미 `picker-control.ts`를 import하므로, `startVideoCapture`를 picker-control에 두면 `picker-control → video-recorder → picker-control` 순환이 생긴다. 별도 모듈로 분리해 차단.
  - `video-capture.ts`에 `useEditorStore`/`blob-db`/`video-recorder`/메시지 타입 등 `handleStartVideo`가 의존하던 import를 가져온다.
  - `IssueTab.tsx`: `video-capture`에서 `startVideoCapture` import, `EmptyState`의 `onStartVideo={() => void startVideoCapture(tabId)}`. 이관으로 안 쓰이게 된 import 정리.
- **검증**:
  - [ ] `pnpm typecheck` 클린 (잔여 import 없음)
  - [ ] `video-recorder.ts`가 `video-capture.ts`를 import하는 경로가 없어 순환이 생기지 않음을 확인
  - [ ] 수동: 영상 녹화 버튼 클릭이 이관 전과 동일하게 동작
  - [ ] 수동: 영상 녹화 시 네트워크/콘솔 로그가 녹화 구간만 담기는지 — `injectNetworkRecorder → clearNetworkRecorder → startRecording` 순서가 보존돼 녹화 이전 버퍼가 안 섞이는지 확인

### Task 3: 단축키 수신 훅
- **변경 대상**: `src/sidepanel/hooks/useCaptureShortcuts.ts` (신규)
- **작업 내용**:
  - `useCaptureShortcuts({ active, tabId })`. `active && tabId != null`일 때만 `chrome.runtime.onMessage` 리스너 등록.
  - 메시지가 `CAPTURE_SHORTCUT_MSG`이고 **메시지 페이로드의 `message.tabId`**가 패널 `tabId`와 일치하면(`sender.tab.id`가 아님 — background 브로드캐스트라 `sender.tab` 없음) `resolveCaptureShortcut(command, useEditorStore.getState())` 호출, 결과 액션별로 `startPicker`/`startAreaCapture`(`picker-control`)/`startVideoCapture`(`video-capture`) 디스패치.
  - 리스너는 `sendResponse`를 호출하지 않고 `undefined`를 반환한다 (브로드캐스트 메시지에 응답 불필요, `return true` 시 채널 미점유).
  - cleanup에서 리스너 제거. `active`/`tabId` deps로 자동 attach/detach.
- **검증**:
  - [ ] `pnpm typecheck` 클린

### Task 4: 패널 배선 (DebugTab + App)
- **변경 대상**: `src/sidepanel/tabs/DebugTab.tsx`, `src/sidepanel/App.tsx`
- **작업 내용**:
  - `DebugTab`에 `activeMainTab: string` prop 추가, `useCaptureShortcuts({ active: activeMainTab === "debug" && sub === "issue", tabId })` 호출.
  - `App.tsx`: `<DebugTab activeMainTab={tab} />`.
- **검증**:
  - [ ] `pnpm typecheck` 클린
  - [ ] `App.tsx`가 `DebugTab`을 단일 인스턴스로 렌더함을 확인 (비활성 메인탭 동시 마운트 상황에서도 `useCaptureShortcuts` 리스너가 중복 등록되지 않음)

### Task 5: 매니페스트 커맨드 + i18n
- **변경 대상**: `manifest.config.ts`, `public/_locales/ko/messages.json`, `public/_locales/en/messages.json`
- **작업 내용**:
  - `manifest.config.ts` `commands`에 `capture-element`/`capture-screenshot`/`capture-video` 추가 (`suggested_key` `Ctrl/Command+Shift+1/2/3`).
  - `CMD_CAPTURE_ELEMENT`/`CMD_CAPTURE_SCREENSHOT`/`CMD_CAPTURE_VIDEO` 메시지를 ko·en 양쪽에 추가.
- **검증**:
  - [ ] 확장 재로드 후 `chrome://extensions/shortcuts`에 3개 커맨드가 `⌘⇧1/2/3`으로 배정·노출

### Task 6: background 리스너
- **변경 대상**: `src/background/index.ts`
- **작업 내용**:
  - top-level에 `chrome.commands.onCommand` 리스너 추가. 캡처 커맨드(`CAPTURE_COMMANDS`)이고 `tab?.id != null`이면 `chrome.runtime.sendMessage({ type: CAPTURE_SHORTCUT_MSG, command, tabId: tab.id })` 브로드캐스트, `.catch(() => {})`.
- **검증**:
  - [ ] `pnpm typecheck` 클린

### Task 7: 캡처 버튼 단축키 툴팁
- **변경 대상**: `src/sidepanel/hooks/useCommandShortcuts.ts` (신규), `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**:
  - `useCommandShortcuts()` 훅: `chrome.commands.getAll()` 1회 조회 → `Partial<Record<CaptureCommand, string>>` 맵 반환. `CAPTURE_COMMANDS`에 속한 커맨드만 남기고(캡처 외 `_execute_action` 등 제외), `shortcut` 빈 문자열 커맨드도 제외. `getAll()`의 `shortcut`은 이미 OS별 표기가 적용된 문자열이라 가공 없이 그대로 사용.
  - `IssueTab.tsx`의 `EmptyState`에서 `useCommandShortcuts()` 호출. 로컬 `ShortcutTooltip` 컴포넌트(`shortcut` 있으면 `Tooltip`+`TooltipContent`로 감싸고, 없으면 children 그대로) 추가. 요소/스샷/영상 버튼 3개를 감싸고, 자유 작성 버튼은 그대로.
  - 버튼 그리드를 `TooltipProvider`로 감싼다. `Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider`는 `@/components/ui/tooltip`에서 import (기설치이나 **코드베이스 최초 사용처** — 신규 도입 패턴). `TooltipTrigger`는 `asChild`로 `Button`을 감싼다.
- **검증**:
  - [ ] `pnpm typecheck` 클린
  - [ ] 수동: 요소/스샷/영상 버튼 호버 시 현재 단축키 툴팁 표시, 자유 작성은 툴팁 없음
  - [ ] 수동: 툴팁이 사이드패널(~400px) 경계 안에서 잘리지 않고 표시, Radix 기본 delay가 적절
  - [ ] 수동: Tab 키로 캡처 버튼 포커스 시에도 툴팁 노출 (키보드 접근성)

## 테스트 계획

### 단위 테스트
- `src/lib/__tests__/capture-commands.test.ts` — `isCaptureEntryScreen` / `resolveCaptureShortcut`:
  - 커맨드 3개 → 각 액션 매핑 (진입 화면 상태에서)
  - `phase==="idle"` → 통과
  - `captureMode==="element" && selection===null` → 통과
  - `phase!=="idle" && captureMode==="element" && selection!==null` → `null` (요소 선택 완료 상태)
  - `captureMode==="screenshot" && phase!=="idle"` → `null`
  - `phase==="styling"`/`"drafting"`/`"recording"` → `null`
  - 빈/비정상 `state`(빈 `phase` 문자열 등) → 방어적으로 `null`
  - 미지 커맨드 → `null`

### 수동 테스트 (`pnpm dev` 로드 후)
- [ ] `chrome://extensions/shortcuts`에 캡처 커맨드 3개 자동 배정 확인
- [ ] 디버그>이슈 작성 진입 화면에서 `⌘⇧1` → 요소 picker, `⌘⇧2` → 화면 캡처, `⌘⇧3` → 영상 녹화
- [ ] 요소 선택 후(진입 화면 아님) 단축키 → 무시
- [ ] 콘솔/네트워크 서브탭에서 단축키 → 무시
- [ ] 다른 메인탭(연동/설정)에서 단축키 → 무시
- [ ] 패널 닫힌 상태에서 단축키 → 무시, 콘솔 에러 없음
- [ ] 영상 녹화 중(`phase==="recording"`)에 `⌘⇧3` 재입력 → 무시 (녹화 중복 시작 방지)
- [ ] `chrome://extensions/shortcuts`에서 키를 충돌/해제로 미배정한 커맨드 → 단축키 no-op + 해당 버튼 툴팁 미표시
- [ ] `tabCapture` 권한 거부 상태에서 `⌘⇧3` → 버튼 클릭과 동일하게 `onVideoRecordingUnavailable` 다이얼로그 표시
- [ ] 캡처 버튼 클릭(특히 영상 녹화)이 이관 후에도 정상 동작
- [ ] 요소/스샷/영상 버튼 호버 시 현재 단축키 툴팁 표시 (`chrome://extensions/shortcuts`에서 키 변경 후 패널 재오픈 시 변경 키 반영)
- [ ] Tab 키로 캡처 버튼 포커스 시에도 툴팁 노출
- [ ] 자유 작성 버튼 호버 시 툴팁 없음

## 구현 순서 권장

1. **Task 1** (공용 모듈 + 테스트) — 다른 태스크의 타입/상수 의존성. `/tdd interface`로 테스트 먼저.
2. **Task 2** (영상 추출) — Task 3의 `startVideoCapture` 의존성.
3. **Task 3** (훅) — Task 1·2 완료 후.
4. **Task 4** (패널 배선) — Task 3 완료 후.
5. **Task 5·6** (매니페스트/i18n, background) — Task 1 완료 후면 가능, **Task 5와 6은 서로 병렬 가능**. 6은 1의 `CAPTURE_COMMANDS`·`CAPTURE_SHORTCUT_MSG`에만 의존.
6. **Task 7** (툴팁) — 독립적. Task 2와 `IssueTab.tsx`를 함께 건드리므로 Task 2 직후 이어서 하는 게 충돌이 적다. 키 표시는 Task 5(매니페스트 커맨드 등록) 후 실제 단축키가 잡혀야 수동 확인 가능.

> 문서 신선도: 신규 파일이 다수라 구현 후 `/push` 단계에서 CLAUDE.md 갱신이 필요하다 —
> - 디렉터리 구조 `hooks/` 목록에 `useCaptureShortcuts`/`useCommandShortcuts` 추가
> - 디렉터리 구조 `lib/` 목록에 `capture-commands` 추가
> - 디렉터리 구조 `sidepanel/` 트리에 `video-capture.ts` 추가
> - 게이트웨이의 "단축키" 줄에 캡처 커맨드 3개 반영
