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
  - `recorder-bridge.ts`는 자체 `chrome.runtime.onMessage.addListener`를 등록하고 recorder case만 처리.
  - `picker.ts`에는 `picker.*` case와 요소 선택 로직만 남긴다. `ping` 핸들러는 picker.ts에 유지(top frame 존재 확인용).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `picker.ts`에 recorder 관련 식별자(`networkSentinel`, `handleNetData` 등) 잔존 0 (grep)
  - [ ] `recorder-bridge.ts`가 `picker.*` case를 갖지 않음
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
  - [ ] manifest diff에 permissions 변화 0

### Task 3: sentinel broadcast·존재 보장 검증
- **변경 대상**: `src/sidepanel/picker-control.ts`(검증 위주, 필요 시 소폭 수정)
- **작업 내용**:
  - `activate*Recorder`의 `chrome.tabs.sendMessage(tabId, {setSentinel})`가 모든 프레임 `recorder-bridge.ts`에 도달하는지 확인(frameId 미지정이라 broadcast).
  - `ensureContentScript`의 `ping`이 top frame picker.ts로 응답되는지 확인. 브리지는 정적 등록이라 별도 ensure 불필요하나, sentinel 발행이 브리지 주입 이후가 되도록 순서 확인.
  - `ensureMainWorldRecorders`의 programmatic 주입이 정적 `all_frames` 등록과 충돌(중복)하지 않는지 — `recorders-entry`의 `CTRL_KEY` 가드로 idempotent 확인.
- **검증**:
  - [ ] iframe 레코더가 녹화 시작 시 활성화(sentinel 수신)됨 — iframe 안 fetch가 로그에 잡힘(수동)
  - [ ] 중복 주입 시 레코더가 한 번만 초기화됨(`CTRL_KEY` 가드 동작)

### Task 4: 회귀 — cross-page 클리어·30s replay·세션 영속
- **변경 대상**: 코드 변경 없음(검증 전용)
- **작업 내용**: iframe 주입이 기존 플로우를 깨지 않는지 확인.
- **검증**:
  - [ ] top frame cross-origin 네비게이션 시 로그 초기화 동작 유지(`shouldClearLogs`, `frameId !== 0`)
  - [ ] iframe 네비게이션은 로그 초기화를 트리거하지 않음
  - [ ] 30s replay 캡처 시 iframe 로그도 시간 구간 trim에 포함됨
  - [ ] 세션 영속(`pending:${tabId}`)·재진입 시 iframe 로그 보존

## 테스트 계획

- **단위 테스트**: 신규 순수 함수 없음(브리지는 이동, 데이터 모델 불변). `mergeLogItems`는 기존 테스트(`log-merge.test.ts`)가 id dedup + 시간정렬을 이미 커버 — 프레임 무관하므로 추가 케이스 불필요. **단, 브리지 분리로 picker.ts의 기존 단위 테스트가 깨지지 않는지 확인**하고, 깨지면 import 경로만 갱신.
- **수동 테스트** (Chrome 실탭):
  - [ ] Stripe Checkout(cross-origin iframe) 페이지에서 screenshot/video 캡처 → 결제 iframe 내부 fetch/console 로그가 사이드패널에 나타남
  - [ ] top frame 로그와 iframe 로그가 시간순 단일 타임라인으로 병합됨
  - [ ] 결제 iframe·YouTube embed가 레코더 주입 후에도 정상 동작(깨지지 않음)
  - [ ] 요소 선택(picker) 실행 시 top frame만 동작, iframe 중복 오버레이 없음
  - [ ] 광고/트래커 iframe 많은 페이지(뉴스 등)에서 캡처 시 크래시·과도한 지연 없음
  - [ ] element 모드는 로그 미수집 정책 유지(기존 매트릭스)

## 구현 순서 권장

1. **Task 1**(브리지 분리) → 2. **Task 2**(manifest) 순차. Task 1이 새 파일을 만들어야 Task 2에서 등록 가능.
2. **Task 3**(sentinel 검증)은 Task 1·2 완료 후.
3. **Task 4**(회귀 검증)는 전체 완료 후 마지막.
- Task 1과 2는 의존 관계라 병렬 불가. Task 3·4는 검증 위주라 구현 부담 적음.

## 가이드 영향

iframe 로그가 사이드패널 로그에 추가로 나타나는 것은 사용자 노출 동작 변화지만, **새 UI·설정·플로우가 없고**(필터 UI 제외) 기존 로그 첨부 동작의 커버리지 확장이다. `guide/ko`·`guide/en`의 로그 관련 페이지(`logs/`)에 "cross-origin iframe 로그도 캡처됩니다" 수준의 한 줄 보강이 적절할 수 있음 — 구현 후 `/guide`로 `guide/AUTHORING.md` 대조해 판단. 필수는 아니며 후속 필터 과제와 묶어 갱신해도 됨.
