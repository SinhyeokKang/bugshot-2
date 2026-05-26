# Cross-page 로그 누적 + Replay 30초 트림 — 구현 태스크

## 선행 조건

- 30s Replay 기능(`fa16efc`)이 dev에 머지돼 있어야 함 (이 작업이 그 위에 얹힘).
- 새 권한·env·외부 API 없음. 신규 메시지 타입 없음(기존 레코더 sentinel 패턴 재사용).

## 태스크

### Task 1: log-merge 순수 헬퍼 + 테스트
- **변경 대상**: `src/sidepanel/lib/log-merge.ts` (신규), `src/sidepanel/lib/__tests__/log-merge.test.ts` (신규)
- **작업 내용**: `mergeLogItems`(id dedup·시간순·oldest evict cap), `trimByTime`(cutoff 필터), 상수 `NETWORK_MAX_ENTRIES=5000`/`CONSOLE_MAX_ENTRIES=2000`. 테스트 먼저 작성.
- **검증**:
  - [ ] dedup: 같은 id 재수신 시 incoming이 덮어쓰고 개수 안 늘어남
  - [ ] cross-page: 기존+신규 엔트리 모두 보존, 시간순 정렬
  - [ ] cap 초과 시 oldest 제거
  - [ ] `trimByTime` 경계(`>= cutoff`) 포함, 빈 배열 처리
  - [ ] `pnpm test log-merge` 통과

### Task 2: usePickerMessages 머지 전환 + 프리즈 가드
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`
- **작업 내용**: `networkRecorder.data`/`consoleRecorder.data` 핸들러를 교체→머지로. 기존 로그 id 재사용, `startedAt/endedAt/captured/totalSeen/warnings` 재계산. `phase ∈ {drafting,previewing,done}`이면 머지 스킵. `isLogFrozen(phase)` 헬퍼 추가.
- **검증**:
  - [ ] 연속 sync 시 누적기가 합쳐짐(교체 아님) — 콘솔에서 `captured` 증가 확인
  - [ ] drafting 단계에서 sync 와도 첨부 로그 불변
  - [ ] `pnpm typecheck` 통과

### Task 3: 레코더 pagehide flush
- **변경 대상**: `src/content/network-recorder.ts`, `src/content/console-recorder.ts`
- **작업 내용**: 각 스크립트 말미(SET_SENTINEL 리스너 근처)에 `window.addEventListener("pagehide", () => dispatch())` 추가.
- **검증**:
  - [ ] 풀 네비게이션 직전 페이지의 요청이 누적기에 남음(수동: A에서 요청 발생 → B로 이동 → 누적 로그에 A 요청 존재)
  - [ ] SPA 라우팅에선 MAIN 유지로 자연 누적(별도 flush 불필요)

### Task 4: useBackgroundRecorder 네비게이션 리셋 제거
- **변경 대상**: `src/sidepanel/hooks/useBackgroundRecorder.ts`
- **작업 내용**: `onTabUpdated`의 page key 변경 시 로그 리셋 블록(store null + pending 삭제 + MAIN clear) 제거. `recordersStopped.current = false` + 재주입은 유지. 이슈 완료 idle 복귀 세션 경계 리셋(123-132)과 recording 억제 블록은 그대로.
- **검증**:
  - [ ] idle 표준대기 중 A→B 이동해도 누적기 유지(리셋 안 됨)
  - [ ] 이슈 제출/취소 후 idle 복귀 시 누적기 리셋됨(세션 경계 동작)
  - [ ] `shouldPreserveBackgroundLogs` 미사용 경고 없음(세션 경계 블록에서 계속 사용)

### Task 5: editor-store 로그 보존 + Clear 액션
- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**:
  - `startPicking`, `startFreeform`을 `set((state) => ({ ...initial, networkLog/consoleLog/networkLogAttach/consoleLogAttach 보존, ... }))`로 변경.
  - `startRecording`(video)는 변경하지 않음(`...initial` 리셋 유지).
  - 신규 액션 `clearNetworkLog`/`clearConsoleLog`: 해당 로그 null + `delete{Network,Console}Log(pending:tabId)`.
- **검증**:
  - [ ] element/screenshot 진입 시 idle 누적 로그가 첨부에 살아있음
  - [ ] video 녹화 진입 시 로그가 비워지고 녹화 구간부터 새로 쌓임
  - [ ] `clearNetworkLog`/`clearConsoleLog` 호출 시 store null + pending 삭제

### Task 6: replay capture() 프레임 버퍼 구간 트림
- **변경 대상**: `src/sidepanel/30s-replay/use-30s-replay.ts`
- **작업 내용**: `capture()`에서 `cutoff = frames[0].timestamp`로 `trimByTime` 적용해 `networkLog`/`consoleLog`를 트림 후 `setNetworkLog`/`setConsoleLog`. onRecordingComplete(→drafting) 전에 수행.
- **검증**:
  - [ ] replay 첨부 로그의 모든 엔트리 timestamp ≥ `frames[0].timestamp`
  - [ ] 버퍼가 30초 미만(예: 막 시작)일 때 로그 창도 그만큼만
  - [ ] 트림 후 도착한 지연 sync가 첨부 로그를 다시 늘리지 않음(프리즈 가드)

### Task 7: Clear Log 버튼 (Console/Network 서브탭)
- **변경 대상**: `src/sidepanel/tabs/ConsoleSubTab.tsx`, `src/sidepanel/tabs/NetworkSubTab.tsx`, i18n(`src/i18n/namespaces/issue.ts` 또는 적절 namespace)
- **작업 내용**: `PageFooter`를 `flex justify-between`으로, 좌측에 `Button variant="outline"` + lucide `Trash2` + i18n 라벨. Console 핸들러=`clearConsoleLog()`+`clearConsoleRecorder(tabId)`, Network 핸들러=`clearNetworkLog()`+`clearNetworkRecorder(tabId)`. i18n 키 ko/en 동시.
- **검증**:
  - [ ] Console footer Clear → 콘솔 로그만 비고 네트워크 유지(반대도)
  - [ ] Clear 후 새 요청만 다시 쌓임(MAIN까지 비워짐)
  - [ ] mp4 프레임 버퍼는 영향 없음
  - [ ] ko/en 라벨 대칭, footer 레이아웃 깨짐 없음

## 테스트 계획

- **단위 테스트(Vitest)**: `log-merge.test.ts` — dedup/누적/cap/트림 경계. (Task 1)
- **수동 테스트(Chrome)**:
  - [ ] A에서 요청·로그 발생 → B 이동 → C 이동 → replay 캡처: 첨부 로그가 mp4 구간(직전 프레임 버퍼)과 일치, A 후반 로그 포함
  - [ ] 같은 시나리오로 screenshot 캡처: cross-page 누적 전체 첨부
  - [ ] video 녹화: 시작 전 로그 무시, 녹화 중 발생분만 첨부
  - [ ] 로그 탭 Clear Log: 해당 로그만 0으로, 이후 재누적
  - [ ] 이슈 제출 후 새 세션: 이전 세션 로그 안 물려받음
  - [ ] SPA 사이트(예: GitHub) 라우팅 가로질러 누적 정상

## 구현 순서 권장

1. **Task 1**(헬퍼·테스트) — 독립, 먼저.
2. **Task 2, 3, 4, 5**는 Task 1 이후 병렬 가능(서로 다른 파일). 단 통합 동작 확인은 4개가 다 들어와야 의미 있음.
3. **Task 6**(replay 트림) — Task 1·2 의존.
4. **Task 7**(Clear UI) — Task 5(clear 액션) 의존.
5. 마지막에 수동 회귀(특히 video·screenshot 모드 전환, `startPicking` 보존 변경의 잔상 회귀).
