# 디바이스 뷰포트 — 구현 태스크

## 선행 조건

- **신규 권한 0.** `<all_urls>` content_scripts + `scripting`으로 전부 커버된다. `manifest.config.ts`를 건드리지 않는다.
- **신규 env 0.** 외부 요청 0.
- **신규 의존성 0.** 세그먼티드 컨트롤은 기존 `Tabs`/`TabsList`를 쓴다(선례 `StyleEditorPanel.tsx:239`). shadcn 신규 설치 없음. 아이콘은 이미 의존성인 `lucide-react`. **cross-origin 판정에 `tldts`를 쓰지 않는다** — 기준이 registrable domain이 아니라 origin이라 `new URL(...).origin` 비교로 끝난다.
- 착수 전 `docs/POSTMORTEM.md`를 `iframe`·`frameId`·`pre-arm`·`캡처 타이밍`으로 grep해 과거 함정을 소환한다. 이 기능은 회귀 밀집 구간 3개를 전부 스친다.
- `docs/ARCHITECTURE.md`의 "등록 핸드셰이크"·"캡처 3축" 절을 읽는다.

---

## 태스크

### Task 1: 프리셋 상수와 가용 폭 판정 (순수)

- **변경 대상**: `src/sidepanel/lib/device-presets.ts` (신규), `src/sidepanel/lib/__tests__/device-presets.test.ts` (신규)
- **작업 내용**: `DEVICE_PRESETS`(390/768/1024 — `430`은 390과 브레이크포인트 구간이 겹쳐 제외) + 각 프리셋의 lucide 아이콘(`Smartphone`/`Tablet`/`Laptop`, `전체`는 `Monitor`) + `isPresetAvailable(width, availableWidth)`. 테스트를 먼저 쓴다.
- **검증**:
  - [ ] `isPresetAvailable(390, 865) === true`
  - [ ] `isPresetAvailable(1024, 865) === false`
  - [ ] `isPresetAvailable(1024, 1024) === true` (경계 포함)
  - [ ] `isPresetAvailable(1024, null) === true` (미조회는 낙관적)
  - [ ] 프리셋이 3개고 `430`이 없다
  - [ ] 각 프리셋에 아이콘이 있고, `labelKey`가 여전히 폭 숫자를 가리킨다 (아이콘이 숫자를 대체하지 않는다)
  - [ ] `pnpm test src/sidepanel/lib/__tests__/device-presets.test.ts` green

### Task 2: 래퍼 DOM 모듈

- **변경 대상**: `src/content/device-frame.ts` (신규), `src/content/__tests__/device-frame.test.ts` (신규, jsdom)
- **작업 내용**: `DEVICE_FRAME_ID`·`DEVICE_STYLE_ID` 상수, `currentDeviceWidth`·`deviceFrameRect`·`availableViewport`·`clampToDeviceFrame`·`mountDeviceFrame`·`unmountDeviceFrame`. 은닉은 스타일시트 한 장이고 여백 색은 `--muted`의 `prefers-color-scheme` 2색 — 라이트 `hsl(210 40% 96.1%)` / 다크 `hsl(0 0% 14.9%)`(`globals.css:26`·`:57`). **라이트를 `0 0% 96.1%`로 쓰지 않는다**(slate 틴트가 빠진 드리프트 값). `#171717` 고정 금지. 이 파일이 토큰 사본 4번째이므로 `src/styles/__tests__/tokens.test.ts`에 등록한다. 래퍼는 `document.body` 직속, `src = location.href`. **`mountDeviceFrame`은 로드 판정을 하지 않는다**(`Promise<boolean>`이 아니라 `void`) — XFO/CSP 판정은 Task 12의 background가 하고 이 모듈은 순수 DOM으로 남는다. iframe `load`에서 `device.frameLoadEvent`를 발화하는 것까지가 책임이다.
- **검증**:
  - [ ] `mountDeviceFrame(390)` 후 `document.getElementById(DEVICE_FRAME_ID)`가 `document.body`의 직속 자식이다
  - [ ] 래퍼의 `src`가 `location.href`다 (`srcdoc`·`about:blank`가 아니다)
  - [ ] `unmountDeviceFrame()` 후 `<style>`·iframe이 둘 다 제거되고, **원본 요소의 인라인 `style` 속성이 애초에 한 번도 변경되지 않았다**(은닉이 스타일시트 한 장이므로 저장·복원 자체가 없다 — 이 항목은 "복원이 정확한가"가 아니라 "건드리지 않았는가"를 본다)
  - [ ] `unmountDeviceFrame()`을 2회 호출해도 throw하지 않는다 (멱등)
  - [ ] 래퍼가 있는 상태에서 `mountDeviceFrame(768)`을 호출하면 iframe 노드가 교체되지 않고 폭만 바뀐다
  - [ ] `currentDeviceWidth()`가 mount 전 `null`, mount 후 `390`
  - [ ] 주입 CSS에 `@media (prefers-color-scheme: dark)` 블록이 있고, 라이트/다크 배경값이 서로 다르다
  - [ ] `tokens.test.ts`가 이 파일의 라이트/다크 리터럴을 `globals.css`의 `--muted`와 대조한다 (네 번째 사본 드리프트 차단)
  - [ ] `clampToDeviceFrame`: 래퍼 밖으로 완전히 벗어난 rect, 걸친 rect, 안에 든 rect, `frame === null` 4케이스
  - [ ] `mountDeviceFrame`이 로드를 기다리거나 스스로 unmount하지 않는다 (판정 책임이 이 모듈에 없다)

> 로드 검증(XFO/CSP)의 **판정 로직**은 Task 12(background)가 갖고 유닛으로 고정한다. 실제 XFO 응답에 대한 브라우저 실동작은 jsdom에서 재현 불가 — Task 15의 e2e가 그 그물이다.

### Task 3: 메시지 타입과 picker 핸들러

- **변경 대상**: `src/types/picker.ts`, `src/content/picker.ts`, `src/sidepanel/picker-control.ts`
- **작업 내용**: `PickerMessage`에 **총 6종** 추가 — 수신 3종(`device.set`·`device.state`·`device.watch`) + push 3종(`device.availableChanged`·`device.frameReady`·`device.frameLoadEvent`). `picker.ts:204`의 `handlePickerMessage` switch에 케이스를 얹되 **각 case 첫 줄에 `if (window !== window.top) return;`**(picker는 `all_frames`라 래퍼 안에서도 돈다. 선례 `picker.ts:321,325,334`). `device.watch { on: false }`가 unwatch다 — 별도 타입을 두지 않는다. 별도로 초기화 시점에 `window.frameElement?.id === DEVICE_FRAME_ID`면 `postToRuntime({ type: "device.frameReady" })` — cross-origin 문서에서 `frameElement`는 throw가 아니라 `null`이라 자연히 통과한다(HTML 명세). `send`는 미export이므로 picker-control 안에 `sendPickerTop`을 두고 `deviceSet`/`deviceState`/`deviceWatch` export 래퍼를 노출한다. **`DeviceSetResponse.ok`는 "마운트/언마운트했다"이고 로드 성공이 아니다** — `reason` 필드를 두지 않는다(성공/차단 판정은 Task 12).
- **검증**:
  - [ ] `pnpm typecheck` green (union 누락 없음)
  - [ ] `device.set`이 `void (async () => {…sendResponse(res)})(); return true;` 형태다 — `break`로 떨어뜨리면 `picker.ts:341`의 `sendResponse({ok:true})`가 먼저 나가 두 번째 응답이 "message port closed"로 죽는다
  - [ ] 래퍼 프레임에서 `device.set`을 받아도 아무것도 하지 않고 **응답도 안 한다**(이중 응답 방지)
  - [ ] 호출부가 `undefined`(전달 실패)와 `{ok:false}`(마운트 실패)를 구분한다 — `send`가 실패를 `undefined`로 삼키므로(`picker-control.ts:114-116`) `ok === false`만 보면 전달 실패가 성공으로 샌다
  - [ ] `device.set` 응답만으로 성공을 선언하지 않는다 — OFF→ON의 모드 확정은 Task 12의 `device.frameLoaded` 수신 뒤다(폭 갱신 경량 경로는 예외로, 응답이 곧 결과다)
  - [ ] **`width: null` 처리에서 `sendResponse`가 `location.reload()`보다 먼저 나간다** — 문서가 갈린 뒤에 응답하면 포트가 죽어 호출부가 전달 실패(`undefined`)로 읽고 불필요한 롤백을 돈다

### Task 3b: element 컨텍스트 확장 게이트 완화

- **변경 대상**: `src/content/picker.ts:427`·`:490`, `src/content/__tests__/`
- **작업 내용**: 두 곳의 `window === window.top` 게이트를 `window === window.top || isDeviceFrame()`으로 연다. `isDeviceFrame()`은 `window.frameElement?.id === DEVICE_FRAME_ID`(same-origin 불변식 덕에 항상 유효). 40% 면적 게이트의 기준 뷰포트는 **자기 뷰포트 그대로** 둔다 — 래퍼는 top 뷰포트에 항상 완전히 들므로 원래 iframe을 제외했던 논거("게이트가 자기 뷰포트 기준이라 top 좌표에서의 완전 포함을 보장할 수 없다")가 성립하지 않는다. **주석의 그 문장도 함께 갱신**한다. 안 열면 모드 ON에서 확장이 100% 꺼져 bbox+24px만 남는다(prd 목표 11).
- **검증**:
  - [ ] 일반 iframe(래퍼 아님)에서는 여전히 확장 판정을 생략한다 — 게이트가 넓어지는 게 아니라 래퍼 하나만 추가된다
  - [ ] 래퍼 안에서 `expandContext`가 켜져 있고 조상 컨테이너가 게이트 3개를 통과하면 `contextSelector`가 반환된다
  - [ ] top 문서에서의 동작이 무변경이다
  - [ ] `contextSelector`가 `null`이 아니라 빈 문자열인 경우의 기존 구분(`!= null`, POSTMORTEM 2026-07-29)이 유지된다

### Task 4: `getTopViewport`를 래퍼 인식으로 교체 + 영상·리플레이 편입

- **변경 대상**: `src/sidepanel/picker-control.ts:811-824`, `src/sidepanel/video-recorder.ts:111-117`, `src/sidepanel/30s-replay/use-30s-replay.ts:153`, `src/sidepanel/__tests__/` 동기화 테스트
- **작업 내용**: 주입 `func`이 `document.getElementById("__bugshot_device_frame__")`를 먼저 보고, 있으면 `clientWidth/clientHeight`를 반환. 프레임 id는 **인라인 리터럴**이어야 한다(클로저가 안 살아남는다). 함수 주석을 "브라우저 뷰포트" → "캡처 대상 뷰포트"로 갱신. **영상·30s Replay는 `getTopViewport`를 안 쓰고 `chrome.tabs.get(tabId)`의 `tab.width/height`를 쓰므로 함께 교체**한다 — 안 하면 모드 ON에서 영상 리포트의 `Viewport`만 브라우저 폭으로 남는다.
- **검증**:
  - [ ] 인라인 리터럴이 `device-frame.ts`의 `DEVICE_FRAME_ID`와 같음을 단언하는 테스트가 있다 (`func.toString()`에 상수가 포함되는지)
  - [ ] 주입 함수가 self-contained다 — 외부 변수를 참조하지 않는다. **상수를 import하면 typecheck·유닛이 전부 green인데 런타임만 `ReferenceError`로 죽고 `picker-control.ts:820`의 catch가 그걸 삼켜 조용히 `null`로 폴백한다**
  - [ ] 모드 OFF에서 반환값이 이전과 동일 (`window.innerWidth/innerHeight`)
  - [ ] **element 두 호출부의 `frameId !== 0` 게이트를 건드리지 않는다**(`usePickerMessages.ts:160`·`:409-410`) — 모드 ON에서 선택은 항상 래퍼 안이라 게이트가 참이 되어 자동으로 올바른 값이 온다. 게이트를 없애면 모드 OFF의 top 선택에서 불필요한 주입이 돌고, 반대로 모드 ON에서 frameId 0으로 새면 메타가 `payload.viewport`(top 실폭)로 폴백해 **조용히 틀린 값**이 남는다
  - [ ] 그 두 호출부의 주석("환경 메타는 **브라우저 뷰포트**여야 하므로")도 함께 갱신한다 — 함수 주석만 고치면 호출부가 옛 의미를 계속 주장한다
  - [ ] `video-recorder`·`use-30s-replay`의 viewport 메타 소스가 `getTopViewport`다
  - [ ] `getTopViewport`가 `null`을 반환할 때 두 곳 모두 기존 `chrome.tabs.get` 값으로 폴백한다 (host permission 실패 시 메타가 비지 않아야 한다)

### Task 5: 문서 지정 레코더 전환 + sentinel 발행 단일 게이트

- **변경 대상**: `src/sidepanel/recorder-control.ts`, `src/sidepanel/picker-control.ts:173-182`·`:709-755`, `src/sidepanel/hooks/usePickerMessages.ts:271-272`, Task 12의 background frame coordinator
- **작업 내용**:
  - `activateRecordersInDeviceTree(tabId)` 신설. 문서 목록은 인자가 아니라 `bgRequest("device.documents")`로 받는다(`{ all, deviceTree }`) — 사이드패널은 프레임 트리를 모르고 캐시도 두지 않기로 했다. `all`에 지정 stop ACK → `deviceTree`에만 지정 start ACK.
  - **sentinel을 발행하는 지점을 헬퍼 하나로 좁히고 거기에 서브트리 게이트를 건다.** 모드 ON이면 `deviceTree` documentId 지정 송신, OFF면 기존 `sendAll`/frameId 지정. 모드 판정은 캐시가 아니라 `deviceTree.length > 0`.
  - 게이트를 통과시켜야 하는 기존 경로 2개: ① `activate*Recorder` 3종(`:709-755`)의 `sendAll` — `useBackgroundRecorder.inject()`가 visibilitychange·`tabs.onUpdated(status==="complete")`·idle 복귀마다 부르고, **래퍼 iframe 로드가 top 탭 status를 complete로 되돌리므로 전환 직후 곧바로 걸린다** ② `rebroadcastSentinelsToFrame`(`:173-182`)과 그 호출부(`usePickerMessages.ts:271-272`) — 커밋된 모든 자식 프레임에 무조건 재발행한다.
  - `useBackgroundRecorder`의 **호출부는 건드리지 않는다.** 트리거를 하나씩 막으면 새 트리거가 생길 때마다 샌다.
  - 게이트를 통과한 `rebroadcastSentinelsToFrame`이 곧 **same-origin 이동 후 start 재전달의 정식 경로**다(래퍼 커밋 → 새 documentId에 재발행). 별도 배선을 만들지 않는다.
- **검증**:
  - [ ] 기존 `clearNetworkRecorder` 3종의 시그니처·동작이 무변경이다
  - [ ] top·기존 iframe·래퍼·래퍼 자식 전부에 stop 3종 ACK가 끝난 뒤에만 래퍼 서브트리 start가 시작된다
  - [ ] stop/start 하나라도 실패하면 성공으로 삼키지 않고 모드 전환을 롤백한다
  - [ ] **모드 ON에서 `activateNetworkRecorder` 3종을 다시 호출해도 숨겨진 top에 sentinel이 안 간다** — 이 항목이 이 태스크의 존재 이유다. 되살아난 레코더는 에러 없이 로그만 2벌이 되어 조용하다
  - [ ] 모드 ON에서 래퍼 **밖** 프레임이 커밋되면 `rebroadcastSentinelsToFrame`이 발행하지 않는다
  - [ ] 모드 ON에서 래퍼가 cross-origin으로 이동해 커밋되면 새 documentId에 sentinel이 재발행된다
  - [ ] 전환 중 새 document가 commit돼도 래퍼 자손만 활성화되고 숨겨진 top 트리는 정지 상태다
  - [ ] 모드 OFF에서 activate 3종·`rebroadcastSentinelsToFrame`의 동작이 무변경이다(게이트가 `deviceTree` 빈 배열에서 기존 경로로 떨어진다)
  - [ ] **mount~`frameReady` 창에서 게이트가 일시적으로 OFF로 판정해 broadcast하는 것은 허용한다** — 그 구간엔 binding이 없어 `deviceTree`가 비는 게 정상이고, 되살아난 숨겨진 top은 이어지는 stop ACK가 죽이고 그 뒤 clear가 로그를 지운다. 이 창을 막으려고 게이트에 조건을 더하지 말 것(막을 방법이 없고 순서가 이미 방어한다)

### Task 6: 전환 오케스트레이션 훅

- **변경 대상**: `src/sidepanel/hooks/useDeviceViewport.ts` (신규), `src/store/settings-ui-store.ts`(version 9 → 10 + `deviceModeWarned`)
- **작업 내용**: design.md의 `select()` **세 경로 + OFF→ON 13단계**를 그대로 구현(재수립 경로는 Task 6b). 마운트 시 `device.state` 조회, `device.availableChanged` 구독. 최초 ON 진입 경고 플래그는 `settings-ui-store`에 **`deviceModeWarned: boolean`** — 경고가 재로드뿐 아니라 원본·래퍼 동시 실행까지 덮으므로 `deviceReloadWarned`가 아니라 이 이름을 쓴다. **version 9 → 10 bump + `migrateSettingsUi` 기본값 false 등록**이 함께 가야 한다. 체크박스 없이 `[계속]`에서 true를 `chrome.storage.local`에 즉시 영속한다. 문구는 진입·해제 재로드와 원본·래퍼 동시 실행에 따른 네트워크 요청·자동저장·결제 중복 위험을 모두 커버한다. `전체` 복귀는 unmount 후 `location.reload()`까지 간다.
  - **OFF→ON 경로에서만** 성공 판정이 `device.set` 응답이 아니라 background push(`device.frameLoaded`/`device.frameBlocked`, ≤3s) 수신이다. `device.arm`은 `device.set` **직전**에 열고 판정 후 닫는다. 폭 갱신(ON→ON)은 arm도 판정도 없이 응답이 곧 결과다.
  - 마운트 시 `device.state`(래퍼 있음)와 `device.documents`(binding 없음)가 엇갈리면 확장 reload 후 상태이므로 `device.state.width`(래퍼 실제 폭)로 **`reestablish`를 부른다**(Task 6b가 그 함수를 소유한다 — 여기서 `device.set`을 직접 보내면 계약 밖 네 번째 재수립 경로가 생긴다).
- **검증**:
  - [ ] `locked`가 `phase !== "idle" || unsupported`로 파생된다 (미지원 탭에서 행은 미렌더지만, 같은 훅을 쓰는 `App.tsx` 다이얼로그 분기 때문에 축은 유지한다)
  - [ ] **`select()`가 세 경로로 갈린다**: OFF→ON(전체 순서) / ON→ON은 `device.set { width }` 하나로 끝나는 **경량 경로** / ON→OFF(pending 폐기 → unmount + reload)
  - [ ] **폭 전환(390→768)에 `device.arm`·`frameLoaded` 대기·레코더 전환·로그 clear가 붙지 않는다** — 재로드가 없어 `frameReady`도 `onCommitted`도 안 오므로, 붙이면 3초 무신호 → 차단 판정 → 롤백으로 모드가 통째로 풀린다
  - [ ] `select()`가 `syncAndSettleLogs` → `device.arm` → `device.set` → 판정 → **전 document stop ACK → store clear 3종 → 래퍼 서브트리 start ACK** 순서를 지킨다. **clear가 stop ACK 뒤·start ACK 앞이어야 한다** — mount보다 앞에 두면 mount~stop 사이에 숨겨진 원본이 뱉은 로그가 경계를 통과하는데 같은 origin이라 필터로도 못 가른다
  - [ ] `ok === false` 응답에서 상태가 `전체`로 되돌아가고 토스트가 뜬다
  - [ ] **응답이 `undefined`(전달 실패)일 때도** 상태가 `전체`로 되돌아간다 — `ok === false`만 보면 샌다
  - [ ] `device.frameBlocked` 수신 시 `device.set { width: null }` 롤백 + `issue.device.blocked` 토스트
  - [ ] `device.frameLoaded` 수신 **전에는** `activateRecordersInDeviceTree`를 부르지 않는다 (binding이 아직 없어 `deviceTree`가 비면 start가 아무 데도 안 간다)
  - [ ] `busy`가 `device.arm`부터 판정·레코더 전환 완료까지 전 구간 `true`다
  - [ ] `select(null)`(전체 복귀)에서도 재로드가 일어나지만, 최초 ON에서 이미 확인했으므로 경고는 다시 띄우지 않는다
  - [ ] **마지막 구독자가 사라질 때만** `device.watch { on: false }`를 보낸다 — 훅이 두 곳에서 마운트되므로 모듈 스코프 refcount로 센다(`pending`·루프 카운터와 같은 소유 규칙)
  - [ ] persist version이 10이고 기존 version 9 스냅샷에서 `deviceModeWarned=false`가 채워진다
  - [ ] 최초 ON에서만 경고가 뜨고 `[계속]` 직후 true가 저장되며 사이드패널을 닫았다 다시 열어도 재노출되지 않는다
  - [ ] 래퍼 마운트가 XFO로 롤백된 경우에도 플래그는 소비된 상태로 둔다 — 사용자가 경고를 이미 읽었고, 재시도마다 다시 띄우면 성가시다(의도된 동작)
  - [ ] **`phase === "picking"`이면 `device.frameLoaded` 확정 직후 래퍼 frameId를 향해 `picker.start`를 `res?.ok`까지 재시도 송신한다**(`restartPickerInFrame` `picker-control.ts:286-303` 패턴, 10회×200ms). `device.set` 응답만 보고 쏘면 즉시 redirect되는 사이트에서 타깃 frameId가 아직 없다. `picker.start`는 broadcast 1회뿐이라 사후 생성 프레임에 안 닿고 `ensureContentScript`의 ping은 frameId 0만 보므로(`:25`) 자가복구도 안 걸린다 — 등록에 실패하면 모드 ON에서 아무 요소도 못 고른다
  - [ ] 그 재시도가 **broadcast가 아니다.** `setFrameToken`(`frame-geometry.ts:73`)이 `picker.start`마다 `childFrames` WeakSet을 갈아치우므로 broadcast하면 방금 등록된 래퍼가 날아간다

### Task 6b: 재수립 계약 + cross-origin handoff (사이드패널 측)

**이 태스크가 이 기능에서 가장 조용히 틀리는 곳이다.** 모드가 다시 서야 하는 사건이 셋(handoff / 차단 복구 / 확장 reload 복구)인데 각자 구현하면 세 번 다르게 만들어지고, 실패가 전부 무증상(모드가 안 서는데 세그먼트는 켜져 보임)이다. **`reestablish` 하나로 못 박고 시작한다** — design.md "재수립 계약" 표가 계약서다.

- **변경 대상**: `src/sidepanel/hooks/useDeviceViewport.ts`, `src/sidepanel/tabs/IssueTab.tsx:705-726`
- **작업 내용**:
  - `reestablish(tabId, width)` 신설. **호출 지점은 둘뿐** — ① top `onCommitted` + `pending` 있음 ② 패널 마운트 시 `device.state`(래퍼 있음)/`device.documents`(binding 없음) 엇갈림. handoff·차단 복구는 pending 세팅 + `chrome.tabs.update`만 하고 직접 부르지 않는다.
  - **design.md 계약 표 13축을 전부 구현한다.** 특히 표에만 있고 `select()`엔 없는 축 다섯이 빠지기 쉽다: `unsupported`는 우회 안 함(폐기 우선) / `busy` 거부 시 pending 복원 / handoff·차단 복구는 `tabs.update` 전에 arm 창 닫기 / `picker.start` 재시도 / pending·카운터는 모듈 스코프 단일 인스턴스.
  - `device.handoff` push 수신 → ① `pending = { tabId, width }`(인메모리, 영속 금지) ② `chrome.tabs.update(tabId, { url })` ③ `sessionExpired = true`(phase 판정 없이 무조건 — 렌더 분기가 non-idle 셋뿐이라 idle에선 안 뜬다).
  - `SessionExpiredDialog`의 body만 디바이스 모드 문구로 분기하고 컴포넌트·플래그·`onConfirm={() => reset()}`은 건드리지 않는다. 녹화·미리보기·완료 phase면 다이얼로그 대신 토스트 1개.
  - **루프 가드는 `reestablish` 호출을 센다** — handoff 횟수를 세면 frame-busting(handoff 없이 top이 곧장 커밋)을 못 잡는다. 연속 2회 초과 또는 직전 재수립 URL 재방문 → 전용 다이얼로그 → [확인] 시 모드 해제 + idle. 리셋은 사용자의 명시적 세그먼트 조작, 또는 재수립 성공 후 top 커밋 없이 10초 경과.
  - **`select(null)`은 `pending`을 `device.set`보다 먼저 버린다** — OFF의 `location.reload()`도 top 커밋이라 pending이 남으면 OFF↔ON 루프가 된다.
- **검증**:
  - [ ] **`reestablish`가 `locked`(`phase !== "idle"`)에서 실행된다** — 거부하면 drafting·recording 중 handoff에서 top만 옮겨가고 래퍼가 안 서는데 세그먼트는 `390`을 가리키는 desync가 된다. 이 태스크의 존재 이유다
  - [ ] `reestablish`가 `device.arm`을 연다 — 안 열면 잠정 등록이 없어 `frameLoaded`/`frameBlocked` 둘 다 안 오고 `busy`가 3초 타임아웃으로 끝난다
  - [ ] **handoff·차단 복구가 `chrome.tabs.update` 전에 arm 창을 닫는다** — 열린 채 남은 3초 창이 타임아웃되면 `frameBlocked`가 뒤늦게 날아와 방금 성공한 재수립을 롤백시킨다
  - [ ] **`busy` 거부 시 소비한 pending이 복원된다** — 삭제한 채 거부하면 `select()`가 도는 중에 온 top 커밋에서 모드가 조용히 유실된다
  - [ ] **`unsupported`는 우회하지 않는다** — `locked`가 `phase !== "idle" || unsupported` 두 축이라 뭉뚱그리면 미지원 URL에서도 재수립을 시도한다. 폐기 조건이 이긴다
  - [ ] **`pending`·루프 카운터가 모듈 스코프다** — 훅은 `DeviceViewportBar`와 `App.tsx` 다이얼로그 분기에서 두 번 마운트되므로(Task 13), 훅 상태에 두면 top 커밋 한 번에 재수립이 2회 발사되고 루프 임계를 각각 절반씩 센다
  - [ ] **`frameLoaded` 뒤 `picker.start` 재시도가 재수립 경로에도 있다** — picking 중 재수립이 그 분기의 유일한 도달 지점이다(위험 8). 빠지면 모드 ON에서 아무 요소도 못 고른다
  - [ ] `reestablish` 호출 지점이 정확히 2개다 (handoff·차단 복구가 직접 부르지 않는다 — 확장 reload 직후 top 커밋에서 두 경로가 겹쳐 발사되면 래퍼가 두 번 mount된다)
  - [ ] `reestablish`는 `syncAndSettleLogs`를 안 부르고 1회 경고를 안 띄운다
  - [ ] `reestablish`가 stop ACK 뒤에 store clear를 **무조건** 한 번 한다 — `background/index.ts:130`의 `logClear`는 editor 세션 스냅샷이 있을 때만 발화하므로, 패널을 막 열고 첫 로그 전이면 안 돈다. 두 번 비워도 둘 다 start ACK 전이라 무해하다
  - [ ] `pending`이 `chrome.storage`에 안 들어간다 (영속하면 기각한 desync가 되살아난다)
  - [ ] `pending`은 top 커밋에서 **소비 즉시 삭제**되고 재수립 성공 시 다시 세팅된다 (실패 경로에 유령 pending이 안 남는다)
  - [ ] 폐기 조건 6개가 전부 구현돼 있다: `전체` 선택 / 탭 전환 / 미지원 URL 도달 / `frameBlocked` / 루프 가드 / 언마운트
  - [ ] `select(null)`에서 pending 폐기가 `device.set`보다 앞이다 (OFF↔ON 무한 루프 차단)
  - [ ] 주소창으로 top을 옮겨도 같은 폭으로 재수립된다 (래퍼 안 이동과 규칙이 같다)
  - [ ] idle에서 handoff가 나면 다이얼로그가 안 뜨고 로그만 비워진다
  - [ ] drafting에서 handoff가 나면 다이얼로그가 뜨고 [확인] 뒤 phase가 idle이며 폭은 유지된다
  - [ ] recording에서 handoff가 나면 다이얼로그 대신 토스트가 뜨고 녹화가 계속된다
  - [ ] 연속 3회째 **재수립**에서 루프 다이얼로그가 뜨고 [확인] 뒤 모드가 해제된다
  - [ ] handoff를 거치지 않은 top 커밋(frame-busting 모사)도 루프 카운터를 올린다
  - [ ] 사용자가 세그먼트를 다시 고르면, 그리고 재수립 성공 후 10초간 top 커밋이 없으면 카운터가 0이다

### Task 7: 세그먼티드 컨트롤 UI

- **변경 대상**: `src/sidepanel/components/DeviceViewportBar.tsx` (신규), `src/sidepanel/components/__tests__/DeviceViewportBar.test.tsx` (신규, jsdom)
- **작업 내용**: **자기 `<Tabs value onValueChange>` 래퍼 + `CollapsingTabsList grid grid-cols-4 h-9`**(선례 `StyleEditorPanel.tsx:234-249` — `TabsContent` 없이 값으로 구동). `ToggleGroup`이 아니다. **라벨은 `TabLabel`로 감싸고 `CollapsingTabsList`를 쓴다** — 좁은 폭에서 아이콘만 남는 접힘이 의도된 동작이고(기기 아이콘을 넣은 이유), 접혀도 `aria-label`이 폭을 말한다. 첫 세그먼트 라벨 `전체`/`Full`(`Monitor` 아이콘, 데스크톱 뷰포트 겸용). **각 세그먼트는 아이콘 + 폭 숫자 병기** — 아이콘만 두면 기기 에뮬레이션으로 오해된다. 초과·잠금은 `aria-disabled`(never `disabled` — 툴팁이 죽는다). Radix의 키보드 활성화를 막도록 `onValueChange`와 `select()` 양쪽에서 locked/busy/초과 값을 거부한다. `busy`면 선택 세그먼트에 `Loader2 motion-reduce:animate-none`, 행에 `aria-busy`와 live status를 둔다. `data-testid`: 행 `device-viewport-bar`, 세그먼트 `device-preset-full`·`device-preset-390`·….
- **검증**:
  - [ ] `availableWidth=865`에서 `device-preset-1024`가 `aria-disabled="true"`, 나머지는 아니다
  - [ ] `availableWidth`가 865→1200으로 바뀌면 컴포넌트 재마운트·사용자 조작 없이 watch 상태 갱신으로 `1024`가 활성화된다
  - [ ] `locked=true`에서 모든 세그먼트가 `aria-disabled`다
  - [ ] `aria-disabled` 세그먼트를 클릭·Enter·Space·화살표키로 활성화해도 `select`가 호출되지 않는다
  - [ ] 오케스트레이터 `select()`를 직접 호출해도 locked/busy/초과 값은 거부된다
  - [ ] `busy=true`에서 스피너·`aria-busy`·live status가 뜨고 행 전체가 `aria-disabled`다
  - [ ] `tabId=null` 또는 미지원 탭이면 `null`을 반환한다
  - [ ] **`<Tabs>` 래퍼가 있다** — `TabsList`만 렌더하면 `DebugTab`의 바깥 `Tabs`(`:67`) 컨텍스트를 잡아 세그먼트 클릭이 `setSub("390")`으로 새어 서브탭이 빈 값으로 전환된다(에러 없는 조용한 오동작)
  - [ ] 320/360/400px 폭에서 라벨이 **잘리거나 줄바꿈되지 않는다** — 안 들어가면 `CollapsingTabsList`가 전 라벨을 접어 아이콘만 남긴다(다른 탭 바와 동일 거동)
  - [ ] 접힌 상태에서도 각 세그먼트의 접근명이 폭을 말한다 (`aria-label`이 라벨과 독립이라 접힘에 영향받지 않는다)
  - [ ] 아이콘이 `aria-hidden`이고 접근명은 폭을 읽는 `aria-label`이다 (아이콘이 접근명을 대체하지 않는다 — 접힘 상태에서 이게 유일한 폭 정보다)

### Task 8: DebugTab 배선

- **변경 대상**: `src/sidepanel/tabs/DebugTab.tsx:73-94`, `src/sidepanel/tabs/DraftingPanel.tsx:576-678`
- **작업 내용**: 서브탭 바 wrapper `<div>`(`CollapsingTabsList`가 74-93) **안쪽에 `mt-2`로** `<DeviceViewportBar tabId={tabId} />`를 넣는다. 별도 bordered 행(`px-4 py-4 border-b`)을 만들면 상단 크롬이 138→207px가 되는데, idle 화면은 `PageScroll`을 안 쓰고 `justify-center`(`IssueTab.tsx:308`) + 조상 `overflow-hidden`(`App.tsx:299`)이라 **밀리는 게 아니라 위아래가 잘린다**. 조건은 `sub === "issue" && !hideSubTabs`.
  별도로 `DraftingPanel`의 재현 환경 근처에 **모드 ON 읽기전용 인디케이터 1개**를 넣는다 — `device.state.width != null`로 ON을 판정하고 `뷰포트 390px`처럼 폭을 표시한다. 접근명과 `data-testid="device-viewport-indicator"`를 둔다.
- **검증**:
  - [ ] 콘솔·네트워크 서브탭으로 이동하면 행이 사라진다
  - [ ] `phase`가 drafting이면 행이 사라진다 (`hideSubTabs`와 동일 조건) — 대신 작성 화면 인디케이터가 뜬다
  - [ ] 미지원 탭에서 행이 렌더되지 않는다
  - [ ] drafting에서 `device.state.width != null`일 때만 인디케이터가 현재 폭·접근명과 함께 렌더된다
  - [ ] 행 추가 후에도 idle 캡처 진입 화면의 본문·CTA·footer가 잘리지 않는다 (360px 높이 기준 육안 확인). **`e2e/capture-modes-layout.spec.ts`의 `boundingBox()` 단언(`:63-77`)이 이 잘림을 잡는 기존 그물이다** — 그 spec이 red면 행 높이부터 의심한다
  - [ ] `pnpm test e2e` 아님 — 이 단계는 `IssueTab.test.tsx`/`DebugTab` 렌더 테스트로 확인

### Task 9: 화면(뷰포트) 캡처 rect 보정 + 드래그 클램핑

- **변경 대상**: `src/content/area-select.ts:110-118`·`:200-216`, `src/content/__tests__/`
- **작업 내용**: `selectFullViewport`의 rect(`:116`)를 `deviceFrameRect() ?? { x:0, y:0, width: innerWidth, height: innerHeight }`로. **스프레드 `{x:0,y:0,...viewport}`를 풀어야 한다** — 래퍼가 `justify-content:center`로 놓이므로 `x` 오프셋이 0이 아니다. 드래그 확정 rect(`:200-216`)는 `clampToDeviceFrame`으로 래퍼 영역 안에 가둔다. **`viewport`(`:114`)는 두 경로 모두 top 그대로 둔다** — 크롭 배율 기준이라 바꾸면 크롭이 ~3.9배 어긋난다.
- **검증**:
  - [ ] 모드 OFF에서 rect가 `{0,0,innerWidth,innerHeight}`로 이전과 동일
  - [ ] 모드 ON에서 rect가 래퍼의 `getBoundingClientRect()`와 일치하고 `x > 0`이다
  - [ ] 모드 ON에서 래퍼 밖 여백까지 드래그한 rect가 래퍼 영역으로 클램핑된다
  - [ ] 모드 OFF에서 드래그 rect가 클램핑 없이 이전과 동일하다
  - [ ] `onSelected`에 넘기는 `viewport`가 네 경우 모두 `{innerWidth, innerHeight}`

### Task 10: 크롭 배율 viewport와 메타 viewport 분리

- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts:206-223`·`:423` — **`capture.ts`가 아니다.** `captureAndCrop`은 이 파일의 모듈 프라이빗 함수이고(`capture.ts`의 export는 `cropImage`뿐) 호출부도 `:222` 한 곳이라 변경이 이 파일 안에서 끝난다.
- **작업 내용**: `captureAndCrop(rect, cropViewport, metaViewport)`로 인자 추가. `picker.areaSelected` 수신부가 `metaViewport = await getTopViewport(tabId)`를 넘긴다. `captureAndInsertInline`(`:442`)은 `cropImage`만 쓰고 메타를 안 써서 무변경 — 두 함수 시그니처가 비대칭이 되므로 주석으로 이유를 남긴다.
- **검증**:
  - [ ] `cropImage`의 스케일 계산이 `cropViewport`를 쓴다 (`img.naturalWidth / cropViewport.width`)
  - [ ] `onAreaCaptured`에 넘어가는 값이 `metaViewport`다
  - [ ] 모드 OFF에서 두 값이 같아 결과가 이전과 동일함을 유닛으로 고정
  - [ ] `getTopViewport`가 null을 반환하면 `cropViewport`로 폴백

### Task 11: 페이지 전체 캡처 잠금

- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx:552-561`, `src/sidepanel/components/TooltipIconButton.tsx`
- **작업 내용**: `capture-method-fullpage`의 `ariaDisabled={busy}`(`:554`)를 `{busy || deviceMode}`로. **`label`은 건드리지 않는다** — `TooltipIconButton.tsx:42,54`에서 `label` 하나가 `aria-label`과 툴팁을 겸하므로 문구를 갈면 접근명이 "페이지 캡처(디바이스 모드에서 잠김)"가 된다.
  **잠금 사유를 보여주려면 `TooltipIconButton`을 손봐야 한다.** 그 컴포넌트는 `TooltipContent`를 내부에서 `label`로 렌더하고 props에 사유 슬롯이 없어서, 바깥에서 두 번째 `TooltipContent`를 붙일 수 없다(`mode-freeform` 선례는 `TooltipIconButton`이 아니라 raw `Button` + `Tooltip` 조합이라 그대로 못 베낀다). **`disabledReason?: string` 옵션 prop을 추가**해 있으면 툴팁 본문만 대체하고 `aria-label`은 `label`을 유지한다. 기존 호출부는 prop 미전달이라 무변경이다.
  `onFullPage`도 조기 반환(컴포넌트가 `ariaDisabled`에서 이미 클릭을 막지만 오케스트레이터 쪽 이중 방어).
- **검증**:
  - [ ] 모드 ON에서 버튼이 `aria-disabled="true"`다
  - [ ] 모드 ON/OFF 양쪽에서 버튼의 `aria-label`이 동일하다 (잠금 사유가 접근명을 오염시키지 않는다)
  - [ ] 모드 ON에서 클릭해도 `runScrollCapture`가 호출되지 않는다 (**"조용한 1타일"이 절대 발생하지 않는다** — 이 항목이 이 태스크의 존재 이유다)
  - [ ] 모드 OFF에서 동작·툴팁이 이전과 동일
  - [ ] `disabledReason`을 안 넘긴 기존 `TooltipIconButton` 호출부(어노테이션 툴바·캡처 방식 툴바)의 툴팁이 무변경이다
  - [ ] 모드 ON에서 툴팁 본문만 잠금 사유로 바뀌고 `aria-label`은 그대로다

### Task 12: 래퍼 frameId를 top처럼 취급

- **변경 대상**: `src/background/tab-bindings.ts`, `src/background/index.ts:120`·`:123`·`:145-186`, `src/types/messages.ts`, `src/background/bgRequestTypes.ts`
- **작업 내용**:
  - `deviceFrameByTab: Map<number, {frameId, documentId}>` + `setDeviceFrame`·`isTopLikeFrame`·`armDeviceFrame`·`listTabDocuments`. 권위값은 `chrome.storage.session`에 보존하고 Map은 복제 캐시로 둔다. SW 시작 시 복원 promise 뒤에 navigation 이벤트를 탭별 순서 큐잉해 복구 전 오판을 막는다. **`isTopLikeFrame`은 동기 시그니처를 유지하되 큐 안에서만 호출한다** — 큐 밖 호출은 복원 전 오판이 된다.
  - 래퍼의 `device.frameReady`로 frameId를 등록한다. 이후 **same-origin** 이동은 frameId를 따라가고 commit마다 documentId를 갱신한다. **`frameReady`는 후속 문서에서도 매번 재발화하므로**(same-origin 불변식) arm 창이 닫혀 있으면 documentId만 갱신하고 push하지 않는다 — 안 그러면 same-origin 이동마다 `frameLoaded`가 날아온다. `parentFrameId`/`parentDocumentId`로 래퍼 자손 계보를 유지한다.
  - **로드 검증(XFO/CSP)의 판정 주체가 여기다.** `device.arm`으로 3초 감시창을 열고, 창 안에서 `parentFrameId === 0 && url === top URL`인 첫 `onBeforeNavigate`를 잠정 래퍼로 잡는다. 성공 = `device.frameReady` 또는 래퍼 frameId의 **same-origin** `onCommitted`(경로·쿼리만 바뀐 redirect 포함), 차단 = 래퍼 frameId의 `onErrorOccurred` 또는 3초 무신호. 결과를 `device.frameLoaded`/`device.frameBlocked`로 push한다. **same-origin redirect를 차단으로 합치지 않는다.**
  - **cross-origin 감지 → `device.handoff` push.** 1차 트리거는 `onBeforeNavigate(래퍼 frameId)`의 URL origin이 top과 다를 때(요청 전에 잡힌다), 폴백은 `onCommitted(래퍼 frameId)`의 cross-origin(same-origin URL이 서버에서 302로 밀린 경우). 판정은 `new URL(url).origin` 비교 — site가 아니라 origin이라 서브도메인 이동도 handoff다. **네비게이션을 취소할 방법은 없다** — MV3에 blocking webRequest가 없으므로 handoff는 사후 조치다.
  - **차단 청취는 감시창 밖에서도 계속한다.** binding 확정 뒤의 `onErrorOccurred(래퍼 frameId)`도 듣고, 유지 중 차단은 handoff와 같은 경로로 보낸다(프레임에 못 들어가는 URL이므로 top으로 내보낸다). 안 하면 모드 유지 중 XFO 사이트에 도달했을 때 백지에 방치된다(prd 목표 9).
  - `listTabDocuments(tabId)`는 `chrome.webNavigation.getAllFrames({ tabId })` + binding으로 `{ all, deviceTree }`를 만든다. Task 5의 유일한 문서 열거원이다.
  - `device.arm`·`device.documents`는 `BgRequest` union + `BG_REQUEST_TYPES` 화이트리스트에 **등록한다**. 반면 `device.frameReady`·`device.frameLoadEvent`는 **background에 push 전용 `chrome.runtime.onMessage` 리스너를 하나 더 달아** 받는다 — `index.ts:188`의 화이트리스트 게이트가 막고(Asana 전량 차단 회귀 전례), `messages.ts:198`의 `handleMessage`는 `_sender`를 아예 안 읽는다.
  - **`onCommitted`의 두 책임을 분리한다.** `frameCommitted` push는 **항상 실제 `details.frameId`로**(자식 분기 `:146-162`를 래퍼에도 그대로 태운다), `isTopLikeFrame`은 **로그 라이프사이클에만**(`:129-140` 3종 sync, `:174-185` logClear) 적용.
  - `navUrlPromise`(`:120`) 키를 `${tabId}:${frameId}`로 확장하고, 래퍼의 prev URL은 `chrome.tabs.get`이 아니라 직전 `onCommitted` URL로 추적.
- **검증**:
  - [ ] 모드 OFF에서 Map이 비어 있어 `isTopLikeFrame`이 `frameId === 0`과 동치다 (기존 동작 100% 보존)
  - [ ] 래퍼 안에서 same-origin 이동 시 3종 `sync`가 발화한다
  - [ ] 래퍼 안에서 reload 시 `logClear`가 발화한다
  - [ ] top 탭이 다른 URL로 이동하면 Map 엔트리가 지워진다
  - [ ] 일반 iframe(래퍼 아님)에서는 여전히 자식 분기로 간다 — **`frameCommitted` 재발행 경로가 안 깨져야 한다**
  - [ ] **래퍼 커밋에서도 `frameCommitted`의 `frameId`가 0이 아니라 래퍼 frameId다.** `:170`의 하드코딩 `frameId: 0`이 래퍼 documentId를 0 슬롯에 쓰면(`usePickerMessages.ts:271`) 이후 진짜 top의 `picker.selected`/`cancelled`/`areaSelected`가 `isStalePickerDocument`에 걸려 전부 드롭된다 — 완전 무반응 회귀
  - [ ] 래퍼 안에서 A→B→C로 연속 이동할 때 두 번째 판정의 `prev`가 A가 아니라 B다
  - [ ] `device.frameReady`가 `BG_REQUEST_TYPES` 게이트에 막히지 않고 background에 도달한다 (전용 push 리스너 경로)
  - [ ] **arm 창이 닫힌 상태의 `frameReady`는 `documentId`만 갱신하고 `frameLoaded`를 push하지 않는다** — 래퍼 안 same-origin 이동마다 재발화하므로, 안 막으면 사이드패널이 전이 완료 처리를 반복한다
  - [ ] `device.arm`·`device.documents`는 반대로 화이트리스트에 **등록돼 있어** 정상 라우팅된다
  - [ ] SW를 강제 종료했다 깨워도 storage 복원 뒤 `isTopLikeFrame`이 래퍼를 다시 인식한다. Playwright에서 worker 종료·재기동을 안정적으로 판정할 수 있으면 e2e에 포함하고, 불가능한 경우에만 순수 coordinator 단위 테스트 + 수동 검증으로 남긴다
  - [ ] **same-origin** 이동 뒤 frameId는 유지되고 documentId만 교체된다 (start 재전달 자체는 Task 5의 게이트가 검증한다)
  - [ ] **cross-origin** 이동에서 `device.handoff`가 1회 push되고 `frameLoaded`/`frameBlocked`는 안 나간다 (세 push가 경쟁하지 않는다)
  - [ ] `onBeforeNavigate`에서 잡히는 cross-origin은 `onCommitted`를 기다리지 않는다 (파티션된 화면이 렌더되기 전)
  - [ ] same-origin redirect(경로 변경)가 handoff로 오판되지 않는다
  - [ ] `a.com` → `www.a.com`처럼 same-site이면서 cross-origin인 이동은 handoff로 간다 (판정이 site가 아니라 origin이다)
  - [ ] binding 확정 뒤의 `onErrorOccurred(래퍼 frameId)`도 잡혀 복구 경로로 간다 (감시창 밖 차단)
  - [ ] arm 창이 닫힌 상태에서는 top의 자식 커밋을 잠정 래퍼로 잡지 않는다 (일반 iframe 오탐 차단)
  - [ ] 판정 신호 6개가 각각 `frameLoaded`/`frameBlocked`/`handoff` 중 **정확히 하나만** 발화한다(arm 닫힘 상태의 `frameReady`는 무발화). 중복 push로 롤백과 활성화가 경쟁하지 않는다
  - [ ] same-origin redirect가 `frameBlocked`로 오판되지 않는다
  - [ ] `listTabDocuments`가 모드 OFF에서 `deviceTree: []`를 반환한다 (Task 5 게이트가 기존 broadcast 경로로 떨어지는 조건)

### Task 13: 2-depth 안내 문구 분기

- **변경 대상**: `src/sidepanel/App.tsx:362-376` (문구 교체 지점은 `:367`)
- **작업 내용**: `useDeviceViewport(tabId).width != null`이면 body를 `app.iframeUnsupported.bodyDeviceMode`로 교체. content script 프로토콜·`messages.ts`의 `fire()` 변경 없음. **`DeviceViewportBar`와 훅이 두 번 마운트되는 지점이 여기다** — `device.state` 중복 요청이 안 나게 확인하고, `pending`·루프 카운터가 훅이 아니라 모듈 스코프에 있는지 함께 본다(Task 6b).
- **검증**:
  - [ ] 모드 OFF에서 다이얼로그 문구가 이전과 동일
  - [ ] 모드 ON에서 "디바이스 모드를 끄면 선택할 수 있습니다" 취지의 문구로 바뀐다
  - [ ] `data-testid="iframe-unsupported-dialog"`가 유지된다 (`e2e/picker-guard.spec.ts` 의존)

### Task 14: i18n

- **변경 대상**: `src/i18n/namespaces/app.ts`, `src/i18n/namespaces/issue.ts`
- **작업 내용**: ko/en 동시 추가.
  - `issue.device.full` / `issue.device.w390`·`w768`·`w1024` (**`w430` 없음**)
  - `issue.device.tooltip.tooNarrow` (창이 좁아 사용 불가)
  - `issue.device.tooltip.locked` (캡처·녹화 중 전환 불가 — **drafting은 행이 안 보이므로 이 문구의 도달 조건은 capturing/recording뿐**)
  - `issue.device.aria.full` / `.width` (세그먼트 접근명 — 숫자만 읽히지 않게. `.width`는 폭 placeholder를 받는다. **라벨이 접혀 아이콘만 남아도 이게 유일한 폭 정보**라 생략 불가)
  - `issue.device.modeWarning.title` / `.body` / `.confirm` / `.cancel` — 진입·해제 재로드와 원본·래퍼 동시 실행에 따른 네트워크 요청·자동저장·결제 중복 위험. **`.dontAskAgain`은 없다**(체크박스 제거) 대신 `[계속]`/`[취소]` 버튼 라벨 2개가 필요하다. 네임스페이스가 `reloadWarning`이 아닌 이유는 경고 범위가 재로드보다 넓기 때문 — 플래그명 `deviceModeWarned`와 맞춘다
  - `issue.device.blocked` (XFO 롤백 토스트 — same-origin redirect 성공에는 쓰지 않는다)
  - `issue.sessionExpired.bodyDeviceMode` (handoff로 뜬 세션 만료 다이얼로그 body. **title은 기존 것을 재사용**한다 — "페이지가 변경되었습니다"가 그대로 맞다)
  - `issue.device.handoffToast` (녹화·미리보기·완료 phase의 비침습 토스트)
  - `issue.device.loop.title` / `.body` / `.confirm` (리다이렉트 루프 가드 다이얼로그)
  - `issue.device.indicator` (작성 화면 모드 ON 표시 — 폭 placeholder 필요, 예: `뷰포트 {width}px`)
  - `issue.device.status.switching` (**`busy` 구간 live status** — design이 "행에 `aria-busy`와 live status"를 요구하는데 문구 키가 없으면 스크린리더에 아무것도 안 읽힌다. XFO 사이트는 이 구간이 최대 3초다)
  - `issue.capturing.method.fullPageDeviceLocked`
  - `app.iframeUnsupported.bodyDeviceMode`
- **검증**:
  - [ ] 저장 시 PostToolUse 훅이 `src/i18n/__tests__/locales.test.ts`를 자동 실행해 통과 (ko/en 키 대칭·빈 값·placeholder 일치)
  - [ ] `src/log-viewer/i18n.ts`는 무변경 — 이 키들을 log-viewer가 안 쓴다

### Task 15: e2e

- **변경 대상**: `e2e/device-viewport.spec.ts` (신규), 필요 시 `e2e/fixtures/`에 XFO 응답 픽스처
- **작업 내용**: 아래 "테스트 계획"의 e2e 시나리오를 spec으로. `/e2e-write`가 green까지 자기완결.
- **영상·30s Replay 제외**: 기존 suite 정책대로(`e2e/playwright.config.ts:27` — Replay 캡처 spec은 `captureVisibleTab` cold-start/quota flaky로 제거된 상태) 실제 Replay·탭 녹화 캡처는 e2e에 넣지 않는다. `getTopViewport` 전달·null 폴백은 단위로, 실제 `Viewport` 메타 값은 아래 수동 체크리스트로 닫는다. prd 성공기준 4의 영상·Replay 부분은 이 두 그물이 유일하다.
- **시나리오 순서 결합 주의**: 경고 다이얼로그(시나리오 7)는 최초 ON 진입에서 플래그를 소비하므로, 그 spec보다 뒤에 도는 전환 시나리오(3~6·20)는 다이얼로그를 기대하면 안 된다. 순서 의존을 만들지 말고 각 spec이 플래그 상태를 스스로 세팅한다.
- **검증**: `pnpm build:e2e && pnpm test:e2e` green

### Task 16: 문서

- **변경 대상**: `docs/privacy.ko.md`·`docs/privacy.en.md`, `docs/PERMISSION.md`, `CLAUDE.md`, `docs/DIRECTORY.md`, `docs/ARCHITECTURE.md`
- **작업 내용**:
  - **privacy ko/en 양쪽 본문 + 상단 시행일** — manifest diff가 0이어도 필수. 새 관측 동작 7개(같은 URL 재로드·쿠키 재전송·원본 문서 은닉·프레임 단위 로그 수집 대상 변경·에뮬레이트 화면 캡처·**cross-origin 이동 시 탭 전체 재이동**·**프레임 안 element 컨텍스트 확장**). 대상 절: `### 페이지 데이터 및 디버그 정보` 표(창 크기 행 — `Viewport`가 이제 브라우저 창이 아니라 디바이스 폭일 수 있다·스크린샷 행), iframe 로그 수집(`privacy.ko.md:66`), iframe 요소 선택(`:68`), `### 광역 호스트 권한 사용처`(`docs/PERMISSION.md:555` §12와 짝).
    **`privacy.ko.md:62`의 "iframe 내부 요소에는 확장을 적용하지 않습니다"가 모드 ON에서 거짓이 된다** — Task 3b가 래퍼에 한해 컨텍스트 확장을 열기 때문이다. 그 문장에 "단, 디바이스 뷰포트 모드에서 페이지 전체를 감싸는 확장 자체의 프레임은 예외" 취지를 더한다. 이 한 문장이 갱신 대상 중 **유일하게 기존 서술을 뒤집는** 것이라 놓치기 쉽다
  - `docs/PERMISSION.md` §12 표에 `scripting`/`<all_urls>` 새 사용처 1행
  - `CLAUDE.md` "스택"에 디바이스 뷰포트 1항목, "게이트웨이"에 모드 ON 제약
  - `docs/DIRECTORY.md`에 신규 파일 4개
  - `docs/ARCHITECTURE.md`에 "디바이스 뷰포트" 절 — 단일 출처가 페이지 DOM인 이유, `srcdoc` 금지, shadow root 금지, 크롭/메타 viewport 분리, **XFO 판정 주체가 background 하나인 이유**(content의 href 비교는 same-origin redirect를 오판한다), **sentinel 발행 단일 게이트**(우회 코드가 하나 생기면 로그가 조용히 2벌이 된다), **"래퍼는 언제나 top과 same-origin" 불변식과 cross-origin handoff**(storage partitioning 때문이고, 이 불변식이 계보 추적·pre-arm·element 확장 셋을 동시에 싸게 만든다), **재수립 계약**(`select`와 달리 잠금을 우회하는 이유 — 이걸 모르고 잠금을 적용하면 drafting 중 handoff에서 모드가 조용히 안 선다)
- **검증**:
  - [ ] privacy ko/en이 같은 줄 수·같은 절 구성으로 유지된다
  - [ ] `pnpm sync:agents:check` green (`CLAUDE.md` 편집 시 훅이 자동 sync하지만 최종 확인)

---

## 테스트 계획

### 단위 테스트

| 대상 | 케이스 |
|---|---|
| `device-presets.ts` | 가용 폭 경계(초과/딱맞음/미달), `null` 낙관적 판정, 프리셋 3개·`430` 부재 |
| `picker.ts` 확장 게이트 | 래퍼에서 확장 판정이 돌고 일반 iframe에서는 안 돈다, top 무변경 |
| handoff 코디네이터 (background) | cross-origin beforeNavigate·commit 각각에서 push 1회, same-origin redirect 무시, 감시창 밖 `onErrorOccurred` 포착 |
| `reestablish` 계약 (사이드패널) | 계약 표 13축 전부 — `phase` 축만 우회하고 `unsupported`는 폐기, `busy` 거부 시 pending 복원, arm 개폐 시점, `picker.start` 재시도, stop ACK 뒤 무조건 clear, 호출 지점 2개, 모듈 스코프 단일 소유 |
| handoff 오케스트레이션 (사이드패널) | `pending` 폐기 조건 6개와 `select(null)`에서의 폐기 순서, 루프 카운터(연속 2회 초과·직전 URL 재방문·handoff 없는 top 커밋 포함·10초 무커밋 리셋), phase별 통보 분기(idle 무음 / non-idle 다이얼로그 / recording 토스트) |
| `device-frame.ts` (jsdom) | mount/unmount 왕복 무손실, 멱등, 폭 갱신 시 노드 유지, `src === location.href`, body 직속, 다크 미디어쿼리 블록 존재 |
| `device-frame.ts` (node) | `clampToDeviceFrame` 4케이스(밖/걸침/안/`null`) |
| `picker-control.ts` | 주입 `func`의 프레임 id 리터럴 ↔ `DEVICE_FRAME_ID` 동기화, self-contained(외부 참조 0) |
| `video-recorder.ts`·`use-30s-replay.ts` | `getTopViewport` 성공값 전달, null이면 기존 `chrome.tabs.get` 값 폴백. 실제 영상·30s Replay 캡처는 e2e suite 제외 |
| `recorder-control.ts`·`picker-control.ts` (sentinel 게이트) | 모드 ON에서 activate 3종이 top에 sentinel을 안 보낸다, 래퍼 밖 프레임 커밋에 재발행 안 한다, 래퍼 커밋에는 재발행한다, 모드 OFF에서 기존 broadcast 경로로 떨어진다 |
| `usePickerMessages.ts` | `cropViewport ≠ metaViewport`일 때 크롭은 `cropViewport`, 메타는 `metaViewport`. `getTopViewport`가 `null`이면 `cropViewport` 폴백 |
| `area-select.ts` | 래퍼 유/무에 따른 rect 분기(`x > 0` 포함), 드래그 클램핑, `viewport`는 항상 top |
| `DeviceViewportBar.tsx` (jsdom) | 초과 비활성, 잠금, busy 접근성, `aria-disabled` 클릭·키보드 우회 차단, `tabId=null`·미지원 탭 미렌더 |
| background device-frame coordinator | storage 복원 순서 큐, **모드 OFF에서 `isTopLikeFrame` ≡ `frameId === 0`**(prd 목표 6의 유일한 유닛 그물), frameId 지속/documentId 교체, parent 계보, `listTabDocuments`의 `all`/`deviceTree` 분리, arm 창 안/밖 잠정 등록 판정, 판정 신호 6개(frameReady×arm개폐 2 · onCommitted×origin 2 · onErrorOccurred · 타임아웃) → push 3종 중 정확히 1회 또는 무발화, OFF/top navigation cleanup |
| `settings-ui-store.ts` | version 9 → 10 마이그레이션에서 `deviceModeWarned` 기본값 주입 |

### e2e 시나리오

`/e2e-write`의 입력이다.

**모드 게이팅 (최우선)**
1. 뷰포트 행 기본 선택이 `전체`이면 페이지 DOM에 `#__bugshot_device_frame__`가 없다.
2. 기존 e2e 전 스위트가 무변경으로 green이다 — 특히 `capture-modes-layout.spec.ts`의 `boundingBox()` 기반 균등 너비 단언(`:63-77`). 뷰포트 행이 상단 크롬을 키워 idle 화면이 잘리면 여기서 먼저 깨진다.

**전환**
3. `390` 세그먼트를 누르면 페이지에 `#__bugshot_device_frame__`가 생기고 그 iframe 안의 `window.innerWidth`가 `390`이다.
3b. **`390`에서 `768`로 바꾸면 iframe 노드가 유지된 채 `innerWidth`만 768이 되고, 모드가 풀리지 않으며 로그도 초기화되지 않는다** (경량 경로 — 재로드가 없어 차단 판정이 돌면 안 된다).
4. `390` 선택 후 페이지 안에서 `matchMedia("(max-width: 767px)").matches`가 `true`다.
5. `390` 선택 후 원본 `body` 자식이 `display: none`이고 iframe만 보인다.
6. `전체`로 되돌리면 `#__bugshot_device_frame__`와 `#__bugshot_device_style__`가 둘 다 없어지고 원본이 **재로드**된다.
7. 최초 ON 진입에서 재로드·중복 실행 위험 경고가 1회 뜨고, [계속] 뒤 **사이드패널을 닫았다 다시 열어도** 다시 뜨지 않는다. 체크박스는 없다. (플래그가 `chrome.storage.local`이라 패널 재오픈 검사로 충분하다 — `e2e/fixtures/extension.ts:167-179`가 워커당 persistent context 1개를 열고 teardown에서 닫으므로 **브라우저 재시작은 이 fixture로 표현할 수 없다**.)

**가용 폭**
8. 창을 좁혀 가용 폭을 1024 미만으로 만들면 `device-preset-1024`가 `aria-disabled`가 된다.
9. 다시 넓히면 사용자 조작 없이 `aria-disabled`가 풀린다.

**로그**
10. 모드 ON에서 페이지가 `console.log`를 1회 호출하면 콘솔 로그 탭에 **1건**만 쌓인다(2벌 아님).
11. 모드 ON에서 네트워크 요청 1건이 네트워크 로그 탭에 1건만 쌓인다.
11b. **모드 ON에서 사이드패널을 숨겼다 다시 보이게 해(`visibilitychange` → `inject()` → activate 3종 재호출) 로그를 다시 찍어도 여전히 1건이다.** 되살아난 top 레코더는 에러 없이 중복 엔트리만 만들므로 이 시나리오가 없으면 회귀가 조용히 통과한다.
12. 모드 전환 직후 이전 페이지의 로그가 남아 있지 않다.
13. 래퍼 안에서 **same-origin** 링크로 이동하면 래퍼가 유지된 채 로그 꼬리가 sync되고, 이동 후 페이지의 `console.log`가 다시 1건 수집된다(start 재전달 확인).

**캡처**
14. 모드 ON에서 `capture-method-fullpage`가 `aria-disabled`이고, 클릭해도 캡처가 시작되지 않는다.
15. 모드 ON에서 화면(뷰포트) 캡처를 하면 결과 이미지의 가로세로비가 래퍼 rect의 비와 일치한다(좌우 여백이 안 들어간다).
15b. 모드 ON에서 래퍼 밖 여백까지 걸쳐 영역 드래그를 해도 결과 이미지의 가로세로비가 래퍼 rect 안에 든다(클램핑).
16. 모드 ON에서 요소를 선택해 캡처한 이슈의 재현 환경 `Viewport` 행이 `390×<창높이>`다.
17. 모드 OFF에서 같은 캡처들의 `Viewport` 행이 브라우저 실제 폭이다.

**picker**
18. 모드 ON에서 래퍼 안의 요소를 정상적으로 선택할 수 있다 (래퍼가 registry에 등록돼 blocker 핸드오프가 열린다 — **이게 깨지면 모드 ON에서 아무것도 못 고른다**).
19. 모드 ON에서 래퍼 안의 iframe(2-depth)을 클릭하면 `iframe-unsupported-dialog`가 뜨고 문구가 디바이스 모드 전용이다.

**실패 경로**
20. `X-Frame-Options: DENY`를 주는 픽스처 페이지에서 `390`을 누르면 3초 안에 원본이 복원되고 세그먼트가 `전체`로 돌아간다(진입 시점 차단).
20b. 롤백 뒤 원본 marker가 보이고 device frame/style이 없으며 캡처 진입을 다시 사용할 수 있다.
20c. **자기 URL이 즉시 same-origin 경로로 302 redirect되는 픽스처 페이지에서 `390`이 성공한다** — 차단으로도 handoff로도 오판하지 않는다. 롤백 토스트가 뜨지 않고 래퍼 안 `innerWidth`가 390이다.
20d. 모드 유지 중(진입 감시창이 닫힌 뒤) 래퍼 안에서 XFO `DENY` 페이지로 이동하면 백지에 머무르지 않는다 — **top이 그 URL로 이동한 뒤** 재수립이 차단되어 세그먼트가 `전체`로 돌아간다(진입 시점과 달리 원본 복원이 아니다).

**handoff**
23. 모드 ON에서 래퍼 안의 **cross-origin** 링크를 누르면 top URL이 그 사이트로 바뀌고, 래퍼가 같은 폭으로 다시 서며 그 사이트 안 `innerWidth`가 390이다.
24. 그 뒤 새 사이트의 `console.log` 1회가 로그 탭에 **1건**만 쌓이고, 이전 사이트의 로그는 남아 있지 않다.
25. drafting 상태에서 cross-origin 이동이 나면 세션 만료 다이얼로그가 뜨고 문구가 디바이스 모드용이며, [확인] 뒤 이슈 idle이면서 세그먼트는 여전히 `390`이다.
26. idle 상태에서 cross-origin 이동이 나면 다이얼로그가 **뜨지 않고** 로그만 비워진다.
27. 모드 ON에서 주소창으로 top을 다른 사이트로 옮겨도 같은 폭으로 재수립된다 (래퍼 안 이동과 결과가 같다).
28. `a → b → a`로 되돌리는 픽스처에서 루프 가드 다이얼로그가 뜨고, [확인] 뒤 모드가 `전체`로 해제된다.
28b. **frame-busting 픽스처**(래퍼가 `window.top.location = self.location`로 탈출)에서도 같은 루프 가드가 발동한다 — handoff를 거치지 않는 경로다.
28c. **drafting 중** cross-origin 이동에서 페이지에 `#__bugshot_device_frame__`가 다시 생기고 그 안 `innerWidth`가 390이다 — 잠금 우회의 유일한 실증이다. (drafting은 `hideSubTabs`로 뷰포트 행이 없으므로 세그먼트가 아니라 **DOM으로 단언**한다. 25번은 다이얼로그·복귀를, 이 항목은 래퍼 존재를 본다.)
28d. `전체`를 눌러 모드를 끄면 재로드 뒤에 래퍼가 **다시 서지 않는다**(pending 폐기 순서 확인).


**element 확장**
29. 모드 ON에서 조상 컨테이너가 게이트 3개를 통과하는 요소를 캡처하면 결과 rect가 요소 bbox+24px보다 크다 (확장이 살아 있다).
30. 모드 ON에서 페이지 안의 일반 iframe 요소는 여전히 확장 대상이 아니다.

**잠금**
21. `phase`가 **capturing 또는 recording**일 때 세그먼트 전체가 `aria-disabled`다. (drafting·styling·previewing·done은 `hideSubTabs`에 걸려 **행 자체가 없으므로** 이 시나리오의 대상이 아니다 — 대신 22b를 본다.)
22. 미지원 탭(`chrome://`)에서 `device-viewport-bar`가 렌더되지 않는다.
22b. `phase`가 drafting일 때 뷰포트 행이 사라지고, 작성 화면에 `device-viewport-indicator`가 현재 폭과 함께 보인다.

### 수동 테스트 (자동화 불가)

Chrome에서 `pnpm build` 후 dist를 로드해 확인한다.

- [ ] 실제 반응형 사이트(예: 문서 사이트)에서 `390`↔`768`↔`전체` 전환이 시각적으로 매끄러운가
- [ ] 래퍼 좌우 여백 배경색이 라이트/다크 모드 양쪽에서 어색하지 않은가 (라이트 페이지에 검은 슬래브가 안 깔리는가)
- [ ] **주입 `func` 리팩터 후 실제 탭에서 `Viewport` 메타가 맞는가** — `executeScript({func})`의 클로저 제약은 typecheck·유닛이 못 잡고 `catch`가 실패를 삼켜 조용히 폴백한다(`docs/ARCHITECTURE.md:465`)
- [ ] 사이드패널 폭을 320px까지 좁혀도 `1024` 세그먼트 라벨이 안 잘리고 안 넘치는가
- [ ] 모드 ON에서 탭 녹화 영상에 여백이 포함되는 정도가 리포트 품질을 해치지 않는가
- [ ] 모드 ON에서 30s Replay 프레임이 정상 인코딩되는가
- [ ] **모드 ON에서 탭 녹화로 만든 이슈의 재현 환경 `Viewport` 행이 `390×<창높이>`인가** (e2e 제외 경로 — prd 성공기준 4)
- [ ] **모드 ON에서 30s Replay로 만든 이슈의 `Viewport` 행이 `390×<창높이>`인가** (동일)
- [ ] 모드 ON 상태에서 확장을 reload하면 같은 폭으로 모드가 재수립되는가 (래퍼만 남고 로그가 죽는 상태로 방치되지 않는가)
- [ ] 로그인이 필요한 사이트에서 모드 진입 후 세션이 유지되는가 (쿠키·`sessionStorage` 보존 확인)
- [ ] **로그인 상태에서 cross-origin handoff가 일어난 뒤에도 목적지 사이트가 로그인 상태로 뜨는가** — 이게 handoff의 존재 이유다. 프레임 안에 뒀다면 파티션된 로그아웃 화면이 떴어야 한다
- [ ] 모드 ON에서 탭 녹화 중 cross-origin 이동 시 토스트가 뜨고 녹화가 끊기지 않는가 (영상엔 A+B, 로그엔 B만 — 의도된 비대칭)
- [ ] 여백 색이 어노테이션 캔버스 배경과 같은 톤인가 (같은 `--muted`를 쓰므로 시각적으로 일치해야 한다)
- [ ] SPA(라우터 기반)에서 래퍼 내부 라우팅 시 로그가 의도대로 동작하는가
- [ ] `position: fixed` 헤더가 있는 사이트에서 래퍼 안 fixed가 정상인가

---

## 구현 순서 권장

```
Task 1 ─┐
Task 2 ─┼─▶ Task 3 ─┬─▶ Task 12 ─┬─▶ Task 6 ─▶ Task 6b ─▶ Task 7 ─▶ Task 8  (모드 ON/OFF·handoff)
Task 14 ┘           │            └─▶ Task 5                                (로그 1벌·sentinel 게이트)
                    ├─▶ Task 3b                                            (element 확장 게이트)
                    ├─▶ Task 4 ─▶ Task 10 ─▶ Task 16                       (Viewport 메타)
                    ├─▶ Task 9                                             (화면 캡처 rect)
                    ├─▶ Task 11                                            (전체 캡처 잠금)
                    └─▶ Task 13                                            (2-depth 문구)
                                    ↓
                                 Task 15 (e2e) ─▶ Task 16 (문서)
```

- **Task 1·2·14는 병렬 가능** — 서로 의존 없음.
- **Task 3이 병목**이다. 메시지 타입이 확정돼야 사이드패널 쪽(4~13)이 전부 붙는다.
- **Task 3 이후 남는 의존은 넷뿐**이고 나머지는 병렬 가능하다: Task 10 → Task 4, **Task 5 → Task 12**(문서 열거·계보가 background에 있다), **Task 6 → Task 12**(성공 판정 push와 `device.arm`이 background에 있다), **Task 6b → Task 6**(`pending`을 훅이 소유한다).
- **Task 3b(element 확장)는 Task 3 직후 독립**이다 — 래퍼 판정만 있으면 되고 background를 안 탄다.
- **Task 6b를 e2e 전에 끝낼 것.** handoff가 빠진 상태로 cross-origin 링크를 밟으면 파티션된 로그아웃 화면이 뜨는데, 그게 "모드가 동작 안 함"으로 오진되기 쉽다.
- **Task 6b의 `reestablish` 계약을 Task 6 착수 전에 확정할 것.** 잠금 우회·arm 개방·pending 폐기 순서·호출 지점 단일화·루프 카운터 범위 다섯이 전부 이 계약 하나에서 갈리고, 틀리면 전부 **무증상 실패**(모드가 안 서는데 UI는 켜져 보임)로 나온다. Task 6의 `select()`를 먼저 짜고 나중에 재수립을 얹으면 잠금을 그대로 물려받기 쉽다.
- **Task 6b의 `reestablish` 계약을 Task 6보다 먼저 문서에서 확정하고 들어갈 것.** 잠금 우회·arm 개방·pending 폐기 순서·호출 지점 단일화·루프 카운터 범위 다섯이 전부 이 계약 하나에서 갈리고, 틀리면 전부 무증상 실패(모드가 안 서는데 UI는 켜져 보임)로 나온다.
- **Task 11(전체 캡처 잠금)을 늦추지 말 것.** 이걸 마지막에 하면 그 사이 개발·수동 검증에서 "조용한 1타일"을 정상 결과로 오인하게 된다.
- **Task 15는 반드시 Task 4~13 완료 후.** 부분 구현 상태에서 e2e를 쓰면 시나리오 3·10·16이 서로 다른 이유로 red가 나 원인 분리가 안 된다.
- 각 태스크 종료마다 `pnpm typecheck` + `pnpm test`. `pnpm build`는 사용자 요청 시에만.

## 가이드 영향

사용자 노출 기능이므로 갱신이 필요하다. 작성 전 `guide/AUTHORING.md`를 읽고, 구현 후 `/guide`로 처리한다.

- 신규 페이지 "디바이스 뷰포트로 반응형 검증하기". **`element/` 하위에 두지 않는다** — `guide/ko/SUMMARY.md`의 IA가 element/screenshot/video/logs로 캡처 모드별 분기인데 이 기능은 그 넷을 횡단하고 컨트롤도 모드 공통 진입 화면에 있다. `element/` 안에 넣으면 스크린샷·영상 사용자가 못 찾는다. 상위 레벨이나 `quick-start` 인접에 둔다.
  - 반드시 포함: **에뮬레이트되는 것(폭·미디어쿼리·`fixed`)과 안 되는 것(DPR·터치·UA)** 을 표로 명시. 없는 것을 있다고 말하면 리포트가 틀린다.
  - 모드 진입 시 페이지가 재로드된다는 것, 되돌릴 수 없는 화면에서 주의할 것
  - **다른 사이트로 이동하면 페이지 전체가 그 사이트로 다시 열리고 새 디버깅 세션이 시작된다**는 것 — 로그가 초기화되고 작성 중인 이슈가 있으면 안내가 뜬다. 이유(프레임 안에 가두면 로그인 상태가 유지되지 않는다)를 한 줄로 곁들인다
  - 모드 ON 동안의 알려진 제약: 페이지 내 iframe 요소 선택 불가, 페이지 전체 캡처 잠김
- 기존 캡처 가이드에서 "페이지 전체 캡처"를 설명하는 페이지에 잠금 조건 1줄 추가.
- 플랫폼 표·지원 플랫폼에는 변화가 없으므로 `guide/AUTHORING.md` 자체는 무변경.
