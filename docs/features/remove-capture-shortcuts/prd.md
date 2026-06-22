# 캡처 단축키 제거

## 배경

현재 확장은 4개의 키보드 단축키를 등록한다 — `_execute_action`(사이드패널 토글, Cmd/Ctrl+Shift+E) + 캡처 단축키 3개(`capture-element`=Shift+S / `capture-screenshot`=Shift+F / `capture-video`=Shift+X). 캡처 단축키는 "디버그 > 이슈 작성 진입 화면"에서만 발화하는 좁은 진입점인데:

- Chrome `suggested_key` 4개 상한을 캡처 3개가 모두 소진해, 더 의미 있는 단축키를 추가할 여지를 막는다. **실제 트리거**: `screen-recording`/`recording-mode-setting` feature가 새 단축키를 원했으나 이 상한에 막혔다(screen-recording PRD가 명시).
- OS·타 확장과 충돌이 잦은 키(Shift+S/F/X)라 best-effort로 미배정되는 경우가 있다.
- 캡처는 진입 화면 버튼으로 이미 충분히 접근 가능하고, 단축키→화면 녹화는 user activation 전파 문제로 동작하지 않는다(별도 분석 완료).

> **정당성 근거 수준**: 캡처 단축키 발화량은 PostHog 등으로 **측정되지 않았다**(해당 이벤트 미집계). 따라서 "거의 안 쓰인다"는 사실이 아니라 **진입점 협소성(진입 화면 호버 툴팁 1곳에서만 노출)에 근거한 정성 판단**이다. 제거의 핵심 동인은 사용량보다 **command 상한 해소 + 비동작 경로(단축키→화면 녹화) 정리**다.

캡처 단축키를 제거하고 **사이드패널 토글(`_execute_action`)만 유지**해, command 표면을 1개로 줄이고 관련 코드·문서를 정리한다.

## 목표

- manifest `commands`에서 `capture-element`/`capture-screenshot`/`capture-video` 3개를 제거하고 `_execute_action`만 남긴다.
- 단축키 디스패치 경로(`background` onCommand 리스너, `useCaptureShortcuts`, `useCommandShortcuts`, `capture-commands.ts`의 단축키 관련 export, `ShortcutTooltip`)를 제거한다.
- 캡처 **버튼 동작은 그대로** 유지한다 — `startPicker`/`startAreaCapture`/`startVideoCapture` 호출과 `isCaptureEntryScreen` 게이트는 보존.
- `public/_locales`의 캡처 command 메시지 3개를 제거한다.
- 단축키를 언급하는 문서(CLAUDE.md, PERMISSION.md, guide)를 정리한다.

## 비목표 (Non-goals)

- `_execute_action`(사이드패널 토글)은 **변경하지 않는다** — command·suggested_key(Cmd/Ctrl+Shift+E) 그대로 유지. 키를 더 쉬운 키로 옮기지 않는다(사용자 커스텀 키바인딩 리셋 위험).
- 캡처 기능 자체·진입 화면 버튼·`isCaptureEntryScreen` 게이트는 손대지 않는다.
- 영속 데이터 마이그레이션 코드는 작성하지 않는다 — 단축키 설정은 chrome.storage/zustand에 저장되지 않으므로 불필요(아래 시나리오 참조).
- 새 단축키 추가는 이번 범위 밖.

## 사용자 시나리오

### 시나리오 1: 기존 사용자 업데이트 (마이그레이션 불필요 확인)
1. 캡처 단축키가 있던 버전을 쓰던 사용자가 새 버전으로 업데이트
2. Chrome이 manifest에서 사라진 command 3개를 자동 정리한다. 사용자가 `chrome://extensions/shortcuts`에서 캡처 command에 **커스텀 키를 재할당했다면 그 매핑은 사라진다** — 이는 의도된 기능 제거다(사용자 관점의 키 손실). **무손실인 것은** `_execute_action`(사용자가 재할당한 키 포함)과 모든 영속 설정 데이터(zustand/chrome.storage)다 — 이들은 캡처 command 제거의 영향을 받지 않는다.
3. `_execute_action`(Cmd/Ctrl+Shift+E, 또는 사용자가 재할당한 키)은 그대로 유지된다
4. 캡처는 진입 화면 버튼으로 동일하게 가능 — 캡처 **기능** 손실은 없다(단축키 진입점만 사라짐)

### 시나리오 2: 신규 사용자
1. 설치 후 `chrome://extensions/shortcuts`에 `_execute_action` 1개만 노출
2. 캡처는 버튼으로 수행

### 엣지 케이스
- **단축키로 캡처하던 사용자**: 캡처 단축키가 사라져 버튼을 써야 한다. 진입 화면 버튼에 단축키 툴팁(`ShortcutTooltip`)이 사라지는 것 외 동작 변화 없음. (공지/안내는 비목표 — release notes에 한 줄로 충분.)

## 성공 기준

- 빌드 후 `chrome://extensions/shortcuts`에 `_execute_action` 1개만 노출되고, 사이드패널 토글이 정상 작동한다.
- 진입 화면 캡처 버튼 3종(요소/범위/탭 녹화)이 단축키 툴팁 없이 정상 동작한다.
- `capture-element`/`capture-screenshot`/`capture-video` 문자열이 코드(테스트·문서 제외 로직)에서 사라진다.
- `isCaptureEntryScreen`과 그 단위 테스트는 보존된다.
- `pnpm typecheck` / `pnpm test` / e2e green. (특히 `capture-modes-layout.spec.ts`의 버튼 testid·ButtonGroup 그룹 구조 회귀 없음.)
- CLAUDE.md·PERMISSION.md·guide의 캡처 단축키 언급이 제거된다.
- release notes에 "캡처 단축키 제거(사이드패널 토글 단축키는 유지)" 안내 문구가 포함된다.
