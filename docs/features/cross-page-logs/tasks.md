# Cross-page 로그 누적 + Replay 30초 트림 — 구현 태스크

## 선행 조건

- 30s Replay 기능(`fa16efc`)이 dev에 머지돼 있어야 함 (이 작업이 그 위에 얹힘).
- **신규 권한 `webNavigation`** (manifest `permissions`에 추가 — onBeforeNavigate 주 경로용). env·외부 API 없음. 신규 메시지 타입 없음(기존 레코더 sentinel 패턴 재사용).
- 권한 추가로 CLAUDE.md 게이트웨이 permissions 목록 + 문서 신선도(`/push` 검사 대상) 갱신 필요.

## 태스크

### Task 1: log-merge 순수 헬퍼 + 테스트
- **변경 대상**: `src/sidepanel/lib/log-merge.ts` (신규), `src/sidepanel/lib/__tests__/log-merge.test.ts` (신규)
- **작업 내용**: `mergeLogItems`(id dedup·시간순·oldest evict cap), `trimByTime(items, getTime, lower, upper?)`(양쪽 경계 필터, upper 생략 시 하한만), `rebuildNetworkLog`/`rebuildConsoleLog`(메타 재계산 순수 함수), 상수 `NETWORK_MAX_ENTRIES=5000`/`CONSOLE_MAX_ENTRIES=2000`. 테스트 먼저 작성.
- **검증**:
  - [ ] dedup: 같은 id 재수신 시 incoming이 덮어쓰고 개수 안 늘어남
  - [ ] cross-page: 기존+신규 엔트리 모두 보존, 시간순 정렬
  - [ ] cap 초과 시 oldest 제거 / cap 정확히 경계(5000/2000)일 때 evict 안 함
  - [ ] 정렬 안정성: 같은 timestamp dedup 후 순서 보존
  - [ ] `trimByTime` 하한 경계(`>= lower`)·상한 경계(`<= upper`) 포함, 전부 범위 밖이면 빈 배열, upper 생략 시 하한만
  - [ ] `rebuild*`: 빈 incoming, warnings union, totalSeen=max, captured ≤ totalSeen 불변
  - [ ] `pnpm test log-merge` 통과

### Task 2: usePickerMessages 머지 전환 + 프리즈 가드
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`
- **작업 내용**: `networkRecorder.data`/`consoleRecorder.data` 핸들러를 교체→머지로. `mergeLogItems` + `rebuildNetworkLog`/`rebuildConsoleLog`(Task 1 헬퍼)로 메타 재계산. 기존 로그 id 재사용. `phase ∈ {drafting,previewing,done}`이면 머지 스킵. `isLogFrozen(phase)` 헬퍼 추가. **메타 재계산 로직은 핸들러에 인라인하지 말고 log-merge.ts 순수 함수로(테스트 우선).**
- **검증**:
  - [ ] 연속 sync 시 누적기가 합쳐짐(교체 아님) — 콘솔에서 `captured` 증가 확인
  - [ ] drafting 단계에서 sync 와도 첨부 로그 불변
  - [ ] `captured ≤ totalSeen` 유지(페이지 경계에서 역전 없음)
  - [ ] `pnpm typecheck` 통과

### Task 3: 떠난 페이지 꼬리 보존 (onBeforeNavigate 주 + pagehide 보조)
- **변경 대상**: `manifest.config.ts`(권한), `src/background/index.ts`(onBeforeNavigate), `src/content/network-recorder.ts`, `src/content/console-recorder.ts`(pagehide)
- **작업 내용**:
  - `manifest.config.ts` `permissions`에 `"webNavigation"` 추가.
  - `src/background/index.ts`: `chrome.webNavigation.onBeforeNavigate`(frameId===0) 핸들러 — 떠나는 탭에 즉시 sync 트리거(주 경로).
  - 각 레코더 스크립트 말미(SET_SENTINEL 리스너 근처)에 `window.addEventListener("pagehide", () => dispatch())` 추가(보조).
- **검증**:
  - [ ] (SPA·MAIN 유지, 보장) SPA 라우팅에선 MAIN 유지로 자연 누적
  - [ ] (풀 네비게이션, best-effort) A에서 요청 발생 → B로 이동 → 누적 로그에 A 요청 존재 — **onBeforeNavigate sync가 도달한 경우**. unload race로 일부 누락 가능함을 인지(100% 보장 항목 아님).
  - [ ] `dispatch()`가 sentinel 없을 때 no-op 확인(가드 불필요)
  - [ ] webNavigation 권한 추가 후 확장 reload·정상 동작 확인

### Task 4: useBackgroundRecorder 네비게이션 리셋 제거
- **변경 대상**: `src/sidepanel/hooks/useBackgroundRecorder.ts`
- **작업 내용**: `onTabUpdated`의 page key 변경 시 로그 리셋 블록(store null + pending 삭제 + MAIN clear) 제거. `recordersStopped.current = false` + 재주입은 유지. 이슈 완료 idle 복귀 세션 경계 리셋(123-132)과 recording 억제 블록은 그대로.
- **검증**:
  - [ ] idle 표준대기 중 A→B 이동해도 누적기 유지(리셋 안 됨)
  - [ ] 이슈 제출/취소 후 idle 복귀 시 누적기 리셋됨(세션 경계 동작)
  - [ ] `shouldPreserveBackgroundLogs` 미사용 경고 없음(세션 경계 블록에서 계속 사용)
  - [ ] 기존 `src/sidepanel/hooks/__tests__/useBackgroundRecorder.test.ts` 통과 유지(시그니처 불변)

### Task 5: editor-store 로그 보존 + Clear 액션
- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**:
  - **`startPicking`(element)**: `set((state) => ({ ...initial, networkLog/consoleLog/networkLogAttach/consoleLogAttach 보존, ... }))`로 변경(4필드).
  - **`startCapturing`(screenshot)**: 이미 `networkLog`/`consoleLog` 보존 중 → `networkLogAttach`/`consoleLogAttach` 2개 **추가 보존**.
  - **`startFreeform`(freeform)**: 4필드 보존. 진입 직전 sync가 drafting 전에 머지되도록 순서 보장(`startFreeformDraft` 진입 sync 타이밍 확인).
  - `startRecording`(video)는 변경하지 않음(`...initial` 리셋 유지).
  - 신규 액션 `clearNetworkLog(tabId)`/`clearConsoleLog(tabId)`: 해당 로그 null + `delete{Network,Console}Log(pending:tabId)` + `clear{Network,Console}Recorder(tabId)`(MAIN clear까지 store 액션 내부에서).
- **검증**:
  - [ ] element 진입 시 idle 누적 로그 + attach 토글 보존
  - [ ] screenshot 진입 시 log + attach 토글 둘 다 보존
  - [ ] freeform 진입 시 진입 직전 누적이 첨부에 반영(프리즈 전 머지)
  - [ ] video 녹화 진입 시 로그가 비워지고 녹화 구간부터 새로 쌓임
  - [ ] `clearNetworkLog`/`clearConsoleLog(tabId)` 호출 시 store null + pending 삭제 + MAIN clear

### Task 6: replay capture() 프레임 버퍼 구간 트림
- **변경 대상**: `src/sidepanel/30s-replay/use-30s-replay.ts`
- **작업 내용**: `capture()`에서 **sync를 await**(fire-and-forget 아님)해 최신 로그를 store에 반영한 뒤, `trimByTime(items, getTime, frames[0].timestamp, captureTime)`(상·하한 양쪽)으로 `networkLog`/`consoleLog`를 트림 후 `setNetworkLog`/`setConsoleLog`. 트림 **직후 즉시** `onRecordingComplete`(→drafting)로 전환해 idle 윈도우 제거.
- **검증**:
  - [ ] replay 첨부 로그의 모든 엔트리 timestamp가 `[frames[0].timestamp, captureTime]` 안
  - [ ] 버퍼가 30초 미만(예: 막 시작)일 때 로그 창도 그만큼만
  - [ ] sync await로 capture 직전 마지막 로그가 트림 대상에 반영됨
  - [ ] 트림 후 도착한 지연 sync가 첨부 로그를 다시 늘리지 않음(트림 직후 drafting 전환, 프리즈 가드)

### Task 7: Clear Log 버튼 (Console/Network 서브탭)
- **변경 대상**: `src/sidepanel/tabs/ConsoleSubTab.tsx`, `src/sidepanel/tabs/NetworkSubTab.tsx`, `src/i18n/namespaces/logs.ts`
- **작업 내용**: `PageFooter`를 `flex items-center justify-between gap-2`로, 좌측에 [Clear Log] 버튼. 디자인은 **Settings > General [Privacy Policy] 버튼과 일치** = `Button variant="outline"` + 텍스트 라벨만(아이콘 없음, **중립 색상 — destructive 안 씀**, `SettingsTab.tsx:223-228` 참조). **클릭 시 컨펌 없이 즉시 초기화.** Console 핸들러=`clearConsoleLog(tabId)`, Network 핸들러=`clearNetworkLog(tabId)`(MAIN clear는 store 액션 내부). **로그 0건 또는 tabId null이면 버튼 `disabled`.** i18n 키 `networkLog.clear`/`consoleLog.clear`(logs.ts namespace), ko "로그 지우기" / en "Clear Log" 동시.
- **검증**:
  - [ ] 버튼 모양이 Privacy Policy와 동일(outline·텍스트 only·아이콘 없음·중립 색상)
  - [ ] 클릭 즉시 초기화(다이얼로그 안 뜸)
  - [ ] 로그 0건일 때 disabled / tabId null일 때 disabled
  - [ ] Console footer Clear → 콘솔 로그만 비고 네트워크 유지(반대도)
  - [ ] Clear 후 새 요청만 다시 쌓임(MAIN까지 비워짐)
  - [ ] mp4 프레임 버퍼는 영향 없음
  - [ ] ko/en 라벨 대칭, footer 레이아웃 깨짐 없음(가장 긴 ko/en 조합 실측)

## 테스트 계획

- **단위 테스트(Vitest)**: `log-merge.test.ts` — dedup/누적/cap 경계/트림 상·하한 경계/rebuild 메타(warnings union·totalSeen max·captured≤totalSeen). (Task 1)
- **기존 테스트 유지**: `useBackgroundRecorder.test.ts` 통과(Task 4).
- **수동 테스트(Chrome)**:
  - [ ] A에서 요청·로그 발생 → B 이동 → C 이동 → replay 캡처: 첨부 로그가 mp4 구간(직전 프레임 버퍼)과 일치, A 후반 로그 포함(onBeforeNavigate 도달 시), 상·하한 모두 범위 내
  - [ ] 같은 시나리오로 screenshot 캡처: cross-page 누적 전체 첨부 + attach 토글 보존
  - [ ] element/freeform 캡처: 누적 보존 + freeform 진입 직전 누적 반영
  - [ ] video 녹화: 시작 전 로그 무시, 녹화 중 발생분만 첨부
  - [ ] 로그 탭 Clear Log: 해당 로그만 0으로, 0건이면 disabled, 이후 재누적
  - [ ] 이슈 제출/취소 후 새 세션: 이전 세션 로그 안 물려받음(세션 경계 리셋)
  - [ ] SPA 사이트(예: GitHub) 라우팅 가로질러 누적 정상(MAIN 유지)
  - [ ] 풀 네비게이션(주소창 이동): onBeforeNavigate로 떠난 페이지 꼬리 보존(best-effort)

## 구현 순서 권장

1. **Task 1**(헬퍼·테스트) — 독립, 먼저.
2. **Task 2, 3, 4, 5**는 Task 1 이후 병렬 가능(서로 다른 파일). 단 통합 동작 확인은 4개가 다 들어와야 의미 있음. Task 3는 권한 추가 포함이라 확장 reload 필요.
3. **Task 6**(replay 트림) — Task 1·2 의존.
4. **Task 7**(Clear UI) — Task 5(clear 액션) 의존.
5. 마지막에 수동 회귀(특히 video·screenshot·element 모드 전환, 보존 변경의 잔상 회귀, freeform 진입 스냅샷, onBeforeNavigate best-effort).
