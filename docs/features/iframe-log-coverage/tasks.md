# iframe 로그 커버리지 확장 — 구현 태스크

## 선행 조건

- 권한 추가 없음 — manifest `permissions`/`host_permissions`/`optional_host_permissions` 변경 0. `<all_urls>`는 이미 content_scripts matches에 존재.
- 실탭 회귀 테스트용 cross-origin iframe 페이지 확보: Stripe Checkout 데모, YouTube embed, Google Maps embed 등 서드파티 iframe이 fetch/XHR/console을 실제로 사용하는 페이지.

## 태스크

### Task 1: 로그 브리지를 `recorder-bridge.ts`로 분리
- **변경 대상**: `src/content/picker.ts`(코드 제거), `src/content/recorder-bridge.ts`(신규)
- **작업 내용**:
  - `picker.ts`에서 다음을 새 파일 `recorder-bridge.ts`로 **이동**(로직 변경 없이):
    - `postToRuntime`(picker.ts:60)
    - Network/Console/Action 브리지 함수 전부(`handle*Data`, `handleSet*Sentinel`, stop/sync/clear — picker.ts:69–202 구간)
    - `chrome.runtime.onMessage` 핸들러의 recorder case(`networkRecorder.*`, `consoleRecorder.*`, `actionRecorder.*`)
  - `recorder-bridge.ts`는 자체 `chrome.runtime.onMessage.addListener`를 등록하고 recorder case만 처리. `postToRuntime`의 `chrome.runtime?.id` invalidation 가드도 함께 이동(iframe은 top보다 reload 빈도가 높아 더 중요).
  - `picker.ts`에는 `picker.*` case와 요소 선택 로직만 남긴다. **참고: `ping`은 background가 처리하므로 picker.ts에 `ping` case가 없다**(switch `default: return`으로 흘러 listener 존재만으로 `pingOk` 통과). 헛되이 ping case를 찾지 말 것.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `picker.ts`에 recorder 관련 식별자(`networkSentinel`, `handleNetData` 등) 잔존 0 (grep)
  - [ ] `recorder-bridge.ts`가 `picker.*` case를 갖지 않음
  - [ ] **응답 계약**: picker.ts는 `recorder.*` 메시지를 `default: return`(무응답)으로, recorder-bridge.ts는 `picker.*`를 `default: return`으로 흘린다 — top frame 공존 시 각 메시지에 한 리스너만 `sendResponse`(포트 충돌·이중 응답 없음)
  - [ ] iframe에서 stale 컨텍스트로 `sendMessage` 시 `postToRuntime` 가드가 Uncaught를 막음(extension reload 후 iframe 잔존 케이스)
  - [ ] 분리 전후 top frame에서 console/network/action 로그 캡처 동작 동일(수동)

### Task 2: manifest에 `all_frames` 적용 + 브리지 등록
- **변경 대상**: `manifest.config.ts`
- **작업 내용**:
  - `recorders-entry.ts` 엔트리에 `all_frames: true` 추가.
  - `recorder-bridge.ts` 엔트리 신규 추가: `matches: ["<all_urls>"]`, `exclude_matches: ["https://bugshot.gitbook.io/*"]`, `run_at: "document_idle"`, `all_frames: true`(world 미지정 = ISOLATED).
  - `picker.ts` 엔트리는 변경하지 않음(top frame only 유지).
- **검증**:
  - [ ] 빌드/로드 후 cross-origin iframe 있는 페이지에서 `chrome://extensions` → 해당 탭 → 프레임별로 `recorder-bridge.ts`/`recorders-entry.ts`가 주입됨 확인
  - [ ] `picker.ts`는 top frame에만 주입됨 확인
  - [ ] **`ensureContentScript`의 인덱스 의존**: `content_scripts[0]`이 여전히 `picker.ts`인지 확인(bridge를 배열에 추가할 때 picker.ts가 index 0을 유지해야 `ensureContentScript`가 올바른 스크립트를 programmatic 주입)
  - [ ] manifest diff에 permissions 변화 0

### Task 3: 캡처 시작 시점 존재 프레임 sentinel broadcast 검증
- **변경 대상**: `src/sidepanel/picker-control.ts`(검증 위주, 필요 시 소폭 수정)
- **작업 내용**:
  - `activate*Recorder`의 `chrome.tabs.sendMessage(tabId, {setSentinel})`가 broadcast 시점에 존재하는 모든 프레임 `recorder-bridge.ts`에 도달하는지 확인(frameId 미지정이라 broadcast).
  - **`ensureContentScript`는 picker.ts(top only) 존재만 검출**하고 recorder-bridge.ts(all_frames)·iframe 주입을 보장하지 않음을 인지. 캡처 시작 이후 뜬 iframe은 Task 4가 담당.
  - `ensureMainWorldRecorders`의 programmatic 주입은 `target:{tabId}`라 **top frame만** 타깃(all_frames 효과 없음). 정적 `all_frames` 등록이 iframe을 커버하므로 보강은 top 보장용. `CTRL_KEY` 가드(프레임별 `window` 단위)로 중복 주입 idempotent 확인.
- **검증**:
  - [ ] 페이지 로드 시점 존재하던 iframe 레코더가 녹화 시작 시 활성화(sentinel 수신)됨 — iframe 안 fetch가 로그에 잡힘(수동, YouTube embed 등 정적 iframe)
  - [ ] 동일 프레임 중복 주입 시 레코더가 한 번만 초기화됨(`CTRL_KEY` 가드)

### Task 4: 동적/지연 iframe sentinel 재발행 (webNav)
- **변경 대상**: `src/background/index.ts`, `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/picker-control.ts`
- **작업 내용**:
  - `background.onCommitted`에 `frameId !== 0`(iframe) 분기 추가: 해당 탭에 활성 세션(`sessionKey(tabId)`)이 있으면 sidepanel에 `{type:"frameCommitted", tabId, frameId}` 알림.
  - sidepanel(usePickerMessages)이 `frameCommitted` 수신 → 보유 sentinel로 `chrome.tabs.sendMessage(tabId, {*.setSentinel}, {frameId})` 재전송(picker-control에 frameId 옵션 지원 send 헬퍼 추가).
  - 재발행이 기존 프레임 buffer를 보존하는지 — `setSentinel`이 `recording=true`만 하고 clearBuffer를 안 함(코드 검증 완료). 선택적으로 브리지 `handleSetSentinel`에 "동일 sentinel이면 재dispatch 스킵" 가드.
- **검증**:
  - [ ] 캡처 시작 **이후** 동적 생성된 iframe(클릭 후 생성되는 Stripe Checkout)의 fetch/console이 로그에 잡힘(수동)
  - [ ] 재발행 시 기존 프레임 누적 로그가 유실되지 않음(buffer 보존)
  - [ ] iframe 다수 페이지에서 재발행 빈도가 과도한 부하를 유발하지 않음

### Task 5: 회귀 — cross-page 클리어·30s replay·세션 영속·시간축
- **변경 대상**: 코드 변경 없음(검증 전용)
- **작업 내용**: iframe 주입·재발행이 기존 플로우를 깨지 않는지 확인.
- **검증**:
  - [ ] top frame cross-origin 네비게이션 시 로그 초기화 동작 유지(`shouldClearLogs`, `frameId !== 0`)
  - [ ] iframe 네비게이션은 로그 초기화를 트리거하지 않음
  - [ ] 30s replay 캡처 시 iframe 로그도 시간 구간 trim에 포함됨
  - [ ] 프레임 간 시간축 정렬 정확 — 세 레코더 모두 `Date.now()` 기준이라 cross-origin 프레임 로그도 단일 타임라인에 올바르게 섞임
  - [ ] 세션 영속(`pending:${tabId}`)·재진입 시 iframe 로그 보존

## 테스트 계획

- **단위 테스트**: 신규 순수 함수 없음(브리지는 이동, 데이터 모델 불변). `mergeLogItems`는 기존 테스트(`log-merge.test.ts`)가 id dedup + 시간정렬을 이미 커버 — 프레임 무관하므로 추가 케이스 불필요. **단, 브리지 분리로 picker.ts의 기존 단위 테스트가 깨지지 않는지 확인**하고, 깨지면 import 경로만 갱신.
- **수동 테스트** (Chrome 실탭). 재현 환경: 가능하면 **고정 fixture 페이지**(`<iframe src=cross-origin>` + 버튼 클릭 시 fetch 유발)를 레포에 두면 테스터가 일관 재현 가능. Stripe Checkout은 iframe 구조가 데모마다 다르고 일부는 redirect(비-iframe)라 보조 검증으로:
  - [ ] **(1차, 정적)** YouTube/Google Maps embed가 있는 페이지에서 screenshot/video 캡처 → iframe 내부 fetch/console 로그가 사이드패널에 나타남
  - [ ] **(2차, 동적)** 클릭 후 동적 생성되는 iframe(Stripe Checkout 또는 fixture)의 로그가 webNav 재발행으로 나타남. 실패 시 known limitation으로 기록하고 Task 4 보강 범위 재검토
  - [ ] top frame 로그와 iframe 로그가 시간순 단일 타임라인으로 병합됨
  - [ ] 결제 iframe·YouTube embed가 레코더 주입 후에도 정상 동작(fetch/XHR 간섭으로 깨지지 않음)
  - [ ] 요소 선택(picker) 실행 시 top frame만 동작, iframe 중복 오버레이 없음
  - [ ] **광고/트래커 iframe 다수 페이지(뉴스 등)에서 top frame 초반 핵심 로그가 `MAX_ENTRIES` FIFO에 밀려 유실되지 않음** — 밀려나면 cap/top-frame 우선보존 후속 과제 트리거
  - [ ] 광고/트래커 iframe 많은 페이지에서 캡처 시 크래시·과도한 지연 없음
  - [ ] **sandboxed iframe**(`sandbox` allow-scripts 없음)·`about:blank`·`srcdoc`에서 에러 없이 조용히 미수집(주입 실패가 콘솔 에러로 누적되지 않음)
  - [ ] **중첩 iframe**(iframe 안 iframe)·**iframe detach**(동적 제거) 시 크래시·로그 오염 없음
  - [ ] element 모드는 로그 미수집 정책 유지(기존 매트릭스)

## 구현 순서 권장

1. **Task 1**(브리지 분리) → **Task 2**(manifest) 순차. Task 1이 새 파일을 만들어야 Task 2에서 등록 가능.
2. **Task 3**(정적 프레임 sentinel 검증)은 Task 1·2 완료 후.
3. **Task 4**(webNav 동적 iframe 재발행)는 Task 3 후 — 정적 커버리지가 동작해야 동적 보강을 분리 검증 가능.
4. **Task 5**(회귀 검증)는 전체 완료 후 마지막.
- Task 1·2는 의존 관계라 병렬 불가. Task 4는 유일한 추가 구현(background+sidepanel), 나머지는 검증 위주.

## 가이드 영향

iframe 로그가 사이드패널 로그에 추가로 나타나는 것은 사용자 노출 동작 변화지만, **새 UI·설정·플로우가 없고**(필터 UI 제외) 기존 로그 첨부 동작의 커버리지 확장이다. `guide/ko`·`guide/en`의 로그 관련 페이지(`logs/`)에 "cross-origin iframe 로그도 캡처됩니다" 수준의 한 줄 보강이 적절할 수 있음 — 구현 후 `/guide`로 `guide/AUTHORING.md` 대조해 판단. 필수는 아니며 후속 필터 과제와 묶어 갱신해도 됨.
