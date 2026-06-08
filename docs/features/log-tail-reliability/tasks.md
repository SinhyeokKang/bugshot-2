# 로그 꼬리 유실 보강 — 구현 태스크

## 선행 조건

- 권한·env 추가 없음.
- [iframe-log-coverage](../iframe-log-coverage/)와 변경 파일이 겹치지 않음(이 과제는 레코더 내부 + 수신부, iframe은 manifest + 브리지). 순서 무관하나 병행/선행 권장.
- 수동 재현 측정 기준선 확보: 보강 전 빌드에서 "cross-origin 링크 직전 `for(50) console.log` 후 즉시 네비"를 **동일 페이지·동일 네비 타겟으로 5회 반복**해 도착 로그 개수 중앙값을 기록(unload race라 시도 편차가 커 1회 측정은 불충분).

## 태스크

### Task 1: `log-throttle.ts` 유틸 + 단위테스트 (테스트 우선)
- **변경 대상**: `src/content/log-throttle.ts`(신규), `src/content/__tests__/log-throttle.test.ts`(신규)
- **작업 내용**: `createTrailingThrottle(flush, intervalMs, scheduleTimer?, clearTimer?)` 구현. `schedule()`(pending이면 무시, 아니면 interval 후 flush 1회 예약), `flushNow()`(예약 취소 + 즉시 flush), `cancel()`(예약만 취소). 타이머는 주입 가능(테스트용 fake timer).
- **검증**:
  - [ ] 연속 `schedule()` N회 → interval 동안 flush 1회만 (throttle 보장)
  - [ ] interval 경과 후 다시 `schedule()` → 다음 flush 예약됨
  - [ ] `flushNow()` → 즉시 flush + 대기 예약 취소
  - [ ] `cancel()` → flush 없이 예약만 취소
  - [ ] `flushNow()` 후 다시 `schedule()` → 정상 재예약(상태 리셋)
  - [ ] `cancel()` 후 `flushNow()` → flush 1회 발생
  - [ ] pending 중 `cancel()` → 이후 `schedule()` 재예약됨
  - [ ] flush 콜백이 throw해도 타이머 상태 오염 없음(다음 schedule 정상)
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
- **작업 내용**: Task 2와 패턴 동일이되 **schedule 삽입 지점이 다름**. network의 `pushEntry`에는 `recording` 가드가 없으므로(가드는 호출처에 있음) **recording 게이트를 통과한 pending push 지점(`recordHook`/XHR `send`/`sendBeacon`)에서만** `throttle.schedule()`을 건다. 응답 갱신(complete/error in-place)에는 schedule을 걸지 않는다 — 갱신본은 다음 trailing 주기(≤200ms)·sync·pagehide에 전체 버퍼로 나가고 dedup이 최신본으로 흡수(complete 반영 최대 200ms 지연, 무손실). pagehide/visibilitychange/stop/sync/clear 동일 적용.
- **검증**:
  - [ ] fetch/XHR 발생 시 pending→complete 전이가 ~200ms 내 사이드패널 반영(수동)
  - [ ] 같은 요청이 dedup으로 최신본 유지(중복 행 없음)
  - [ ] 비녹화(`recording=false`) 시 network throttle 미동작(pending push가 게이트 뒤라 schedule 자체가 안 걸림)

### Task 4: action-recorder에 throttle flush 연결
- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**: Task 2와 동일 패턴 적용.
- **검증**:
  - [ ] 클릭/네비 action이 실시간 누적
  - [ ] 기존 action 기록 동작 회귀 없음

### Task 5: 수신부 IndexedDB write 가드
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`(+ write 가드 순수 유틸 분리)
- **작업 내용**:
  - `*.data` 수신 시 store `set*Log`는 매번(메모리), `saveNetworkLog/saveConsoleLog/saveActionLog`(IndexedDB)는 trailing throttle(`LOG_PERSIST_INTERVAL_MS≈1000`)로 감싼다. 가드 로직은 레코더의 `createTrailingThrottle`와 동형/재사용인 타이머 주입형 순수 유틸로 분리해 단위테스트(테스트 우선).
  - **확정 시점 flush**: freeze는 `stop` 메시지가 아니라 store phase 전이(`isLogFrozen`)로 일어나므로, **phase가 frozen으로 전이되는 시점(store subscribe)에 pending save를 `flushNow`**로 강제한다. (수신부는 freeze 후 `*.data`를 가드로 drop하므로 이 트리거가 없으면 마지막 write가 throttle에 갇힘.)
  - **30s replay trim 분리**: `save*Log`는 `use-30s-replay.ts` trim 경로에서도 직접 호출된다. 가드는 수신부에만 두고 trim 경로 save는 우회(즉시) 유지하되, trim save 직전 수신부 pending write를 `cancel`/`flushNow`로 비워 trim 전 전체 버퍼가 trim 후 save를 덮어쓰지 않게 한다.
- **검증**:
  - [ ] write 가드 순수 유틸 단위테스트 통과
  - [ ] 로그 폭주 중 IndexedDB write가 초당 1회 수준으로 제한됨(과부하 없음)
  - [ ] **drafting 전환 직후** IDB에 마지막 로그 상태 반영(freeze 전이 flush)
  - [ ] 세션 재진입 시 마지막 로그 상태 복원됨
  - [ ] **30s replay 캡처 후** 세션 재진입 시 trim된(30s 윈도우 내) 로그만 복원 — trim 전 전체 버퍼 부활 없음
  - [ ] 탭 전환 반복(visibilitychange hidden) 시에도 write 초당 1회 유지
  - [ ] store(메모리) 표시는 지연 없이 실시간

### Task 6: 회귀 + 수동 재현 측정
- **변경 대상**: 코드 변경 없음(검증 전용)
- **검증**:
  - [ ] **binary 합격선**: 동일 페이지·동일 cross-origin 네비 타겟에서 "네비 직전 ~200ms 밖 로그"가 5회 반복 모두 100% 도착(기준선 대비). ~200ms 이내 꼬리 유실은 갭1 특성상 허용.
  - [ ] 로그 폭주 중 누적이 200ms 주기로 진행(디바운스 아님 확인)
  - [ ] 30s replay trim에 실시간 누적 로그가 정상 포함
  - [ ] same-origin 내부 이동·비녹화 시 기존 동작 유지

## 테스트 계획

- **단위 테스트**: `createTrailingThrottle`(Task 1) — schedule 병합/flushNow/cancel/타이머 주입 + 상태 리셋·예외 계열 케이스(Task 1 검증 참조). 수신부 write 가드 유틸(Task 5)도 동형 단위테스트. `mergeLogItems`는 기존 테스트로 dedup 커버 — 전체 재전송 안전성 근거: 한 dispatch엔 항상 같은 entry의 최신 phase만 담겨(전체 버퍼 재전송) stale pending이 complete를 역전 덮어쓸 수 없으므로 추가 테스트 불필요.
- **수동 테스트**(Chrome 실탭):
  - [ ] cross-origin 링크 직전 로그 폭주 → 도착 개수 보강 전/후 비교(5회)
  - [ ] 탭 전환(visibilitychange hidden) 시 flush 동작 + 반복 시 write 폭증 없음
  - [ ] 녹화 중 풀 네비 → 새 페이지 레코더 재활성화 + 로그 연속
  - [ ] IndexedDB write 빈도(DevTools Application 탭) 과부하 없음
  - [ ] `clear`(navigation-clear) 직후 들어온 entry의 schedule이 비워진 버퍼를 잘못 dispatch하지 않음(`lastLogClearAt` 필터와 타이밍 겹침 확인)
  - [ ] 30s replay 캡처 후 재진입 시 trim 경계 밖 로그 부활 없음

## 구현 순서 권장

1. **Task 1**(유틸+테스트) 선행 — 나머지가 의존.
2. **Task 2 → 3 → 4**(레코더 3종) 순차. 2를 레퍼런스로 3·4는 동형 적용(병렬 가능하나 패턴 검증 위해 2 먼저).
3. **Task 5**(write 가드)는 Task 2~4로 flush 빈도가 오른 뒤 필요 — 2~4 후.
4. **Task 6**(회귀 측정)은 마지막.

## 가이드 영향: 없음

사용자 비노출 내부 신뢰성 개선. UI·기능·플로우 변화 없음.
