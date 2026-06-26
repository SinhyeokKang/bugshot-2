# WebSocket 프레임 캡처

## 배경

BugShot 네트워크 레코더는 `fetch` / `XMLHttpRequest` / `navigator.sendBeacon`만 후킹한다(`src/content/network-recorder.ts`). WebSocket 연결과 그 프레임(메시지)은 전혀 캡처되지 않는다. `src/types/network.ts:37`의 `WS_UNSUPPORTED` 경고 literal은 타입 union에만 박혀 있고 실제 레코더에서 쓰이지 않는다 — 계획만 하고 미구현된 흔적.

실시간 통신(채팅, 라이브 시세, 협업 커서, 알림 푸시 등)을 WebSocket으로 구현한 페이지에서 버그가 나면, 현재 BugShot으로는 그 통신 내역을 하나도 담을 수 없다. 캡처한 네트워크 로그는 BugShot의 핵심 가치 — **이슈 제출**에 직결된다: 로그는 logs.html(30s Replay 뷰어)에 실리고, 본문 로그 요약(`buildNetworkLogSummary`)으로 이슈 본문에 들어간다. WebSocket을 못 잡으면 실시간 앱 버그 리포트는 핵심 증거가 빈다.

경쟁 도구 Jam은 `window.WebSocket` 생성자를 Proxy로 감싸 connect/send/receive/close 이벤트를 잡고, 크롬 DevTools는 연결을 Network 목록에 한 줄로 쌓고 상세 패널의 **Messages** 탭에서 프레임을 시간순으로 보여준다.

## 목표

- 페이지가 연 WebSocket 연결을 네트워크 로그 목록(LNB)에 **연결당 행 1개**로 쌓는다. status `101`로 표시.
- 연결 행을 클릭하면 상세 패널의 **Messages 탭**에서 그 연결의 프레임 기록을 시간순으로 뿌린다(▲send / ▼receive + open/close 이벤트).
- 텍스트 프레임 본문을 캡처한다. 바이너리 프레임(ArrayBuffer/Blob/TypedArray)은 캡처하지 않는다.
- **이슈 제출 정합**: 비정상 close된 WS 연결을 `phase:"error"`로 매핑해, 기존 본문 로그 요약(`buildNetworkLogSummary`, `src/sidepanel/lib/buildLogSummary.ts:20`의 `r.phase==="error" || r.status>=400` 필터)과 logs.html 네트워크 탭에 추가 배관 없이 자연히 실리게 한다.
- **누락 가시화**: 바이너리 스킵·프레임 캡으로 인한 "캡처 N / 전체 M" 격차를 Messages 패널 헤더 배지로 노출해 "메시지 누락" 혼란을 막는다.
- 캡처한 프레임을 기존 네트워크 로그 파이프라인(pre-arm 버퍼링 → sentinel dispatch → 사이드패널 머지 → IndexedDB 영속 → 30s Replay log-viewer)에 그대로 태운다.
- 30s Replay의 log-viewer에서 WS 연결 행·프레임을 보여주고, 각 프레임의 시크 칩으로 영상 위치를 점프할 수 있게 한다.
- HAR 익스포트에 WebSocket 연결과 프레임을 Chrome 호환 확장 필드로 담는다.

## 비목표 (Non-goals)

- **바이너리 프레임 본문 캡처 안 함**. Jam과 동일하게 텍스트 프레임만. 바이너리는 아예 기록하지 않는다(메타 행도 안 남김 — `framesTotal` 카운트에만 반영).
- **EventSource(SSE) 후킹 안 함**. 이번 스코프는 WebSocket 한정. (SSE는 현재도 fetch HTTP 요청으로만 잡히고 스트림 본문은 제외 — 그대로 둔다.)
- **영상 재생 헤드 기반 프레임 하이라이트 안 함** (v1 제외). 기존 log-viewer는 console/network/action 어느 로그도 playhead로 활성 행을 하이라이트하지 않는다(`App.tsx`가 `activeTs`를 로그 컴포넌트에 전달하지 않음). WS만 신규 배선하지 않는다. log-viewer에서 WS는 **연결 행 + Messages 프레임 리스트 + 프레임 단위 seek 칩**까지만 — 후속 과제로 미룬다.
- **프레임 단위 타임라인 마커 안 만듦**. log-viewer 영상 타임라인 마커는 연결 단위(open 시각)로만(`markers.ts` 기존 로직). 프레임마다 마커를 찍으면 마커가 폭증한다.
- **WebSocket 핸드셰이크 응답 헤더 표시 안 함**. WebSocket API는 페이지 컨텍스트에서 101 응답 헤더를 노출하지 않는다 — Headers 탭은 URL·서브프로토콜·status 101만.
- **프레임 전송/필터 외 조작 기능 없음**. 재전송, 프레임 편집 등 미포함.
- **권한·매니페스트 변경 없음**. WebSocket 후킹은 fetch 후킹과 동일하게 페이지 컨텍스트(MAIN world)에서 일어나 추가 권한이 필요 없다.

## 사용자 시나리오

### 주 플로우: 라이브 서브탭에서 WebSocket 통신 확인
1. 사용자가 WebSocket을 쓰는 페이지에서 BugShot 사이드패널을 연다(레코더 자동 arming).
2. 페이지가 `new WebSocket(url)`로 연결을 연다 → 네트워크 서브탭 목록에 `101  WS  wss://…/socket` 행 1개가 뜬다(연결 유지 중 pending = 호박색).
3. 양방향 메시지가 오가면 그 연결 행 안에 프레임이 누적된다(목록 행 자체는 1개 유지).
4. 행을 클릭 → 상세 패널이 **Messages 탭으로 바로 열린다**(WS는 기본 탭 = Messages). 탭 구성은 `Headers / Messages`.
5. **Messages 탭**: 헤더에 카운트 배지(예: `42 frames · 3 binary skipped`), 본문에 프레임이 시간순으로 — `▲ {"type":"sub"}  18B  0:01`, `▼ {"type":"ack"}  12B  0:01` … open/close 이벤트도 한 줄씩.
6. JSON 프레임은 클릭하면 `JsonTreeViewer`로 트리 펼침. All / Send / Receive 방향 필터로 좁히기(open/close 이벤트 행은 필터와 무관하게 항상 표시 — 연결 수명 컨텍스트).
7. 연결이 닫히면 행이 complete(정상)·error(비정상 close)로 바뀌고 Messages 끝에 close 이벤트 행이 추가된다. 비정상 close 연결은 이슈 본문 로그 요약 에러 섹션에 잡힌다.

### 보조 플로우: 30s Replay에서 영상과 함께 확인
1. 사용자가 30s Replay로 영상을 캡처해 이슈에 첨부한다.
2. log-viewer를 열면 Network 탭에 WS 연결 행이 동일하게 보인다.
3. 연결 행을 펼친 Messages 탭에서 각 프레임의 **시크 칩을 누르면 그 프레임 시각으로 영상이 점프**한다(연결 행 자체도 기존처럼 open 시각 시크 칩 제공). *프레임 활성 하이라이트는 v1 비목표.*

### 엣지 케이스
- **바이너리 프레임**: 목록·Messages 어디에도 안 나타난다. `framesTotal` 통계와 Messages 헤더 배지(`N binary skipped`)로만 드러난다.
- **동시 다중 연결**: 페이지가 연 WS 연결마다 행 1개로 분리된다(연결당 1회 부여하는 고유 id 기준).
- **재연결 폭주**: reconnect loop로 연결이 N개 생성되면 각각 행 1개. 연결 엔트리 수는 기존 `ENTRY_CAP`(5000)에 함께 걸려 oldest부터 evict된다(`ENTRY_CAPPED` 경고).
- **프레임 폭주**: 고빈도 소켓(초당 수백 프레임)은 연결당 프레임 캡(FIFO)에 걸려 오래된 프레임부터 evict되고 `WS_FRAMES_CAPPED` 경고가 뜬다.
- **큰 텍스트 프레임**: 프레임 본문 캡(`BODY_CAP`) 초과 시 잘리고 `BODY_TRUNCATED` 경고(기존 경고 재사용).
- **replay 창 이전 open**: 연결이 영상 구간보다 먼저 열렸으면(`trimByTime`이 연결 open 시각 = `startTime`으로만 필터) 연결 엔트리가 구간에 포함되며 창 밖 프레임까지 함께 실린다(허용 — 연결은 영상 직전에 시작될 수 있음).
- **민감 데이터**: 텍스트 프레임이 JSON이면 기존 마스킹 경로로 토큰·비밀번호 키를 마스킹.
- **pre-arm 경계**: sentinel 도착 전 열린 연결도 pre-arm 버퍼에 적재돼 reload logClear 경계를 보존(기존 `preArm` 플래그 재사용).
- **빈/경계 케이스**: 연결만 열고 프레임 0, open 프레임 없이 즉시 비정상 close, 빈 문자열 프레임(`""`), `ws://`→`wss://` 모두 행 렌더·분류가 깨지지 않아야 한다.
- **페이지 무간섭**: 후킹 실패(CSP·frozen WebSocket 등)해도, `instanceof WebSocket`·정적 상수(`WebSocket.OPEN`) 사용 페이지에서도 원본 WebSocket 동작이 절대 깨지지 않는다(try/catch 격리 + 생성자 Proxy forward).

## 성공 기준

- WebSocket을 여는 테스트 페이지에서 연결이 네트워크 목록에 행 1개(status 101)로 뜨고, send/receive 텍스트 프레임이 Messages 탭에 시간순으로 누적된다.
- WS 행 클릭 시 상세 패널이 Messages 탭으로 바로 열린다.
- 바이너리 프레임은 캡처되지 않고, Messages 헤더 배지의 "N binary skipped"로 가시화된다.
- 동시 다중 연결이 각각 별도 행으로 분리되고, 비정상 close 연결이 `phase:"error"`로 본문 로그 요약·logs.html에 반영된다.
- 페이지 측 WebSocket 송수신 동작이 BugShot 후킹 유무와 무관하게 동일하다(무간섭 — `instanceof`·정적 상수 포함).
- 30s Replay log-viewer에서 WS 연결·프레임이 보이고, 프레임 시크 칩으로 영상이 해당 시각으로 점프한다.
- HAR 익스포트에 WS 연결이 `_resourceType:"websocket"` + `_webSocketMessages`로 담긴다.
- 기존 fetch/XHR/sendBeacon 캡처·머지·캡·영속 동작에 회귀가 없다.
- `pnpm test`가 신규 순수 함수 단위 테스트를 포함해 통과한다.
