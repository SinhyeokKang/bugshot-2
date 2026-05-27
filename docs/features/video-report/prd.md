# 비디오 리포트 — log-viewer 영상 동기화 플레이어

> **이 문서는 `docs/features/video-report-player/`(from-scratch vanilla HTML 리포트, `buildVideoReport.ts`)를 대체한다.** 그 접근은 이미 출시된 React log-viewer(`src/log-viewer/`, Console/Network/Actions 3탭)와 중복이라 폐기한다. 대신 **기존 log-viewer에 영상 플레이어 한 칸을 붙이고 로그를 영상 타임라인에 동기화**한다. 구현 종료 후 `video-report-player/` 디렉터리는 사용자가 삭제한다.

## 배경

비디오 모드(수동 녹화 + 30s-replay)로 잡은 버그는 영상 + network/console/action 로그가 한 이슈에 첨부된다. 현재 첨부물:

- `recording.mp4` — 영상 단독 파일.
- `logs.html` — Console/Network/Actions 3탭 React 뷰어(자기완결 단일 HTML). 제출 시 자동 첨부.

문제는 **영상과 로그가 따로 논다**는 것. 받는 사람은 영상에서 "버그가 난 순간"을 찾고, 다시 logs.html로 가서 그 시각의 에러 로그를 눈으로 짝지어야 한다. 시간 축 연결이 없다.

action-recorder가 이미 머지돼 `ActionEntry.timestamp`(절대 epoch ms)·`ActionLog.startedAt`이 존재하고, console/network 로그도 동일한 절대 timestamp를 갖는다. 즉 **모든 로그가 이미 절대 시각을 들고 있다.** 영상 시작 시각(앵커) 하나만 확보하면 `상대초 = (entry.timestamp − videoStartedAt) / 1000`으로 영상과 로그를 묶을 수 있다.

→ log-viewer에 ① 영상 플레이어 칸을 추가하고 ② `recording.mp4`를 logs.html 안으로 임베드해 단일 파일을 유지하며 ③ 로그 행 ↔ 영상 재생 위치를 양방향 동기화한다.

## 목표

비디오 모드 이슈 제출 시 첨부되는 `logs.html`을 열면:

1. 좌측 영상 플레이어, 우측 기존 Console/Network/Actions 탭이 **가로로 나란히**(초기 5:5, 가운데 드래그 핸들로 너비 조정, 둘 다 100vh) 표시된다.
2. **어느 탭이든** 로그 행을 클릭하면 영상이 그 로그가 찍힌 시각으로 점프한다.
3. 영상 재생 중에는 현재 재생 시각에 해당하는 로그 행이 각 탭에서 하이라이트된다.
4. 모든 탭의 상대시간 표시(`+MM:SS`)가 **영상 시작 시각을 공통 0점**으로 통일된다.

영상은 기존 이슈 본문 인라인(`recording.mp4`)을 유지하면서, logs.html 안에도 dataUrl로 임베드해 단일 파일 뷰어의 동기화를 가능케 한다. logs.html 자체는 외부 의존성 0인 자기완결 파일이다.

## 비목표 (Non-goals)

- **`recording.mp4` 인라인 첨부 폐지** — 하지 않는다. 4개 플랫폼 본문 인라인 영상 프리뷰는 그대로 유지하고, logs.html에는 동기화용으로 영상을 **추가** 임베드한다(전송량 ~2배 trade-off는 성공 기준·열린 질문 참조).
- **타임라인 마커 / 재생바 위 로그 표식 UI** — 후속. (사용자: "추후 타임스탬프 UI를 재생바에 추가하는 식으로.")
- **키보드 단축키**(Space/←→/J·K), **자동 스크롤 + Resume pill** — 후속. 코어는 행 클릭 점프 + 현재 행 하이라이트뿐.
- **Preview 패널 다운로드 진입점** — 제출 자동 첨부만. Preview에 logs.html 다운로드 UI는 추가하지 않는다(이번 스코프는 "제출된 이슈의 영상-로그 동기화"에 집중 — 제출 전 직접 공유 흐름은 후속).
- **element / screenshot / freeform 모드** — 영상이 없으므로 플레이어 칸 없음. logs.html은 기존대로 탭만.
- **리포트 UI 다국어** — log-viewer는 ko/en 사전을 이미 갖고 있어 신규 문자열만 양 사전에 추가. 새 다국어 체계 도입 없음.
- **`buildVideoReport.ts` 등 vanilla 리포트 빌더** — 만들지 않는다(폐기된 접근).

## 사용자 시나리오

### S1. 영상-로그 동기화로 원인 추적 (핵심)

QA가 비디오 모드로 버그를 녹화(녹화 중 콘솔 에러·네트워크 500·클릭/입력 발생)하고 Jira에 제출한다. 첨부된 `logs.html`을 개발자가 열면 좌측 영상, 우측 탭이 나란히 뜬다. Network 탭에서 `500 POST /api/checkout` 행을 클릭하면 영상이 그 요청이 나간 순간으로 점프한다. 영상을 재생하면 Console 탭에서 그 직후 찍힌 `TypeError` 행이 하이라이트된다. "결제 클릭 → 500 → TypeError"의 시간 순서를 한 화면에서 본다.

### S2. 영상 없이 (graceful degradation)

저장된 draft가 오래돼 영상 blob이 IndexedDB에서 만료됐거나(`getVideoBlob` null), 구버전 draft라 `videoStartedAt`/`videoEndedAt`이 없는 경우(`videoStartedAt`/`videoEndedAt`은 이 기능에서 처음 도입되므로 **출시 전 저장된 모든 비디오 draft가 여기 해당** — 출시 직후 한동안 다수다. 동기화는 신규 녹화부터 적용):

- 영상 blob 없음 → logs.html에 플레이어 칸 없이 기존처럼 탭만 풀폭 표시. 크래시 없음.
- 앵커(startedAt/endedAt) 없음 → 영상은 재생되되 로그 동기화(점프·하이라이트·공통 상대시간)는 비활성. 각 탭은 기존 동작.

### S3. 좁은/넓은 화면 너비 조정

받는 사람이 가운데 핸들을 드래그해 영상:로그 비율을 7:3, 3:7 등으로 조정한다. 초기값은 5:5.

## 성공 기준

- 비디오 모드 이슈를 4개 플랫폼에 제출하면 기존 본문 인라인 영상이 그대로 보이고(`recording.mp4`/Jira ADF mediaSingle 유지), 동시에 영상이 임베드된 `logs.html`이 첨부된다.
- 이슈 본문 인라인 영상이 4개 플랫폼 모두 회귀 없이 재생된다(GitHub/Linear/Notion inline, Jira ADF).
- `logs.html`을 Chrome/Firefox에서 열면 좌측 영상 + 우측 3탭이 가로 5:5로 뜨고, 가운데 핸들로 너비를 조정할 수 있다(둘 다 100vh).
- 임의 탭의 로그 행 클릭 → 영상이 해당 시각으로 점프.
- 영상 재생 → 현재 시각에 해당하는 행이 각 탭에서 하이라이트.
- 세 탭의 `+MM:SS`가 영상 시작 0점 기준으로 통일된다.
- 영상 blob 부재 시 플레이어 칸 없이 탭만, 앵커 부재 시 동기화만 비활성 — 둘 다 크래시 없음.
- element/screenshot/freeform의 `logs.html`엔 플레이어 칸이 없다(영상 미임베드).
- 신규 Chrome 권한 0건. 새 수집 대상 0건. 단 영상이 본문 인라인 + logs.html 임베드 **양쪽**에 실리므로 비디오 모드 제출의 전송량은 영상 1개분만큼 증가(~2배)한다 — 의도된 trade-off(인라인 프리뷰 유지 + 동기화 vs 용량).
- `pnpm typecheck` / `pnpm test` 통과(동기화 순수 헬퍼 + buildLogsHtml/buildCaptureFiles 단위 테스트 포함).

## 열린 질문 — 결론

| 질문 | 결론 |
|---|---|
| 영상을 logs.html에 어떻게 담나 | `__BUGSHOT_DATA__` JSON에 `video.dataUrl`로 임베드. `recording.mp4` 본문 인라인 첨부는 **유지**(폐지 아님) — logs.html은 동기화용 추가 임베드. |
| 임베드로 logs.html이 ~20MB+가 되면 (제출 첨부 한도) | 첨부 시도 후 실패는 격리 — 이슈 본문·인라인 영상·`bugshot.md` 첨부는 정상 진행, logs.html 첨부만 best-effort 누락. Jira는 `messages.ts:343-362`가 per-attachment try/catch로 이미 격리(확인됨), GitHub/Linear/Notion은 구현 시 확인. logs.html이 누락돼도 인라인 영상은 본문에 남아 영상 자체가 사라지지 않는다. |
| 영상 임베드 logs.html을 Jira/Linear가 `injectIssueUrl`로 왕복할 때 | `injectIssueUrl`(base64 전체 디코드→파싱→재인코딩)이 ~20MB에서 SW 블로킹/OOM 위험 → 대용량에 견디게 최적화(design 위험 요소). |
| 동기화 앵커 | `videoStartedAt`/`videoEndedAt` 신규 영속화. 수동녹화=`startTime`/`onstop` 시각, 30s-replay=`frames[0].timestamp`/`captureTime`. 모든 탭 공통 0점. |
| 상대시간 표시 기준 | 영상 있으면 세 탭 모두 `videoStartedAt` 기준으로 통일. 영상 없으면 기존(각 로그 자기 startedAt). |
| 레이아웃 | 가로 분할, 드래그 핸들, 초기 5:5, 둘 다 100vh. shadcn `resizable`(react-resizable-panels) 신규 설치. |
| 인터랙션 범위 | 코어만 — 행 클릭 점프 + 현재 행 하이라이트. 마커·키보드·자동스크롤은 후속. |
| 진입점 | 제출 자동 첨부만. |
