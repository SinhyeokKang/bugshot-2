# WebSocket 프레임 캡처 — 기술 설계

## 개요

`src/content/network-recorder.ts`(MAIN world)에 `window.WebSocket` **생성자만 Proxy로 신규 후킹**한다(인스턴스 `send`는 기존 컨벤션대로 직접 치환 wrap — XHR.send식). 각 연결을 기존 `NetworkRequest` 엔트리 1개에 매핑하되(status `101`), 프레임은 새 `webSocket` 필드의 `frames` 배열에 담는다. 캡·dispatch·머지·영속·HAR은 기존 네트워크 로그 인프라를 최소 침투로 재사용한다. UI는 DevTools 모델(연결=목록 행, 프레임=상세 Messages 탭)을 따라 `NetworkLogContent`의 상세 탭을 WebSocket일 때 `Headers / Messages`로 분기한다.

> **후킹 패턴 주의**: 기존 후킹은 전부 직접 함수 치환이다 — `window.fetch = createPatchedFetch(...)`(`:284`), `XHR.send = function(){…originalSend.call(this,…)}`(`:292-325`), `navigator.sendBeacon` 동일(`:443`). 코드베이스에 Proxy 사용처는 없다. WebSocket은 **생성 시점을 가로채야** 하므로 생성자에만 Proxy(`construct` trap)를 신규 도입하고(`instanceof`·정적 상수는 forward로 유지), 인스턴스 `send`는 직접 wrap한다.

## 변경 범위

### 타입
- **`src/types/network.ts`** — 현재 `NetworkRequest`/`NetworkLog` 정의.
  - `NetworkRequest`에 `webSocket?: WebSocketMeta` 추가.
  - 새 타입 `WebSocketFrame`, `WebSocketFrameData`, `WebSocketMeta`, `WebSocketFrameDirection` 추가.
  - `NetworkLog.warnings`의 미사용 `"WS_UNSUPPORTED"` literal을 **`"WS_FRAMES_CAPPED"`로 교체**(이 기능이 그 자리를 대체 — 고아 제거).

### 레코더 (MAIN world)
- **`src/content/network-recorder.ts`** — fetch/XHR/sendBeacon 후킹·메모리 캡·sentinel dispatch 보유.
  - `network-recorder.ts:59`의 **로컬 `type NetworkWarning`** union(현재 `"MEMORY_CAPPED" | "ENTRY_CAPPED" | "BODY_TRUNCATED"`, types/network.ts와 별도)에 `"WS_FRAMES_CAPPED"`를 함께 추가 — 누락 시 `warnings.add("WS_FRAMES_CAPPED")`가 typecheck 실패.
  - `window.WebSocket`을 Proxy(`construct` trap)로 감싸는 `patchWebSocket()` 추가. `capturing` 게이트로 attach 여부 결정.
  - 연결당 `CapturedRequest`(WS 변종) push: `id = crypto.randomUUID()`(연결당 1회 — 수명 동안 stable, 다중/재연결에서 unique), status 101, phase pending. `open/message/close/error` 리스너 + `ws.send` **직접 wrap**으로 프레임 적재.
  - 연결당 프레임 캡(`MAX_WS_FRAMES_PER_CONN`) FIFO 초과 시 oldest 프레임 evict + `warnings.add("WS_FRAMES_CAPPED")`. 프레임 본문은 기존 `BODY_CAP`(3MB)로 truncate(`BODY_TRUNCATED`).
- **`src/content/network-recorder-helpers.ts`** — 순수 분류·마스킹 유틸 보유.
  - `classifyWsFrameData(data)`(1-arg) 추가: 텍스트면 문자열, 바이너리(ArrayBuffer/Blob/TypedArray/SharedArrayBuffer)면 `null`(드롭 신호), `BODY_CAP` 초과면 `{kind:"truncated"}`.
  - `maskWsFrame(text)` 추가: 기존 export 함수 `maskBody(text, "application/json")` 재사용(`maskJsonBody`는 미export). JSON 파싱 실패 시 원문 통과.

### 사이드패널 수신·머지
- **`src/sidepanel/lib/log-merge.ts`** — `mergeLogItems`/`rebuildNetworkLog` 보유. **변경 없음**(연결 엔트리는 id 기준 replace로 최신 frames를 통째로 덮어씀 — MAIN world가 매 flush마다 full frame 배열 재전송하므로 손실 없음. `log-merge.test.ts:111-120`로 byId replace 검증됨). `rebuildNetworkLog`의 `warnings` 타입만 자동 반영.
- **`src/sidepanel/hooks/usePickerMessages.ts`** — `networkRecorder.data` 수신부. **변경 없음**(payload 구조 동일, frames는 request 내부에 동승).

### UI
- **`src/sidepanel/components/NetworkLogContent.tsx`** — 목록·상세 패널 렌더.
  - `RequestFilter`에 `"ws"` 추가, `classifyRequest`에 WebSocket 분기(`req.webSocket` 존재 시 `"ws"`).
  - `RequestRow`: WS 연결은 method 칸에 `WS`, status `101` 표시(`ContentTypeIcon`에 ws 아이콘 분기). `data-testid`로 ws 필터 칩·WS 행 식별자 부착.
  - `DetailTab`: WS 엔트리일 때 탭 구성을 `Headers / Messages`로 분기. **WS 엔트리의 기본 탭은 `messages`**(Headers는 URL·서브프로토콜·101뿐이라 `handleSelect`의 `headers` 리셋을 WS일 땐 `messages`로). 일반 요청은 기존 `Headers / Request / Response` 유지.
  - 새 `MessagesPanel` 서브컴포넌트:
    - 헤더: 카운트 배지(`framesTotal` 기반 "N frames · M binary skipped · capped" — `framesTotal > frames.length` 격차 노출).
    - 본문: 프레임 **행(table 아님 — `RequestRow`식 flex + truncate)**. 방향 아이콘(lucide `ArrowUp`=send / `ArrowDown`=receive, open/close는 전용 아이콘) + Length + 상대시간(`formatRelativeTime`, base = 연결 open 시각 또는 `syncBaseMs`) + 클릭 시 `JsonTreeViewer`/`pre` 펼침.
    - All/Send/Receive 방향 필터(기존 필터 컨벤션 따름). **open/close 이벤트 행은 필터와 무관하게 항상 표시**(연결 수명 컨텍스트).
    - 빈 상태: 연결됐으나 프레임 0이면 empty state 문구(기존 empty state 패턴).
    - `syncBaseMs`/`onSeek` 공급 시 프레임마다 `LogSeekChip`(클릭→영상 시각 점프). **`activeTs` 기반 활성 프레임 하이라이트는 v1 비목표**(아래 log-viewer 항목).
- **`src/log-viewer/App.tsx`** — **변경 없음**. 현재 `{...sync}` = `{syncBaseMs, onSeek}`만 전달하고 `activeTs`는 어떤 로그 컴포넌트에도 안 내려준다(playhead 활성 하이라이트 미구현). WS도 이 한계를 그대로 따른다 — 프레임 seek 칩까지만, 활성 하이라이트 없음.
- **`src/log-viewer/markers.ts`** — **변경 없음**(network 마커는 `r.startTime` = 연결 open 시각으로 자동 생성. 프레임 마커는 비목표).

### 익스포트
- **`src/sidepanel/lib/buildHar.ts`** — `requestToEntry`에 WS 분기 추가. **함수 최상단에서 early-return**(진입 즉시 `new URL`·body·headers 접근 전 — `:37-103`): `req.webSocket` 존재 시 entry에 `_resourceType:"websocket"` + Chrome 호환 `_webSocketMessages:[{type:"send"|"receive", time, opcode:1, data}]` 부착. open/close 이벤트는 `_webSocketMessages`에 포함하지 않음(Chrome 포맷은 데이터 프레임만).

### i18n
- **`src/i18n/namespaces/logs.ts`** — `networkLog.filter.ws`, `networkLog.tab.messages`, `networkLog.ws.*`(open/close/sent/received/binarySkipped/framesCapped/empty 라벨) ko·en 동시 추가.

## 데이터 흐름

```
[MAIN world] page: new WebSocket(url)
  → window.WebSocket Proxy.construct (생성자만 Proxy)
  → (capturing?) attachWsRecorder(ws):
       const id = crypto.randomUUID()   // 연결당 1회, stable+unique
       buffer.push( CapturedRequest{ id, url, status:101, phase:"pending",
                                     webSocket:{ protocol, frames:[], framesTotal:0 } } )
       ws.addEventListener("open")   → frames.push({direction:"open",   ts})
       ws.addEventListener("message")→ classifyWsFrameData → (text?) maskWsFrame → frames.push({direction:"receive", ts, data, size})
                                                            (binary?) framesTotal++ 만
       ws.send = wrap(originalSend)   → classifyWsFrameData → (text?) maskWsFrame → frames.push({direction:"send", ts, data, size})  // 직접 치환
       ws.addEventListener("close")  → frames.push({direction:"close", ts, code, reason, wasClean})
                                        phase = wasClean ? "complete" : "error"
       ws.addEventListener("error")  → (no frame; close가 뒤따라 처리)
       각 적재 후: framesTotal++; 연결당 프레임 캡 초과 시 oldest evict + WS_FRAMES_CAPPED; throttle.schedule()

[dispatch] (기존) CustomEvent "__bugshot_net_data__"+sentinel { requests: buffer.slice(), totalSeen, warnings }
  → [ISOLATED] recorder-bridge (structured clone) → runtime message "networkRecorder.data"
  → [sidepanel] usePickerMessages → mergeLogItems(byId replace, 최신 full frames로 덮음) → rebuildNetworkLog → setNetworkLog → IndexedDB push

[UI] NetworkLogContent: 연결 = 목록 행 1개, 클릭 → Messages 탭(기본)에서 frames 렌더 + 헤더 배지
[log-viewer] 동일 NetworkLogContent에 syncBaseMs/onSeek 전달 → 프레임 seek 칩(활성 하이라이트는 v1 제외)
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
  ts: number;                 // 프레임 발생 시각(절대 ms) — seek 기준
  data?: WebSocketFrameData;  // open은 undefined; send/receive는 텍스트; close는 reason(있으면)
  size: number;               // payload 바이트 크기(open/close 등 control은 0)
  code?: number;              // close 전용
  reason?: string;            // close 전용
  wasClean?: boolean;         // close 전용
}

export interface WebSocketMeta {
  protocol: string;           // 협상된 서브프로토콜(없으면 "")
  frames: WebSocketFrame[];   // 연결당 프레임 캡(MAX_WS_FRAMES_PER_CONN) 적용된 보유분
  framesTotal: number;        // 캡처 시도 총 프레임 수(드롭된 바이너리·evict 포함) — 배지 격차 산출
}

export interface NetworkRequest {
  // ...기존 필드...
  webSocket?: WebSocketMeta;  // 존재하면 이 엔트리는 WebSocket 연결
}

// NetworkLog.warnings:
//   ("MEMORY_CAPPED" | "WS_FRAMES_CAPPED" | "BODY_TRUNCATED" | "ENTRY_CAPPED")[]
//   ("WS_UNSUPPORTED" → "WS_FRAMES_CAPPED" 교체)
// 주의: network-recorder.ts:59의 로컬 NetworkWarning union도 함께 넓힐 것.
```

```typescript
// src/content/network-recorder-helpers.ts (순수 함수 — 단위 테스트 대상)

// 텍스트면 문자열, 바이너리면 null(드롭), BODY_CAP 초과면 truncated. (1-arg)
export function classifyWsFrameData(
  data: unknown,
): string | { kind: "truncated"; limit: number; size: number } | null;

// 기존 maskBody(text, "application/json") 재사용 — JSON이면 토큰 키 마스킹, 아니면 원문.
export function maskWsFrame(text: string): string;
```

```typescript
// src/content/network-recorder.ts (상수)
const MAX_WS_FRAMES_PER_CONN = 1000;   // 연결당 프레임 FIFO 캡
// 프레임 본문 캡은 기존 BODY_CAP(3MB) 재사용 — 초과 시 truncated + BODY_TRUNCATED 경고
```

## 기존 패턴 준수

- **동기 IIFE 청크 제약**: WebSocket 후킹 코드는 `network-recorder.ts`(이미 청크 내부) + `network-recorder-helpers.ts`(이미 같은 청크가 import) 안에만 둔다. `recorders-entry.ts`에 **새 외부 static import를 추가하지 않는다** — 추가하면 async loader로 되돌아가 pre-arm이 무력화된다(CLAUDE.md 회귀 주의). (검증: `recorders-entry → network-recorder → network-recorder-helpers` 단일 체인, 새 헬퍼는 순수 함수 추가뿐.)
- **후킹 = 직접 치환**: 인스턴스 `send`는 XHR.send와 동일하게 직접 wrap. 생성자만 Proxy 신규 도입(생성 가로채기 불가피).
- **capturing vs recording 게이트**: attach는 `capturing` 게이트로, dispatch·preArm 표시는 `recording` 게이트로(기존 fetch/XHR와 동일). sentinel 도착 전 연결도 `preArm:true`로 적재.
- **무간섭 보증**: fetch wrap의 try/catch 격리 패턴을 그대로 따라 후킹 실패 시 원본 WebSocket 동작을 절대 깨지 않는다.
- **마스킹 일관성**: 텍스트 프레임은 기존 `maskBody` 경로 재사용 — 별도 마스킹 규칙 신설 금지.
- **i18n 동시 갱신**: `logs.ts` ko·en 키를 함께 추가(PostToolUse 훅이 대칭 검사).
- **테스트 우선**: 신규 순수 함수(`classifyWsFrameData`, `maskWsFrame`)는 `network-recorder-helpers.test.ts`에 테스트를 먼저 박는다.

## 대안 검토

### 대안 1: 프레임마다 독립 엔트리(Jam 내부 모델)
각 프레임을 `NetworkRequest`처럼 목록 행으로. **기각** — 채팅·고빈도 소켓에서 목록이 폭증해 일반 요청을 덮고, DevTools UX(연결=행)와 어긋나며, 사용자가 "연결당 1행 + Messages 탭" 모델을 명시 선택했다.

### 대안 2: `chrome.debugger` API로 Network.webSocketFrame* 이벤트 수신
DevTools 프로토콜로 정확한 프레임을 받음. **기각** — `debugger` 권한은 침습적이고 "다른 디버거가 부착됨" 경고 배너가 뜬다. MV3 service worker에서 탭별 attach 관리 복잡, BugShot의 page-context 후킹 철학과 불일치. 권한 추가 → privacy/심사 부담.

### 대안 3: 별도 `webSocketLog` 스토어·서브탭 신설
WS를 네트워크와 분리. **기각** — 머지·영속·영상 동기화·HAR·필터 인프라를 전부 중복 구현해야 한다. WS는 의미상 네트워크 활동이므로 기존 네트워크 로그에 합치는 게 최소 설계.

### 대안 4: 바이너리 프레임 메타 행 유지
`{kind:"binary", size}` 행을 남김. **기각** — 사용자가 "완전 스킵"을 선택. 단순성 우선, `framesTotal` 통계 + Messages 헤더 배지로 누락 가시화.

## 위험 요소

- **메모리 캡 미통합 (수용된 한계)**: `enforceMemoryCap()`(`network-recorder.ts:111-132`)는 `requestBody`/`responseBody` 문자열만 `{kind:"omitted"}`로 치환하는 구조라 `webSocket.frames[].data`를 건드리지 못한다. v1은 **전역 `MEMORY_CAP`(50MB) eviction에 프레임을 합류시키지 않는다**(단순성 선택). 프레임은 **연결당 프레임 수 캡(`MAX_WS_FRAMES_PER_CONN`=1000) + 프레임 본문 캡(`BODY_CAP`=3MB) + 연결 엔트리 수 캡(`ENTRY_CAP`=5000)**으로만 bound된다. 이론상 최악(1000프레임 × 3MB × 다수 연결)은 50MB를 크게 초과할 수 있다 — 실측 후 필요 시 프레임 바이트의 전역 캡 합류를 후속 도입. 고용량 텍스트 소켓에서 메모리 증가를 모니터링한다.
- **full re-dispatch 비용**: dispatch는 매 flush `buffer.slice()` 전량을 CustomEvent(structured clone)→runtime message로 보낸다(`:493-505`, throttle 200ms). 프레임이 누적될수록 매 200ms마다 전 연결의 누적 프레임 배열을 재직렬화한다 — O(총 프레임)/flush. byId full-replace 무손실(`log-merge.ts:23-25`)을 떠받치는 "항상 full 재전송" 불변식이 곧 비용원이다. **고빈도 소켓 실측 검증 필수**, 부분 diff 최적화 도입 시 머지 무손실 회귀 주의.
- **Proxy 정적 프로퍼티/`instanceof`**: 생성자 Proxy는 get/has를 forward하므로 `WebSocket.OPEN`·`instanceof WebSocket`이 유지되나, 실제 탭·e2e 회귀 검증 필수(page.evaluate로 스크립트 판정).
- **`ws.send` 직접 wrap 범위**: 인스턴스 `send`만 wrap. 페이지가 prototype 레벨로 호출하거나 send를 재바인딩하는 드문 경우 누락 가능(Jam도 인스턴스 레벨 — 허용 범위).
- **머지 시 frames 손실 방지**: `mergeLogItems` byId replace가 incoming full frames로 덮으므로, MAIN world가 **항상 누적 full 배열을 재전송**해야 한다(부분 전송 금지).
- **HAR 호환**: Chrome HAR의 `_webSocketMessages`는 비표준 확장. 표준 HAR 뷰어는 무시할 뿐 깨지지 않음(검증).
- **privacy.md**: WebSocket 텍스트 프레임 본문 캡처는 **새 수집 동작**. manifest diff가 0이어도 docs/privacy.md를 시행일 포함해 갱신해야 한다(CLAUDE.md 트리거).
