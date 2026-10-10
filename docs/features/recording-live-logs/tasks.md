# 녹화 중 로그 확인 — 구현 태스크

## 선행 조건

- 새 권한·env·의존성·shadcn 컴포넌트 없음. `Button`·`PageShell`·`PageFooter`·`formatMmSs`(`sidepanel/lib/logRow.ts`)·`resolveDark`(`sidepanel/lib/resolveDark.ts`) 모두 있다.
- 새 i18n 키 **2개** × 5 로케일(ko·en·fr·es·de). 값은 design.md 표.
- 착수 전 `docs/POSTMORTEM.md`를 `recording`·`DebugTab`·`logTabsLocked`·`dark`·`tokens`·`ScrollArea`로 grep해 과거 함정을 소환한다.
- privacy·PERMISSION 영향 없음(새 캡처·전송 없음, 기존 로그 표시만).

## 태스크

### Task 1: `useResolvedDark` 훅 추출 (TDD)
- **변경 대상**: `src/sidepanel/hooks/useResolvedDark.ts`(신규), `src/sidepanel/hooks/__tests__/useResolvedDark.test.tsx`(신규), `src/sidepanel/hooks/useThemeEffect.ts`
- **작업 내용**: `useSettingsUiStore(theme)` + `matchMedia("(prefers-color-scheme: dark)")` 구독 → `resolveDark(theme, matches)` 불리언 반환. `theme === "system"`일 때만 `change` 리스너를 단다. `useThemeEffect`는 이 훅의 값으로 `document.documentElement.classList.toggle("dark", dark)`만 하도록 축소한다. 테스트를 먼저 작성한다(`matchMedia` stub).
- **검증**:
  - [ ] theme `light` → false, `dark` → true
  - [ ] theme `system` + matches true → true, `change` 이벤트로 false가 되면 리렌더 후 false
  - [ ] theme이 `system`이 아니면 matchMedia 리스너가 등록되지 않는다
  - [ ] 언마운트 시 리스너 해제
  - [ ] 기존 테마 동작 무변경(수동: 설정에서 light/dark/system 전환)

### Task 2: `useRecordingElapsed` 훅 추출 (TDD)
- **변경 대상**: `src/sidepanel/hooks/useRecordingElapsed.ts`(신규), `src/sidepanel/hooks/__tests__/useRecordingElapsed.test.tsx`(신규), `src/sidepanel/tabs/IssueTab.tsx`(`RecordingState`)
- **작업 내용**: `RecordingState`의 `elapsed` state + 500ms `setInterval` effect + `videoRecorder.getMaxDuration()`을 훅으로 옮겨 `{ elapsedSec, maxSec }`를 반환한다. `RecordingState`는 이 훅을 쓰도록 바꾸고 렌더는 무변경. 테스트를 먼저 작성한다(`@/sidepanel/video-recorder` mock + fake timers).
- **검증**:
  - [ ] 마운트 직후 `getElapsedSec()` 값이 바로 반영된다
  - [ ] 500ms 진행마다 갱신된다
  - [ ] 언마운트 시 interval 해제
  - [ ] `maxSec === getMaxDuration()`
  - [ ] `IssueTab.test.tsx` green

### Task 3: i18n 키 추가
- **변경 대상**: `src/i18n/namespaces/issue.ts`
- **작업 내용**: `issue.recording.barLabelTab`·`issue.recording.barLabelScreen`을 5개 로케일 블록의 `issue.recording.titleScreen` 다음에 추가한다(값은 design.md 표).
- **검증**:
  - [ ] PostToolUse 훅의 `locales.test.ts` green(키 대칭·빈 값 없음)

### Task 4: 반전 스코프 토큰 (`.light, :root`)
- **변경 대상**: `src/styles/globals.css`, `src/styles/__tests__/tokens.test.ts`
- **작업 내용**: 라이트 블록 셀렉터를 `.light, :root`로 바꾸고 주석 한 줄을 단다(반전 스코프용이고, `parseTokens`가 `":root {"`로 찾으므로 순서 고정). 테스트에 "globals.css의 라이트 블록 셀렉터가 `.light`를 포함한다" 단언을 추가한다. 반전 스코프가 라이트 토큰을 그대로 받는다는 계약을 고정하는 것이다. 테스트를 먼저 작성한다.
- **검증**:
  - [ ] 새 단언 red → 셀렉터 변경 후 green
  - [ ] `tokens.test.ts`·`muted-surface-contrast.test.ts` 기존 케이스 green
  - [ ] `log-viewer/styles.css`는 무변경이고 "라이트(:root) 토큰 표가 완전히 같다" green

### Task 5: `RecordingFloatingBar` 컴포넌트 (TDD)
- **변경 대상**: `src/sidepanel/components/RecordingFloatingBar.tsx`(신규), `src/sidepanel/components/__tests__/RecordingFloatingBar.test.tsx`(신규)
- **작업 내용**: design.md "인터페이스 설계"의 마크업 그대로 만든다. `recordingSource`는 `useEditorStore`, 시간은 Task 2, 테마는 Task 1. 컴포넌트 상단에 "반전 스코프 안에서 `dark:` variant 금지" 한 줄 주석을 단다. 테스트를 먼저 작성한다(훅 2개·store·video-recorder mock).
- **검증**:
  - [ ] `useResolvedDark` false → 루트에 `dark` 클래스, true → `light` 클래스
  - [ ] source `tab` → `issue.recording.barLabelTab`, `screen` → `barLabelScreen`
  - [ ] 시간 텍스트 `0:45 / 2:00`(elapsed 45, max 120)
  - [ ] `recording-bar-stop` 클릭 → `stopRecording` 1회, `recording-bar-cancel` 클릭 → `cancelRecording` 1회
  - [ ] 컴포넌트 소스에 `dark:` 문자열 0건(소스 스캔 단언 한 줄)

### Task 6: `bottomInset` prop
- **변경 대상**: `src/sidepanel/components/ConsoleLogContent.tsx`, `src/sidepanel/components/NetworkLogContent.tsx`, 각 `__tests__/*.test.tsx`
- **작업 내용**: optional `bottomInset?: boolean`. 콘솔은 목록 `ScrollArea` 안쪽 `<div className="overflow-hidden">`에, 네트워크는 목록 `ScrollArea` 안쪽 `<div>`와 상세 `ScrollArea` 안쪽 콘텐츠에 `pb-6`을 조건부로 붙인다. 기본 false.
- **검증**:
  - [ ] `bottomInset` 미지정 시 기존 클래스 그대로(기존 테스트 green)
  - [ ] true면 목록 컨테이너에 `pb-6`(콘솔 1곳, 네트워크 목록 + 상세)

### Task 7: 서브탭 녹화 상태 (footer disabled + 바 + inset)
- **변경 대상**: `src/sidepanel/tabs/ConsoleSubTab.tsx`, `src/sidepanel/tabs/NetworkSubTab.tsx`, `src/sidepanel/tabs/__tests__/ConsoleSubTab.test.tsx`·`NetworkSubTab.test.tsx`(신규)
- **작업 내용**: `const recording = useEditorStore((s) => s.phase === "recording")`. `[Clear]`·`[이슈 작성]`의 `disabled`에 `recording`을 OR로 더한다(이슈 작성은 지금 disabled 조건이 없으니 `disabled={recording}`). `<PageShell className="relative">`, `{recording && <RecordingFloatingBar />}`, `bottomInset={recording}`. 테스트를 먼저 작성한다(바·LogContent는 stub).
- **검증**:
  - [ ] phase `recording` → `console-clear`/`network-clear`와 이슈 작성 버튼 disabled, `recording-bar` 존재, LogContent stub에 `bottomInset=true`
  - [ ] phase `idle` → 버튼 기존 조건대로, `recording-bar` 없음

### Task 8: `DebugTab` 잠금 해제·폴링·서브탭 복귀
- **변경 대상**: `src/sidepanel/tabs/DebugTab.tsx`, `src/sidepanel/tabs/__tests__/DebugTab.test.tsx`
- **작업 내용**: ① `logTabsLocked = unsupported`(주석 갱신) ② 3종 sync effect 조건을 `sub !== "issue" && phase !== "recording"`이면 return으로 바꾸고 deps에 `phase` 추가 ③ `useEffect(() => { if (hideSubTabs) setSub("issue"); }, [hideSubTabs])`. 테스트를 먼저 작성한다. 기존 "녹화 중이면 기존 잠금이 그대로 동작" 케이스는 **활성 단언으로 뒤집는다**.
- **검증**:
  - [ ] phase `recording` → console/network 트리거 활성
  - [ ] phase `recording` + unsupported → 여전히 disabled
  - [ ] recording 중 console 서브탭에서 phase → `drafting` 재렌더 → active 서브탭이 issue
  - [ ] recording 중 console 서브탭에서 phase → `idle` 재렌더 → console 유지
  - [ ] recording 중 console 서브탭에서 fake timers 1500ms 진행 → `syncNetworkRecorder`·`syncActionRecorder` 호출됨. idle + console 서브탭에선 호출 안 됨(기존 동작)

### Task 9: 문서 갱신
- **변경 대상**: `docs/DESIGN.md`, `e2e/GOTCHAS.md`
- **작업 내용**:
  - DESIGN §6에 "반전 플로팅 바" 관용구를 추가한다: 앱 반대 테마 클래스 스코프 + `bg-background/80 backdrop-blur-md shadow-lg ring-1 ring-border rounded-xl`, **진행 중인 세션 상태 전용**(다른 용도로 쓰면 위계 효과가 사라진다), 스코프 안 `dark:` 금지, `.light, :root` 순서 의존, 높이 관계(68px·inset 12px·`pb-6`).
  - DESIGN §2 raw 색 "녹화 중 화면 red"에 `RecordingFloatingBar`(`dark:` 짝 없음, 반전 스코프라 의도)를 추가한다.
  - DESIGN §8에 바 맥박의 `motion-reduce:animate-none`을 추가한다.
  - DESIGN §14의 "앱 내 유일한 `animate-pulse`"를 갱신한다(스켈레톤 + 녹화 점).
  - GOTCHAS 45행의 잠금 phase 목록에서 `recording`을 제거한다.
- **검증**:
  - [ ] 문서 서술과 코드(클래스·값) 일치

## 테스트 계획

- **단위 테스트(jsdom)**: Task 1(`useResolvedDark`), Task 2(`useRecordingElapsed`), Task 5(`RecordingFloatingBar`), Task 6(`bottomInset`), Task 7(서브탭), Task 8(`DebugTab`). node 트랙은 Task 4(`tokens.test.ts`).
- **e2e 시나리오**: 없음. `phase === "recording"` 진입이 실 tabCapture/getDisplayMedia에 의존해 자동화가 불안정하다(`e2e/capture.spec.ts`·`recording-annotation.spec.ts` 주석). 회귀 그물은 jsdom 테스트다.
- **수동 테스트**(`pnpm build` 후 dist 로드):
  - [ ] 탭 녹화 중 콘솔·네트워크 서브탭이 열리고 로그가 실시간으로 쌓인다. 콘솔 탭에 있을 때 네트워크 배지도 오른다
  - [ ] 바가 footer 위에 11px 걸쳐 뜨고, disabled 버튼이 블러로 비친다. 끝까지 스크롤하면 마지막 행이 바 위로 올라온다
  - [ ] 앱 라이트 → 어두운 바 / 앱 다크 → 밝은 바. `system` 모드에서 OS 테마를 바꾸면 즉시 뒤집힌다
  - [ ] 바의 ghost [취소] hover 피드백이 양 테마에서 보인다
  - [ ] [녹화 완료] → 트림 화면/초안으로 이동하고 서브탭 바가 숨겨진다. 다시 idle로 돌아오면 issue 서브탭
  - [ ] [취소] → 같은 로그 탭에 머물고 footer 버튼이 다시 활성화된다
  - [ ] 2:00 자동 종료, 화면 녹화 "공유 중지"로 종료할 때도 issue 서브탭으로 이동한다
  - [ ] 네트워크 상세를 연 상태에서도 바가 상세 콘텐츠 하단을 막지 않는다(`pb-6`)
  - [ ] **최소 패널 폭(약 320px)에서 ko·en·fr·es·de 5개 로케일 모두 바가 넘치지 않는다**. 넘치면 구현을 멈추고 축소 규칙을 사용자에게 묻는다(design.md 위험 요소)
  - [ ] OS "동작 줄이기"를 켜면 빨간 점 맥박이 멈춘다

## 구현 순서 권장

1. Task 1·2·3·4·6은 서로 독립이라 병렬로 진행할 수 있다.
2. Task 5는 1·2·3에 의존한다.
3. Task 7은 5·6에 의존한다.
4. Task 8은 독립이지만 수동 확인은 7 이후에 한다.
5. Task 9는 마지막에 한다(구현값 확정 후).

## 가이드 영향

- `guide/ko/video/record.md`·`guide/en/video/record.md` "녹화 중" 섹션 — 녹화 중에도 콘솔·네트워크 탭에서 로그를 확인할 수 있고, 하단 바에서 [녹화 완료]·[취소]를 할 수 있다는 단락을 추가한다. 바 스크린샷 컷을 새로 추가할지는 `/guide-shots`에서 판단한다.
- `guide/{ko,en}/logs/README.md` — 로그 탭 접근 조건 서술이 있으면 녹화 중 조회 가능으로 맞춘다.
