# WebSocket 프레임 캡처 — 구현 태스크

## 선행 조건
- 권한·env·OAuth 변경 없음(WebSocket 후킹은 page-context, 추가 권한 불필요).
- shadcn 신규 컴포넌트 불필요(기존 Tabs/Collapsible/ScrollArea/JsonTreeViewer 재사용).
- 회귀 보호 핵심: `recorders-entry.ts`에 새 외부 static import를 추가하지 말 것(pre-arm 동기 IIFE 제약).

## 태스크

### Task 1: 타입 정의
- **변경 대상**: `src/types/network.ts`
- **작업 내용**:
  - `WebSocketFrameDirection`, `WebSocketFrameData`, `WebSocketFrame`, `WebSocketMeta` 추가(design.md 시그니처).
  - `NetworkRequest`에 `webSocket?: WebSocketMeta` 추가.
  - `NetworkLog.warnings` union의 `"WS_UNSUPPORTED"` → `"WS_FRAMES_CAPPED"` 교체.
- **검증**:
  - [ ] `pnpm typecheck` 통과(warnings literal 교체로 인한 컴파일 에러 없음).
  - [ ] `WS_UNSUPPORTED` 참조가 코드베이스에 0개로 남음(grep).

### Task 2: 순수 헬퍼 + 단위 테스트 (테스트 우선)
- **변경 대상**: `src/content/network-recorder-helpers.ts`, `src/content/__tests__/network-recorder-helpers.test.ts`
- **작업 내용**:
  - 테스트 먼저 작성: `classifyWsFrameData`(문자열→그대로 / ArrayBuffer·Blob·TypedArray→null / BODY_CAP 초과 문자열→truncated), `maskWsFrame`(JSON 토큰 키 마스킹 / 비JSON 원문 통과).
  - 두 함수 구현.
- **검증**:
  - [ ] 신규 테스트가 실패→통과로 전환.
  - [ ] `pnpm test` green.
  - [ ] 바이너리 입력은 항상 null 반환(드롭) 케이스 커버.

### Task 3: WebSocket 후킹 (레코더)
- **변경 대상**: `src/content/network-recorder.ts`
- **작업 내용**:
  - `MAX_WS_FRAMES_PER_CONN = 1000` 상수 추가.
  - `patchWebSocket()`: `window.WebSocket`을 Proxy로 감싸 construct 시 `capturing`이면 `attachWsRecorder(ws, args)`.
  - `attachWsRecorder`: 연결당 WS 변종 엔트리 push(status 101, phase pending, `webSocket:{protocol, frames:[], framesTotal:0}`, `!recording`이면 `preArm:true`), `open/message/close/error` 리스너 + `ws.send` Proxy로 프레임 적재. message/send는 `classifyWsFrameData`→텍스트면 `maskWsFrame` 후 push, 바이너리면 `framesTotal`만 증가. close는 `code/reason/wasClean` 기록 + phase 전이. 적재마다 `throttle.schedule()`.
  - `enforceMemoryCap()`/`estimateBodySize()` 확장: 프레임 payload를 메모리 계상, 초과 시 oldest frame data evict. 연결당 프레임 캡 FIFO 초과 시 oldest evict + `warnings.add("WS_FRAMES_CAPPED")`.
  - try/catch 격리로 후킹 실패 시 원본 WebSocket 무간섭.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] 수동: WebSocket 테스트 페이지에서 연결·send·receive·close가 버퍼에 적재(콘솔/디버깅).
  - [ ] 수동: 후킹 on/off와 무관하게 페이지 WebSocket 송수신 정상(무간섭).
  - [ ] `recorders-entry.ts` 외부 static import 수 변화 없음 → 빌드 시 `recorders-entry`가 여전히 동기 IIFE.

### Task 4: 목록 UI — WS 행 + 필터
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx`
- **작업 내용**:
  - `RequestFilter`/`REQUEST_FILTERS`에 `"ws"` 추가, `classifyRequest`에 `req.webSocket` 분기.
  - `ContentTypeIcon`·`RequestRow`에 WS 분기(method 칸 `WS`, status 101 표시, ws 아이콘).
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] WS 엔트리가 목록에 행 1개로, `ws` 필터로 좁혀짐.

### Task 5: 상세 패널 — Messages 탭
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx`
- **작업 내용**:
  - `DetailTab`을 WS 엔트리일 때 `Headers / Messages`로 분기(일반 요청은 기존 유지).
  - `MessagesPanel` 신규: 프레임 테이블(방향 ▲send/▼receive + open/close 이벤트 행 + Length + 상대시간), All/Send/Receive 필터, 텍스트 프레임 클릭 시 `JsonTreeViewer`/`pre` 펼침.
  - `syncBaseMs`/`activeTs`/`onSeek`를 MessagesPanel로 내려 활성 프레임 하이라이트 + `LogSeekChip` 시크.
  - Headers 탭: URL·서브프로토콜·status 101만(핸드셰이크 응답 헤더 미노출).
- **검증**:
  - [ ] WS 행 클릭 시 탭이 `Headers / Messages`로 바뀜.
  - [ ] Messages에 send/receive/open/close가 시간순 표시, All/Send/Receive 필터 동작.
  - [ ] JSON 프레임 트리 펼침 동작.

### Task 6: i18n 키
- **변경 대상**: `src/i18n/namespaces/logs.ts`
- **작업 내용**: `networkLog.filter.ws`, `networkLog.tab.messages`, `networkLog.ws.{open,close,sent,received,framesCapped,...}` ko·en 동시 추가.
- **검증**:
  - [ ] Edit/Write 시 PostToolUse 훅의 `locales.test.ts`(ko/en 대칭) 자동 통과.

### Task 7: HAR 익스포트
- **변경 대상**: `src/sidepanel/lib/buildHar.ts`
- **작업 내용**: `requestToEntry`에 WS 분기 — `req.webSocket` 존재 시 entry에 `_resourceType:"websocket"` + `_webSocketMessages:[{type, time, opcode:1, data}]`(send/receive 데이터 프레임만).
- **검증**:
  - [ ] 단위 테스트(buildHar 기존 테스트 있으면 케이스 추가): WS 엔트리가 `_webSocketMessages` 포함.
  - [ ] `pnpm test` green.

### Task 8: log-viewer 동기화 확인
- **변경 대상**: 없음(코드 변경 없이 동작 확인). `src/log-viewer/App.tsx`는 이미 `{...sync}` 전달.
- **작업 내용**: NetworkLogContent가 log-viewer에서 WS 행·Messages 프레임을 영상과 동기화하는지 확인. 필요 시 MessagesPanel의 `activeTs` 처리 보정(Task 5에서 처리).
- **검증**:
  - [ ] 수동: 30s Replay 캡처 → log-viewer Network 탭에 WS 연결·프레임 표시 + 영상 재생 시 프레임 하이라이트·시크.

## 테스트 계획

- **단위 테스트** (`src/content/__tests__/network-recorder-helpers.test.ts`):
  - `classifyWsFrameData`: 문자열 그대로 / ArrayBuffer·Blob·TypedArray·SharedArrayBuffer→null / BODY_CAP 초과→truncated.
  - `maskWsFrame`: `{"token":"x"}`→마스킹 / `{"a":1}`→무변 / 비JSON 원문 통과.
  - (선택) `buildHar` WS 엔트리 `_webSocketMessages` 직렬화.
- **e2e 시나리오** (`/e2e-write` 입력):
  - "WebSocket을 여는 테스트 페이지에서 사이드패널 네트워크 서브탭을 열면, status 101 WS 연결 행이 목록에 1개 나타난다."
  - "WS 연결 행을 클릭하면 Messages 탭이 나타나고, 페이지가 보낸 텍스트 메시지가 ▲send 프레임으로, 에코된 메시지가 ▼receive 프레임으로 시간순 표시된다."
  - "Send 필터를 누르면 receive 프레임이 사라지고 send 프레임만 남는다."
  - (가능 시 Playwright 픽스처로 로컬 ws echo 서버 또는 인페이지 `WebSocket` mock 사용. echo 인프라가 어려우면 인페이지에서 `new WebSocket`을 stub해 message 이벤트를 합성하는 fixture로 대체.)
- **수동 테스트** (Chrome, 자동화 곤란):
  - 실제 WebSocket 사이트(채팅·시세 등)에서 연결·프레임 누적·무간섭 확인.
  - 바이너리 프레임 페이지에서 프레임이 목록에 안 뜨고 `framesTotal` 통계만 증가.
  - 고빈도 소켓에서 `WS_FRAMES_CAPPED` 경고·evict 동작.
  - `instanceof WebSocket`·정적 상수(`WebSocket.OPEN`) 사용하는 페이지 무회귀.
  - 30s Replay log-viewer 영상 동기화.

## 구현 순서 권장
1. **Task 1**(타입) → **Task 2**(헬퍼+테스트) 순차 — 이후 모든 작업의 기반.
2. **Task 3**(후킹)은 Task 1·2 완료 후. 레코더 핵심.
3. **Task 4·5·6**(UI·i18n)는 Task 1 완료 후 Task 3과 병렬 가능. Task 5는 Task 4와 같은 파일이라 순차.
4. **Task 7**(HAR)은 Task 1 완료 후 독립 병렬 가능.
5. **Task 8**(log-viewer 확인)은 Task 5 완료 후 최종 검증.

## 가이드 영향
사용자 노출 기능(네트워크 로그에 WebSocket 추가). 구현 후 `/guide`로 ko·en 갱신 — 대상 페이지는 `guide/AUTHORING.md` 기준으로 확정하되, 네트워크/로그 캡처를 설명하는 페이지(예: 로그 수집·네트워크 로그 섹션)에 "WebSocket 연결·프레임 캡처(텍스트 한정, 바이너리 제외)" 항목 추가.

## 추가 문서 영향 (구현 시 함께 처리, 본 스코프 밖이지만 명시)
- **docs/privacy.md**: WebSocket 텍스트 프레임 본문 캡처 = 새 수집 동작. manifest diff 0이어도 시행일 포함 갱신(CLAUDE.md 트리거).
- **ARCHITECTURE.md / DIRECTORY.md**: 네트워크 레코더 후킹 대상에 WebSocket 추가 반영.
- **CLAUDE.md**: 게이트웨이/레코더 설명에 WebSocket 후킹 한 줄 추가 검토.
