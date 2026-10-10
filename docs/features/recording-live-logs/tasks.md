# 녹화 중 로그 확인 — 구현 태스크

## 선행 조건

- 새 권한·env·의존성·shadcn 컴포넌트 없음. `Button`·`TooltipIconButton`·`PageShell`·`PageFooter`·`formatMmSs`(`sidepanel/lib/logRow.ts`) 모두 있다.
- 새 i18n 키 **3개** × 5 로케일(ko·en·fr·es·de). 값은 design.md 표.
- 착수 전 `docs/POSTMORTEM.md`를 `recording`·`DebugTab`·`logTabsLocked`·`dark`·`tokens`·`ScrollArea`로 grep해 과거 함정을 소환한다.
- privacy·PERMISSION 영향 없음(새 캡처·전송 없음, 기존 로그 표시만). 화면 녹화에 패널이 찍히는 점은 가이드 안내로 처리한다(가이드 영향 참조).

## 태스크

### Task 1: `useRecordingElapsed` 훅 추출 (TDD)
- **변경 대상**: `src/sidepanel/hooks/useRecordingElapsed.ts`(신규), `src/sidepanel/hooks/__tests__/useRecordingElapsed.test.tsx`(신규), `src/sidepanel/tabs/IssueTab.tsx`(`RecordingState`)
- **작업 내용**: `RecordingState`의 `elapsed` state + 500ms `setInterval` effect + `videoRecorder.getMaxDuration()`을 훅으로 옮겨 `{ elapsedSec, maxSec }`를 반환한다. `getElapsedSec()`가 0을 돌려줘도 직전 값이 0보다 크면 직전 값을 유지한다(정지 처리 구간 보정). `RecordingState`는 이 훅을 쓰도록 바꾸고 렌더는 무변경. 테스트를 먼저 작성한다(`@/sidepanel/video-recorder` mock + fake timers).
- **검증**:
  - [x] 마운트 직후 `getElapsedSec()` 값이 바로 반영된다(elapsed 0이면 0)
  - [x] 500ms 진행마다 갱신된다
  - [x] 45를 반환하다가 0을 반환하면 45를 유지한다
  - [x] 언마운트 시 interval 해제
  - [x] `maxSec === getMaxDuration()`
  - (`IssueTab.test.tsx`는 `RecordingState`를 렌더하지 않으므로 이 태스크의 그물이 아니다. 렌더 무변경은 수동 확인)

### Task 2: i18n 키 추가
- **변경 대상**: `src/i18n/namespaces/issue.ts`
- **작업 내용**: `issue.recording.barLabelTab`·`issue.recording.barLabelScreen`·`issue.recording.barStop`을 5개 로케일 블록의 `issue.recording.titleScreen` 다음에 추가한다(값은 design.md 표).
- **검증**:
  - [x] PostToolUse 훅의 `locales.test.ts` green(키 대칭·빈 값 없음)

### Task 3: (삭제 — 반전 테마를 CSS 전용으로 바꾸면서 `useResolvedDark` 훅이 빠졌다. 번호는 리뷰 이력 대조용으로 비워둔다)

### Task 4: 반전 스코프 토큰 (`.theme-inverse`)
- **변경 대상**: `src/styles/globals.css`, `src/styles/__tests__/tokens.test.ts`
- **작업 내용**: 라이트 블록 셀렉터를 `.dark .theme-inverse, :root`, 다크 블록을 `:root:not(.dark) .theme-inverse, .dark`로 바꾸고 주석 한 줄을 단다(반전 스코프용이고, `parseTokens`가 `":root {"`·`".dark {"`로 찾으므로 각 리스트의 마지막 셀렉터 고정). 테스트를 먼저 작성한다 — `tokens.test.ts:62`의 로컬 `parseRule`이 셀렉터 리스트를 분해하므로 그걸로 단언한다.
- **검증**:
  - [x] 새 단언 red → 셀렉터 변경 후 green: 라이트 블록 셀렉터에 `.dark .theme-inverse`와 `:root`, 다크 블록 셀렉터에 `:root:not(.dark) .theme-inverse`와 `.dark`
  - [x] `parseTokens(GLOBALS, ":root")`·`parseTokens(GLOBALS, ".dark")`가 기존과 같은 토큰 표를 반환(순서 의존 고정)
  - [x] `tokens.test.ts`·`muted-surface-contrast.test.ts` 기존 케이스 green
  - [x] `log-viewer/styles.css`는 무변경이고 "라이트(:root) 토큰 표가 완전히 같다" green

### Task 5: `RecordingFloatingBar` 컴포넌트 (TDD)
- **변경 대상**: `src/sidepanel/components/RecordingFloatingBar.tsx`(신규), `src/sidepanel/components/__tests__/RecordingFloatingBar.test.tsx`(신규)
- **작업 내용**: design.md "인터페이스 설계"의 마크업과 `handleCancel` 그대로 만든다. `recordingSource`는 `useEditorStore`, 시간은 Task 1. 컴포넌트 상단에 반전 스코프 안 dark variant 금지 주석을 단다. 테스트를 먼저 작성한다(훅·store·video-recorder mock).
- **검증**:
  - [x] 루트에 `theme-inverse` 클래스
  - [x] source `tab` → `issue.recording.barLabelTab`, `screen` → `barLabelScreen`. region `aria-label`도 같은 값
  - [x] 시간 텍스트 `0:45`(elapsed 45), `0:00`(elapsed 0). `/ 2:00`은 없다
  - [x] `recording-bar-stop`(라벨 `barStop`) 클릭 → `stopRecording` 1회
  - [x] `recording-bar-cancel`의 `aria-label`이 `common.cancel`, 클릭 → `cancelRecording` 1회
  - [x] `role="tabpanel"`+`aria-labelledby="trig"` 래퍼와 `id="trig"` 버튼을 둔 렌더에서 취소 클릭 → `document.activeElement`가 `#trig`
  - [x] 소스 스캔: 주석을 걷어낸 본문에서 `/\bdark:[a-z]/` 매치 0건(주석의 경고 문구와 충돌하지 않게 클래스 토큰만 센다. `button.tsx`·`TooltipIconButton.tsx`도 같은 스캔 대상에 넣어 반전 스코프 자식까지 잠근다)

### Task 6: `bottomInset` prop
- **변경 대상**: `src/sidepanel/components/ConsoleLogContent.tsx`, `src/sidepanel/components/NetworkLogContent.tsx`, 각 `__tests__/*.test.tsx`(기존 파일에 케이스 추가)
- **작업 내용**: optional `bottomInset?: boolean`. 콘솔은 목록 `ScrollArea` 안쪽 `<div className="overflow-hidden">`에, 네트워크는 목록 `ScrollArea` 안쪽 `<div>`(testid `network-list-body`)와, 상세 `ScrollArea` 안 형제 `TabsContent`들을 새로 감싼 래퍼 div(testid `network-detail-body`)에 `pb-6`을 조건부로 붙인다. 기본 false.
- **검증**:
  - [x] `bottomInset` 미지정 시 기존 클래스 그대로(기존 테스트 green)
  - [x] true면 콘솔 목록 컨테이너에 `pb-6`
  - [x] true면 `network-list-body`에 `pb-6`, 요청 하나를 선택해 상세를 연 뒤 `network-detail-body`에 `pb-6`
  - [x] 래퍼 추가 후에도 상세 탭 전환(헤더·페이로드·응답 등) 기존 테스트 green

### Task 7: 서브탭 녹화 상태 (footer disabled + 바 + inset)
- **변경 대상**: `src/sidepanel/tabs/ConsoleSubTab.tsx`, `src/sidepanel/tabs/NetworkSubTab.tsx`, `src/sidepanel/tabs/__tests__/ConsoleSubTab.test.tsx`·`NetworkSubTab.test.tsx`(신규)
- **작업 내용**: `const recording = useEditorStore((s) => s.phase === "recording")`. `[Clear]`·`[이슈 작성]`의 `disabled`에 `recording`을 OR로 더한다(이슈 작성은 지금 disabled 조건이 없으니 `disabled={recording}`). [이슈 작성]에 testid(`console-write-issue`·`network-write-issue`)를 단다. `<PageShell className="relative">`, `bottomInset={recording}`, `{recording && <RecordingFloatingBar />}`를 footer 뒤에 둔다. 테스트를 먼저 작성한다(바·LogContent는 stub).
- **검증**:
  - [x] **로그 1건 이상 + `tabId` non-null인 상태에서**(0건이면 Clear는 원래 disabled라 단언이 공허하다) phase `recording` → `console-clear`/`network-clear`와 `*-write-issue` disabled, `recording-bar` 존재, LogContent stub에 `bottomInset=true`
  - [x] 같은 상태에서 phase `idle` → 두 버튼 enabled, `recording-bar` 없음, `bottomInset` false
  - [x] DOM 순서: footer가 `recording-bar`보다 앞

### Task 8: `DebugTab` 잠금 해제·폴링·서브탭 복귀
- **변경 대상**: `src/sidepanel/tabs/DebugTab.tsx`, `src/sidepanel/tabs/__tests__/DebugTab.test.tsx`
- **작업 내용**: ① `logTabsLocked = unsupported`(주석 갱신) ② `const recording = phase === "recording"`, `const pollAll = sub === "issue" || recording`. 3종 sync effect를 `if (activeMainTab !== "debug" || !pollAll || unsupported) return`으로 바꾸고 deps는 `[activeMainTab, pollAll, unsupported]` ③ `useLayoutEffect(() => { if (hideSubTabs) setSub("issue"); }, [hideSubTabs])` ④ 25-26행 주석 갱신. 테스트를 먼저 작성한다. 기존 "녹화 중이면 기존 잠금이 그대로 동작"(`DebugTab.test.tsx:82-87`) 케이스는 **활성 단언으로 뒤집는다**.
- **테스트 하네스 주의**:
  - drafting에서는 `hideSubTabs`로 트리거가 렌더되지 않아 `activeSub()`(`getByTestId`)가 throw한다. 복귀 판정은 `stub-console`이 null이고 `stub-issue`가 있는지로 한다.
  - user-event 14의 `click`은 fake timers 아래서 hang한다. `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`를 쓰거나, Radix Tabs가 mousedown에 활성화되므로 `fireEvent.mouseDown`으로 전환한다.
  - issue 서브탭 마운트 시 즉시 sync가 1회 나간다(`DebugTab.tsx:55`). 서브탭 전환 후 sync mock을 `mockClear()`한 뒤 단언한다.
- **검증**:
  - [x] phase `recording` → console/network 트리거 활성
  - [x] phase `recording` + unsupported → 여전히 disabled
  - [x] recording 중 console 서브탭에서 phase → `drafting` 재렌더 → `stub-console` null + `stub-issue` 존재. 이어서 `idle`로 재렌더 → `activeSub() === "subtab-issue"`
  - [x] recording 중 console 서브탭에서 phase → `idle` 재렌더 → console 유지
  - [x] recording 중 console 서브탭에서 `mockClear` 후 1500ms 진행 → `syncNetworkRecorder`·`syncActionRecorder` 호출됨. idle + console 서브탭에선 호출 안 됨(기존 동작)
  - [x] recording + `activeMainTab !== "debug"` → sync 0, recording + unsupported → sync 0
  - [x] issue 서브탭에서 phase가 picking → capturing으로 바뀌어도 sync가 재시작(즉시 1회 추가 호출)되지 않는다(deps 파생 불리언)

### Task 9: 문서 갱신
- **변경 대상**: `docs/DESIGN.md`, `e2e/GOTCHAS.md`, `e2e/COVERAGE.md`
- **작업 내용**: design.md "문서 갱신" 항목 그대로.
  - DESIGN §6: 반전 플로팅 바 관용구(기존 플로팅 컨트롤의 파생 — `.theme-inverse` + `shadow-lg rounded-xl`, 진행 중 세션 전용, 높이 관계 68px·inset 12px·`pb-6`, 덮이는 footer는 `disabled`).
  - DESIGN §3: 반전 스코프 안 `dark:` 금지 + 셀렉터 순서 의존.
  - DESIGN §2: 61행 "넷 다 `dark:` 짝 보유" 문장 갱신 + 녹화 red에 `RecordingFloatingBar` 추가.
  - DESIGN §8: 바 맥박 `motion-reduce:animate-none`.
  - DESIGN §14: "앱 내 유일한 `animate-pulse`" 갱신 + 진행 중 잠금 규칙에 "가려진 버튼은 `disabled`" 예외 한 줄.
  - GOTCHAS 45행 재작성(`logTabsLocked` = unsupported, `hideSubTabs` = styling/drafting/previewing/done, 녹화 중엔 열림).
  - COVERAGE: Task 10 spec 등재 + 수동 잔여 목록 갱신.
- **검증**:
  - [x] 문서 서술과 코드(클래스·값·행 번호) 일치

### Task 10: e2e — 녹화 중 로그 탭 (`/e2e-write`)
- **변경 대상**: `e2e/recording-live-logs.spec.ts`(신규)
- **작업 내용**: 패널 페이지에서 `panel.evaluate`로 `navigator.mediaDevices.getDisplayMedia`를 `canvas.captureStream()` 반환으로 stub하고(선례 `e2e/logview/fixtures.ts:62`), 녹화 방식을 화면(`recording-mode-screen` — `capture-modes-layout.spec`이 이미 조작)으로 골라 녹화를 시작해 phase=recording에 진입한다. **첫 단계는 PoC** — 진입이 안 되면 spec을 쓰지 않고 그 사실을 보고한 뒤 jsdom + 수동으로 폴백한다(design.md 위험 요소).
- **시나리오**(각각 "~하면 ~가 된다"):
  - [x] 녹화 시작 후 `subtab-console`·`subtab-network`가 enabled이고, 클릭하면 `recording-bar`가 보이며 issue 서브탭에선 `recording-bar`가 없다
  - [x] 녹화 중 `console-clear`·`console-write-issue`가 disabled다
  - [x] 콘솔 서브탭에서 `recording-bar-stop`을 누르면 트림 오버레이가 뜨고, 트림을 닫으면 active 서브탭이 issue다
  - [x] 콘솔 서브탭에서 `recording-bar-cancel`을 누르면 `recording-bar`가 사라지고 active 서브탭이 console로 유지되며 `console-clear`가 다시 enabled(로그 ≥1건 seed 후)
  - [x] stub 스트림의 video track에 `dispatchEvent(new Event("ended"))`("공유 중지" 재현)하면 트림 오버레이가 뜬다
  - [x] 앱 라이트에서 `recording-bar`의 computed `background-color` 명도가 패널 배경보다 낮고, 다크에선 높다(설정 영속 오염 방지 — `finally`로 테마 복원)
  - [x] 패널 폭 320px(`setViewportSize`)에서 ko·en·fr·es·de 각각 `recording-bar`의 `scrollWidth <= clientWidth`이고 `recording-bar-stop`의 bounding box 오른쪽 끝이 패널 폭 안(로케일 설정 영속 복원)
- **검증**:
  - [x] `pnpm build:e2e` 후 해당 spec green

## 테스트 계획

- **단위 테스트(jsdom)**: Task 1(`useRecordingElapsed`), Task 5(`RecordingFloatingBar`), Task 6(`bottomInset`), Task 7(서브탭), Task 8(`DebugTab`). node 트랙은 Task 4(`tokens.test.ts`).
- **커버리지**: 신규 훅 `.ts`는 로직 스코프라 Task 1이 커버한다. `RecordingFloatingBar.tsx`는 `.tsx`라 `isBrowserBound`가 자동 제외한다. `BROWSER_BOUND_EXACT` 등록 불필요.
- **e2e 시나리오**: Task 10. `getDisplayMedia` stub으로 화면 녹화 경로를 탄다. 탭 녹화(`tabCapture`) 실경로는 자동화가 불안정해(`e2e/capture.spec.ts` 주석) 수동 잔여다.
- **수동 테스트**(`pnpm build` 후 dist 로드 — dist가 stale이면 헛테스트):
  - [ ] **탭 녹화** 중 콘솔·네트워크 서브탭이 열리고 로그가 실시간으로 쌓인다. 콘솔 탭에 있을 때 네트워크 배지도 오른다
  - [ ] 바가 footer를 완전히 덮고 로그 영역에 11px 걸친다. 끝까지 스크롤하면 마지막 행이 바 위로 올라온다
  - [ ] `system` 모드에서 OS 테마를 바꾸면 바가 즉시 뒤집힌다
  - [ ] 바의 [✕] hover 피드백과 툴팁("취소")이 양 테마에서 보인다. Tab 키로 바 버튼에 갔을 때 포커스 링이 보이는지 확인(전역 `--ring` 저대비는 알려진 문제 — 퇴행 여부만 본다)
  - [ ] [완료] 직후 바 시간이 0:00으로 떨어지지 않고, 트림 화면으로 이동하며 서브탭 바가 숨겨진다. 다시 idle로 돌아오면 issue 서브탭
  - [ ] 키보드로 [✕] → 같은 로그 탭에 머물고 포커스가 그 서브탭 트리거에 있으며 footer 버튼이 다시 활성화된다
  - [ ] 탭 녹화 2:00 자동 종료 때도 issue 서브탭으로 이동한다
  - [ ] 네트워크 상세를 연 상태에서도 바가 상세 콘텐츠 하단을 막지 않는다(`pb-6`). 취소 후 상세 펼침이 유지되고, 완료 후 재진입하면 닫혀 있다
  - [ ] 펜을 켠 채 로그 탭으로 가도 페이지 Esc로 펜이 꺼진다(비목표 확인)
  - [ ] 바에서 [✕] 후 페이지에 picker·어노테이션 잔여물이 없다(IssueTab 언마운트 중 `clearPicker` 구독 미실행 — design.md 위험 요소)
  - [ ] 화면 녹화 중 다른 탭으로 갔다가 돌아오면 서브탭·바·로그 상태(PRD 엣지 케이스)
  - [ ] OS "동작 줄이기"를 켜면 빨간 점 맥박이 멈춘다

## 구현 순서 권장

1. Task 1·2·4·6은 서로 독립이라 병렬로 진행할 수 있다.
2. Task 5는 1·2에 의존하고, 반전 표면의 시각 확인은 4에 의존한다.
3. **Task 7과 8은 같은 배치로 묶는다.** 7은 5·6에 의존한다. 8만 먼저 들어가면 녹화 중 콘솔 탭이 열리고 [Clear]가 활성인 상태가 생긴다(PRD가 막으려는 상태).
4. Task 10(e2e)은 7·8 이후 `/e2e-write`에서 진행한다.
5. Task 9는 마지막에 한다(구현값·행 번호 확정 후).

## 가이드 영향

- `guide/ko/video/record.md`·`guide/en/video/record.md` "녹화 중" 섹션 — 녹화 중에도 콘솔·네트워크 탭에서 로그를 확인할 수 있고, 하단 바에서 [완료]·[취소]를 할 수 있다는 단락을 추가한다. **화면 녹화는 패널까지 찍히므로 녹화 중 로그 탭을 열면 로그 내용이 영상에 남는다**는 주의 한 줄을 함께 넣는다. 바 스크린샷 컷을 새로 추가할지는 `/guide-shots`에서 판단한다.
- `guide/{ko,en}/logs/README.md` — 로그 탭 접근 조건 서술이 있으면 녹화 중 조회 가능으로 맞춘다.
