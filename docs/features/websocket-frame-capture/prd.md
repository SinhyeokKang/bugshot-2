# WebSocket 프레임 캡처

## 배경

BugShot 네트워크 레코더는 `fetch` / `XMLHttpRequest` / `navigator.sendBeacon`만 후킹한다(`src/content/network-recorder.ts`). WebSocket 연결과 그 프레임(메시지)은 전혀 캡처되지 않는다. `src/types/network.ts:37`의 `WS_UNSUPPORTED` 경고 literal은 타입 union에만 박혀 있고 실제 레코더에서 쓰이지 않는다 — 계획만 하고 미구현된 흔적.

실시간 통신(채팅, 라이브 시세, 협업 커서, 알림 푸시 등)을 WebSocket으로 구현한 페이지에서 버그가 나면, 현재 BugShot으로는 그 통신 내역을 하나도 담을 수 없다. 경쟁 도구 Jam은 `window.WebSocket` 생성자를 Proxy로 감싸 connect/send/receive/close 이벤트를 잡고, 크롬 DevTools는 연결을 Network 목록에 한 줄로 쌓고 상세 패널의 **Messages** 탭에서 프레임을 시간순으로 보여준다.

## 목표

- 페이지가 연 WebSocket 연결을 네트워크 로그 목록(LNB)에 **연결당 행 1개**로 쌓는다. status `101`로 표시.
- 연결 행을 클릭하면 상세 패널의 **Messages 탭**에서 그 연결의 프레임 기록을 시간순으로 뿌린다(▲send / ▼receive + open/close 이벤트).
- 텍스트 프레임 본문을 캡처한다. 바이너리 프레임(ArrayBuffer/Blob/TypedArray)은 캡처하지 않는다.
- 캡처한 프레임을 기존 네트워크 로그 파이프라인(pre-arm 버퍼링 → sentinel dispatch → 사이드패널 머지 → IndexedDB 영속 → 30s Replay log-viewer 동기화)에 그대로 태운다.
- 30s Replay의 log-viewer에서 영상 재생 헤드에 맞춰 Messages 탭의 활성 프레임을 하이라이트한다.
- HAR 익스포트에 WebSocket 연결과 프레임을 Chrome 호환 확장 필드로 담는다.

## 비목표 (Non-goals)

- **바이너리 프레임 본문 캡처 안 함**. Jam과 동일하게 텍스트 프레임만. 바이너리는 아예 기록하지 않는다(메타 행도 안 남김).
- **EventSource(SSE) 후킹 안 함**. 이번 스코프는 WebSocket 한정. (SSE는 현재도 fetch HTTP 요청으로만 잡히고 스트림 본문은 제외 — 그대로 둔다.)
- **프레임 단위 타임라인 마커 안 만듦**. log-viewer 영상 타임라인 마커는 연결 단위(open 시각)로만. 프레임마다 마커를 찍으면 마커가 폭증한다.
- **WebSocket 핸드셰이크 응답 헤더 표시 안 함**. WebSocket API는 페이지 컨텍스트에서 101 응답 헤더를 노출하지 않는다 — Headers 탭은 URL·서브프로토콜·status 101만.
- **프레임 전송/필터 외 조작 기능 없음**. 재전송, 프레임 편집 등 미포함.
- **권한·매니페스트 변경 없음**. WebSocket 후킹은 fetch 후킹과 동일하게 페이지 컨텍스트(MAIN world)에서 일어나 추가 권한이 필요 없다.

## 사용자 시나리오

### 주 플로우: 라이브 서브탭에서 WebSocket 통신 확인
1. 사용자가 WebSocket을 쓰는 페이지에서 BugShot 사이드패널을 연다(레코더 자동 arming).
2. 페이지가 `new WebSocket(url)`로 연결을 연다 → 네트워크 서브탭 목록에 `101  WS  wss://…/socket` 행 1개가 뜬다(연결 유지 중 pending = 호박색).
3. 양방향 메시지가 오가면 그 연결 행 안에 프레임이 누적된다(목록 행 자체는 1개 유지).
4. 행을 클릭 → 상세 패널 탭이 `Headers / Messages`로 바뀐다.
5. **Messages 탭**: 프레임이 시간순으로 — `▲ {"type":"sub"}  18B  00:01`, `▼ {"type":"ack"}  12B  00:01` … open/close 이벤트도 한 줄씩.
6. JSON 프레임은 클릭하면 `JsonTreeViewer`로 트리 펼침. All / Send / Receive 방향 필터로 좁히기.
7. 연결이 닫히면 행이 complete(정상)·error(비정상 close)로 바뀌고 Messages 끝에 close 이벤트 행이 추가된다.

### 보조 플로우: 30s Replay에서 영상과 동기화
1. 사용자가 30s Replay로 영상을 캡처해 이슈에 첨부한다.
2. log-viewer를 열면 Network 탭에 WS 연결 행이 동일하게 보인다.
3. 영상을 재생하면 Network 행은 기존처럼 open 시각 기준으로 활성 하이라이트되고, 연결 행을 펼친 **Messages 탭 안에서는 재생 헤드 시각에 해당하는 프레임이 하이라이트**된다.
4. 프레임의 시크 칩을 누르면 그 프레임 시각으로 영상이 점프한다.

### 엣지 케이스
- **바이너리 프레임**: 목록·Messages 어디에도 안 나타난다. 단 프레임 카운트 통계(`framesTotal`)에는 포함돼 "캡처 N / 전체 M" 격차로 드러난다.
- **프레임 폭주**: 고빈도 소켓(초당 수백 프레임)은 연결당 프레임 캡(FIFO)에 걸려 오래된 프레임부터 evict되고 `WS_FRAMES_CAPPED` 경고가 뜬다.
- **큰 텍스트 프레임**: 프레임 본문 캡 초과 시 잘리고 `BODY_TRUNCATED` 경고(기존 경고 재사용).
- **민감 데이터**: 텍스트 프레임이 JSON/urlencoded면 기존 `maskBody`로 토큰·비밀번호 키를 마스킹.
- **pre-arm 경계**: sentinel 도착 전 열린 연결도 pre-arm 버퍼에 적재돼 reload logClear 경계를 보존(기존 `preArm` 플래그 재사용).
- **페이지 무간섭**: 후킹 실패(CSP·frozen WebSocket 등)해도 원본 WebSocket 동작은 절대 깨지지 않는다(try/catch 격리).

## 성공 기준

- WebSocket을 여는 테스트 페이지에서 연결이 네트워크 목록에 행 1개로 뜨고, send/receive 텍스트 프레임이 Messages 탭에 시간순으로 누적된다.
- 바이너리 프레임은 캡처되지 않고, `framesTotal` 통계에만 반영된다.
- 페이지 측 WebSocket 송수신 동작이 BugShot 후킹 유무와 무관하게 동일하다(무간섭).
- 30s Replay log-viewer에서 WS 연결·프레임이 보이고 영상 재생과 동기화된다.
- HAR 익스포트에 WS 연결이 `_resourceType:"websocket"` + `_webSocketMessages`로 담긴다.
- 기존 fetch/XHR/sendBeacon 캡처·머지·캡·영속 동작에 회귀가 없다.
- `pnpm test`가 신규 순수 함수 단위 테스트를 포함해 통과한다.
