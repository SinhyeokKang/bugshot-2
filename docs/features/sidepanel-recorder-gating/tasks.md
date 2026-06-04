# 사이드패널 레코더 게이팅 — 구현 태스크

## 선행 조건

- 구현 전, `console-recorder.ts`·`action-recorder.ts`의 push 경로가 `recording` 플래그로 게이트되는지 확인한다(network/XHR과 동일 패턴이면 기본값만 바꾸면 됨). 게이트가 없다면 push 진입부에 `if (!recording) return;`를 추가하는 작업이 Task에 포함된다.
- 권한·env·OAuth·외부 API 변경 없음.

## 태스크

### Task 1: `createPatchedFetch`에 recording 가드 추가
- **변경 대상**: `src/content/network-recorder-helpers.ts`
- **작업 내용**: `createPatchedFetch(originalFetch, record?, shouldRecord?: () => boolean)`로 시그니처 확장. 함수 본문 맨 앞에 `if (shouldRecord && !shouldRecord()) return originalFetch.call(this, input, init);` 추가 — recording이 꺼져 있으면 `new Request`/`extractRequestInfo`/`record` 없이 원본 input/init 그대로 전송.
- **검증**:
  - [ ] `shouldRecord=() => false`면 originalFetch가 **원본 input/init**을 받고(인자 동일성), `new Request` 재구성이 일어나지 않는다.
  - [ ] `shouldRecord=() => true` 또는 미전달이면 기존 동작(req 전송 + record 호출) 유지.
  - [ ] 기존 회귀 테스트(본문 비소비, 비블로킹, 예외 격리) 전부 green.

### Task 2: network-recorder 기본값 false + 가드 연결
- **변경 대상**: `src/content/network-recorder.ts`
- **작업 내용**: `let recording = true;`(:68) → `false`. `createPatchedFetch(originalFetch, recordHook)`(:329) → `createPatchedFetch(originalFetch, recordHook, () => recording)`.
- **검증**:
  - [ ] 주입 직후 `recording`이 `false`이고, fetch/XHR/sendBeacon이 원본 경로로 통과(수동: AWS 콘솔에서 패널 미오픈 상태로 정상 동작).
  - [ ] `setSentinel` 수신 후 `recording=true`로 전환되어 캡처 시작.

### Task 3: console/action recorder 기본값 false
- **변경 대상**: `src/content/console-recorder.ts`(:28), `src/content/action-recorder.ts`(:39)
- **작업 내용**: 두 파일의 `let recording = true;` → `false`. 선행 조건에서 push 게이트가 없다고 확인되면 push 진입부 가드도 추가.
- **검증**:
  - [ ] 패널 미오픈 탭에서 `console.*` 호출·DOM 클릭이 버퍼에 쌓이지 않는다.
  - [ ] 패널 오픈(activate) 후 정상 캡처.

### Task 4: 패널 닫힘/탭전환 stop 신호 (background)
- **변경 대상**: `src/background/index.ts`
- **작업 내용**: `port.onDisconnect`(:86-89)에 `networkRecorder.stop`·`consoleRecorder.stop`·`actionRecorder.stop` 세 `chrome.tabs.sendMessage(tabId, …)` 추가(각 `.catch(() => {})`).
- **검증**:
  - [ ] 패널을 닫으면 해당 탭의 세 레코더 `recording`이 `false`로 전환(수동: 닫은 뒤 그 탭에서 트래픽이 더 이상 캡처되지 않음).
  - [ ] 첨부된 `pending:${tabId}` 로그는 유지됨(IndexedDB 불변).

### Task 5: 탭 전환 동작 수동 검증 + 필요 시 보완
- **변경 대상**: (검증 우선, 결과에 따라) `src/background/tab-bindings.ts` 또는 `src/background/index.ts`
- **작업 내용**: 패널을 연 상태에서 다른 탭으로 전환 시 이전 탭의 `recording`이 `false`가 되는지 확인. 탭 전환으로 패널 문서가 destroy되어 `port.onDisconnect`가 발화하면 추가 작업 불필요. 발화하지 않으면 `chrome.tabs.onActivated`에서 직전 활성 탭에 stop을 보내는 보완을 추가.
- **검증**:
  - [ ] 탭 A에서 패널 오픈 → 탭 B로 전환 → 탭 A에서 트래픽 발생 시 캡처되지 않음.
  - [ ] 탭 A로 복귀 시 다시 캡처 시작.

## 테스트 계획

- **단위 테스트** (`src/content/__tests__/network-recorder.test.ts`, Vitest):
  - `createPatchedFetch`에 `shouldRecord: () => false` 전달 시 — originalFetch가 원본 input/init 수신, `new Request` 미호출(Request 객체가 아닌 원본 인자 전달 확인).
  - `shouldRecord: () => true` 시 기존 동작 유지(req 전송).
- **수동 테스트** (Chrome, dev 빌드 로드 언팩):
  - [ ] 패널 미오픈 상태에서 AWS 콘솔 로그인·리전 선택·권한 작업 정상.
  - [ ] 패널 오픈 후 network/console/action 로그 수집 정상.
  - [ ] 패널 닫기 → 해당 탭 트래픽 미캡처.
  - [ ] 탭 전환 → 이전 탭 미캡처, 복귀 시 재개.
  - [ ] 같은 탭 내 페이지 이동 시 cross-page 누적 정상(기존 동작 회귀 없음).
  - [ ] 30s Replay 정상(게이팅 무관 확인).

## 구현 순서 권장

1. **Task 1 → Task 2** (fetch 가드 인프라 후 network 연결, 단위 테스트와 함께). 순차.
2. **Task 3**, **Task 4**는 Task 1과 독립 — 병렬 가능.
3. **Task 5**는 Task 2·3·4 완료 후 통합 수동 검증.

## 가이드 영향

- `guide/ko`·`guide/en`의 로그 관련 페이지(네트워크/콘솔 로그 수집 설명) — "로그는 사이드패널을 연 시점부터 수집된다"는 동작을 반영해야 한다(소급 캡처 안 됨). 안내 UI는 추가하지 않으므로 가이드 본문에서만 명시.
  - 대상 후보: `guide/ko`·`guide/en`의 logs/디버그 캡처 섹션(정확한 파일은 `guide/AUTHORING.md` IA 대조 후 `/guide`로 확정).
- 구현·검증 완료 후 `/guide`로 ko·en 동시 갱신.
