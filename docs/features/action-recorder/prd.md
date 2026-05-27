# 액션 레코더 (Repro Steps)

## 배경

bugshot-2 비디오 모드와 30s-replay는 화면 영상 + 네트워크 로그 + 콘솔 로그를 캡처한다. 그러나 "사용자가 버그를 **어떻게 재현했는가**"는 영상 안에만 있다. 이슈를 받는 개발자는 영상을 처음부터 끝까지 눈으로 따라가며 어떤 버튼을 눌렀고 무엇을 입력했는지 역추적해야 한다.

Jam(jam.dev)은 이 문제를 "repro steps"로 푼다 — 녹화 중 Capture 스크립트가 클릭·텍스트 입력·페이지 이동 같은 DOM 이벤트를 잡아 "Submit 버튼 클릭", "이메일 입력란에 입력" 같은 자연어 단계 목록으로 만든다. 이 구조화된 데이터는 그대로 재현 경로가 되고, AI가 깔끔한 재현 절차로 다듬는 입력이 된다.

bugshot-2에도 동일한 캡처 계층을 추가한다. 이미 `network-recorder`/`console-recorder`라는 검증된 레코더 패턴이 있으므로, 세 번째 레코더 `action-recorder`를 같은 틀로 얹는다. 캡처한 액션은 network/console 로그와 동일하게 버퍼에 누적되고, 이슈 제출 시 첨부되는 **log-viewer HTML 리포트**(`src/log-viewer/`)에 'Actions' 탭으로 합류한다 — 이미 출시된 Console/Network 탭 리포트에 세 번째 탭을 더하는 형태.

## 목표

- **비디오 녹화 및 30s-replay 중** 사용자의 **클릭/탭, 페이지 이동, 텍스트 입력**을 구조화된 로그(`ActionEntry[]`)로 캡처한다.
- 캡처된 액션을 network/console 로그처럼 **버퍼에 누적**한다 (MAIN world 페이지 버퍼 + 사이드패널 store 누적).
- video-record는 녹화 중 **페이지를 이동해도 액션 로그가 누적**된다. 30s-replay는 capture 시점에 **최근 ~30초 윈도우로 트림**한다 (network/console과 동일 정책).
- 텍스트 입력 값은 기록하되 **password·민감 필드는 마스킹**해 PII/자격증명 노출을 막는다.
- 액션 로그가 AI 초안 작성 시 **참고용 메타 정보**로 프롬프트에 포함된다.
- 이슈 제출 시 첨부되는 **log-viewer HTML 리포트의 'Actions' 탭**에 액션이 시간순으로 표시된다 (**video/30s-replay 한정**).

## 비목표 (Non-goals)

- **`stepsToReproduce`(재현 과정) 섹션 자동 채움 안 함.** 액션 로그는 AI 프롬프트 메타로만 들어가고, AI가 그 섹션을 어떻게 채울지는 기존 동작 그대로 둔다.
- **이슈 본문에 별도 "액션 로그" 요약 섹션을 만들지 않는다.** 네트워크/콘솔처럼 마크다운/ADF 본문에 섹션을 추가하지 않는다.
- **라이브 사이드패널 'Actions' 서브탭을 만들지 않는다.** 액션은 버퍼에만 조용히 쌓이고, 사용자에게는 **이슈 제출 후 log-viewer HTML에서만** 노출된다. 디버그 탭은 issue/console/network 3개 서브탭을 그대로 유지한다.
- **freeform·screenshot·element 모드는 log-viewer 'Actions' 탭에서 제외.** `logs.html`은 video/freeform/screenshot에 계속 생성되지만, 액션은 `captureMode === "video"`(수동 녹화 + 30s-replay)일 때만 리포트에 주입한다.
- **키보드 단축키·스크롤 캡처 안 함.** 노이즈 대비 가치가 낮아 1차 범위에서 제외.
- **video-report 타임라인 UI 구현 안 함.** 영상-로그 시간 동기화 타임라인 player(`docs/features/video-report-player/`)는 미구현 스펙이며 이번 범위 밖. 이번 소비자는 타임라인이 아닌 **tabbed log-viewer**다.

## 사용자 시나리오

### S1. 비디오 녹화로 재현 경로 캡처 (핵심)

1. 사용자가 사이드패널에서 비디오 모드 녹화를 시작한다. 녹화 시작 시 그동안 백그라운드 버퍼에 쌓여 있던 녹화 이전 라이브 액션은 한 번 비워지고, 이 시점부터 새 녹화 세션 단위로 누적이 시작된다.
2. A 페이지에서 "장바구니 담기" 버튼을 클릭하고, 쿠폰 코드를 입력란에 입력한다.
3. 링크를 눌러 B 페이지(`/checkout`)로 이동한다.
4. B 페이지에서 "결제" 버튼을 클릭한다 — 여기서 버그 발생.
5. 녹화를 종료하고 이슈를 제출한다.
6. 이슈에 첨부된 `logs.html`을 브라우저로 열면 Console/Network와 나란히 'Actions' 탭이 있고, A·B 양쪽 액션이 **하나의 시간순 목록**으로 남아 있다:
   - `클릭: 장바구니 담기 버튼`
   - `입력: 쿠폰 코드 입력란 → "WELCOME10"`
   - `이동: /cart → /checkout`
   - `클릭: 결제 버튼`
7. 제출 전 AI 초안을 생성하면 이 액션 목록이 프롬프트에 참고 정보로 포함돼, 초안 본문이 실제 재현 경로를 반영한다.

### S2. 민감 정보 입력

1. 녹화 중 로그인 폼에서 이메일과 비밀번호를 입력한다.
2. log-viewer 'Actions' 탭에서 이메일은 `입력: 이메일 입력란 → "user@x.com"`로, 비밀번호는 `입력: 비밀번호 입력란 → ***`(마스킹 배지)로 표시된다.
3. 신용카드 번호 필드(`name="cardNumber"`)도 값이 `***`로 마스킹된다.
4. log-viewer는 외부 공유 가능한 HTML 첨부이므로 마스킹은 PII 보호의 마지막 방어선이다.

### S3. SPA 라우팅

1. 녹화 중 React Router 기반 SPA에서 메뉴를 클릭해 라우트가 바뀐다(전체 페이지 리로드 없음, `history.pushState`).
2. 'Actions' 탭에 `이동: /dashboard → /settings (pushState)` entry가 남는다.

### S4. 30s-replay로 재현 경로 캡처

1. 30s-replay는 **명시적 녹화 시작이 없다** — 사이드패널이 열린 idle 상태에서 화면 프레임과 network/console 로그를 롤링 버퍼에 계속 쌓는다. 액션도 같은 방식으로 백그라운드 버퍼에 누적된다.
2. 사용자가 "장바구니 담기" 클릭 → 쿠폰 입력 → `/checkout` 이동 → "결제" 클릭(버그)을 하고, 30s-replay capture 버튼을 누른다.
3. capture 시점에 최근 ~30초 윈도우(`frames[0].timestamp` ~ captureTime)로 액션이 **트림**된다 — 윈도우 밖의 오래된 액션은 제외된다 (network/console과 동일).
4. 이슈를 제출하면 `logs.html`의 'Actions' 탭에 그 윈도우의 액션만 시간순으로 남는다.

### 엣지 케이스

- **클릭 직후 즉시 페이지 이동**: 클릭 → 즉시 unload 시 마지막 클릭 1건이 sync 전에 소실될 수 있다. 페이지 이동 자체는 새 페이지의 `navType:"load"` entry로 보존된다. (network/console 레코더와 동일한 알려진 한계 — 수용.)
- **비-녹화 상태**: 라이브 서브탭이 없으므로 사용자에게 보이는 것은 없다. 백그라운드 버퍼는 계속 동작하다가 페이지 이동 시 초기화된다(Console/Network와 동일). 누적·트림은 video-record 세션 또는 30s-replay capture에서만 일어난다.
- **`name`/`id` 없는 커스텀 입력 컴포넌트**: 마스킹 힌트를 찾지 못하면 값이 그대로 캡처될 수 있다 — `contenteditable` 등은 부모의 password 힌트로 보수적 판정.
- **액션 0건인 video/30s-replay 이슈**: 클릭 없이 녹화만 하거나 윈도우가 액션을 전부 trim out한 경우 `actionLog`가 null 또는 빈 entries다. log-viewer 'Actions' 탭은 disabled(데이터 없음) 또는 "캡처된 액션 없음" 빈 상태로 표시한다.

## 성공 기준

- 비디오 녹화·30s-replay 중 클릭·페이지 이동·텍스트 입력이 `ActionEntry`로 캡처되어 버퍼에 누적된다.
- **video-record**: 녹화 중 페이지를 2회 이상 이동해도 모든 페이지의 액션이 중복 없이(`id` dedup) 한 목록에 누적된다. 녹화 시작 시 녹화 이전 라이브 액션이 비워지고 녹화 세션 액션만 누적된다.
- **30s-replay**: capture된 시간 윈도우(`frames[0].timestamp` ~ captureTime) 밖의 액션은 제외된다. (30s-replay에는 "녹화 시작 시 clear" 개념이 없다 — 트림이 진실의 원천.)
- `type="password"` 및 민감 필드명 입력 값이 `***`로 마스킹된다.
- AI 초안 생성 시 프롬프트에 액션 로그가 참고 메타로 포함되고, `stepsToReproduce` 섹션이 자동으로 채워지지는 않는다.
- 이슈 제출 시 `captureMode === "video"`이면 액션 로그가 `LogViewerData.actionLog`로 주입되어 `logs.html`의 'Actions' 탭에 시간순 렌더된다. freeform·screenshot의 `logs.html`에는 'Actions' 탭이 없다(actionLog null).
- 새 Chrome 권한 0건 — 기존 content_scripts MAIN world 범위 내에서 동작.
- `pnpm typecheck` / `pnpm test` 전체 통과 (헬퍼 순수 함수 + buildLogsHtml/buildCaptureFiles + log-viewer i18n 단위 테스트 포함).
