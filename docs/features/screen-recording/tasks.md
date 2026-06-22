# 화면 전체 녹화 — 구현 태스크

## 선행 조건
- `getDisplayMedia`가 사이드패널(MV3 확장 페이지)에서 user activation으로 동작하는지 수동 확인(개발 빌드). 동작 안 하면 design의 desktopCapture 대안으로 전환.
- 추가 manifest 권한·env 없음. 단축키 추가 없음.

## 태스크

### Task 1: video-recorder에 스트림 소스 분기 추출
- **변경 대상**: `src/sidepanel/video-recorder.ts`
- **작업 내용**:
  - `startRecording(tabId)`의 MediaRecorder 생성~onstop~maxTimer~state 설정 본문(51–122행)을 내부 헬퍼 `beginRecording(stream, tabId, viewportHint?)`로 추출.
  - `startRecording(tabId)`는 tabCapture 스트림 획득 후 `beginRecording(stream, tabId)` 호출(동작 보존).
  - `startScreenRecording(stream, tabId)` export 추가 → `beginRecording(stream, tabId, trackViewport(stream))`.
  - `trackViewport(stream)`: video track `getSettings().width/height` 반환(없으면 undefined).
  - `beginRecording`에서 video track `ended` 리스너로 `stopRecording` 등록. onstop/cancel에서 리스너 정리.
  - onstop의 viewport: `viewportHint`가 있으면 사용, 없으면 기존 `chrome.tabs.get` 폴백.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 뷰포트 녹화(mode-video)가 회귀 없이 동작(수동: 녹화→drafting 영상 재생)
  - [ ] startScreenRecording이 주어진 스트림으로 MediaRecorder를 돌려 onstop에서 onRecordingComplete 호출

### Task 2: video-capture에 startScreenCapture 추가
- **변경 대상**: `src/sidepanel/video-capture.ts`
- **작업 내용**:
  - `startScreenCapture(tabId)` export 추가. **첫 await가 getDisplayMedia**(user activation 보존):
    1. `getDisplayMedia({ video: { frameRate: 12 }, audio: false })` — reject(취소/거부)면 catch 후 return(no-op, 토스트 없음).
    2. 로그 레코더 activate/clear(현재 탭) — `startVideoCapture`와 동일 블록 재사용.
    3. `store.startRecording({ tabId, url, title })`.
    4. `videoRecorder.startScreenRecording(stream, tabId)`. 실패 시 `store.cancelRecording()` + `stream.getTracks().forEach(t => t.stop())`.
  - `chrome.tabs.get(tabId)`는 getDisplayMedia **이후**에(activation 보존). url/title은 store.startRecording 직전에 확보.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (수동) 버튼 클릭 → getDisplayMedia picker 표시
  - [ ] (수동) picker 취소 시 idle 유지(에러 없음)

### Task 3: IssueTab EmptyState 1×2×2×1 레이아웃 + 버튼 배선
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**:
  - `EmptyState` props에 `onStartScreenRecord: () => void` 추가.
  - Row3 `ButtonGroup`: `mode-video`(탭 녹화, `Video` 아이콘 유지) + 신규 `mode-screen-record`(화면 녹화, `data-testid="mode-screen-record"`, lucide `MonitorPlay`/`ScreenShare` 아이콘). `ReplayButton` 제거.
  - Row4: `ReplayButton` 단독 full-width(`flex-1 rounded-l-none border-l-0` → `w-full`로 보정).
  - 상위 idle 렌더 지점에서 `onStartScreenRecord={() => startScreenCapture(tabId)}` 배선(`onStartVideo` 패턴 복제). `startScreenCapture` import 추가.
- **검증**:
  - [ ] idle 화면이 1×2×2×1로 렌더(element / element-shot·screenshot / video·screen-record / replay)
  - [ ] `mode-screen-record` 버튼 클릭 시 startScreenCapture 호출
  - [ ] ReplayButton이 하단 단독, 기존 상태표시(버퍼링/인코딩/disabled) 유지

### Task 4: i18n 키 (ko·en 동시)
- **변경 대상**: `src/i18n/namespaces/issue.ts`
- **작업 내용**:
  - `issue.mode.video` 텍스트를 "화면 녹화"→"탭 녹화" / "Record screen"→"Record tab"로 변경(ko·en) — "화면 녹화" 라벨을 실제 화면 녹화로 이전.
  - `issue.mode.screenRecord` 신규: "화면 녹화" / "Record screen"(ko·en).
  - 필요 시 `mode-screen-record` 미지원 환경 안내/tooltip 키.
- **검증**:
  - [ ] PostToolUse 훅(locales.test.ts) 통과 — ko/en 키 대칭·빈 값·placeholder 일치
  - [ ] 양 로케일에서 버튼 라벨 정상 표시

### Task 5: privacy.md 갱신
- **변경 대상**: `docs/privacy.md`
- **작업 내용**: 화면 전체 녹화(탭 밖·다른 창·전체 화면 데이터 캡처 가능)를 수집 항목·목적에 추가. 시행일 갱신.
- **검증**:
  - [ ] 화면 녹화 동작이 명시되고 시행일이 갱신됨
  - [ ] tabCapture(뷰포트)와 getDisplayMedia(화면) 차이가 분명히 기술됨

## 테스트 계획

- **단위 테스트**: `video-recorder`/`video-capture`는 chrome API·MediaRecorder·getDisplayMedia 의존이라 순수 함수가 거의 없다. `trackViewport`(track settings → {width,height}|undefined)만 분리 가능하면 단위 테스트 대상(입력: 가짜 settings 객체). 그 외는 e2e/수동으로 커버.
- **e2e 시나리오** (`/e2e-write` 입력):
  - idle 화면에 `mode-element`/`mode-element-shot`/`mode-screenshot`/`mode-video`/`mode-screen-record`/`replay-button` 6개 버튼이 모두 노출된다.
  - `mode-screen-record` 버튼이 `mode-video`와 같은 행에, `replay-button`이 그 아래 단독 행에 렌더된다(1×2×2×1 — DOM 순서/그룹으로 판정).
  - (실제 getDisplayMedia 녹화→drafting은 자동화 제외 — 아래 수동.)
- **수동 테스트** (Chrome):
  - [ ] [화면 전체 녹화] → picker 표시 → [전체 화면] 선택 → 녹화 → 패널 중지 → drafting Media 섹션 영상 재생
  - [ ] 같은 흐름에서 브라우저 "공유 중지"로 종료 → drafting 정상 전환
  - [ ] 60초 자동 중지 → drafting 전환
  - [ ] picker 취소 → idle 유지, 콘솔 에러 없음
  - [ ] 화면 녹화 후 drafting에 현재 탭 console/network/action 로그 첨부 확인
  - [ ] 뷰포트 녹화·30s 리플레이·요소/스크린샷 캡처 회귀 없음

## 구현 순서 권장
- Task 1 → Task 2 (recorder 분기 후 capture 배선). Task 3·4는 Task 2 완료 후 병렬 가능. Task 5(privacy)는 독립.
- 권장: 1 → 2 → 3 → 4 → 5.

## 가이드 영향
사용자 노출 기능 추가 — `/guide`로 갱신 필요:
- `capture/`(또는 캡처 모드 설명 페이지) ko·en — "화면 전체 녹화" 모드 추가, idle 버튼 레이아웃 변경 반영.
- 30s 리플레이 위치 변경(하단 단독)이 가이드 스크린샷/설명에 걸리면 함께 갱신.
- `guide/AUTHORING.md`의 지원 캡처 모드·UI 라벨 표에 화면 전체 녹화 반영(새 모드 도입 트리거).
