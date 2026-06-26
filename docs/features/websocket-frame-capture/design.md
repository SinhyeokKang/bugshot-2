# WebSocket 프레임 캡처 — 기술 설계

## 개요

`src/content/network-recorder.ts`(MAIN world)에 `window.WebSocket` 생성자 Proxy 후킹을 추가한다. 각 연결을 기존 `NetworkRequest` 엔트리 1개에 매핑하되(status `101`), 프레임은 새 `webSocket` 필드의 `frames` 배열에 담는다. 후킹·캡·dispatch·머지·영속·영상 동기화·HAR은 기존 네트워크 로그 인프라를 최소 침투로 재사용한다. UI는 DevTools 모델(연결=목록 행, 프레임=상세 Messages 탭)을 따라 `NetworkLogContent`의 상세 탭을 WebSocket일 때 `Headers / Messages`로 분기한다.

## 변경 범위

### 타입
- **`src/types/network.ts`** — 현재 `NetworkRequest`/`NetworkLog` 정의.
  - `NetworkRequest`에 `webSocket?: WebSocketMeta` 추가.
  - 새 타입 `WebSocketFrame`, `WebSocketFrameData`, `WebSocketMeta`, `WebSocketFrameDirection` 추가.
  - `NetworkLog.warnings`의 미사용 `"WS_UNSUPPORTED"` literal을 **`"WS_FRAMES_CAPPED"`로 교체**(이 기능이 그 자리를 대체 — 고아 제거).

### 레코더 (MAIN world)
- **`src/content/network-recorder.ts`** — fetch/XHR/sendBeacon 후킹·메모리 캡·sentinel dispatch 보유.
  - `window.WebSocket`을 Proxy로 감싸는 `patchWebSocket()` 추가. `capturing` 게이트로 attach 여부 결정.
  - 연결당 `CapturedRequest`(WS 변종) push + `open/message/close/error` 리스너 + `ws.send` Proxy로 프레임 적재.
  - `enforceMemoryCap()`/`estimateBodySize()` 확장: WS 프레임 payload도 메모리 계상·evict 대상에 포함, 연결당 프레임 캡(`MAX_WS_FRAMES_PER_CONN`) FIFO.
- **`src/content/network-recorder-helpers.ts`** — 순수 분류·마스킹 유틸 보유.
  - `classifyWsFrameData(data, contentTypeHint)` 추가: 텍스트면 문자열, 바이너리(ArrayBuffer/Blob/TypedArray/SharedArrayBuffer)면 `null`(드롭 신호), `BODY_CAP` 초과면 `{kind:"truncated"}`.
  - `maskWsFrame(text)` 추가: JSON이면 기존 `maskJsonBody` 재사용, 아니면 원문.

### 사이드패널 수신·머지
- **`src/sidepanel/lib/log-merge.ts`** — `mergeLogItems`/`rebuildNetworkLog` 보유. **변경 없음**(연결 엔트리는 id 기준 replace로 최신 frames를 통째로 덮어씀 — MAIN world가 매 flush마다 full frame 배열 재전송하므로 손실 없음). `rebuildNetworkLog`의 `warnings` 타입만 자동 반영.
- **`src/sidepanel/hooks/usePickerMessages.ts`** — `networkRecorder.data` 수신부. **변경 없음**(payload 구조 동일, frames는 request 내부에 동승).

### UI
- **`src/sidepanel/components/NetworkLogContent.tsx`** — 목록·상세 패널 렌더.
  - `RequestFilter`에 `"ws"` 추가, `classifyRequest`에 WebSocket 분기(`req.webSocket` 존재 시 `"ws"`).
  - `RequestRow`: WS 연결은 method 칸에 `WS`, status `101` 표시(`ContentTypeIcon`에 ws 아이콘 분기).
  - `DetailTab`: WS 엔트리일 때 탭 구성을 `Headers / Messages`로 분기(일반 요청은 기존 `Headers / Request / Response` 유지).
  - 새 `MessagesPanel` 서브컴포넌트: 프레임 테이블(방향 ▲▼ + Length + 상대시간 + 클릭 시 `JsonTreeViewer`), All/Send/Receive 필터, `activeTs` 기반 활성 프레임 하이라이트·시크칩(`LogSeekChip` 재사용).
- **`src/log-viewer/App.tsx`** — **변경 없음**(`NetworkLogContent`에 이미 `{...sync}`/`{...scrollProps}` 전달 중. Messages 탭 내부 동기화는 NetworkLogContent가 `syncBaseMs`/`activeTs`/`onSeek`를 MessagesPanel로 내려 처리).
- **`src/log-viewer/markers.ts`** — **변경 없음**(network 마커는 `r.startTime` = 연결 open 시각으로 자동 생성. 프레임 마커는 비목표).

### 익스포트
- **`src/sidepanel/lib/buildHar.ts`** — `requestToEntry`에 WS 분기 추가: `req.webSocket` 존재 시 entry에 `_resourceType:"websocket"` + Chrome 호환 `_webSocketMessages:[{type:"send"|"receive", time, opcode:1, data}]` 부착. open/close 이벤트는 `_webSocketMessages`에 포함하지 않음(Chrome 포맷은 데이터 프레임만).

### i18n
- **`src/i18n/namespaces/logs.ts`** — `networkLog.filter.ws`, `networkLog.tab.messages`, `networkLog.ws.*`(open/close/sent/received/binarySkipped/framesCapped 라벨) ko·en 동시 추가.

## 데이터 흐름

```
[MAIN world] page: new WebSocket(url)
  → window.WebSocket Proxy.construct
  → (capturing?) attachWsRecorder(ws):
       buffer.push( CapturedRequest{ id, url, status:101, phase:"pending",
                                     webSocket:{ protocol, frames:[], framesTotal:0 } } )
       ws.addEventListener("open")   → frames.push({direction:"open",   ts})
       ws.addEventListener("message")→ classifyWsFrameData → (text?) frames.push({direction:"receive", ts, data, size})  // binary면 framesTotal만++ 
       ws.send = Proxy                → classifyWsFrameData → (text?) frames.push({direction:"send",    ts, data, size})
       ws.addEventListener("close")  → frames.push({direction:"close", ts, code, reason, wasClean})
                                        phase = wasClean ? "complete" : "error"
       ws.addEventListener("error")  → (no frame; close가 뒤따라 처리)
       각 적재 후 throttle.schedule()  // 기존 trailing throttle 재사용
  → enforceMemoryCap()/연결당 프레임 캡  // 초과 시 oldest frame data evict + WS_FRAMES_CAPPED

[dispatch] (기존) CustomEvent "__bugshot_net_data__"+sentinel { requests: buffer.slice(), totalSeen, warnings }
  → [ISOLATED] recorder-bridge → runtime message "networkRecorder.data"
  → [sidepanel] usePickerMessages → mergeLogItems(byId replace) → rebuildNetworkLog → setNetworkLog → IndexedDB push

[UI] NetworkLogContent: 연결 = 목록 행 1개, 클릭 → Messages 탭에서 frames 렌더
[log-viewer] 동일 NetworkLogContent에 syncBaseMs/activeTs/onSeek 전달 → Messages 프레임 하이라이트·시크
```

## 인터페이스 설계

```typescript
// src/types/network.ts

export type WebSocketFrameDirection = "send" | "receive" | "open" | "close";

// 바이너리 프레임은 저장하지 않으므로 "binary" 변종 없음.
export type WebSocketFrameData =
  | string
  | { kind: "truncated"; limit: number; size: number };

export interface WebSocketFrame {
  direction: WebSocketFrameDirection;
  ts: number;                 // 프레임 발생 시각(절대 ms) — log-viewer 동기화 기준
  data?: WebSocketFrameData;  // open은 undefined; send/receive는 텍스트; close는 reason(있으면)
  size: number;               // payload 바이트 크기(open/close 등 control은 0)
  code?: number;              // close 전용
  reason?: string;            // close 전용
  wasClean?: boolean;         // close 전용
}

export interface WebSocketMeta {
  protocol: string;           // 협상된 서브프로토콜(없으면 "")
  frames: WebSocketFrame[];   // 연결당 프레임 캡(MAX_WS_FRAMES_PER_CONN) 적용된 보유분
  framesTotal: number;        // 캡처 시도 총 프레임 수(드롭된 바이너리·evict 포함)
}

export interface NetworkRequest {
  // ...기존 필드...
  webSocket?: WebSocketMeta;  // 존재하면 이 엔트리는 WebSocket 연결
}

// NetworkLog.warnings:
//   ("MEMORY_CAPPED" | "WS_FRAMES_CAPPED" | "BODY_TRUNCATED" | "ENTRY_CAPPED")[]
//   ("WS_UNSUPPORTED" → "WS_FRAMES_CAPPED" 교체)
```

```typescript
// src/content/network-recorder-helpers.ts (순수 함수 — 단위 테스트 대상)

// 텍스트면 문자열, 바이너리면 null(드롭), BODY_CAP 초과면 truncated.
export function classifyWsFrameData(
  data: unknown,
): string | { kind: "truncated"; limit: number; size: number } | null;

// JSON이면 maskJsonBody로 마스킹, 아니면 원문 그대로.
export function maskWsFrame(text: string): string;
```

```typescript
// src/content/network-recorder.ts (상수)
const MAX_WS_FRAMES_PER_CONN = 1000;   // 연결당 프레임 FIFO 캡
// 프레임 본문 캡은 기존 BODY_CAP(3MB) 재사용 — 초과 시 truncated + BODY_TRUNCATED 경고
```

## 기존 패턴 준수

- **동기 IIFE 청크 제약**: WebSocket 후킹 코드는 `network-recorder.ts`(이미 청크 내부) + `network-recorder-helpers.ts`(이미 같은 청크가 import) 안에만 둔다. `recorders-entry.ts`에 **새 외부 static import를 추가하지 않는다** — 추가하면 async loader로 되돌아가 pre-arm이 무력화된다(CLAUDE.md 회귀 주의).
- **capturing vs recording 게이트**: attach는 `capturing` 게이트로, dispatch·preArm 표시는 `recording` 게이트로(기존 fetch/XHR와 동일). sentinel 도착 전 연결도 `preArm:true`로 적재.
- **무간섭 보증**: fetch wrap의 try/catch 격리 패턴을 그대로 따라 후킹 실패 시 원본 WebSocket 동작을 절대 깨지 않는다.
- **메모리 다층 캡**: `MEMORY_CAP`(50MB)·`enforceMemoryCap()`에 프레임 payload를 합류시키고, 연결당 프레임 캡은 별도 FIFO. 기존 `ENTRY_CAP`(연결 엔트리 수)도 그대로 적용.
- **마스킹 일관성**: 텍스트 프레임은 기존 `maskBody`/`maskJsonBody` 경로 재사용 — 별도 마스킹 규칙 신설 금지.
- **i18n 동시 갱신**: `logs.ts` ko·en 키를 함께 추가(PostToolUse 훅이 대칭 검사).
- **테스트 우선**: 신규 순수 함수(`classifyWsFrameData`, `maskWsFrame`)는 `network-recorder-helpers.test.ts`에 테스트를 먼저 박는다.

## 대안 검토

### 대안 1: 프레임마다 독립 엔트리(Jam 내부 모델)
각 프레임을 `NetworkRequest`처럼 목록 행으로. **기각** — 채팅·고빈도 소켓에서 목록이 폭증해 일반 요청을 덮고, DevTools UX(연결=행)와 어긋나며, 사용자가 "연결당 1행 + Messages 탭" 모델을 명시 선택했다.

### 대안 2: `chrome.debugger` API로 Network.webSocketFrameReceived 이벤트 수신
DevTools 프로토콜로 정확한 프레임을 받음. **기각** — `debugger` 권한은 침습적이고 "다른 디버거가 부착됨" 경고 배너가 뜬다. MV3 service worker에서 탭별 attach 관리 복잡, BugShot의 page-context 후킹 철학과 불일치. 권한 추가 → privacy/심사 부담.

### 대안 3: 별도 `webSocketLog` 스토어·서브탭 신설
WS를 네트워크와 분리. **기각** — 머지·영속·영상 동기화·HAR·필터 인프라를 전부 중복 구현해야 한다. WS는 의미상 네트워크 활동이므로 기존 네트워크 로그에 합치는 게 최소 설계.

### 대안 4: 바이너리 프레임 메타 행 유지
`{kind:"binary", size}` 행을 남김. **기각** — 사용자가 "완전 스킵"을 선택. 단순성 우선, framesTotal 통계로 누락 가시화.

## 위험 요소

- **Proxy 정적 프로퍼티**: `window.WebSocket.CONNECTING`/`OPEN` 등 상수와 `instanceof WebSocket`이 Proxy 통과로 유지되는지 확인 필요(Proxy는 get/has를 forward하므로 정상이나 실제 탭 회귀 필수).
- **`ws.send` 인스턴스 Proxy**: 생성자 Proxy의 construct에서 반환된 인스턴스의 `send`만 감싼다. 페이지가 `send`를 재바인딩하거나 prototype 레벨로 호출하는 경우 누락 가능 — Jam도 인스턴스 레벨로 감싼다(허용 범위).
- **메모리**: 고빈도 텍스트 소켓은 프레임이 빠르게 쌓인다. 연결당 캡(1000) + `MEMORY_CAP` 합류로 방어하되, evict 동작을 실측 검증.
- **머지 시 frames 손실**: `mergeLogItems` byId replace가 incoming의 full frames로 덮으므로, MAIN world가 **항상 누적 full 배열을 재전송**해야 한다(부분 전송 금지). dispatch가 `buffer.slice()`로 full을 보내는 기존 동작에 의존 — 부분 diff 최적화 도입 시 회귀.
- **log-viewer 동기화 경계**: 연결 행 활성은 open 시각 기준이라, 연결이 영상 구간보다 먼저 열렸으면(trim 윗경계) 프레임만 구간 내일 수 있다. Messages 패널의 `activeTs` 하이라이트는 프레임 ts 기준으로 독립 동작하게 설계.
- **HAR 호환**: Chrome HAR의 `_webSocketMessages`는 비표준 확장. 표준 HAR 뷰어는 무시할 뿐 깨지지 않음(검증).
- **privacy.md**: WebSocket 텍스트 프레임 본문 캡처는 **새 수집 동작**. manifest diff가 0이어도 docs/privacy.md를 시행일 포함해 갱신해야 한다(CLAUDE.md 트리거).
