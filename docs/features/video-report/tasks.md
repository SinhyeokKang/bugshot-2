# 비디오 리포트 — 구현 태스크

구현 순서는 의존성 기준. 각 태스크는 검증 체크를 포함한다.

## 선행 조건

- 신규 Chrome 권한 불필요 — manifest 무변경.
- `npx shadcn@latest add resizable` (react-resizable-panels) — Task 5에서 설치, `src/components/ui/resizable.tsx` 위치 확인.
- 기준 패턴 정독: `src/sidepanel/lib/buildLogsHtml.ts`, `buildCaptureFiles.ts`, `src/log-viewer/App.tsx`, `src/sidepanel/components/{Console,Network,Action}LogContent.tsx`, `src/store/editor-store.ts`(`onRecordingComplete`/`confirmDraft`/`EditorSnapshot`), `src/sidepanel/30s-replay/use-30s-replay.ts`(`:152-180`).

## T1. 동기화 앵커 영속화

- [ ] `src/sidepanel/video-recorder.ts` — `onstop` 진입 즉시 `const localEndedAt = Date.now()`. `state = null`(`:71`) 전에 `localStartTime = s.startTime` 보존. `onRecordingComplete(blob, thumbnail, viewport, localStartTime, localEndedAt)`.
- [ ] `src/store/editor-store.ts` — `EditorState`/`initial`/`EditorSnapshot`에 `videoStartedAt: number | null`, `videoEndedAt: number | null`. `onRecordingComplete` 시그니처(`:115`)·구현(`:348`)에 `startedAt`/`endedAt` 인자 + set 반영. `confirmDraft` video 분기 `saveDraft`에 두 필드 포함.
- [ ] `src/sidepanel/hooks/useEditorSessionSync.ts` — `snapshotFromState()`(`:49-51`)에 `videoStartedAt`/`videoEndedAt` 복사 추가.
- [ ] `src/store/issues-store.ts` — `IssueRecord`에 `videoStartedAt?`/`videoEndedAt?`. `ISSUES_STORE_VERSION` 주석 한 줄(마이그레이션 코드 없음).
- [ ] `src/sidepanel/30s-replay/use-30s-replay.ts` — `capture()`의 `onRecordingComplete`(`:180`)에 `frames[0].timestamp`, `captureTime` 인자 추가.

**검증**:
- [ ] `pnpm typecheck` 통과.
- [ ] `src/store/__tests__/editor-store.test.ts` — `onRecordingComplete(blob, thumb, viewport, startedAt, endedAt)` 후 `videoStartedAt`/`videoEndedAt` set, `confirmDraft` video 분기가 `saveDraft`에 두 필드를 싣는지(기존 `videoCapturedAt` 테스트 `:167` 옆에 추가).
- [ ] 수동: 비디오 녹화 후 패널 닫았다 열어 두 필드 보존 확인.

## T2. 동기화 순수 헬퍼 (test-first)

- [ ] `src/log-viewer/__tests__/timeline.test.ts` 작성(red):
  - `findActiveIndex([100,200,300], 250) → 1` (250 이하 최댓값 200).
  - `findActiveIndex([100,200,300], 50) → -1` (전부 초과).
  - `findActiveIndex([100,200,300], 300) → 2` (경계 포함).
  - `findActiveIndex([], 100) → -1`.
  - 비정렬 입력 `[300,100,200]`에서도 올바른 원본 인덱스 반환(또는 "정렬 입력 가정" 계약을 테스트로 고정 — 구현 선택을 테스트로 확정).
  - `toVideoSeconds(absTs, baseMs)` — `(abs−base)/1000`, 음수 입력 `→ 0` clamp.
- [ ] `src/log-viewer/timeline.ts` 구현.

**검증**: 작성 직후 red → 구현 후 `pnpm test` green. `pnpm typecheck` 통과.

## T3. `LogViewerData.video` + buildLogsHtml/buildCaptureFiles

- [ ] `src/types/log-viewer.ts` — `LogViewerData`에 `video: { dataUrl; mime; startedAt; endedAt; thumbnail?; viewport? } | null`.
- [ ] `src/sidepanel/lib/buildLogsHtml.ts` — 시그니처에 `video` 인자(actionLog 다음, pageUrl 앞), `data.video` 주입.
- [ ] `src/sidepanel/lib/buildCaptureFiles.ts`:
  - `BuildCaptureFilesInput`에 `videoStartedAt?`/`videoEndedAt?`/`videoThumbnail?`/`videoViewport?`.
  - `result.video` push(`:42-47`) **제거**, `recordingFilename` import 제거.
  - video 모드 & `videoBlob` & `videoStartedAt`/`videoEndedAt` 모두 존재 시 `video` 객체 조립(`blobToDataUrl(videoBlob)`, `videoBlob.type`) → `buildLogsHtml`에 전달, 아니면 `null`.

**검증**:
- [ ] `pnpm typecheck` 통과.
- [ ] `src/sidepanel/lib/__tests__/buildLogsHtml.test.ts` 갱신: `video` 인자 추가 호출, `video` 있음→`data.video` not null / `video=null`→null. 회귀: network/console/action-only 케이스 유지.
- [ ] `src/sidepanel/lib/__tests__/buildCaptureFiles.test.ts` 갱신:
  - `video 모드 + blob + 앵커 → logs.html에 video 임베드, result.video 없음(recording.mp4 폐지)`.
  - `video 모드 + 앵커 없음 → video=null` (graceful).
  - `freeform/screenshot/element → video=null` (회귀).
  - 기존 `result.video`(recording.mp4) 단언이 있으면 제거/갱신.

## T4. 세 LogContent 동기화 props (코어)

- [ ] `src/sidepanel/components/ConsoleLogContent.tsx` / `NetworkLogContent.tsx` / `ActionLogContent.tsx`에 optional props `syncBaseMs?`/`onSeek?`/`activeTs?` 추가:
  - `syncBaseMs` 공급 시 상대시간 base를 `syncBaseMs`로(Console/Action). **Network는 칩 신규 추가**(`[+MM:SS]` 좌측, 행 클릭 점프 `<button>`).
  - 각 행의 `[+MM:SS]` 칩을 `onSeek(rowTimestamp)` 호출 `<button>`으로(칩만 점프 트리거 — 기존 행 클릭/accordion/detail 동작 불변).
  - `activeTs` 공급 시 `findActiveIndex(entryTimestamps, activeTs)` 행에 active 스타일(좌 accent 보더 + `bg-accent/40`). Network 기존 `rowBg` detail-active와 별도 슬롯.
  - **미공급 경로(라이브 서브탭) 동작·레이아웃 100% 불변**.

**검증**:
- [ ] `pnpm typecheck` 통과.
- [ ] 수동(회귀): 라이브 사이드패널 디버그 console/network 서브탭 레이아웃·동작 불변.
- [ ] (UI라 단위 테스트 부적합 — active 행 산출 로직은 T2 `findActiveIndex`로 커버.)

## T5. log-viewer 플레이어 + 분할 레이아웃 + i18n

- [ ] `npx shadcn@latest add resizable` — `src/components/ui/resizable.tsx` 확인.
- [ ] `src/log-viewer/App.tsx`:
  - `data.video` 있음 → `ResizablePanelGroup direction="horizontal"`(좌 플레이어 `defaultSize={50}` / 우 `Tabs` `{50}`, `ResizableHandle withHandle`). 루트 `h-screen`, 패널 `h-full`. 없음 → 기존 `Tabs` 풀폭.
  - 좌: `<video ref controls poster={video.thumbnail} src={video.dataUrl} onTimeUpdate onError>`. `onError` 시 안내 + 탭 유지.
  - `currentMs` state(`videoStartedAt + currentTime*1000`), `seekTo(absTs)`(`video.currentTime = (absTs−startedAt)/1000`).
  - `video.startedAt`/`endedAt` 있을 때만 세 `*LogContent`에 `syncBaseMs`/`onSeek`/`activeTs` 전달.
- [ ] `src/log-viewer/i18n.ts` — 영상 에러/플레이어 안내 등 신규 문자열 ko/en 동시.

**검증**:
- [ ] `pnpm typecheck` 통과.
- [ ] `pnpm test` — `log-viewer/__tests__/i18n.test.ts` ko/en 대칭 통과.
- [ ] `pnpm build:log-viewer` 후 임시 video `logs.html`을 Chrome/Firefox에서 열어: 좌 영상 + 우 3탭 5:5, 핸들 드래그로 비율 조정(둘 다 100vh).

## T6. 제출 경로 wiring

- [ ] `src/sidepanel/tabs/IssueCreateModal.tsx` `buildEditorCaptureFiles`(`:219-238`) — store에서 `videoStartedAt`/`videoEndedAt`/`videoThumbnail`/`videoViewport` 읽어 `buildCaptureFiles`에 전달.
- [ ] `src/sidepanel/tabs/DraftDetailDialog.tsx` `buildCtxForSubmit`(`:232-290`) — `issue.videoStartedAt`/`videoEndedAt`, `issue.snapshot` viewport/thumbnail 전달.
- [ ] 제출 핸들러가 `captureFiles.video`를 참조하는 곳이 있는지 확인 — 있으면 분기 제거(recording.mp4 폐지), 없으면 무변경.
- [ ] (필요 시) logs.html 첨부 실패가 이슈 본문·`bugshot.md` 첨부를 막지 않도록 격리 동작 확인/보강.

**검증**:
- [ ] `pnpm typecheck` 통과.
- [ ] 4개 플랫폼 비디오 모드 제출 → 이슈에 영상 임베드 `logs.html` 첨부, `recording.mp4` 미첨부 확인.
- [ ] element/screenshot/freeform 제출 → logs.html에 플레이어 없음(회귀).
- [ ] 저장된 draft(IndexedDB blob) 제출 경로도 동일 확인.

## T7. 종단 검증

- [ ] `pnpm dev` 로드, 임의 페이지 비디오 모드 캡처 — 녹화 중 콘솔 에러/네트워크 요청/클릭·입력 의도 발생, 로그 첨부 ON.
- [ ] 제출 → 첨부 `logs.html`을 Chrome/Firefox에서 열어:
  - 좌 영상 재생 + 우 3탭, 핸들 비율 조정.
  - 임의 탭 행 칩 클릭 → 영상 점프. 재생 → 각 탭 현재 행 하이라이트.
  - 세 탭 `+MM:SS`가 영상 0점 기준 통일.
- [ ] 30s-replay capture 제출 → 동일 동기화(앵커=윈도우 시작).
- [ ] 영상 blob 만료(getVideoBlob null) draft → 플레이어 없이 탭만, 크래시 없음.
- [ ] 구버전 draft(앵커 없음) → 영상 재생, 동기화 비활성, 크래시 없음.
- [ ] 50~60초 녹화 → logs.html ~15MB+ → 플랫폼 첨부 한도 초과 시 격리 동작(이슈 본문·`bugshot.md` 정상).
- [ ] 라이브 사이드패널 디버그 서브탭(console/network) 회귀 없음.
- [ ] `pnpm typecheck`, `pnpm test` 통과.

## 테스트 계획

- **단위**: `timeline.ts`(`findActiveIndex`/`toVideoSeconds`), `buildLogsHtml.test`(video 인자), `buildCaptureFiles.test`(video 임베드/null/recording.mp4 폐지), `editor-store.test`(앵커 set + confirmDraft), `log-viewer/i18n.test`(ko/en 대칭).
- **수동**: T7 체크리스트(동기화·graceful·회귀·용량).

## 구현 순서 권장

T1 → T2 → T3 → T4 → T5 → T6 → T7 순차. T4(컴포넌트 props)와 T5(App 레이아웃)는 T3 완료 후 병렬 가능하나, T5가 T4 props를 소비하므로 T4 우선 권장. T2는 T4·T5 진입 전 완료(active 행 로직 의존).

## 문서 신선도

- [ ] `CLAUDE.md` — 디렉터리/스택에 `resizable` 컴포넌트, `src/log-viewer/timeline.ts` 반영.
- [ ] `DIRECTORY.md` — `timeline.ts`, `resizable.tsx`, log-viewer 플레이어 역할.
- [ ] `ARCHITECTURE.md` — 세션 영속화에 `videoStartedAt`/`videoEndedAt`, logs.html 영상 임베드 + 동기화 흐름, `recording.mp4` 폐지.
- [ ] `README.md` — 비디오 리포트(영상-로그 동기화 logs.html) 기능 설명.
- [ ] `docs/privacy.md` — 대조: 신규 수집·전송 대상 없음(기존 영상이 logs.html로 합쳐질 뿐). 시행일 bump 불요로 판단되나 `/push`에서 재확인(영상 임베드가 새 동작으로 해석될 여지 점검).
- [ ] `video-report-player/` 디렉터리 — 이 기능이 대체하므로 구현 완료 후 사용자가 삭제.
