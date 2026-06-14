# 페이지 console.error/warn 캡처 — 구현 태스크

## 선행 조건

- 권한·env·manifest 변경 없음(확인 완료).
- 데이터 타입·뷰어 변경 없음(`ConsoleLevel`에 error/warn, `ConsoleEntry.stack?` 존재; Console 로그 탭이 error/warn 렌더).
- 변경 파일은 `src/content/console-recorder.ts`, `src/content/console-recorder-helpers.ts` 둘뿐.

## 태스크

### Task 1: 순수 헬퍼 + 단위 테스트 (test-first)
- **변경 대상**: `src/content/console-recorder-helpers.ts`, `src/content/__tests__/console-recorder-helpers.test.ts`
- **작업 내용**: 라이프사이클(install/restore)까지 순수 함수로 추출해 IIFE import 불가 문제를 우회하고 멱등·복원을 단위로 검증한다.
  - `makeConsoleWrapper(native, level, record)`: 반환 함수 호출 시 `native(...args)`를 **먼저** 동기 호출하고, 그 다음 `record(level, args)`를 **`try/catch`로 격리**해 호출(record throw가 호출자로 전파 금지).
  - `shouldRestoreWrapper(current, ours)`: `current === ours` 반환.
  - `installConsoleWrap(target, wrappers, state)`: `state.installed`면 no-op, 아니면 `target.error/warn`에 wrappers 할당 + `state.installed = true`.
  - `restoreConsoleWrap(target, wrappers, natives, state)`: 메서드별 `shouldRestoreWrapper(target.x, wrappers.x)` true일 때만 natives로 복원, 그 후 `state.installed = false`.
  - 테스트를 먼저 작성:
    - `makeConsoleWrapper`: native가 받은 인자 그대로 동기 호출 / record가 `(level, args)`로 1회 / native가 record보다 먼저 / **record가 throw해도 native는 호출됐고 wrapper 호출자에게 전파 안 됨**
    - `shouldRestoreWrapper`: 동일 참조 true, 다른 함수 false
    - `installConsoleWrap`: 미설치 시 wrappers 할당+가드 true / **이미 installed면 no-op(멱등) — 재할당 안 함**
    - `restoreConsoleWrap`: 우리 wrapper면 natives 복원+가드 false / **페이지가 덧씌운 경우(현재≠우리 wrapper) 복원 스킵·보존, 가드만 false** / 한 메서드만 덧씌워진 혼합 케이스
- **검증**:
  - [ ] `pnpm test` — 신규 테스트 통과
  - [ ] `pnpm typecheck` 통과

### Task 2: console-recorder에 error/warn arm-스코프 wrap 결선
- **변경 대상**: `src/content/console-recorder.ts`
- **작업 내용**:
  - IIFE 상단(기존 `LEVELS_TO_WRAP` wrap보다 먼저)에서 `natives = { error, warn }`을 `.bind(console)`로 캡처.
  - `record: RecordFn = (level, args) => pushEntry(level, serializeArgs(args), captureStack(level))` 정의 — `captureStack`은 wrapper 경로 깊이에 맞게 **slice 보정**(고정 `slice(4)`가 페이지 첫 프레임을 자르지 않도록 실측 고정).
  - `wrappers = { error, warn }`를 `makeConsoleWrapper`로 생성, `ewState = { installed: false }`.
  - `setSentinel()`의 `recording = true` 직후 `installConsoleWrap(console, wrappers, ewState)` 호출.
  - `stopHandler`의 `recording = false` 직후 `restoreConsoleWrap(console, wrappers, natives, ewState)` 호출.
  - `LEVELS_TO_WRAP` 위 기존 주석을 새 동작(arm 구간 한정 wrap + 오염 수용, 복원 안전성)으로 갱신하되, **이전 미wrap이 버그가 아니라 의도적 회피였고 이번에 트레이드오프 수용으로 번복**함을 명시(PRD 트레이드오프 한 줄 참조).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `LEVELS_TO_WRAP`(log/info/debug)는 변경 없음 — 기존 캡처 회귀 없음(코드 diff 확인)
  - [ ] uncaught/rejection/assert 핸들러 변경 없음(코드 diff 확인)
  - [ ] **모든 disarm 경로(`port.onDisconnect`·탭 전환·미지원 이동·idle)가 `stopHandler`→`restoreConsoleWrap`에 도달**함을 picker-control stop 흐름과 교차해 확인 — 누락 경로가 있으면 오염이 arm 종료 후 잔존
  - [ ] `stopHandler`에 restore 추가가 기존 `recording=false; throttle.flushNow()` 순서·동작과 충돌 없음(동작 확인)

### Task 3: e2e 시나리오 검증
- **변경 대상**: `e2e/` (스펙은 `/e2e-write`에서 작성) — src 변경은 필요 시 `data-testid`/`data-level` 추가만
- **작업 내용**: arm 상태에서 페이지가 `console.error`/`console.warn`을 호출하면 콘솔 로그에 해당 레벨 엔트리가 잡히는지 자동 판정. iframe·기존 캡처 회귀까지 커버.
  - top frame: `console.error('E2E_ERR')` → error 엔트리 / `console.warn('E2E_WARN')` → warn 엔트리.
  - iframe(기존 `logs-iframe.spec.ts` 패턴 재사용): iframe 내 `console.error`도 캡처되는지 1케이스.
  - 레벨 단언 견고화를 위해 콘솔 엔트리 div에 `data-level={level}` 추가(src 변경 허용 범위 = testid/속성 부착) → 탭 필터 의존 없이 속성으로 단언.
- **검증**:
  - [ ] `/e2e-write`로 spec green
  - [ ] iframe error/warn 캡처 spec green
  - [ ] 기존 콘솔 회귀 spec green — 구체 목록 명시: `log-capture.spec.ts`(log 캡처+clear), `logs-iframe.spec.ts`, assert→error push 경로, uncaught/rejection 캡처

## 테스트 계획

- **단위 테스트**(`console-recorder-helpers.test.ts`):
  - `makeConsoleWrapper`: native 동기 선호출 / record 위임 / 호출 순서 / 인자 보존 / **record throw 무간섭(전파 안 됨)**
  - `shouldRestoreWrapper`: 동일 참조만 true
  - `installConsoleWrap`: 설치 / **멱등(이미 installed면 no-op)**
  - `restoreConsoleWrap`: 우리 wrapper 복원 / **페이지 덧씌움 시 복원 스킵·보존** / 혼합 케이스
  - (직렬화는 기존 `serializeArgs`/`safeStringify` 테스트가 커버 — 신규 불필요)
- **e2e 시나리오**(`/e2e-write` 입력):
  - "사이드패널이 arm된 상태에서 테스트 페이지의 버튼을 클릭해 `console.error('E2E_ERR')`를 호출하면, 콘솔 로그 탭에 `data-level=error` 이고 텍스트에 `E2E_ERR`를 포함한 엔트리가 1개 나타난다."
  - "같은 방식으로 `console.warn('E2E_WARN')` 호출 시 `data-level=warn` 엔트리가 나타난다."
  - "iframe 내부에서 `console.error`를 호출해도(all_frames wrap) 콘솔 로그 탭에 error 엔트리가 나타난다." (`logs-iframe.spec.ts` 패턴 재사용)
  - 회귀: 기존 `log-capture.spec.ts`/`logs-iframe.spec.ts` 및 assert→error·uncaught/rejection 캡처가 이 변경 후에도 green.
- **수동 테스트**(자동화 불가 — chrome://extensions 오염 동작 + 복원):
  - [ ] 패널 열고 supported 페이지에서 `console.error` 호출 → logs.html/콘솔 탭에 error로 잡힘 + DevTools에도 정상 출력
  - [ ] arm 중 `chrome://extensions`(개발자 모드) → Bugshot 카드에 페이지 error가 수집됨(오염 발생 = 의도된 수용 동작 확인)
  - [ ] 패널 닫기/미지원 페이지 이동(`stop`) 후 페이지 `console.error` 호출 → `chrome://extensions`에 더 수집 안 됨(native 복원 확인)
  - [ ] 30s 리플레이 캡처 → 캡처 직전 발생한 console.error가 logs.html에 포함됨

## 구현 순서 권장

Task 1 → Task 2 (순차, 1의 헬퍼를 2가 사용). Task 3(e2e)은 Task 2 완료 후. Task 1의 단위 테스트는 구현 전 작성(test-first).

## 가이드 영향

`guide/ko`·`guide/en`에서 "어떤 로그가 캡처되는가"를 설명하는 페이지에 두 가지를 반영한다(CDO/CPO 합의 — 인앱 마이크로카피는 추가하지 않고 가이드 한 줄로만 안내):
1. "이제 페이지의 `console.error`/`console.warn`도 캡처".
2. **오염 안내 한 줄**: "패널을 켜둔 동안(arm 구간)에는 페이지의 error/warn이 개발자 모드 `chrome://extensions`의 Bugshot 오류 로그에 함께 표시될 수 있습니다 — 확장 자체 오류가 아니라 페이지 로그입니다."

해당 페이지 존재·정확한 경로는 `guide/AUTHORING.md` 대조 후 `/guide`에서 ko·en 동시 갱신. (콘솔 캡처 설명 페이지가 없으면 신규 추가 여부를 `/guide`에서 판단.)
