# 비디오 리포트 — 구현 태스크

구현 순서는 의존성 기준. 각 태스크는 검증 체크를 포함한다.

## 선행 조건

- 신규 Chrome 권한 불필요 — manifest 무변경.
- `npx shadcn@latest add resizable` (react-resizable-panels) — Task 5에서 설치, `src/components/ui/resizable.tsx` 위치 확인.
- 기준 패턴 정독: `src/sidepanel/lib/buildLogsHtml.ts`, `buildCaptureFiles.ts`, `src/log-viewer/App.tsx`, `src/sidepanel/components/{Console,Network,Action}LogContent.tsx`, `src/store/editor-store.ts`(`onRecordingComplete`/`confirmDraft`/`EditorSnapshot`), `src/sidepanel/30s-replay/use-30s-replay.ts`(`:152-180`).

## T1. 동기화 앵커 영속화

- [x] `src/sidepanel/video-recorder.ts` — `onstop` 진입 즉시 `const localEndedAt = Date.now()`. `state = null`(`:71`) 전에 `localStartTime = s.startTime` 보존. `onRecordingComplete(blob, thumbnail, viewport, localStartTime, localEndedAt)`.
- [x] `src/store/editor-store.ts` — `EditorState`/`initial`/`EditorSnapshot`에 `videoStartedAt: number | null`, `videoEndedAt: number | null`. `onRecordingComplete` 시그니처(`:115`)·구현(`:348`)에 `startedAt`/`endedAt` 인자 + set 반영. `confirmDraft` video 분기 `saveDraft`에 두 필드 포함.
- [x] `src/sidepanel/hooks/useEditorSessionSync.ts` — `snapshotFromState()`(`:49-51`)에 `videoStartedAt`/`videoEndedAt` 복사 추가.
- [x] `src/store/issues-store.ts` — `IssueRecord`에 `videoStartedAt?`/`videoEndedAt?`. `ISSUES_STORE_VERSION` 주석 한 줄(마이그레이션 코드 없음).
- [x] `src/sidepanel/30s-replay/use-30s-replay.ts` — `capture()`의 `onRecordingComplete`(`:180`)에 `frames[0].timestamp`, `captureTime` 인자 추가.

**검증**:
- [x] `pnpm typecheck` 통과.
- [x] `src/store/__tests__/editor-store.test.ts` — `onRecordingComplete(blob, thumb, viewport, startedAt, endedAt)` 후 `videoStartedAt`/`videoEndedAt` set, `confirmDraft` video 분기가 `saveDraft`에 두 필드를 싣는지(기존 `videoCapturedAt` 테스트 `:167` 옆에 추가).
- [ ] 수동: 비디오 녹화 후 패널 닫았다 열어 두 필드 보존 확인.

## T2. 동기화 순수 헬퍼 (test-first)

- [x] `src/log-viewer/__tests__/timeline.test.ts` 작성(red):
  - `findActiveIndex([100,200,300], 250) → 1` (250 이하 최댓값 200).
  - `findActiveIndex([100,200,300], 50) → -1` (전부 초과).
  - `findActiveIndex([100,200,300], 300) → 2` (경계 포함).
  - `findActiveIndex([], 100) → -1`.
  - `findActiveIndex([100,100,100], 100) → 2` (동일 timestamp 다발 → 마지막 인덱스. 계약 고정).
  - 비정렬 입력 `[300,100,200]`에서도 올바른 원본 인덱스 반환(또는 "정렬 입력 가정" 계약을 테스트로 고정 — 구현 선택을 테스트로 확정).
  - `toVideoSeconds(absTs, baseMs)` — `(abs−base)/1000`, 음수 입력 `→ 0` clamp.
- [x] `src/log-viewer/timeline.ts` 구현.

**검증**: 작성 직후 red → 구현 후 `pnpm test` green. `pnpm typecheck` 통과. ✅

## T3. `LogViewerData.video` + buildLogsHtml/buildCaptureFiles

- [x] `src/types/log-viewer.ts` — `LogViewerData`에 `video: { dataUrl; mime; startedAt; endedAt; thumbnail?; viewport? } | null`.
- [x] `src/sidepanel/lib/buildLogsHtml.ts` — 시그니처에 `video` 인자(actionLog 다음, pageUrl 앞), `data.video` 주입.
- [x] `src/sidepanel/lib/buildCaptureFiles.ts`:
  - `BuildCaptureFilesInput`에 `videoStartedAt?`/`videoEndedAt?`/`videoThumbnail?`/`videoViewport?`.
  - **`result.video` push(`:42-47`) 유지**(recording.mp4 인라인 폐지 아님), `recordingFilename` import 유지.
  - video 모드 & `videoBlob` & `videoStartedAt`/`videoEndedAt` 모두 존재 시 `video` 객체 조립(`blobToDataUrl(videoBlob)`, `videoBlob.type`) → `buildLogsHtml`에 **추가** 전달(인라인 push와 별개), 아니면 `null`.

**검증**:
- [x] `pnpm typecheck` 통과.
- [x] `src/sidepanel/lib/__tests__/buildLogsHtml.test.ts` 갱신: `video` 인자가 actionLog와 pageUrl 사이에 삽입되므로 **기존 호출부 전부(~10곳: `:98,116,125,136,143,160,173,181` 등) 인자 위치를 함께 수정**(누락 시 red 방치). `video` 있음→`data.video` not null / `video=null`→null. 회귀: network/console/action-only 케이스 유지.
- [x] `src/sidepanel/lib/__tests__/buildCaptureFiles.test.ts` 갱신:
  - `video 모드 + blob + 앵커 → logs.html에 video 임베드 **AND** result.video(recording.mp4) 그대로 존재`(인라인 유지 회귀 단언).
  - `video 모드 + 앵커 없음 → logs.html video=null, result.video는 존재` (graceful).
  - `freeform/screenshot/element → video=null, result.video 없음` (회귀).
  - 기존 `result.video`(recording.mp4) 단언 **유지**(폐지 아님).

## T4. 세 LogContent 동기화 props (코어)

- [x] `src/sidepanel/components/ConsoleLogContent.tsx` / `NetworkLogContent.tsx` / `ActionLogContent.tsx`에 optional props `syncBaseMs?`/`onSeek?`/`activeTs?` 추가 (칩은 공유 `LogSeekChip.tsx`로 분리, active 보더 슬롯은 동기화 모드에서만 적용해 라이브 시프트 0):
  - **행 timestamp 소스**: Console/Action=`entry.timestamp`, **Network=`req.startTime`**(`timestamp` 필드 없음). `onSeek`/`findActiveIndex`에 이 값 사용.
  - `syncBaseMs` 공급 시 상대시간 base를 `syncBaseMs`로(Console/Action — `formatRelativeTime`이 각 컴포넌트에 개별 정의, 추출 없이 base 인자만 교체). **Network는 칩 신규 추가**(`[+MM:SS]` 좌측).
  - 각 행의 `[+MM:SS]` 칩을 `onSeek(rowTs)` 호출 `<button>`으로. **`e.stopPropagation()` 필수**(행 onClick accordion/detail과 동시발화 방지). 세 탭 칩 `<button>` 스타일 통일 + `aria-label`("M:SS 지점으로 이동") + focus-visible.
  - `activeTs` 공급 시 `findActiveIndex(rowTimestamps, activeTs)` 행에 active 스타일(좌 accent 보더 + `bg-accent/40`) + `aria-current`. Network 기존 `rowBg` detail-active와 별도 슬롯. 자동 스크롤 비포함(후속).
  - **미공급 경로(라이브 서브탭: ConsoleSubTab/NetworkSubTab) 동작·레이아웃 100% 불변**.

**검증**:
- [x] `pnpm typecheck` 통과.
- [ ] 컴포넌트 단위 테스트(@testing-library): **인프라 미설치(jsdom + @testing-library 부재, .tsx 테스트 0개)로 스킵** — active 인덱스 산출은 T2 `findActiveIndex` 단위 테스트로 커버. 칩 button/span·active 스타일 분기는 typecheck + 수동 회귀로 검증. (인프라 추가는 사용자 판단)
- [ ] 수동(회귀): 라이브 사이드패널 디버그 console/network 서브탭 레이아웃·동작 불변.

## T5. log-viewer 플레이어 + 분할 레이아웃 + i18n

- [x] `npx shadcn@latest add resizable` — `src/components/ui/resizable.tsx` 확인. (shadcn이 `@/` 루트에 생성 → `src/`로 이동. shadcn 레지스트리가 구 API를 생성해 `react-resizable-panels`를 호환 버전 `^2.1.9`로 핀)
- [x] `src/log-viewer/App.tsx`:
  - `data.video` 있음 → `ResizablePanelGroup direction="horizontal"`(좌 플레이어 `defaultSize={50}` / 우 `Tabs` `{50}`, `ResizableHandle withHandle`). 루트 `h-screen`, 패널 `h-full`. 없음 → 기존 `Tabs` 풀폭.
  - 좌: `bg-black` `h-full` 컨테이너(세로 중앙 정렬) 안에 `<video ref controls poster={video.thumbnail} src={video.dataUrl} className="object-contain" onTimeUpdate onError>`. 레터박스 검은 배경. `onError` 시 좌 패널에 안내 메시지(분할 유지) + 탭 동작 유지.
  - `currentMs` state(`videoStartedAt + currentTime*1000`), `seekTo(absTs)`(`video.currentTime = (absTs−startedAt)/1000` + `video.play()` 자동재생).
  - `video.startedAt`/`endedAt` 있을 때만 세 `*LogContent`에 `syncBaseMs`/`onSeek`/`activeTs` 전달.
- [x] `src/log-viewer/i18n.ts` — 영상 에러 안내 신규 문자열 ko/en 동시. (점프 칩 aria-label은 `@/i18n` namespaces/logs.ts에 `logViewer.seekTo` ko/en)

**검증**:
- [x] `pnpm typecheck` 통과.
- [x] `pnpm test` — `log-viewer/__tests__/i18n.test.ts` ko/en 대칭 통과 + `src/i18n/__tests__/locales.test.ts` 통과.
- [ ] `pnpm build:log-viewer` 후 임시 video `logs.html`을 Chrome/Firefox에서 열어: 좌 영상 + 우 3탭 5:5, 핸들 드래그로 비율 조정(둘 다 100vh).

## T6. 제출 경로 wiring

- [x] `src/sidepanel/tabs/IssueCreateModal.tsx` `buildEditorCaptureFiles`(`:219-238`) — store에서 `videoStartedAt`/`videoEndedAt`/`videoThumbnail`/`videoViewport` 읽어 `buildCaptureFiles`에 전달.
- [x] `src/sidepanel/tabs/DraftDetailDialog.tsx` `buildCtxForSubmit`(`:232-290`) — `issue.videoStartedAt`/`videoEndedAt` 전달. **viewport는 `issue.viewport` 최상위 필드**에서 읽음(`issue.snapshot`은 `{before,after}`라 영상 메타 없음). `videoThumbnail`은 IssueRecord 미영속 → 저장 draft는 poster 생략.
- [x] **제출 핸들러 8개 호출부는 `captureFiles.video`(=recording.mp4 인라인)를 그대로 소비 — 무변경 확인**: Jira attachments(`IssueCreateModal.tsx:253`/`DraftDetailDialog.tsx:306`), GitHub/Linear/Notion submit 인자. logs.html 영상은 별개 추가이므로 인라인 경로 손대지 않음.
- [x] logs.html 첨부 실패 격리 확인: Jira는 per-attachment try/catch로 이미 격리. **GitHub은 per-file href=null로 격리(확인)**. **Linear/Notion은 미격리 → best-effort 보강**(Linear: `.catch(()=>null).filter`, Notion: `category==="log"`만 `continue`, image/video는 strict).
- [x] **`injectIssueUrl` 대용량 최적화**(`src/lib/inject-issue-url.ts`): JSON 전체 parse/stringify 회피(meta에 issueUrl 문자열만 삽입) + 청크 base64 변환(문자 누적 루프 제거). 회귀 테스트(대용량 video dataUrl 케이스) 추가, 기존 케이스 green.

**검증**:
- [x] `pnpm typecheck` 통과.
- [ ] 4개 플랫폼 비디오 모드 제출 → 이슈에 **본문 인라인 영상 재생**(GitHub/Linear/Notion inline, Jira ADF) + 영상 임베드 `logs.html` 첨부 둘 다 확인.
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
- [ ] 50~60초 녹화 → logs.html ~15MB+ → 플랫폼 첨부 한도 초과 시 격리 동작(이슈 본문·인라인 영상·`bugshot.md` 정상). Jira/Linear `injectIssueUrl` 대용량 왕복 블로킹/OOM 없는지(스모크).
- [ ] 대용량 logs.html(~20MB) 열람 → log-viewer `JSON.parse` + `<video>` 로드 OOM/truncation 없는지(Chrome/Firefox 스모크).
- [ ] 라이브 사이드패널 디버그 서브탭(console/network) 회귀 없음.
- [x] `pnpm typecheck`, `pnpm test` 통과 (1152 tests green).

## 테스트 계획

- **단위**: `timeline.ts`(`findActiveIndex`/`toVideoSeconds`), `buildLogsHtml.test`(video 인자), `buildCaptureFiles.test`(video 임베드/null/recording.mp4 폐지), `editor-store.test`(앵커 set + confirmDraft), `log-viewer/i18n.test`(ko/en 대칭).
- **수동**: T7 체크리스트(동기화·graceful·회귀·용량).

## 구현 순서 권장

T1 → T2 → T3 → T4 → T5 → T6 → T7 순차. T4(컴포넌트 props)와 T5(App 레이아웃)는 T3 완료 후 병렬 가능하나, T5가 T4 props를 소비하므로 T4 우선 권장. T2는 T4·T5 진입 전 완료(active 행 로직 의존).

## 문서 신선도

- [ ] `CLAUDE.md` — 디렉터리/스택에 `resizable` 컴포넌트, `src/log-viewer/timeline.ts` 반영.
- [ ] `DIRECTORY.md` — `timeline.ts`, `resizable.tsx`, log-viewer 플레이어 역할.
- [ ] `ARCHITECTURE.md` — 세션 영속화에 `videoStartedAt`/`videoEndedAt`, logs.html 영상 추가 임베드 + 동기화 흐름(인라인 mp4 유지), `injectIssueUrl` 대용량 최적화.
- [ ] `README.md` — 비디오 리포트(영상-로그 동기화 logs.html) 기능 설명.
- [ ] `docs/privacy.md` — 대조: 신규 수집 대상 없음(같은 영상이 logs.html에도 추가 임베드될 뿐, 전송 대상 동일·전송량만 ~2배). 시행일 bump 불요로 판단되나 `/push`에서 재확인(영상 임베드가 새 동작으로 해석될 여지 점검).
- [ ] `video-report-player/` 디렉터리 — 이 기능이 대체하므로 구현 완료 후 사용자가 삭제.
