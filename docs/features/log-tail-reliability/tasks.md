# 로그 꼬리 유실 보강 — 구현 태스크

## 선행 조건

- 권한·env 추가 없음.
- [iframe-log-coverage](../iframe-log-coverage/)와 변경 파일이 겹치지 않음(이 과제는 레코더 내부 + 수신부, iframe은 manifest + 브리지). 순서 무관하나 병행/선행 권장.
- 수동 재현 측정 기준선 확보: 보강 전 "cross-origin 링크 직전 `for(50) console.log` 후 즉시 네비" 시 도착 로그 개수를 먼저 기록.

## 태스크

### Task 1: `log-throttle.ts` 유틸 + 단위테스트 (테스트 우선)
- **변경 대상**: `src/content/log-throttle.ts`(신규), `src/content/__tests__/log-throttle.test.ts`(신규)
- **작업 내용**: `createTrailingThrottle(flush, intervalMs, scheduleTimer?, clearTimer?)` 구현. `schedule()`(pending이면 무시, 아니면 interval 후 flush 1회 예약), `flushNow()`(예약 취소 + 즉시 flush), `cancel()`(예약만 취소). 타이머는 주입 가능(테스트용 fake timer).
- **검증**:
  - [ ] 연속 `schedule()` N회 → interval 동안 flush 1회만 (throttle 보장)
  - [ ] interval 경과 후 다시 `schedule()` → 다음 flush 예약됨
  - [ ] `flushNow()` → 즉시 flush + 대기 예약 취소
  - [ ] `cancel()` → flush 없이 예약만 취소
  - [ ] `pnpm test` 통과

### Task 2: console-recorder에 throttle flush 연결
- **변경 대상**: `src/content/console-recorder.ts`
- **작업 내용**: `createTrailingThrottle(dispatch, FLUSH_INTERVAL_MS)` 생성. `pushEntry` 끝에 `throttle.schedule()`. `stopHandler`/`syncHandler`를 `throttle.flushNow()` 경유로, `clearHandler`에 `throttle.cancel()` 추가. `pagehide`를 `flushNow()`로 교체. `visibilitychange(hidden)` 핸들러 신규 추가.
- **검증**:
  - [ ] 녹화 중 console.log 발생 시 ~200ms 내 사이드패널에 누적(수동)
  - [ ] stop/sync 시 즉시 flush, clear 시 예약 취소 동작
  - [ ] 비녹화(`recording=false`) 시 throttle 미동작(상시비용 0)
  - [ ] `pnpm typecheck` 통과

### Task 3: network-recorder에 throttle flush 연결
- **변경 대상**: `src/content/network-recorder.ts`
- **작업 내용**: Task 2와 동일 패턴. pending push 지점과 응답 갱신(complete/error) 지점 모두에서 `throttle.schedule()`(in-flight 상태 실시간 반영). pagehide/visibilitychange/stop/sync/clear 동일 적용.
- **검증**:
  - [ ] fetch/XHR 발생 시 pending→complete 전이가 ~200ms 내 사이드패널 반영(수동)
  - [ ] 같은 요청이 dedup으로 최신본 유지(중복 행 없음)

### Task 4: action-recorder에 throttle flush 연결
- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**: Task 2와 동일 패턴 적용.
- **검증**:
  - [ ] 클릭/네비 action이 실시간 누적
  - [ ] 기존 action 기록 동작 회귀 없음

### Task 5: 수신부 IndexedDB write 가드
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`
- **작업 내용**: `*.data` 수신 시 store `set*Log`는 매번(메모리), `saveNetworkLog/saveConsoleLog/saveActionLog`(IndexedDB)는 throttle(~1s trailing) 또는 idle 지연으로 감싼다. 단 `stop`/제출 등 확정 시점에는 즉시 최종 save 보장(마지막 상태 누락 방지).
- **검증**:
  - [ ] 로그 폭주 중 IndexedDB write가 초당 1회 수준으로 제한됨(과부하 없음)
  - [ ] 세션 재진입 시 마지막 로그 상태 복원됨(최종 save 보장)
  - [ ] store(메모리) 표시는 지연 없이 실시간

### Task 6: 회귀 + 수동 재현 측정
- **변경 대상**: 코드 변경 없음(검증 전용)
- **검증**:
  - [ ] "for(50) console.log 직후 cross-origin 네비" 도착 개수: 보강 후 ≫ 보강 전(기준선 대비)
  - [ ] 로그 폭주 중 누적이 200ms 주기로 진행(디바운스 아님 확인)
  - [ ] 30s replay trim에 실시간 누적 로그가 정상 포함
  - [ ] same-origin 내부 이동·비녹화 시 기존 동작 유지

## 테스트 계획

- **단위 테스트**: `createTrailingThrottle`(Task 1) — schedule 병합/flushNow/cancel/타이머 주입. `mergeLogItems`는 기존 테스트로 dedup 커버(전체 재전송 안전성) — 추가 불필요.
- **수동 테스트**(Chrome 실탭):
  - [ ] cross-origin 링크 직전 로그 폭주 → 도착 개수 보강 전/후 비교
  - [ ] 탭 전환(visibilitychange hidden) 시 flush 동작
  - [ ] 녹화 중 풀 네비 → 새 페이지 레코더 재활성화 + 로그 연속
  - [ ] IndexedDB write 빈도(DevTools Application 탭) 과부하 없음

## 구현 순서 권장

1. **Task 1**(유틸+테스트) 선행 — 나머지가 의존.
2. **Task 2 → 3 → 4**(레코더 3종) 순차. 2를 레퍼런스로 3·4는 동형 적용(병렬 가능하나 패턴 검증 위해 2 먼저).
3. **Task 5**(write 가드)는 Task 2~4로 flush 빈도가 오른 뒤 필요 — 2~4 후.
4. **Task 6**(회귀 측정)은 마지막.

## 가이드 영향: 없음

사용자 비노출 내부 신뢰성 개선. UI·기능·플로우 변화 없음.
