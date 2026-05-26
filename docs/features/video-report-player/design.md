# 기술 설계 — 비디오 모드 HTML 리포트

## 핵심 설계 결정

### 1. 녹화 시작·종료 시각 영속화 (필수 선행 작업)

로그를 영상 타임라인에 맞추려면 `상대ms = log.timestamp − 녹화시작시각`이, 타임라인 스케일에는 녹화 길이가 필요하다. 그런데:

- 녹화 시작 시각은 `src/sidepanel/video-recorder.ts:14`의 `state.startTime`으로만 존재 — **메모리 전용, 영속화 안 됨**.
- 영속되는 건 `editor-store.ts`의 `videoCapturedAt`(`EditorState` 선언 `:87` / `initial` `:189`, `onRecordingComplete` 구현 `:292`에서 `Date.now()`로 set)뿐인데, 이는 녹화 **완료** 시각 — blob 조립·썸네일 생성(`video-recorder.ts:73-93`) 후라 실제 녹화 종료보다 수백 ms~1초 늦다.
- 네트워크 `NetworkRequest.startTime`(`src/types/network.ts:16`) / 콘솔 `ConsoleEntry.timestamp`(`src/types/console.ts:6`)는 둘 다 절대 epoch ms → 녹화 시작 시각만 있으면 그대로 차감 가능.

→ 두 시각을 모두 영속화한다:
- `videoStartedAt` — `state.startTime`. `onRecordingComplete`로 흘려보내 editor store 신규 필드에 저장.
- `videoEndedAt` — `onstop` 콜백 진입 즉시 `Date.now()`로 찍은 값. `videoCapturedAt`은 썸네일 생성 후라 부정확하므로 타임라인 스케일·구간 필터에는 `videoEndedAt`을 쓴다(`videoCapturedAt`은 기존 용도 그대로 둠).

제출 시 첨부(아래)는 제출 시점의 editor store 또는 saved draft의 `IssueRecord`에서 타이밍을 읽으므로 `IssueRecord`도 `videoStartedAt`/`videoEndedAt`을 보유해야 한다.

**realm 주의**: `videoStartedAt`/`videoEndedAt`은 side panel 컨텍스트의 `Date.now()`이고, network/console 레코더 타임스탬프는 녹화 대상 탭(MAIN world)의 시계다. 같은 머신의 두 JS realm이라 동일 시스템 시계를 공유하므로 실무상 차감이 안전하다 — 이 가정에 의존한다.

**세션 영속화 주의**: `EditorSnapshot`에 `videoStartedAt`/`videoEndedAt`을 추가하는 것만으로는 부족하다. `src/sidepanel/hooks/useEditorSessionSync.ts`의 `snapshotFromState()`가 스냅샷 필드를 **수동으로 일일이 복사**하므로(`videoCapturedAt: s.videoCapturedAt` 등), 두 필드도 거기 명시적으로 추가해야 한다. 누락 시 타입은 통과(`Pick`)하지만 패널 재오픈 후 런타임에서 값이 사라져 타임라인이 깨진다.

### 2. 리포트 필터 UI는 vanilla 재구현, 분류는 기존 콘솔 UI와 정렬

기존 `ConsoleLogContent`/`NetworkLogContent`의 필터는 React + shadcn 컴포넌트라 의존성 0인 단일 HTML에서 그대로 못 쓴다. 리포트 내 필터는 vanilla JS 타입 칩 토글로 새로 구현한다.

분류 체계는 codebase와 어긋나면 안 된다. 기존 `ConsoleLogContent`는 console 레벨 칩(`all`/`error`/`warn`/`info`/`debug`/`log` 6종)을, `NetworkLogContent`는 콘텐츠 타입 칩(`all`/`json`/`js`/`css`/`img`/`font`/`doc`/`other` 8종)을 쓴다. 리포트는 **콘솔 분류를 그대로 차용**한다 — console 레벨 칩(`error`/`warn`/`info`/`debug`/`log`)을 동일하게 쓰고, 네트워크는 콘텐츠 타입까지 쪼개지 않고 **단일 `Network` 토글**로 둔다. 콘솔 칩은 기존 화면과 완전히 일치하고, 네트워크는 외부 수신자·좁은 화면 맥락상 8칩이 과하므로 단일 토글로 단순화한다(의도된 차이).

### 3. 타임라인 마커 = 호버 미리보기, 점프는 로그 행 클릭

짧은 녹화에서 마커가 겹쳐 정밀 클릭이 어렵다. 마커는 시각 표시 + 호버 툴팁만 담당하고, 영상 점프는 로그 행 클릭으로 받는다.

### 4. 타임라인 스케일은 `videoEndedAt − videoStartedAt`

MediaRecorder WebM blob은 `video.duration`이 `Infinity`로 나오는 알려진 버그가 있다. 마커 위치 계산은 영속된 두 epoch 값의 차(`nominalDurationMs = videoEndedAt − videoStartedAt`)를 쓰고, 재생 위치 추적은 `video.currentTime` 이벤트를 쓴다.

`videoEndedAt`은 `onstop` 콜백 진입 즉시 찍은 `Date.now()`라 실제 녹화 종료에 거의 일치한다(`videoCapturedAt`은 썸네일 생성 후라 수백 ms~1초 늦어 타임라인 스케일엔 부적합 — 핵심 설계 1 참조). 마커 위치는 `ts / nominalDurationMs`를 `[0, 1]`로 clamp해 타임라인 바를 벗어나지 않게 한다.

### 5. 파일 저장 & 제출 시 첨부

- **Preview 다운로드**: `downloads` 권한이 없으므로 `<a download>` + `URL.createObjectURL(blob)`로 저장 (manifest 변경 불필요).
- **제출 시 첨부**: 비디오 모드 이슈 제출 시 HTML 리포트를 `bugshot-report.html`로 만들어 4개 플랫폼 이슈에 파일 첨부(아래 "제출 시 HTML 리포트 첨부" 절). 기존 `bugshot.md`(AI 메타) 첨부와 같은 경로를 탄다.
- **로그 가용성**: 로그는 `networkLogBlobKey`/`consoleLogBlobKey`가 있을 때만 존재(= 사용자가 로그 첨부를 켠 경우). 없으면 리포트는 영상 + meta만, 로그 패널은 빈 상태로 graceful degradation.

## 데이터 모델 변경

### editor-store.ts

`EditorState` / `initial` / `EditorSnapshot`에 `videoStartedAt: number | null`, `videoEndedAt: number | null` 추가. `onRecordingComplete`(시그니처 `:109` 부근, 구현 `:292`)가 두 시각을 인자로 받아 set:

```
onRecordingComplete: (blob, thumbnail, viewport, startedAt, endedAt) => set({
  phase: "drafting", videoBlob: blob, videoThumbnail: thumbnail,
  videoViewport: viewport, videoStartedAt: startedAt, videoEndedAt: endedAt,
  videoCapturedAt: Date.now(),
})
```

### issues-store.ts

`IssueRecord`에 `videoStartedAt?: number`, `videoEndedAt?: number` 추가. saved draft를 나중에 `DraftDetailDialog`에서 제출할 때 editor store가 그 이슈를 들고 있지 않을 수 있으므로 `IssueRecord`가 타이밍을 보유해야 한다.

- persist 버전 v5 → v6. `ISSUES_STORE_VERSION` 상수 위 v5 주석 블록(`issues-store.ts:175` 부근)에 v6 줄을 덧붙인다.
- **마이그레이션 코드는 추가하지 않는다.** 신규 필드 전부 optional이므로 v4→v5와 동일하게 `ISSUES_STORE_VERSION`만 6으로 bump + 주석. `migrate` 함수 본체는 무변경.
- 구 비디오 이슈/draft는 두 필드가 `undefined` → 리포트가 로그 타임라인 없이 영상만 렌더.

### video-recorder.ts

`onstop` 콜백 진입 즉시 `const localEndedAt = Date.now()`로 실제 녹화 종료 시각을 찍는다. `state = null` 전에 `startTime`을 지역 변수로 보존(현재 `localTabId` 보존 패턴과 동일), blob 조립 후 `onRecordingComplete(blob, thumbnail, viewport, localStartTime, localEndedAt)`로 전달.

### confirmDraft (editor-store.ts:376 video 분기)

`saveDraft({ ... })` 객체에 `videoStartedAt: state.videoStartedAt ?? undefined`, `videoEndedAt: state.videoEndedAt ?? undefined` 포함.

## 신규 모듈: `src/sidepanel/lib/buildVideoReport.ts`

순수 함수 위주. exports:

- `interface ReportLogEntry` — discriminated union:
  - `kind: "network"` → `id, ts, method, url, status, durationMs, phase`
  - `kind: "console"` → `id, ts, level, message, stack?`
  - `id`는 마커↔로그 행 연결·점프 타깃 식별용 안정 키. console은 `ConsoleEntry.id`(`console.ts:13`)를 옮기고, network는 `NetworkRequest`의 식별자(없으면 `kind`+인덱스 합성)를 쓴다. 인덱스 기반 매칭의 취약성을 피한다.
  - `ts`는 녹화 시작 기준 상대 ms. `console`의 `message`는 `ConsoleEntry.args`(직렬화된 문자열 — 실제 필드명은 `message`가 아니라 `args`)에서 옮긴다.
- `buildReportTimeline(networkLog, consoleLog, videoStartedAt, videoEndedAt): ReportLogEntry[]` — **순수 함수**.
  - `videoStartedAt`/`videoEndedAt` 타입은 `number | null | undefined`. 둘 중 하나라도 없으면 빈 배열 반환 (구 이슈 graceful degradation).
  - 두 로그를 상대 ts(`startTime|timestamp − videoStartedAt`)로 변환·병합.
  - `[0, videoEndedAt − videoStartedAt]` 구간으로 필터 (경계 포함).
  - ts 오름차순 정렬. 동일 ts는 입력 순서 보존(stable) — network·console이 같은 ms일 때 결정적. `Array.prototype.sort`의 ES2019 stable 보장에 의존한다(타깃 Chrome 116+ · Node 테스트 환경 모두 안전).
  - `null` 입력(로그 미첨부)은 빈 배열로 취급.
  - `videoEndedAt ≤ videoStartedAt`(비정상 음수 duration)이면 빈 배열.
- `interface VideoReportData` — `{ meta: { title, url, viewport, capturedAt, userAgent }, videoDataUrl, videoMime, nominalDurationMs, logs: ReportLogEntry[] }`. `videoDataUrl`은 영상 blob을 확보하지 못하면 빈 문자열 — 이때 리포트는 로그만 담아 export한다(아래 "영상 부재" 참조).
- `buildVideoReportHtml(data): string` — 완성된 HTML 문자열 조립. 인라인 `<style>` + `<script>` + `<script type="application/json" id="bugshot-report">`(meta + logs) + `<video src="dataUrl">`. 플레이어 CSS/JS는 같은 파일 내 `String.raw` 상수.
  - **XSS 방어**: `JSON.stringify(...)` 결과를 `.replace(/</g, "\\u003c")`로 escape해 사용자/페이지 제어 문자열(`title`/`url`/console `args`/network `url`)이 `</script>`로 JSON 블록을 조기 종료시키지 못하게 한다. 리포트 내장 스크립트는 DOM 렌더 시 `textContent`/`createElement`만 쓰고 `innerHTML`은 쓰지 않는다.
- `buildVideoReportAttachment(data): { filename, dataUrl }` — `buildVideoReportHtml` 결과를 `data:text/html;base64,...`로 인코딩, filename `bugshot-report.html`(상수 `VIDEO_REPORT_FILENAME`). 제출 시 첨부용.
- `downloadVideoReport(data): { sizeBytes: number }` — HTML → Blob → `<a download>` 트리거. 결과 크기를 반환해 호출부가 25MB 초과 시 토스트 경고를 띄울 수 있게 한다.
- `buildVideoReportDataFromIssue(issue): Promise<VideoReportData>` — 제출 전 draft / saved draft용. `getVideoBlob(id)`, `getNetworkLog(networkLogBlobKey)`, `getConsoleLog(consoleLogBlobKey)`로 조립. PreviewPanel의 `videoBlob` 폴백(아래)과 제출 시 saved draft 경로에서 쓴다.

영상 dataUrl 변환은 기존 `blobToDataUrl`(`src/store/blob-db.ts:448`) 재사용.

테스트 대상은 `buildReportTimeline` 순수 함수에 한정한다 — `buildVideoReportHtml`은 거대 문자열, `downloadVideoReport`는 DOM/`URL.createObjectURL` 부수효과라 단위 테스트 부적합.

## 제출 시 HTML 리포트 첨부

비디오 모드 이슈를 제출할 때 `buildVideoReportAttachment`로 만든 `bugshot-report.html`을 플랫폼 이슈에 파일 첨부한다. 기존 `buildAiMetaAttachment`(`bugshot.md`)와 동일 패턴 — `{ filename, dataUrl }` 형태.

- **데이터 출처**: 제출 핸들러가 비디오 모드일 때 `VideoReportData`를 조립한다. 활성 세션 제출은 `IssueCreateModal.tsx`의 4개 핸들러가 editor store(`videoBlob` 등)에서, saved draft 제출은 `DraftDetailDialog.tsx`의 4개 핸들러가 `buildVideoReportDataFromIssue`로. (`SubmitFieldsDialog`는 `IssueCreateModal.tsx`가 export하는 필드 입력 폼일 뿐 제출 로직이 없다 — 제출 핸들러는 `IssueCreateModal.tsx` + `DraftDetailDialog.tsx` 두 파일.)
- **조립 타이밍**: `VideoReportData` 조립은 `submitToX` 호출 인자로 들어가므로 `submitToX` 호출 *전*, editor store의 `videoBlob`이 `onSubmitted`(`editor-store.ts:520`)로 비워지기 전에 끝나야 한다.
- **플랫폼 wiring**: 4개 submit 함수가 이미 첨부 리스트를 iterate한다.
  - `submitToGithub` — `logs` 배열에 추가.
  - `submitToLinear` — `attachments` 배열에 추가 (`createAttachment`).
  - `submitToNotion` — `attachments`에 `log` 카테고리로 추가 (첨부 섹션 file 블록).
  - Jira — `submitIssue` 핸들러의 `attachments` 배열에 추가.
- **mime 처리**: `guessMime`은 `submitToGithub.ts` / `submitToLinear.ts` / `submitToNotion.ts` **3파일에 각각 독립 정의**돼 있다. 세 곳 모두 `.html → text/html` 분기를 추가해야 리포트가 `application/octet-stream`으로 떨어지지 않는다.
- **실패 격리**: 리포트 첨부가 플랫폼 용량 한도 등으로 실패해도 이슈 본문 생성·`bugshot.md` 첨부는 정상 진행한다. 리포트 첨부만 best-effort로 누락(위험 요소 참조).

## 리포트 HTML 구조 (받는 사람 화면)

```
┌──────────────────────────────────────────────────────────┐
│  이슈 제목 · URL · 뷰포트 · 캡처 시각 · userAgent          │
├───────────────────────────┬──────────────────────────────┤
│   Video Player (sticky)   │  [필터: Network·Errors·…]    │
│                           │  ─────────────────────────── │
│   ▶ ━━●━━━━━━━━━━━━━━━━   │  [+0.4s] network GET /api    │
│   타임라인 + 로그 마커     │  [+1.2s] console error ...   │
└───────────────────────────┴──────────────────────────────┘
```

- 헤더: 제목 · URL · 뷰포트 · 캡처 시각 · userAgent.
- 좌측(sticky): `<video controls>` + 하단 타임라인 바(로그 발생 마커, 호버 툴팁). `poster`로 녹화 썸네일(`videoThumbnail`)을 깔아 대용량 dataUrl 디코딩 전 검은 화면을 피한다.
- 우측(스크롤): 시간순 로그 행 `[+ts초] type · content`, 상단에 타입 필터 칩.

### 인터랙션

- 로그 행 클릭 → `video.currentTime = entry.ts / 1000`.
- `timeupdate` → 현재 시각 로그 행 active 스타일 + `scrollIntoView({ block: "nearest" })`. 자동 스크롤 기본 ON, 사용자 수동 스크롤 시 OFF + 우측 패널 하단 중앙에 "Resume auto-scroll" 반투명 pill 버튼 노출 → 클릭 시 ON 복귀.
- 필터 칩 → 로그 목록 + 타임라인 마커 동시 필터.
- 타임라인 마커는 점프 불가(점프는 로그 행 클릭으로만 받음 — 핵심 설계 3). 마커에 `cursor: default`를 명시해 클릭 affordance를 죽이고, 호버 툴팁만 제공한다.
- 키보드: `Space` 재생/정지, `←/→` 1초 점프, `J/K` 이전/다음 로그 점프.
  - 포커스가 `<button>`/필터 칩 등 인터랙티브 요소에 있을 땐 `Space`/`J`/`K` 커스텀 핸들러를 가로채지 않는다(네이티브 동작 우선).
- 빈 상태: 로그 0건이면 우측 패널에 "No logs captured" 안내. 필터 결과 0건이면 "No logs match the current filter" 안내(`NetworkLogContent`의 noResults 대응). 기존 `ConsoleLogContent`/`NetworkLogContent`의 빈 상태와 같은 형태를 vanilla CSS로 재현 — 아이콘 원(`rounded-full` + `bg-muted` 상당 배경 + 패딩 12px), 아이콘 24px, 세로 중앙정렬 gap 12px, muted 텍스트.
- **영상 부재**: `videoDataUrl`이 비면(blob 만료 등으로 `videoBlob` 폴백도 실패) 좌측 player 영역에 "영상 없음" 안내를 표시하고 로그 패널은 정상 동작 — 로그만 담긴 리포트로 graceful degrade(영상 점프만 비활성). 다운로드/export 자체는 막지 않는다.
- `video` 로드 에러 시 player 영역에 코덱 안내 메시지를 덮어 표시하되, **로그 패널·타임스탬프 목록은 계속 동작**(영상 점프만 비활성). graceful degrade.

### 접근성

- 로그 행은 `<button>` 또는 `tabindex="0"` + Enter 처리로 키보드 점프 가능.
- 현재 재생 위치의 active 로그 행에 `aria-current="true"`.
- 리포트 UI는 영문 단일이라 i18n 부담 없음 — a11y 속성은 충분히 부여.

### 리포트 내 JSON 블록 스키마

```html
<script type="application/json" id="bugshot-report">
{
  "meta": { "title": "...", "url": "...", "viewport": [1440, 900],
            "capturedAt": "2026-05-18T12:34:56Z", "userAgent": "..." },
  "video": { "mimeType": "video/mp4", "nominalDurationMs": 15240 },
  "logs": [
    { "ts": 412, "kind": "network", "method": "GET", "url": "/api/x",
      "status": 500, "durationMs": 234, "phase": "complete" },
    { "ts": 1203, "kind": "console", "level": "error", "message": "...", "stack": "..." }
  ]
}
</script>
```

영상 dataUrl은 `<video src>`에 직접 인라인하고, JSON 블록은 meta + logs만 담는다 (다중 MB base64를 JSON 문자열에 넣지 않음). 직렬화 시 `<` → `<` escape.

## 진입점

- **PreviewPanel.tsx** — 기존 "Copy Markdown" 버튼(JSX 블록 `:193-203`)을 비디오 모드일 때 `Export ▾` DropdownMenu로 묶고, 메뉴에 "Copy Markdown" + "HTML Report" 두 항목을 둔다. editor store(`videoBlob`, `videoStartedAt`, `videoEndedAt`, `videoViewport`, `target`, `networkLog`, `consoleLog`)에서 `VideoReportData` 조립 → `downloadVideoReport`.
  - **신규 컴포넌트**: `DropdownMenu`는 코드베이스에 미설치 → `npx shadcn@latest add dropdown-menu`로 설치 후 `src/components/ui/dropdown-menu.tsx` 위치 확인.
  - 비디오 모드가 아닌 모드(element/freeform)에서는 기존처럼 "Copy Markdown" 단일 버튼을 그대로 둔다 — DropdownMenu는 비디오 모드 한정.
  - `videoBlob`은 `EditorSnapshot`에 없다(스냅샷엔 `videoThumbnail`/`videoViewport`/`videoCapturedAt`만 있음). 패널을 닫았다 열면 `videoBlob`이 `null`이다. 이 경우 현재 이슈 id로 `buildVideoReportDataFromIssue(issue)` 폴백.
- **제출 시 첨부** — "제출 시 HTML 리포트 첨부" 절 참조. IssueListTab에는 별도 export 진입점을 두지 않는다(제출 시 영상·로그 blob이 정리되므로 사후 재가공 불가).
- **i18n** — `src/i18n/` ko/en 로케일에 버튼 라벨·토스트 문자열 추가. 리포트 *내부* UI는 영문 고정(빌드 언어와 무관), 확장 UI만 다국어.

## 위험 요소

- **플랫폼 첨부 용량 한도**: 60초 / 1.5Mbps 영상은 base64 인라인 시 ~15MB, HTML 전체로는 더 커진다. Jira Cloud 기본 첨부 한도는 10MB(인스턴스별 설정 가능)라 리포트 첨부가 거부될 수 있다. GitHub·Linear·Notion도 한도가 있다. V1은 첨부 실패를 격리(이슈 본문·`bugshot.md` 첨부는 정상)하고, 한도 초과 사전 차단·압축은 후속 검토.
- **WebM + Safari, `file://` 미디어 제약**: 녹화가 WebM로 떨어지거나 Safari의 `file://` 미디어 로딩 제약에 걸리면 Safari가 영상을 못 연다 — `video` 에러 핸들러 + graceful degrade로 처리(로그 패널은 유지). Safari 영상 재생은 best-effort이며, 성공 기준 필수 브라우저는 Chrome·Firefox.
- **MAIN world 주입 무관**: 이 기능은 SW→탭 주입을 쓰지 않으므로 `executeScript` 직렬화 규칙과 무관.

## 수정·신규 파일 요약

| 파일 | 변경 |
|---|---|
| `src/sidepanel/video-recorder.ts` | `onstop`에서 `startTime`/`Date.now()`(endedAt) 보존 후 `onRecordingComplete`에 전달 |
| `src/store/editor-store.ts` | `videoStartedAt`/`videoEndedAt` 필드(`EditorState`/`initial`/`EditorSnapshot`) + `onRecordingComplete` 시그니처/구현 + `confirmDraft` video 분기 |
| `src/sidepanel/hooks/useEditorSessionSync.ts` | `snapshotFromState()`에 `videoStartedAt`/`videoEndedAt` 복사 추가 |
| `src/store/issues-store.ts` | `IssueRecord`에 `videoStartedAt?`/`videoEndedAt?` + `ISSUES_STORE_VERSION` v6 bump(마이그레이션 코드 무변경) |
| `src/sidepanel/lib/buildVideoReport.ts` | **신규** — 타임라인/HTML 빌더/첨부 빌더/다운로드/이슈 어댑터 |
| `src/sidepanel/lib/__tests__/buildVideoReport.test.ts` | **신규** — `buildReportTimeline` 단위 테스트 |
| `src/components/ui/dropdown-menu.tsx` | **신규** — `npx shadcn@latest add dropdown-menu` |
| `src/sidepanel/tabs/PreviewPanel.tsx` | 비디오 모드 `Export ▾` DropdownMenu("Copy Markdown" + "HTML Report") + `videoBlob` 폴백 |
| `src/sidepanel/lib/submitToGithub.ts` | 비디오 리포트 첨부 + `guessMime` `.html` 분기 |
| `src/sidepanel/lib/submitToLinear.ts` | 비디오 리포트 첨부 + `guessMime` `.html` 분기 |
| `src/sidepanel/lib/submitToNotion.ts` | 비디오 리포트 첨부(`log` 카테고리) + `guessMime` `.html` 분기 |
| `src/background/` (Jira submitIssue 경로) | 비디오 리포트 첨부 |
| `src/sidepanel/tabs/IssueCreateModal.tsx` | 활성 세션 제출 핸들러 — 비디오 모드 시 `VideoReportData` 조립 → 첨부 전달 |
| `src/sidepanel/tabs/DraftDetailDialog.tsx` | saved draft 제출 핸들러 — 비디오 모드 시 `buildVideoReportDataFromIssue` 조립 → 첨부 전달 |
| `src/i18n/` (ko/en) | 신규 문자열 |
