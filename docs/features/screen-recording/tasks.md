# 화면 전체 녹화 — 구현 태스크

## 선행 조건
- **Task 0(아래)이 green이어야 나머지 태스크가 유효하다.** getDisplayMedia가 side panel에서 직접 동작하지 않으면 offscreen 경유 재설계가 필요(권한·구조 변경).
- 추가 manifest 권한·env 없음(직접 호출 성공 전제). 단축키 추가 없음.

## 태스크

### Task 0: getDisplayMedia side panel 동작 PoC (차단 게이트)
- **목적**: MV3 side panel(확장 페이지)에서 `navigator.mediaDevices.getDisplayMedia`가 user activation으로 picker 표시 + 스트림 획득까지 되는지 개발 빌드에서 1회 확인. (MV3 미디어 캡처는 offscreen이 표준 권장이라 직접 호출 성공이 보장되지 않음.)
- **작업 내용**: 임시 버튼 onClick에서 `getDisplayMedia({video:true})` 호출 → 스트림 track 획득 여부 콘솔 확인. 미커밋 PoC.
- **검증**:
  - [ ] side panel에서 picker 표시됨
  - [ ] 대상 선택 후 MediaStream의 video track 획득(`getVideoTracks().length > 0`)
  - [ ] (실패 시) Task 1~3 진입 전 design의 offscreen 대안으로 전환 결정

### Task 1: video-recorder에 스트림 소스 분기 추출 + source/리스너 정리
- **변경 대상**: `src/sidepanel/video-recorder.ts`
- **작업 내용**:
  - `startRecording(tabId)`의 MediaRecorder 생성~onstop~maxTimer~state 설정 본문(51–122행)을 내부 헬퍼 `beginRecording(stream, tabId, { source, viewportHint? })`로 추출.
  - `startRecording(tabId)`는 tabCapture 스트림 획득 후 `beginRecording(stream, tabId, { source: "tab" })` 호출(동작 보존).
  - `startScreenRecording(stream, tabId)` export 추가 → `beginRecording(stream, tabId, { source: "screen", viewportHint: trackViewport(stream) })`.
  - `RecorderState`에 `source: "tab"|"screen"` 보관(store 전달용).
  - `trackViewport(stream)`: video track `getSettings().width/height` 반환(없으면 undefined). **순수 함수로 분리** — 단위 테스트 대상.
  - **track `ended` 리스너 정리**: `beginRecording`에서 `ended` 핸들러를 named 함수로 만들어 `RecorderState`에 보관하고 video track에 등록(`stopRecording` 호출). `onstop`과 **`cancelRecording` 양쪽**에서 `track.removeEventListener("ended", handler)`. `cancelRecording` 본문에 ended 정리 추가(현재 없음).
  - onstop의 viewport: `viewportHint`가 있으면 사용. 화면 경로에서 `viewportHint` undefined면 `{0,0}` 유지(현재 탭 크기 폴백 금지). tab 경로는 기존 `chrome.tabs.get` 폴백.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] `trackViewport` 단위 테스트(가짜 settings → {w,h} / undefined 분기) — `src/sidepanel/lib/__tests__/trackViewport.test.ts`, 5 케이스 green
  - [ ] 기존 탭 녹화(mode-video)가 회귀 없이 동작(수동: 녹화→drafting 영상 재생)
  - [ ] (수동) 공유 중지·패널 중지·60초 3경로 경합 시 `onRecordingComplete` 중복 미발생(이중 종료 안전 + ended 리스너 정리)

### Task 2: video-capture에 startScreenCapture 추가
- **변경 대상**: `src/sidepanel/video-capture.ts`
- **작업 내용**:
  - `startScreenCapture(tabId)` export 추가. **첫 await가 getDisplayMedia**(user activation 보존):
    1. `getDisplayMedia({ video: { displaySurface: "monitor", width: { max: 1920 }, height: { max: 1080 }, frameRate: 12 }, audio: false })`(전체화면 우선 힌트 + 1080p 상한). reject 시 **취소/실패 분기**: `err.name === "NotAllowedError"`면 silent return(콘솔·토스트 없음), 그 외는 `console.warn` 후 return. 둘 다 idle 유지.
    2. 로그 레코더 activate/clear(현재 탭) — `startVideoCapture`와 동일 블록 재사용.
    3. `chrome.tabs.get(tabId)`로 url/title 확보(getDisplayMedia 이후) → `store.startRecording({ tabId, url, title, source: "screen" })`.
    4. `try { videoRecorder.startScreenRecording(stream, tabId) } catch` → 실패 시 `store.cancelRecording()` + `stream.getTracks().forEach(t => t.stop())`.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] (수동) 버튼 클릭 → getDisplayMedia picker 표시
  - [ ] (수동) picker 취소(NotAllowedError) → idle 유지, 콘솔 경고 **없음**
  - [ ] (수동) picker 열린 채 다른 캡처 트리거(단축키 등) 시 상태 깨짐 없음

### Task 3: IssueTab 1×2×2×1 레이아웃 + RecordingState source 분기 + 배선
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`, `src/store/editor-store.ts`
- **작업 내용**:
  - **store**: `startRecording` 액션 인자에 `source: "tab"|"screen"` 추가, 상태 보관. 기존 호출처(`startVideoCapture`)는 `"tab"` 전달. RecordingState가 store에서 source를 읽는다.
  - `EmptyState` props에 `onStartScreenRecord: () => void` 추가.
  - Row3 `ButtonGroup`: `mode-video`(탭 녹화, `Video` 아이콘 유지) + 신규 `mode-screen-record`(화면 녹화, `data-testid="mode-screen-record"`, `MonitorPlay` 아이콘). 둘 다 `variant="outline"` + `flex-1` + default 사이즈(`xl` 금지). `mode-screen-record`는 단축키 없으니 `ShortcutTooltip` 미적용. 라벨 span에 `min-w-0 truncate`(좁은 폭 clip 방지). `ReplayButton` 제거.
  - Row4: `ReplayButton` 단독 full-width. ReplayButton의 `flex-1 rounded-l-none border-l-0`를 **양 분기(`replayEnabled` on/off 둘 다)에서** `w-full`로 교체(좌측 seam 보정 제거). enabled 분기의 `aria-disabled:*` 상태 클래스는 보존.
  - **RecordingState**: props에 `source` 추가. 라벨 "탭 녹화 중"/"화면 녹화 중", 아이콘 `Video`/`MonitorPlay` 분기. **Cancel 버튼이 `videoRecorder.cancelRecording()`을 호출하는지 확인**(화면 스트림 정지 위해).
  - 상위 idle 렌더 지점에서 `onStartScreenRecord={() => startScreenCapture(tabId)}` 배선. `startScreenCapture` import.
- **검증**:
  - [ ] idle 화면이 1×2×2×1로 렌더. `mode-video`/`mode-screen-record`가 같은 `ButtonGroup`(role="group") 형제, `replay-button`은 별도 컨테이너(DOM 구조 단언)
  - [ ] `mode-screen-record` 클릭 시 startScreenCapture 호출(수동 — picker 뜸)
  - [ ] ReplayButton 단독 + 좌측 모서리 복원(rounded/border-l), 기존 상태표시(버퍼링/인코딩/disabled) 유지
  - [ ] (수동) 화면 녹화 중 "화면 녹화 중" 라벨·아이콘, Cancel 시 브라우저 공유 막대 사라짐

### Task 4: i18n 키 (ko·en 동시)
- **변경 대상**: `src/i18n/namespaces/issue.ts`
- **작업 내용**:
  - `issue.mode.video` 텍스트를 "화면 녹화"→"탭 녹화" / "Record screen"→"Record tab"로 변경(ko·en) — "화면 녹화" 라벨을 실제 화면 녹화로 이전.
  - `issue.mode.screenRecord` 신규: "화면 녹화" / "Record screen"(ko·en).
  - RecordingState source 키 신규: `issue.recording.tab`("탭 녹화 중"/"Recording tab") · `issue.recording.screen`("화면 녹화 중"/"Recording screen"). 기존 녹화중 라벨이 단일 키면 두 키로 분기.
- **검증**:
  - [x] PostToolUse 훅(locales.test.ts) 통과 — ko/en 키 대칭·빈 값·placeholder 일치
  - [ ] 양 로케일에서 버튼·녹화중 라벨 정상 표시

### Task 5: privacy.md 갱신
- **변경 대상**: `docs/privacy.md`
- **작업 내용**: 화면 전체 녹화(탭 밖·다른 창·전체 화면 데이터 캡처 가능)를 수집 항목·목적에 추가. 시행일 갱신.
- **검증**:
  - [ ] 화면 녹화 동작이 명시되고 시행일이 갱신됨
  - [ ] tabCapture(뷰포트)와 getDisplayMedia(화면) 차이가 분명히 기술됨

## 테스트 계획

- **단위 테스트(필수)**: `trackViewport(stream)` — 가짜 `getSettings()` 반환(정상 {w,h} / 누락 undefined) 입력으로 분기 검증. CLAUDE.md "신규 헬퍼는 테스트 먼저". 그 외 `video-recorder`/`video-capture`는 chrome API·MediaRecorder·getDisplayMedia 의존이라 순수 함수가 없어 e2e/수동으로 커버.
- **e2e 시나리오** (`/e2e-write` 입력 — 버튼 노출·레이아웃까지만, 녹화는 자동화 불가):
  - idle 화면에 `mode-element`/`mode-element-shot`/`mode-screenshot`/`mode-video`/`mode-screen-record`/`replay-button` 6개 버튼이 모두 노출된다(`getByTestId(...).toBeVisible()`).
  - `mode-video`와 `mode-screen-record`가 **같은 `ButtonGroup`(role="group")의 형제**이고, `replay-button`은 그 그룹 **밖 별도 컨테이너**에 있다(위치/픽셀 단언이 아닌 DOM 부모 구조로 판정 — README 셀렉터 정책 준수).
  - `mode-screen-record` **클릭은 e2e에서 하지 않는다**(getDisplayMedia picker가 떠 행이 멈춤 — 수동).
- **수동 테스트** (Chrome):
  - [ ] [화면 녹화] → picker 표시 → [전체 화면] 선택 → 녹화 → 패널 중지 → drafting Media 섹션 영상 재생
  - [ ] [화면 녹화] → picker [탭] 선택 → 녹화 → drafting(로그-영상 동일 탭 일치 확인)
  - [ ] 브라우저 "공유 중지"로 종료 → drafting 정상 전환 / 60초 자동 중지 → drafting 전환
  - [ ] 공유중지·패널중지·60초 **경합** 시 중복 종료/에러 없음
  - [ ] picker 취소(NotAllowedError) → idle 유지, 콘솔 경고 없음
  - [ ] picker 열린 채 다른 캡처 단축키 → 상태 깨짐 없음
  - [ ] 화면 녹화 후 drafting에 현재 탭 console/network/action 로그 첨부 확인
  - [ ] "화면 녹화 중"/"탭 녹화 중" 라벨·아이콘 분기, Cancel 시 공유 막대 사라짐
  - [ ] 탭 녹화·30s 리플레이·요소/스크린샷 캡처 회귀 없음

## 회귀 리스크 (분석)
- **레이아웃 변경(ReplayButton Row3→Row4)이 기존 e2e를 깨지 않음**: `replay-button` 참조 spec은 `replay-action-log.spec.ts`·`action-log-coverage.spec.ts` 2개인데 **모두 testid + aria-disabled 단언만** 하고 위치/형제순서를 안 본다 → 안 깨짐. `mode-video`는 e2e 직접 참조 0(수동 잔여). 새 e2e만 DOM 구조 단언 추가.
- **i18n `issue.mode.video` 라벨 변경 회귀**: "화면 녹화"→"탭 녹화"를 참조하는 가이드/툴팁/온보딩이 있는지 `/implement` 전 grep 확인(가이드 영향에 반영). 단축키 툴팁은 키 자체(`capture-video`)라 무관.
- **`startRecording` 액션 시그니처 변경**(source 추가): 호출처는 `startVideoCapture` 1곳뿐(`"tab"` 전달) — typecheck로 누락 잡힘.

## 구현 순서 권장
- **Task 0(PoC)가 green이어야 진행.** 이후 Task 1 → Task 2(recorder 분기 후 capture 배선). Task 3·4는 Task 2 완료 후 병렬 가능. Task 5(privacy)는 독립.
- 권장: 0 → 1 → 2 → 3 → 4 → 5.

## 가이드 영향
사용자 노출 기능 추가 — `/guide`로 갱신 필요:
- `capture/`(또는 캡처 모드 설명 페이지) ko·en — "화면 전체 녹화" 모드 추가, idle 버튼 레이아웃 변경 반영.
- 30s 리플레이 위치 변경(하단 단독)이 가이드 스크린샷/설명에 걸리면 함께 갱신.
- `guide/AUTHORING.md`의 지원 캡처 모드·UI 라벨 표에 화면 전체 녹화 반영(새 모드 도입 트리거).
