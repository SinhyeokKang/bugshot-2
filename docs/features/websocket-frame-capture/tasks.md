# WebSocket 프레임 캡처 — 구현 태스크

## 선행 조건
- 권한·env·OAuth 변경 없음(WebSocket 후킹은 page-context, 추가 권한 불필요).
- shadcn 신규 컴포넌트 불필요(기존 Tabs/Collapsible/ScrollArea/JsonTreeViewer 재사용).
- e2e용 로컬 ws echo 서버를 위해 devDependency `ws`(또는 기존 http 서버 upgrade) 필요 — Task 9에서.
- 회귀 보호 핵심: `recorders-entry.ts`에 새 외부 static import를 추가하지 말 것(pre-arm 동기 IIFE 제약).

## 태스크

### Task 1: 타입 정의
- **변경 대상**: `src/types/network.ts`
- **작업 내용**:
  - `WebSocketFrameDirection`, `WebSocketFrameData`, `WebSocketFrame`, `WebSocketMeta` 추가(design.md 시그니처).
  - `NetworkRequest`에 `webSocket?: WebSocketMeta` 추가.
  - `NetworkLog.warnings` union의 `"WS_UNSUPPORTED"` → `"WS_FRAMES_CAPPED"` 교체.
- **검증**:
  - [x] `pnpm typecheck` 통과.
  - [x] `WS_UNSUPPORTED` 참조가 코드베이스에 0개로 남음(grep).

### Task 2: 순수 헬퍼 + 단위 테스트 (테스트 우선)
- **변경 대상**: `src/content/network-recorder-helpers.ts`, `src/content/__tests__/network-recorder-helpers.test.ts`
- **작업 내용**:
  - 테스트 먼저 작성:
    - `classifyWsFrameData(data)`(1-arg): 문자열→그대로 / ArrayBuffer·Blob·TypedArray·SharedArrayBuffer→null / `BODY_CAP` 초과 문자열→`{kind:"truncated"}` / 빈 문자열 `""`→`""`(빈 프레임).
    - `maskWsFrame(text)`: 내부적으로 `maskBody(text, "application/json")` 사용. `{"token":"x"}`→마스킹 / `{"a":1}`→무변 / 비JSON 원문 통과.
  - 두 함수 구현.
- **검증**:
  - [x] 신규 테스트가 실패→통과로 전환.
  - [x] `pnpm test` green.
  - [x] 바이너리 입력은 항상 null 반환(드롭) 케이스 커버. 빈 문자열 케이스 커버.

### Task 3: WebSocket 후킹 (레코더)
- **변경 대상**: `src/content/network-recorder.ts`
- **작업 내용**:
  - `network-recorder.ts:59`의 로컬 `type NetworkWarning` union에 `"WS_FRAMES_CAPPED"` 추가(누락 시 typecheck 실패).
  - `MAX_WS_FRAMES_PER_CONN = 1000` 상수 추가.
  - `patchWebSocket()`: `window.WebSocket`을 Proxy(`construct` trap)로 감싸 construct 시 `capturing`이면 `attachWsRecorder(ws, args)`. **생성자만 Proxy**, 그 외엔 forward.
  - `attachWsRecorder`: 연결당 WS 변종 엔트리 push(`id = crypto.randomUUID()` 연결당 1회, status 101, phase pending, `webSocket:{protocol, frames:[], framesTotal:0}`, `!recording`이면 `preArm:true`). `open/message/close/error` 리스너 + `ws.send` **직접 wrap**(XHR.send식). message/send는 `classifyWsFrameData`→텍스트면 `maskWsFrame` 후 push, 바이너리면 `framesTotal`만 증가. close는 `code/reason/wasClean` 기록 + phase 전이(`wasClean?complete:error`). 적재마다 `framesTotal++`, 연결당 프레임 캡 초과 시 oldest evict + `warnings.add("WS_FRAMES_CAPPED")`, `throttle.schedule()`.
  - 프레임 본문은 `BODY_CAP` truncate 재사용. **전역 `MEMORY_CAP` eviction에는 프레임 미합류**(design 위험요소대로 수용된 한계 — 주석으로 명시).
  - try/catch 격리로 후킹 실패 시 원본 WebSocket 무간섭.
- **검증**:
  - [x] `pnpm typecheck` 통과(로컬 union 포함).
  - [ ] 수동: WebSocket 테스트 페이지에서 연결·send·receive·close가 버퍼에 적재.
  - [ ] 자동(Task 9): 후킹 on 상태에서 `WebSocket.OPEN===1 && typeof window.WebSocket==="function"` + `new WebSocket(...) instanceof WebSocket` 무회귀.
  - [x] `recorders-entry.ts` 외부 static import 수 변화 없음 → 빌드 시 `recorders-entry`가 여전히 동기 IIFE. (런타임 import는 helpers 1개 유지, 타입은 import type — security 검증 확인)

### Task 4: 목록 UI — WS 행 + 필터 + testid
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx`
- **작업 내용**:
  - `RequestFilter`/`REQUEST_FILTERS`에 `"ws"` 추가, `classifyRequest`에 `req.webSocket` 분기.
  - `ContentTypeIcon`·`RequestRow`에 WS 분기(method 칸 `WS`, status 101 표시, ws 아이콘).
  - **data-testid 부착**(src 수정은 testid 추가만): ws 필터 칩(`network-filter-ws`), WS 행(기존 `data-entry-id` 활용 + 필요 시 `data-ws="true"`).
- **검증**:
  - [x] `pnpm typecheck` 통과.
  - [ ] WS 엔트리가 목록에 행 1개로, `ws` 필터로 좁혀짐. (브라우저 확인 필요 — `/build`)

### Task 5: 상세 패널 — Messages 탭 + testid
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx`
- **작업 내용**:
  - `DetailTab`을 WS 엔트리일 때 `Headers / Messages`로 분기(일반 요청은 기존 유지). **WS 엔트리는 기본 탭 = `messages`**(`handleSelect`의 `headers` 리셋을 WS일 땐 `messages`로).
  - `MessagesPanel` 신규:
    - 헤더 카운트 배지: `framesTotal` 기반 "N frames · M binary skipped · (capped)" 격차 노출.
    - 프레임 **행 = flex + truncate**(table 아님): 방향 아이콘(lucide `ArrowUp`=send / `ArrowDown`=receive, open/close 전용 아이콘) + Length + 상대시간(`formatRelativeTime`, base = open 시각 또는 `syncBaseMs`) + 클릭 시 `JsonTreeViewer`/`pre` 펼침.
    - All/Send/Receive 방향 필터(기존 필터 컨벤션). **open/close 이벤트 행은 필터 무관 항상 표시**.
    - 빈 상태: 프레임 0이면 empty state 문구.
    - `syncBaseMs`/`onSeek` 공급 시 프레임마다 `LogSeekChip`. **activeTs 활성 하이라이트 없음**(v1 비목표).
  - **data-testid 부착**: Messages 탭(`detail-tab-messages`), 방향 필터(`ws-filter-send`/`-receive`/`-all`), 프레임 행(`data-frame-direction="send|receive|open|close"`).
- **검증**:
  - [ ] WS 행 클릭 시 상세가 Messages 탭으로 바로 열림.
  - [ ] Messages에 send/receive/open/close가 시간순 표시, All/Send/Receive 필터 동작(open/close 유지).
  - [ ] 헤더 배지가 framesTotal 격차(바이너리 스킵·캡)를 표시.
  - [ ] JSON 프레임 트리 펼침 동작. 프레임 0 빈 상태 문구.

### Task 6: i18n 키
- **변경 대상**: `src/i18n/namespaces/logs.ts`
- **작업 내용**: `networkLog.filter.ws`, `networkLog.tab.messages`, `networkLog.ws.{open,close,sent,received,binarySkipped,framesCapped,empty,...}` ko·en 동시 추가.
- **검증**:
  - [x] Edit/Write 시 PostToolUse 훅의 `locales.test.ts`(ko/en 대칭) 자동 통과.

### Task 7: HAR 익스포트
- **변경 대상**: `src/sidepanel/lib/buildHar.ts`, `src/sidepanel/lib/__tests__/buildHar.test.ts`
- **작업 내용**: `requestToEntry` **최상단에서 WS early-return**(`new URL`·body 접근 전): `req.webSocket` 존재 시 entry에 `_resourceType:"websocket"` + `_webSocketMessages:[{type, time, opcode:1, data}]`(send/receive 데이터 프레임만). 기존 `buildHar.test.ts`에 **WS 엔트리 케이스 추가**(`_webSocketMessages` 직렬화).
- **검증**:
  - [x] WS 엔트리가 `_webSocketMessages` 포함, 일반 요청 entry 무변.
  - [x] `pnpm test` green.

### Task 8: log-viewer 동기화 확인
- **변경 대상**: 없음. `src/log-viewer/App.tsx`는 이미 `{syncBaseMs, onSeek}` 전달(activeTs 미전달 — playhead 하이라이트 미구현이 의도된 한계).
- **작업 내용**: NetworkLogContent가 log-viewer에서 WS 행·Messages 프레임·**프레임 seek 칩**을 영상과 연동하는지 확인(활성 하이라이트는 v1 비목표라 검증 대상 아님).
- **검증**:
  - [ ] 수동: 30s Replay 캡처 → log-viewer Network 탭에 WS 연결·프레임 표시 + 프레임 seek 칩 클릭 시 영상 점프.

### Task 9: e2e — 로컬 ws echo 서버 + spec
- **변경 대상**: `e2e/fixtures/extension.ts`(또는 e2e 서버 셋업), 신규 spec, `package.json`(devDep `ws`)
- **작업 내용**:
  - e2e fixture에 **로컬 ws echo 서버** 추가(`ws` devDep 또는 기존 http 서버 `upgrade` 핸들). 픽스처 페이지가 `ws://localhost:<port>`로 접속해 텍스트 프레임 송신 → 에코 수신.
  - **인페이지 `WebSocket` stub 금지**(레코더 Proxy가 document_start에 먼저 깔려 stub이 덮는 순서 역전 위험).
  - 무간섭 검증을 `page.evaluate`로 스크립트 판정(자동 승격).
- **검증** (e2e 시나리오 — 스크립트 판정, `websocket-log.spec.ts` green):
  - [x] WebSocket을 여는 픽스처 페이지에서 네트워크 서브탭에 WS 연결 행(`data-ws`)이 1개 나타난다(닫은 뒤 Headers에 status 101).
  - [x] WS 행 클릭 시 Messages 탭이 바로 열리고, 송신·에코가 send/receive 프레임으로 표시된다.
  - [x] Send 필터를 누르면 receive 데이터 프레임이 사라지고 send + open이 남는다.
  - [x] `page.evaluate(() => WebSocket.OPEN === 1 && typeof window.WebSocket === "function")` + `instanceof` true (무간섭).
  - [x] 동시 다중 연결 시 행이 연결 수만큼 분리된다.

## 테스트 계획

- **단위 테스트** (`src/content/__tests__/network-recorder-helpers.test.ts`, `buildHar.test.ts`):
  - `classifyWsFrameData`: 문자열 그대로 / 바이너리 4종→null / `BODY_CAP` 초과→truncated / `""`→`""`.
  - `maskWsFrame`: `{"token":"x"}`→마스킹 / `{"a":1}`→무변 / 비JSON 원문.
  - `buildHar`: WS 엔트리 `_webSocketMessages` 직렬화, 일반 요청 무변.
- **e2e 시나리오** (Task 9, 로컬 ws echo 서버 기반 — 인페이지 stub 금지):
  - 위 Task 9 검증 항목 전부.
- **수동 테스트** (Chrome, 자동화 곤란):
  - 실제 WebSocket 사이트(채팅·시세 등)에서 연결·프레임 누적·무간섭 확인.
  - 바이너리 프레임 페이지에서 행 미표시 + Messages 헤더 "N binary skipped" 배지.
  - 고빈도 소켓에서 `WS_FRAMES_CAPPED` 경고·프레임 evict, 메모리 증가 모니터링(전역 캡 미합류 한계 확인).
  - 재연결 폭주 → 연결 엔트리 `ENTRY_CAP` 상호작용.
  - replay 창 이전 open + 창내 프레임 → 연결 엔트리가 구간에 포함.
  - 연결만 열고 프레임 0 / open 없이 즉시 비정상 close / 빈 문자열 프레임 / ws→wss 렌더 무결.
  - 30s Replay log-viewer 프레임 seek 칩 영상 점프.

## 구현 순서 권장
1. **Task 1**(타입) → **Task 2**(헬퍼+테스트) 순차 — 이후 모든 작업의 기반.
2. **Task 3**(후킹)은 Task 1·2 완료 후. 레코더 핵심.
3. **Task 4·5·6**(UI·i18n)는 Task 1 완료 후 Task 3과 병렬 가능. Task 5는 Task 4와 같은 파일이라 순차.
4. **Task 7**(HAR)은 Task 1 완료 후 독립 병렬 가능.
5. **Task 8**(log-viewer 확인) → **Task 9**(e2e)는 Task 3·4·5 완료 후 최종.

## 가이드 영향
사용자 노출 기능(네트워크 로그에 WebSocket 추가). 구현 후 `/guide`로 ko·en 갱신 — 대상 페이지는 `guide/AUTHORING.md` 기준으로 확정하되, 네트워크/로그 캡처를 설명하는 페이지에 "WebSocket 연결·프레임 캡처(텍스트 한정, 바이너리 제외), Messages 탭" 항목 추가.

## 추가 문서 영향 (구현 시 함께 처리, 본 스코프 밖이지만 명시)
- **docs/privacy.md**: WebSocket 텍스트 프레임 본문 캡처 = 새 수집 동작. manifest diff 0이어도 시행일 포함 갱신(CLAUDE.md 트리거).
- **ARCHITECTURE.md / DIRECTORY.md**: 네트워크 레코더 후킹 대상에 WebSocket 추가 반영.
- **CLAUDE.md**: 게이트웨이/레코더 설명에 WebSocket 후킹 한 줄 추가 검토.
