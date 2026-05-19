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
  - `resolveCaptureShortcut(command, state)` 순수 함수: 커맨드를 액션으로 매핑하되, 진입 화면 게이트(`phase==="idle" || (captureMode==="element" && !selection)`) 미통과 시 `null`.
  - 테스트(`/tdd interface`로 먼저 작성 권장): 3개 커맨드 → 액션 매핑, `phase==="idle"` 통과, `captureMode==="element" && !selection` 통과, `phase==="styling"` 차단, 미지 커맨드 → `null`.
- **검증**:
  - [ ] `pnpm test` — `capture-commands.test.ts` 통과
  - [ ] `pnpm typecheck` 클린

### Task 2: 영상 녹화 시작 로직 추출
- **변경 대상**: `src/sidepanel/picker-control.ts`, `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**:
  - `IssueTab.tsx`의 모듈 레벨 `handleStartVideo`(142–173행)와 `isTabCaptureUnavailable`(175–183행)를 `picker-control.ts`로 이관, `export async function startVideoCapture(tabId: number)`로 공개.
  - `IssueTab.tsx`: `startVideoCapture` import, `EmptyState`의 `onStartVideo={() => void startVideoCapture(tabId)}`. 이관으로 안 쓰이게 된 import 정리.
- **검증**:
  - [ ] `pnpm typecheck` 클린 (잔여 import 없음)
  - [ ] 수동: 영상 녹화 버튼 클릭이 이관 전과 동일하게 동작

### Task 3: 단축키 수신 훅
- **변경 대상**: `src/sidepanel/hooks/useCaptureShortcuts.ts` (신규)
- **작업 내용**:
  - `useCaptureShortcuts({ active, tabId })`. `active && tabId != null`일 때만 `chrome.runtime.onMessage` 리스너 등록.
  - 메시지가 `CAPTURE_SHORTCUT_MSG` && `tabId` 일치면 `resolveCaptureShortcut(command, useEditorStore.getState())` 호출, 결과 액션별로 `startPicker`/`startAreaCapture`/`startVideoCapture` 디스패치.
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
  - `useCommandShortcuts()` 훅: `chrome.commands.getAll()` 1회 조회 → `{ [name]: shortcut }` 맵 반환, `shortcut` 빈 문자열 커맨드는 제외.
  - `IssueTab.tsx`의 `EmptyState`에서 `useCommandShortcuts()` 호출. 로컬 `ShortcutTooltip` 컴포넌트(`shortcut` 있으면 `Tooltip`+`TooltipContent`로 감싸고, 없으면 children 그대로) 추가. 요소/스샷/영상 버튼 3개를 감싸고, 자유 작성 버튼은 그대로.
  - 버튼 그리드를 `TooltipProvider`로 감싼다. `Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider`는 `@/components/ui/tooltip`에서 import (기설치, 신규 설치 불필요). `TooltipTrigger`는 `asChild`로 `Button`을 감싼다.
- **검증**:
  - [ ] `pnpm typecheck` 클린
  - [ ] 수동: 요소/스샷/영상 버튼 호버 시 현재 단축키 툴팁 표시, 자유 작성은 툴팁 없음

## 테스트 계획

### 단위 테스트
- `src/lib/__tests__/capture-commands.test.ts` — `resolveCaptureShortcut`:
  - 커맨드 3개 → 각 액션 매핑 (진입 화면 상태에서)
  - `phase==="idle"` → 통과
  - `captureMode==="element" && selection===null` → 통과
  - `phase==="styling"`/`"drafting"`/`"recording"` → `null`
  - 미지 커맨드 → `null`

### 수동 테스트 (`pnpm dev` 로드 후)
- [ ] `chrome://extensions/shortcuts`에 캡처 커맨드 3개 자동 배정 확인
- [ ] 디버그>이슈 작성 진입 화면에서 `⌘⇧1` → 요소 picker, `⌘⇧2` → 화면 캡처, `⌘⇧3` → 영상 녹화
- [ ] 요소 선택 후(진입 화면 아님) 단축키 → 무시
- [ ] 콘솔/네트워크 서브탭에서 단축키 → 무시
- [ ] 다른 메인탭(연동/설정)에서 단축키 → 무시
- [ ] 패널 닫힌 상태에서 단축키 → 무시, 콘솔 에러 없음
- [ ] 캡처 버튼 클릭(특히 영상 녹화)이 이관 후에도 정상 동작
- [ ] 요소/스샷/영상 버튼 호버 시 현재 단축키 툴팁 표시 (`chrome://extensions/shortcuts`에서 키 변경 후 패널 재오픈 시 변경 키 반영)
- [ ] 자유 작성 버튼 호버 시 툴팁 없음

## 구현 순서 권장

1. **Task 1** (공용 모듈 + 테스트) — 다른 태스크의 타입/상수 의존성. `/tdd interface`로 테스트 먼저.
2. **Task 2** (영상 추출) — Task 3의 `startVideoCapture` 의존성.
3. **Task 3** (훅) — Task 1·2 완료 후.
4. **Task 4** (패널 배선) — Task 3 완료 후.
5. **Task 5·6** (매니페스트/i18n, background) — Task 1 완료 후면 가능, **Task 5와 6은 서로 병렬 가능**. 6은 1의 `CAPTURE_COMMANDS`·`CAPTURE_SHORTCUT_MSG`에만 의존.
6. **Task 7** (툴팁) — 독립적. Task 2와 `IssueTab.tsx`를 함께 건드리므로 Task 2 직후 이어서 하는 게 충돌이 적다. 키 표시는 Task 5(매니페스트 커맨드 등록) 후 실제 단축키가 잡혀야 수동 확인 가능.

> 문서 신선도: 신규 파일(`src/lib/capture-commands.ts`, `src/sidepanel/hooks/useCaptureShortcuts.ts`)과 `manifest.config.ts` 커맨드 변경이 있어, 구현 후 `/push` 단계에서 CLAUDE.md 디렉터리 구조·게이트웨이(단축키) 섹션 갱신이 필요하다.
