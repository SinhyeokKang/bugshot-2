# 태스크 — 비디오 모드 HTML 리포트

구현 순서는 의존성 기준. 각 태스크는 검증 체크를 포함한다.

## T1. 녹화 시작 시각 영속화

- [ ] `src/sidepanel/video-recorder.ts` — `onstop` 콜백에서 `state = null` 전에 `startTime`을 지역 변수로 보존, `onRecordingComplete(blob, thumbnail, viewport, localStartTime)` 호출.
- [ ] `src/store/editor-store.ts` — `EditorState` / `initial` / `EditorSnapshot`에 `videoStartedAt: number | null` 추가. `onRecordingComplete` 시그니처에 `startedAt` 인자 추가, set에 `videoStartedAt` 반영.
- [ ] `src/sidepanel/hooks/useEditorSessionSync.ts` — `snapshotFromState()`에 `videoStartedAt: s.videoStartedAt` 복사 추가 (누락 시 패널 재오픈 후 값 소실).
- [ ] `src/store/editor-store.ts` `confirmDraft` video 분기(`:376`) — `saveDraft` 객체에 `videoStartedAt`, `videoCapturedAt` 포함.
- [ ] `src/store/issues-store.ts` — `IssueRecord`에 `videoStartedAt?: number`, `videoCapturedAt?: number` 추가. `ISSUES_STORE_VERSION` v5 → v6 bump (마이그레이션 코드 추가 없음, 주석만).

**검증**:
- `pnpm typecheck` 통과.
- `src/store/__tests__/editor-store.test.ts` — 기존 `onRecordingComplete` 호출 테스트가 있으면 새 시그니처로 갱신. `onRecordingComplete(blob, thumb, viewport, startedAt)` 후 `videoStartedAt`/`videoCapturedAt`가 set 되는지, `confirmDraft` video 분기가 `saveDraft`에 두 필드를 싣는지 단위 테스트.
- 수동: 비디오 모드 녹화 후 패널을 닫았다 열어 `videoStartedAt`이 보존되는지 확인.

## T2. `buildReportTimeline` 테스트 작성 (test-first)

- [ ] `src/sidepanel/lib/__tests__/buildVideoReport.test.ts` 작성:
  - 네트워크 + 콘솔 로그가 상대 ts로 변환되고 ts 오름차순 병합되는지.
  - 녹화 구간 밖(ts < 0, ts > duration) 로그가 제거되는지.
  - 경계값(ts = 0, ts = duration) 포함 여부.
  - `null` 로그(미첨부) 입력 시 빈 배열.
  - `videoStartedAt` 또는 `videoCapturedAt`이 `null`/`undefined`일 때 빈 배열 (구 이슈).
  - `videoCapturedAt ≤ videoStartedAt`(음수 duration) 비정상 입력 시 빈 배열.
  - network·console 엔트리가 동일 ts일 때 정렬 안정성(입력 순서 보존).
  - `phase: "pending"` 미완료 네트워크 요청도 `startTime`이 구간 내면 포함되는지.

**검증**: 테스트는 작성 시점에 실패(구현 전) — 인터페이스만 확정.

## T3. `buildVideoReport` 모듈 구현

- [ ] `src/sidepanel/lib/buildVideoReport.ts` 신규:
  - `ReportLogEntry`, `VideoReportData` 타입. `console`의 `message`는 `ConsoleEntry.args`에서 옮김.
  - `buildReportTimeline(networkLog, consoleLog, videoStartedAt, videoCapturedAt)` — 순수 함수.
  - `buildVideoReportHtml(data)` — 인라인 CSS/JS 플레이어 포함 HTML 문자열. 플레이어 CSS/JS는 `String.raw` 상수. JSON 블록 직렬화 시 `<` → `<` escape.
  - `buildVideoReportAttachment(data)` — `{ filename: "bugshot-report.html", dataUrl }`.
  - `downloadVideoReport(data)` — `<a download>` 트리거, 결과 `sizeBytes` 반환.
  - `buildVideoReportDataFromIssue(issue)` — `getVideoBlob`/`getNetworkLog`/`getConsoleLog` + `blobToDataUrl`로 조립.

**검증**: `pnpm test` — T2 테스트 통과. `buildVideoReportHtml` 출력 크기가 임계 근처일 때 동작 확인(과대 입력 스모크). `pnpm typecheck` 통과.

## T4. 리포트 플레이어 인터랙션 (HTML 내장 vanilla JS)

`buildVideoReportHtml`의 인라인 스크립트로 구현:

- [ ] 좌측 sticky 비디오(`poster`=썸네일) + 하단 타임라인 마커, 우측 스크롤 로그 목록 레이아웃.
- [ ] 로그 행 클릭 → `video.currentTime` 점프. 로그 행은 `<button>`/`tabindex` + Enter로 키보드 점프 가능.
- [ ] `timeupdate` → 현재 로그 행 active(`aria-current`) + 자동 스크롤(기본 ON, 수동 스크롤 시 OFF + "Resume auto-scroll" 플로팅 버튼).
- [ ] 타입 필터 칩 (`Network` / `Errors` / `Warnings` / `Logs`) — 목록 + 마커 동시 필터. 기존 `ConsoleLogContent`/`NetworkLogContent` 분류와 정렬.
- [ ] 키보드 `Space` / `←→` / `J K`. 포커스가 인터랙티브 요소(버튼·칩)에 있을 땐 가로채지 않음.
- [ ] 타임라인 마커 호버 툴팁. 마커 위치 = `ts / nominalDurationMs` clamp `[0,1]`.
- [ ] 빈 상태: 로그 0건 / 필터 결과 0건 각각 안내 메시지(아이콘 원 + muted 텍스트).
- [ ] `video` 로드 에러 시 player 영역에 코덱 안내, 로그 패널은 유지(영상 점프만 비활성).

**검증**: 임시로 HTML 파일을 디스크에 써서 Chrome/Firefox/Safari(최신 stable)에서 직접 열어 인터랙션 확인.

## T5. Preview 다운로드 진입점 + i18n

- [ ] `src/sidepanel/tabs/PreviewPanel.tsx` — 비디오 모드일 때 "HTML Report" 버튼 추가, editor store에서 `VideoReportData` 조립 → `downloadVideoReport`. `videoBlob`이 `null`이면(패널 재오픈) `buildVideoReportDataFromIssue(issue)` 폴백.
- [ ] `downloadVideoReport` 반환 `sizeBytes`가 25MB 초과면 토스트 경고.
- [ ] `src/i18n/` ko/en — 버튼 라벨·토스트 문자열 추가.

**검증**: `pnpm typecheck` 통과.

## T6. 제출 시 HTML 리포트 첨부

- [ ] 제출 핸들러(IssueCreateModal / SubmitFieldsDialog) — 비디오 모드 이슈 제출 시 `VideoReportData` 조립(활성 세션은 editor store, saved draft는 `buildVideoReportDataFromIssue`) → `buildVideoReportAttachment`.
- [ ] `src/sidepanel/lib/submitToGithub.ts` — 리포트 첨부를 `logs` 배열에 추가. `guessMime`에 `.html → text/html` 분기 추가.
- [ ] `src/sidepanel/lib/submitToLinear.ts` — 리포트 첨부 추가.
- [ ] `src/sidepanel/lib/submitToNotion.ts` — 리포트 첨부를 `log` 카테고리로 추가.
- [ ] Jira `submitIssue` 경로 — 리포트 첨부 추가.
- [ ] 리포트 첨부 실패가 이슈 본문 생성·`bugshot.md` 첨부를 막지 않도록 격리.

**검증**: `pnpm typecheck` 통과. 4개 플랫폼 제출 후 이슈에 `bugshot-report.html`이 첨부되는지 수동 확인. element/screenshot 모드 제출엔 첨부되지 않는지 확인(회귀).

## T7. 종단 검증

- [ ] `pnpm dev` 로드, 임의 페이지에서 비디오 모드 캡처 — 녹화 중 콘솔 로그/네트워크 요청 의도적 발생, 로그 첨부 토글 ON.
- [ ] Preview 패널 "HTML Report" 버튼 → `.html` 다운로드.
- [ ] 다운로드한 HTML을 Chrome/Firefox/Safari에서 열어 확인:
  - 영상 재생, 헤더 메타 표시.
  - 로그 행 클릭 → 영상 점프. 영상 재생 → 로그 행 하이라이트 + 자동 스크롤. 수동 스크롤 → "Resume" 버튼.
  - 타입 필터 토글 → 목록·마커 동시 필터.
  - 키보드 단축키 동작. 칩에 포커스 시 `Space` 가로채지 않음.
  - 녹화 구간 밖 로그 없음.
- [ ] 4개 플랫폼 제출 → 이슈에 `bugshot-report.html` 첨부 확인 → 내려받아 동일 인터랙션 확인.
- [ ] 로그 미첨부 비디오 이슈 → 영상만, 로그 패널 빈 상태.
- [ ] 필터 결과 0건 → 빈 상태 안내.
- [ ] 구버전 draft(`videoStartedAt` 없음) export → 로그 타임라인 없이 영상만, 크래시 없음.
- [ ] 장시간(50~60초) 녹화 + 로그 다수 → 25MB 초과 시 토스트 경고 동작.
- [ ] ko/en 양쪽 빌드에서 버튼 라벨·토스트 확인.
- [ ] `pnpm typecheck`, `pnpm test` 통과.

## 문서 신선도

- [ ] `CLAUDE.md` 디렉터리 구조 — `src/sidepanel/lib/`에 `buildVideoReport` 추가 반영.
- [ ] `README.md` — 기능 목록에 HTML 리포트(Preview 다운로드 + 제출 시 첨부) 추가.
- [ ] `ARCHITECTURE.md` — 세션 영속화에 `videoStartedAt`, 플랫폼 어댑터 절에 비디오 리포트 첨부 흐름 반영.
