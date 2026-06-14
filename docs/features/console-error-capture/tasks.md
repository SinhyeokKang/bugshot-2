# 페이지 console.error/warn 캡처 — 구현 태스크

## 선행 조건

- 권한·env·manifest 변경 없음(확인 완료).
- 데이터 타입·뷰어 변경 없음(`ConsoleLevel`에 error/warn, `ConsoleEntry.stack?` 존재; Console 로그 탭이 error/warn 렌더).
- 변경 파일은 `src/content/console-recorder.ts`, `src/content/console-recorder-helpers.ts` 둘뿐.

## 태스크

### Task 1: 순수 헬퍼 + 단위 테스트 (test-first)
- **변경 대상**: `src/content/console-recorder-helpers.ts`, `src/content/__tests__/console-recorder-helpers.test.ts`
- **작업 내용**:
  - `makeConsoleWrapper(native, level, record)` 추가: 반환된 함수 호출 시 `native(...args)`를 먼저 동기 호출하고, 그 다음 `record(level, args)`를 호출.
  - `shouldRestoreWrapper(current, ours)` 추가: `current === ours` 반환.
  - 테스트를 먼저 작성:
    - wrapper 호출 시 native가 받은 인자 그대로 동기 호출됨
    - wrapper 호출 시 record가 `(level, args)`로 1회 호출됨
    - native 호출 순서가 record보다 먼저
    - `shouldRestoreWrapper`: 동일 참조 true, 다른 함수 false
- **검증**:
  - [ ] `pnpm test` — 신규 테스트 통과
  - [ ] `pnpm typecheck` 통과

### Task 2: console-recorder에 error/warn arm-스코프 wrap 결선
- **변경 대상**: `src/content/console-recorder.ts`
- **작업 내용**:
  - IIFE 상단(기존 `LEVELS_TO_WRAP` wrap보다 먼저)에서 `nativeError`/`nativeWarn`을 `.bind(console)`로 캡처.
  - `record: RecordFn = (level, args) => pushEntry(level, serializeArgs(args), captureStack())` 정의.
  - `errorWrapper`/`warnWrapper`를 `makeConsoleWrapper`로 생성, `errorWarnInstalled` 가드 추가.
  - `installErrorWarnWrap()`(가드 멱등) / `restoreErrorWarnWrap()`(`shouldRestoreWrapper` 판정) 추가.
  - `setSentinel()`의 `recording = true` 직후 `installErrorWarnWrap()` 호출.
  - `stopHandler`의 `recording = false` 직후 `restoreErrorWarnWrap()` 호출.
  - `LEVELS_TO_WRAP` 위 기존 주석을 새 동작(arm 구간 한정 wrap + 오염 수용, 복원 안전성)으로 갱신.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `LEVELS_TO_WRAP`(log/info/debug)는 변경 없음 — 기존 캡처 회귀 없음(코드 diff 확인)
  - [ ] uncaught/rejection/assert 핸들러 변경 없음(코드 diff 확인)

### Task 3: e2e 시나리오 검증
- **변경 대상**: `e2e/` (스펙은 `/e2e-write`에서 작성) — src 변경은 필요 시 `data-testid` 추가만
- **작업 내용**: arm 상태에서 페이지가 `console.error`/`console.warn`을 호출하면 콘솔 로그에 해당 레벨 엔트리가 잡히는지 자동 판정.
- **검증**:
  - [ ] `/e2e-write`로 spec green
  - [ ] 기존 콘솔 e2e(있으면) 회귀 없음

## 테스트 계획

- **단위 테스트**(`console-recorder-helpers.test.ts`):
  - `makeConsoleWrapper`: native 동기 선호출 / record 위임 / 호출 순서 / 인자 보존
  - `shouldRestoreWrapper`: 동일 참조만 true
  - (직렬화는 기존 `serializeArgs`/`safeStringify` 테스트가 커버 — 신규 불필요)
- **e2e 시나리오**(`/e2e-write` 입력):
  - "사이드패널이 arm된 상태에서 테스트 페이지의 버튼을 클릭해 `console.error('E2E_ERR')`를 호출하면, 콘솔 로그 탭에 level=error 이고 텍스트에 `E2E_ERR`를 포함한 엔트리가 1개 나타난다."
  - "같은 방식으로 `console.warn('E2E_WARN')` 호출 시 level=warn 엔트리가 나타난다."
- **수동 테스트**(자동화 불가 — chrome://extensions 오염 동작 + 복원):
  - [ ] 패널 열고 supported 페이지에서 `console.error` 호출 → logs.html/콘솔 탭에 error로 잡힘 + DevTools에도 정상 출력
  - [ ] arm 중 `chrome://extensions`(개발자 모드) → Bugshot 카드에 페이지 error가 수집됨(오염 발생 = 의도된 수용 동작 확인)
  - [ ] 패널 닫기/미지원 페이지 이동(`stop`) 후 페이지 `console.error` 호출 → `chrome://extensions`에 더 수집 안 됨(native 복원 확인)
  - [ ] 30s 리플레이 캡처 → 캡처 직전 발생한 console.error가 logs.html에 포함됨

## 구현 순서 권장

Task 1 → Task 2 (순차, 1의 헬퍼를 2가 사용). Task 3(e2e)은 Task 2 완료 후. Task 1의 단위 테스트는 구현 전 작성(test-first).

## 가이드 영향

`guide/ko`·`guide/en`에서 "어떤 로그가 캡처되는가"를 설명하는 페이지가 있으면 "이제 페이지의 `console.error`/`console.warn`도 캡처"를 반영해야 한다. 해당 페이지 존재·정확한 경로는 `guide/AUTHORING.md` 대조 후 `/guide`에서 ko·en 동시 갱신. (콘솔 캡처 설명 페이지가 없으면 "없음".)
