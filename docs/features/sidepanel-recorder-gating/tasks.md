# 사이드패널 레코더 게이팅 — 구현 태스크

## 선행 조건

- 코드 확인됨: `console-recorder.ts`(`pushEntry`:104)·`action-recorder.ts`(`pushAction`:49) 모두 push 진입부에 `if (!recording) return;` 게이트가 이미 있다. 따라서 두 파일은 **기본값 한 글자만 바꾸면 끝**이며 push 가드 추가 작업은 발생하지 않는다.
- 권한·env·OAuth·외부 API 변경 없음.

## 태스크

### Task 1: `createPatchedFetch`에 recording 가드 추가
- **변경 대상**: `src/content/network-recorder-helpers.ts`
- **작업 내용**: `createPatchedFetch(originalFetch, record?, shouldRecord?: () => boolean)`로 시그니처 확장. 함수 본문 맨 앞에 `if (shouldRecord && !shouldRecord()) return originalFetch.call(this, input, init);` 추가 — recording이 꺼져 있으면 `new Request`/`extractRequestInfo`/`record` 없이 원본 input/init 그대로 전송.
- **검증**:
  - [x] `shouldRecord=() => false`면 originalFetch가 **원본 input/init**을 받고(인자 동일성), `new Request` 재구성이 일어나지 않는다.
  - [x] `shouldRecord=() => true` 또는 미전달이면 기존 동작(req 전송 + record 호출) 유지.
  - [x] 기존 회귀 테스트(본문 비소비, 비블로킹, 예외 격리) 전부 green.

### Task 2: network-recorder 기본값 false + 가드 연결
- **변경 대상**: `src/content/network-recorder.ts`
- **작업 내용**: `let recording = true;`(:68) → `false`. `createPatchedFetch(originalFetch, recordHook)`(:329) → `createPatchedFetch(originalFetch, recordHook, () => recording)`.
- **검증**:
  - [ ] 주입 직후 `recording`이 `false`이고, fetch/XHR/sendBeacon이 원본 경로로 통과(수동: AWS 콘솔에서 패널 미오픈 상태로 정상 동작).
  - [ ] `setSentinel` 수신 후 `recording=true`로 전환되어 캡처 시작.

### Task 3: console/action recorder 기본값 false
- **변경 대상**: `src/content/console-recorder.ts`(:28), `src/content/action-recorder.ts`(:39)
- **작업 내용**: 두 파일의 `let recording = true;` → `false`. push 게이트는 이미 존재하므로(선행 조건) 기본값만 변경.
- **검증**:
  - [ ] 패널 미오픈 탭에서 `console.*` 호출·DOM 클릭이 버퍼에 쌓이지 않는다.
  - [ ] 패널 오픈(activate) 후 정상 캡처.

### Task 4: 패널 닫힘/탭전환 stop 신호 (background)
- **변경 대상**: `src/background/index.ts`
- **작업 내용**: `port.onDisconnect`(:86-89)에 `networkRecorder.stop`·`consoleRecorder.stop`·`actionRecorder.stop` 세 `chrome.tabs.sendMessage(tabId, …)` 추가(각 `.catch(() => {})`).
- **검증**:
  - [ ] 패널을 닫으면 해당 탭의 세 레코더 `recording`이 `false`로 전환(수동: 닫은 뒤 그 탭에서 트래픽이 더 이상 캡처되지 않음).
  - [ ] 첨부된 `pending:${tabId}` 로그는 유지됨(IndexedDB 불변).

### Task 5: 탭 전환 stop 보완 (`onActivated`) — 기본 포함
- **변경 대상**: `src/background/tab-bindings.ts`
- **작업 내용**: `port.onDisconnect`(패널 닫기)만으로는 탭 전환 stop이 보장되지 않으므로(per-tab sidePanel에서 비활성 탭 패널 문서 destroy 미보장), `onActivated` 보완을 **기본으로 포함**한다. 직전 활성 tabId를 모듈 변수로 추적하고, `chrome.tabs.onActivated`(기존 리스너) 발화 시 직전 tabId에 `networkRecorder.stop`·`consoleRecorder.stop`·`actionRecorder.stop`을 `chrome.tabs.sendMessage(prevTabId, …).catch(() => {})`로 전송. sentinel 미보유 탭에는 no-op이라 안전.
- **검증**:
  - [ ] 탭 A에서 패널 오픈 → 탭 B로 전환 → 탭 A에서 트래픽 발생 시 탭 A 패널 카운트(DebugTab Console/Network Badge)에 더 쌓이지 않음.
  - [ ] 탭 A로 복귀 시 다시 캡처 시작.
  - [ ] 빠른 탭 전환 연타 시 직전 tabId 추적이 어긋나지 않음(엉뚱한 탭 stop 없음).

## 테스트 계획

- **단위 테스트** (`src/content/__tests__/network-recorder.test.ts`, Vitest):
  - `shouldRecord: () => false` 케이스는 **별도 spy mock으로 작성**한다. 기존 `makeRecordingFetch`/`makeStrictFetch`는 input이 Request가 아니면 내부에서 `new Request(input, init)`로 정규화해버려 "원본 인자"인지 "patched가 만든 Request"인지 구분 못 한다(SigV4 회귀 못 잡음). 대신 `const fn = vi.fn(...)`로 받아:
    - `expect(fn.mock.calls[0][0]).toBe(originalInput)` (원본 input 참조 동일성)
    - `expect(fn.mock.calls[0][0]).not.toBeInstanceOf(Request)` (string input이 Request로 재구성되지 않음)
    - init 객체도 원본 그대로 전달되는지 단언.
  - `shouldRecord: () => true` 또는 미전달 시 기존 동작 유지(req 전송 + record 호출).
  - 기존 회귀 테스트(본문 비소비·비블로킹·예외 격리) 전부 green 유지.
- **수동 테스트** (Chrome, dev 빌드 로드 언팩):
  - [ ] 패널 미오픈 상태에서 AWS 콘솔 로그인·리전 선택·권한 작업 정상.
  - [ ] 패널 오픈 후 network/console/action 로그 수집 정상.
  - [ ] 패널 닫기 → 해당 탭 트래픽 미캡처.
  - [ ] 탭 전환 → 이전 탭 미캡처, 복귀 시 재개.
  - [ ] **패널 닫고 1초 내 재오픈 → 캡처 정상 재개**(stop/activate 메시지 race에도 새 sentinel로 정상 시작). 재오픈 후 로그 카운트의 누적/리셋이 기대대로인지(in-memory buffer 보존 동작) 기록.
  - [ ] **video(MediaRecorder) 녹화 중 패널 닫힘/탭 전환** → 세 레코더 stop이 video 캡처에 영향 없음(녹화 계속·결과물 정상).
  - [ ] 같은 탭 내 페이지 이동 시 cross-page 누적 정상(기존 동작 회귀 없음).
  - [ ] 30s Replay 정상(게이팅 무관 확인).

## 구현 순서 권장

1. **Task 1 → Task 2** (fetch 가드 인프라 후 network 연결, 단위 테스트와 함께). 순차.
2. **Task 3**, **Task 4**, **Task 5**는 Task 1과 독립 — 병렬 가능(Task 4 port disconnect, Task 5 onActivated는 stop의 두 신호로 함께 구현).
3. 전 Task 완료 후 통합 수동 검증.

## 가이드 영향

- `guide/ko`·`guide/en`의 로그 관련 페이지(네트워크/콘솔 로그 수집 설명) — "로그는 사이드패널을 연 시점부터 수집된다"는 동작을 반영해야 한다(소급 캡처 안 됨). 안내 UI는 추가하지 않으므로 가이드 본문에서만 명시.
- **30s Replay 비대칭**: 30s Replay는 게이팅 대상이 아니라 패널 미활성 탭에서도 직전 영상을 잡지만, 그 구간의 network/console 로그는 동반되지 않는다("영상은 있으나 로그는 빔"). 가이드의 30s Replay/로그 섹션에 이 비대칭을 1줄 명시.
  - 대상 후보: `guide/ko`·`guide/en`의 logs/디버그 캡처 섹션(정확한 파일은 `guide/AUTHORING.md` IA 대조 후 `/guide`로 확정).
- 구현·검증 완료 후 `/guide`로 ko·en 동시 갱신.
