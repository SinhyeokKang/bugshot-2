# 태스크 — 비디오 모드 HTML 리포트

구현 순서는 의존성 기준. 각 태스크는 검증 체크를 포함한다.

## T1. 녹화 시작·종료 시각 영속화

- [ ] `src/sidepanel/video-recorder.ts` — `onstop` 콜백 진입 즉시 `const localEndedAt = Date.now()`. `state = null` 전에 `startTime`을 지역 변수로 보존, `onRecordingComplete(blob, thumbnail, viewport, localStartTime, localEndedAt)` 호출.
- [ ] `src/store/editor-store.ts` — `EditorState` / `initial` / `EditorSnapshot`에 `videoStartedAt: number | null`, `videoEndedAt: number | null` 추가. `onRecordingComplete` 시그니처에 `startedAt`/`endedAt` 인자 추가, set에 두 필드 반영.
- [ ] `src/sidepanel/hooks/useEditorSessionSync.ts` — `snapshotFromState()`에 `videoStartedAt: s.videoStartedAt`, `videoEndedAt: s.videoEndedAt` 복사 추가 (누락 시 패널 재오픈 후 값 소실).
- [ ] `src/store/editor-store.ts` `confirmDraft` video 분기(`:376`) — `saveDraft` 객체에 `videoStartedAt`, `videoEndedAt` 포함.
- [ ] `src/store/issues-store.ts` — `IssueRecord`에 `videoStartedAt?: number`, `videoEndedAt?: number` 추가. `ISSUES_STORE_VERSION` v5 → v6 bump (마이그레이션 코드 추가 없음, `:175` 부근 v5 주석 블록에 v6 줄 추가).

**검증**:
- `pnpm typecheck` 통과.
- `src/store/__tests__/editor-store.test.ts` — `onRecordingComplete` 호출 테스트는 현재 존재하지 않으므로 **신규 작성**한다. `onRecordingComplete(blob, thumb, viewport, startedAt, endedAt)` 후 `videoStartedAt`/`videoEndedAt`/`videoCapturedAt`가 set 되는지, `confirmDraft` video 분기가 `saveDraft`에 `videoStartedAt`/`videoEndedAt`을 싣는지 단위 테스트.
- 수동: 비디오 모드 녹화 후 패널을 닫았다 열어 `videoStartedAt`/`videoEndedAt`이 보존되는지 확인.

## T2. `buildReportTimeline` 테스트 작성 (test-first)

- [ ] `src/sidepanel/lib/__tests__/buildVideoReport.test.ts` 작성:
  - 네트워크 + 콘솔 로그가 상대 ts로 변환되고 ts 오름차순 병합되는지.
  - 녹화 구간 밖(ts < 0, ts > duration) 로그가 제거되는지.
  - 경계값(ts = 0, ts = duration) 포함 여부.
  - `null` 로그(미첨부) 입력 시 빈 배열.
  - `videoStartedAt` 또는 `videoEndedAt`이 `null`/`undefined`일 때 빈 배열 (구 이슈). `videoStartedAt`은 있고 `videoEndedAt`만 없는 비대칭 케이스도 명시적으로 검증.
  - `videoEndedAt ≤ videoStartedAt`(음수 duration) 비정상 입력 시 빈 배열.
  - network·console 엔트리가 동일 ts일 때 정렬 안정성(입력 순서 보존).
  - `phase: "pending"` 미완료 네트워크 요청도 `startTime`이 구간 내면 포함되는지.
  - 대량 데이터(network ~5000 + console ~2000, FIFO 상한 근처)에서 정렬·필터가 정상이고 결과가 결정적인지.
  - 각 엔트리에 `id`가 채워지는지 (console은 `ConsoleEntry.id`, network는 합성 키).

**검증**: 테스트는 작성 시점에 실패(구현 전) — 인터페이스만 확정.

## T3. `buildVideoReport` 모듈 구현

- [ ] `src/sidepanel/lib/buildVideoReport.ts` 신규:
  - `ReportLogEntry`(각 엔트리에 `id` 포함), `VideoReportData` 타입. `console`의 `message`는 `ConsoleEntry.args`에서 옮김.
  - `buildReportTimeline(networkLog, consoleLog, videoStartedAt, videoEndedAt)` — 순수 함수.
  - `buildVideoReportHtml(data)` — 인라인 CSS/JS 플레이어 포함 HTML 문자열. 플레이어 CSS/JS는 `String.raw` 상수. JSON 블록 직렬화 시 `<` → `<` escape.
  - `buildVideoReportAttachment(data)` — `{ filename: "bugshot-report.html", dataUrl }`.
  - `downloadVideoReport(data)` — `<a download>` 트리거, 결과 `sizeBytes` 반환.
  - `buildVideoReportDataFromIssue(issue)` — `getVideoBlob`/`getNetworkLog`/`getConsoleLog` + `blobToDataUrl`로 조립. `getVideoBlob` 실패 시 `videoDataUrl`을 빈 문자열로 두고 로그만 담아 반환(영상 부재 degrade).

**검증**: `pnpm test` — T2 테스트 통과. 60초 영상 base64 인라인(약 25MB 입력)으로 `buildVideoReportHtml`이 OOM·문자열 truncation 없이 완성되는지 스모크 확인. `pnpm typecheck` 통과.

## T4. 리포트 플레이어 인터랙션 (HTML 내장 vanilla JS)

`buildVideoReportHtml`의 인라인 스크립트로 구현:

- [ ] 좌측 sticky 비디오(`poster`=썸네일) + 하단 타임라인 마커, 우측 스크롤 로그 목록 레이아웃.
- [ ] 로그 행 클릭 → `video.currentTime` 점프. 로그 행은 `<button>`/`tabindex` + Enter로 키보드 점프 가능.
- [ ] `timeupdate` → 현재 로그 행 active(`aria-current`) + 자동 스크롤(기본 ON, 수동 스크롤 시 OFF + 우측 패널 하단 중앙 "Resume auto-scroll" 반투명 pill 버튼).
- [ ] 타입 필터 칩 — console 레벨 칩(`error`/`warn`/`info`/`debug`/`log`, 기존 `ConsoleLogContent`와 동일 분류) + 단일 `Network` 토글. 목록 + 마커 동시 필터.
- [ ] 키보드 `Space` / `←→` / `J K`. 포커스가 인터랙티브 요소(버튼·칩)에 있을 땐 가로채지 않음.
- [ ] 타임라인 마커 호버 툴팁. 마커 위치 = `ts / nominalDurationMs` clamp `[0,1]`. 마커는 점프 불가 — `cursor: default`로 클릭 affordance 제거.
- [ ] 빈 상태: 로그 0건 / 필터 결과 0건 각각 안내 메시지 — 아이콘 원(`rounded-full` + muted 배경 + 패딩 12px), 아이콘 24px, gap 12px, muted 텍스트.
- [ ] `video` 로드 에러 시 player 영역에 코덱 안내, 로그 패널은 유지(영상 점프만 비활성).
- [ ] `videoDataUrl`이 빈 경우 player 영역에 "영상 없음" 안내, 로그 패널은 정상 동작(로그만 담긴 리포트).

**검증**: 임시로 HTML 파일을 디스크에 써서 Chrome/Firefox에서 직접 열어 인터랙션 확인. Safari는 best-effort로 확인(영상 안 열려도 로그 패널 동작 검증).

## T5. Preview 다운로드 진입점 + i18n

- [ ] `npx shadcn@latest add dropdown-menu` — `src/components/ui/dropdown-menu.tsx` 설치 위치 확인.
- [ ] `src/sidepanel/tabs/PreviewPanel.tsx` — 비디오 모드일 때 기존 "Copy Markdown" 버튼을 `Export ▾` DropdownMenu("Copy Markdown" + "HTML Report")로 묶는다. editor store에서 `VideoReportData` 조립 → `downloadVideoReport`. `videoBlob`이 `null`이면(패널 재오픈) `buildVideoReportDataFromIssue(issue)` 폴백. element/freeform 모드는 기존 단일 버튼 유지.
- [ ] `downloadVideoReport` 반환 `sizeBytes`가 25MB 초과면 토스트 경고.
- [ ] `src/i18n/` ko/en — 버튼/메뉴 라벨·토스트 문자열 추가.

**검증**:
- `pnpm typecheck` 통과.
- `pnpm test` — `src/i18n/__tests__/locales.test.ts`의 ko↔en 키 패리티·빈 값 테스트 통과(신규 키 누락 자동 검출).
- 수동: 비디오 모드 녹화 → 패널 닫고 다시 열기 → `Export ▾` → "HTML Report" → `videoBlob` 폴백 경로로 영상·로그가 정상 조립되는지 확인.
- 수동(회귀): element/freeform 모드 PreviewPanel에서 기존 "Copy Markdown" 버튼 레이아웃·동작이 깨지지 않는지 확인.

## T6. 제출 시 HTML 리포트 첨부

- [ ] `src/sidepanel/tabs/IssueCreateModal.tsx` — 활성 세션 4개 제출 핸들러. 비디오 모드일 때 editor store에서 `VideoReportData` 조립 → `buildVideoReportAttachment`. 조립은 `submitToX` 호출 전, `videoBlob`이 비워지기 전에 수행.
- [ ] `src/sidepanel/tabs/DraftDetailDialog.tsx` — saved draft 4개 제출 핸들러. 비디오 모드일 때 `buildVideoReportDataFromIssue` 조립 → `buildVideoReportAttachment`.
- [ ] `src/sidepanel/lib/submitToGithub.ts` — 리포트 첨부를 `logs` 배열에 추가. `guessMime`에 `.html → text/html` 분기 추가.
- [ ] `src/sidepanel/lib/submitToLinear.ts` — 리포트 첨부 추가. `guessMime`에 `.html` 분기 추가.
- [ ] `src/sidepanel/lib/submitToNotion.ts` — 리포트 첨부를 `log` 카테고리로 추가. `guessMime`에 `.html` 분기 추가.
- [ ] Jira `submitIssue` 경로 — 리포트 첨부 추가.
- [ ] 리포트 첨부 실패가 이슈 본문 생성·`bugshot.md` 첨부를 막지 않도록 격리.

**검증**:
- `pnpm typecheck` 통과.
- 4개 플랫폼 제출 후 이슈에 `bugshot-report.html`이 `text/html`로 첨부·인식되는지 수동 확인(특히 Linear/Notion).
- element/screenshot 모드 제출엔 첨부되지 않는지 확인(회귀).
- 실패 격리: Jira 첨부 한도(기본 10MB)를 넘기는 장시간 녹화로 리포트 첨부 거부를 의도적으로 유발 → 그때도 이슈 본문 등록·`bugshot.md` 첨부가 정상 완료되는지 확인.

## T7. 종단 검증

- [ ] `pnpm dev` 로드, 임의 페이지에서 비디오 모드 캡처 — 녹화 중 콘솔 로그/네트워크 요청 의도적 발생, 로그 첨부 토글 ON.
- [ ] Preview 패널 `Export ▾` → "HTML Report" → `.html` 다운로드.
- [ ] 다운로드한 HTML을 Chrome/Firefox에서 열어 확인 (Safari는 best-effort — 영상 안 열려도 로그 패널 동작):
  - 영상 재생, 헤더 메타 표시.
  - 로그 행 클릭 → 영상 점프. 영상 재생 → 로그 행 하이라이트 + 자동 스크롤. 수동 스크롤 → "Resume" 버튼.
  - 타입 필터 토글 → 목록·마커 동시 필터.
  - 키보드 단축키 동작. 칩에 포커스 시 `Space` 가로채지 않음.
  - 녹화 구간 밖 로그 없음.
- [ ] 4개 플랫폼 제출 → 이슈에 `bugshot-report.html` 첨부 확인 → 내려받아 동일 인터랙션 확인.
- [ ] 로그 미첨부 비디오 이슈 → 영상만, 로그 패널 빈 상태.
- [ ] 영상 dataUrl 부재(blob 만료 시뮬레이션) → 로그만 담긴 리포트로 degrade, 크래시 없음.
- [ ] 필터 결과 0건 → 빈 상태 안내.
- [ ] 구버전 draft(`videoStartedAt`/`videoEndedAt` 없음) export → 로그 타임라인 없이 영상만, 크래시 없음.
- [ ] 장시간(50~60초) 녹화 + 로그 다수 → 25MB 초과 시 토스트 경고 동작 + Jira 첨부 한도 초과 시 격리 동작 확인.
- [ ] ko/en 양쪽 빌드에서 버튼/메뉴 라벨·토스트 확인.
- [ ] `pnpm typecheck`, `pnpm test` 통과.

## 문서 신선도

- [ ] `CLAUDE.md` 디렉터리 구조 — `src/sidepanel/lib/`에 `buildVideoReport` 추가 반영. `store/` 주석의 `issues v5` → `v6` 갱신.
- [ ] `README.md` — 기능 목록에 HTML 리포트(Preview 다운로드 + 제출 시 첨부) 추가.
- [ ] `ARCHITECTURE.md` — 세션 영속화에 `videoStartedAt`/`videoEndedAt`, 플랫폼 어댑터 절에 비디오 리포트 첨부 흐름 반영.
