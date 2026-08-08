# 디바이스 뷰포트 — 기술 설계

## 개요

top 문서 안에 같은 URL을 `src=`로 로드하는 iframe(`#__bugshot_device_frame__`)을 만들고, 원본 `body` 자식을 스타일시트 한 장으로 숨긴 뒤 그 iframe을 선택한 폭으로 렌더한다. `<all_urls>` content scripts가 래퍼에도 주입된다.

**불변식: 래퍼는 언제나 top과 same-origin이다.** 래퍼가 cross-origin으로 나가려 하면 프레임 안에 두지 않고 top 탭을 그 URL로 보낸 뒤 같은 폭으로 재수립한다(아래 "cross-origin handoff"). 근거는 셋이다 — ① cross-**site** iframe은 third-party storage partitioning으로 파티션된 빈 저장소를 보고 SameSite=Lax 쿠키도 안 실려 **실제 사이트가 아닌 로그아웃 화면**을 찍게 된다 ② `window.frameElement`가 항상 유효해져 cross-origin 문서를 DOM 없이 추적하기 위한 계보 로직이 통째로 사라진다 ③ pre-arm 플래그가 origin 스코프 `sessionStorage`라, same-origin이어야 래퍼가 document_start부터 버퍼링한다.

**판정 기준은 site가 아니라 origin이다.** ①만 보면 site 기준으로 충분하지만 ②③이 origin 기준을 요구한다 — `a.com` → `www.a.com`은 same-site여도 `frameElement`가 `null`이 되고 pre-arm 플래그가 갈린다. 한 단계 좁게 잡아 세 보장을 예외 없이 성립시키고, 대가는 서브도메인 이동에서 재로드 1회다. 구현은 `new URL(url).origin` 비교이고 `tldts`가 필요 없다.

래퍼 식별은 `device.frameReady` 1회 등록 후 Chrome `frameId`/`documentId`가 맡는다.

**설계의 축은 "상태를 어디에 두지 않을 것인가"다.** 모드의 출처는 top 문서에 그 iframe이 존재하는지 여부이고, `chrome.storage`에 ON/OFF 플래그를 **영속하지 않는다**. background의 `chrome.storage.session`에는 로그·navigation 라우팅용 frame binding만 보존하며 UI 상태로 사용하지 않는다.

예외가 하나 있다: **top 문서가 교체될 때 폭을 넘기기 위한 사이드패널 인메모리 `pending`**(아래 "cross-origin handoff"). 이건 영속되지 않고, 매 top 커밋마다 실제 re-mount로 조정되며, 차단되면 `전체`로 롤백되므로 기각한 desync(래퍼는 없는데 UI만 ON)를 만들지 않는다. 그 외에는 사이드패널이 필요할 때마다 top 문서에 물어본다.

같은 원리로 **뷰포트 값을 파생하는 코드가 사이드패널 상태를 안 읽는다.** `getTopViewport`가 주입하는 함수가 스스로 래퍼를 찾아보고, 있으면 래퍼 크기를 없으면 `window.innerWidth/innerHeight`를 반환한다. `getTopViewport` **호출부 3개**(element·screenshot·freeform)가 무변경으로 올바른 값을 받는다.

**영상·30s Replay는 이 경로에 없다.** `video-recorder.ts:111-117`과 `30s-replay/use-30s-replay.ts:153`은 `chrome.tabs.get(tabId)`의 `tab.width/height`를 쓰므로, 그대로 두면 모드 ON에서 영상 리포트의 `Viewport`만 브라우저 폭으로 남는다. 두 곳을 `getTopViewport`로 교체해 캡처 5종을 한 출처로 모은다(Task 4).

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/content/device-frame.ts` | 래퍼 생성·제거·로드 검증. top 문서 DOM만 다루는 순수 DOM 모듈. `picker.ts`가 import |
| `src/sidepanel/lib/device-presets.ts` | 프리셋 상수 + 가용 폭 판정 순수 함수. 유닛 테스트 대상 |
| `src/sidepanel/lib/device-mode.ts` | 전이 경로·재수립 게이트 판정 + pending·루프 카운터(모듈 스코프). 유닛 테스트 대상 |
| `src/sidepanel/lib/device-sentinel-gate.ts` | sentinel 발행 대상 판정(모드 ON이면 래퍼 서브트리로 좁힘). 유닛 테스트 대상 |
| `src/sidepanel/lib/capture-viewport.ts` | 캡처 뷰포트 폴백 규칙 단일 출처 |
| `src/sidepanel/device-viewport-controller.ts` | 전이 오케스트레이션·push 수신·소유권 토큰. 패널 루트가 attach/detach |
| `src/sidepanel/components/DeviceViewportBar.tsx` | 세그먼티드 컨트롤 UI |
| `src/sidepanel/hooks/useDeviceViewport.ts` | 컨트롤러 스토어 구독 + 가용 폭 watch 수명. 전이 자체는 컨트롤러가 소유한다 |
| `src/content/__tests__/device-frame.test.ts` | jsdom — 스타일 주입·복원 왕복 |
| `src/sidepanel/lib/__tests__/device-presets.test.ts` | node — 가용 폭 판정 |
| `src/sidepanel/components/__tests__/DeviceViewportBar.test.tsx` | jsdom — 잠금·비활성 조건 |
| `src/background/__tests__/device-frame-coordinator.test.ts` | node — binding 순서 큐, 계보 판정, `isTopLikeFrame` 모드 OFF 동치 |
| `e2e/device-viewport.spec.ts` | 신규 e2e |

**manifest는 건드리지 않는다.** 브리프가 지적한 배열 순서 위험 4곳(`picker-control.ts:35-36`의 index 0 하드코딩, `:64-74`의 recorder-bridge find, `:86-90`의 MAIN find, `scripts/check-prearm-chunk.mjs:39`)을 전부 회피한다. 래퍼 로직은 이미 `all_frames`로 주입돼 있는 `picker.ts`(content_scripts[0])에 메시지 핸들러로 얹는다. `recorders-entry` 청크 그래프와도 무관하므로 pre-arm 동기 IIFE 형태가 유지된다.

### 수정 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/content/picker.ts` | 요소 선택·캡처 준비 content script | `device.*` 메시지 3종 핸들러 추가(전부 `window === window.top` 게이트). 래퍼 안에서 자기 정체를 알리는 `device.frameReady` 발화 |
| `src/content/picker.ts:427`·`:490` | 컨텍스트 확장 게이트가 `window === window.top` | `window === window.top \|\| isDeviceFrame()`으로 완화 — 아래 "래퍼에서 컨텍스트 확장을 여는 근거" |
| `src/content/area-select.ts:110-118` | `selectFullViewport`가 rect를 `{x:0,y:0,...viewport}`로 하드코딩(:116) | 래퍼가 있으면 `deviceFrameRect()`로 교체 — **스프레드를 풀어야 한다**(중앙 정렬이라 `x` 오프셋이 0이 아니다). `viewport`(크롭 배율 기준, :114)는 top 유지 |
| `src/content/area-select.ts:200-216` | 드래그 확정 rect | 래퍼가 있으면 rect를 래퍼 영역으로 **클램핑**. 안 하면 여백이 결과에 들어간다 |
| `src/sidepanel/picker-control.ts:811-824` | `getTopViewport`가 top `innerWidth/innerHeight` 반환 | 주입 함수가 래퍼를 먼저 찾도록 교체. 시그니처·기존 호출부 3개 무변경 |
| `src/sidepanel/video-recorder.ts:111-117` | `chrome.tabs.get()`의 `tab.width/height`로 viewport 메타 | `getTopViewport(tabId)`로 교체 |
| `src/sidepanel/30s-replay/use-30s-replay.ts:153` | 동일 | 동일 |
| `src/sidepanel/recorder-control.ts` | clear 3종 (`:13-21`, frameId 미지정 broadcast) | `activateRecordersInDeviceTree` 신설 — document 지정 stop/start ACK |
| `src/sidepanel/picker-control.ts:709-755` | `activate*Recorder` 3종이 `sendAll` broadcast로 sentinel 발행 | **sentinel 발행 경로 전체에 서브트리 게이트.** 아래 "sentinel 발행 경로 단일 게이트" 절 — 여기를 안 막으면 로그 2벌이 되살아난다 |
| `src/sidepanel/picker-control.ts:173-182` | `rebroadcastSentinelsToFrame(tabId, frameId)` — 커밋된 프레임에 무조건 재발행 | 같은 게이트를 통과시킨다. 모드 ON에서 래퍼 서브트리 밖 프레임이면 발행하지 않는다 |
| `src/sidepanel/hooks/useBackgroundRecorder.ts:104`·`:113-118`·`:141-144` | `inject()`가 visibilitychange·`status==="complete"`·idle 복귀마다 activate 3종 재호출 | 호출부는 무변경. 위 게이트가 하류에서 흡수한다 — 호출 트리거를 하나씩 막는 방식은 새 트리거가 생길 때마다 샌다 |
| `src/sidepanel/hooks/usePickerMessages.ts:271-272` | `frameCommitted` 수신 → `rebroadcastSentinelsToFrame` 무조건 호출 | 같은 게이트. 래퍼 서브트리 커밋이면 재발행(= same-origin 이동 후 start 재전달의 정식 경로), 아니면 skip |
| `src/sidepanel/hooks/usePickerMessages.ts:206-223`·`:423` | `captureAndCrop(rect, viewport)` — **`capture.ts`가 아니라 이 파일의 모듈 프라이빗 함수**(`capture.ts`의 export는 `cropImage`뿐) | 크롭은 `msg.viewport`, 메타는 `getTopViewport(tabId)`로 분리. 변경이 이 파일 안에서 끝난다 |
| `src/sidepanel/tabs/DebugTab.tsx:73-94` | 서브탭 바 `<div>`(`CollapsingTabsList` 74-93) | 그 wrapper **뒤에 형제로** `<DeviceViewportBar>` 행을 둔다. 행 컨테이너(`shrink-0 border-b border-border px-4 py-4` — 로그 탭 필터 행과 같은 규칙)는 `DeviceViewportBar`가 자기 루트에 들고 오므로, 렌더 게이트(`tabId == null \|\| unsupported`)로 `null`이 되면 빈 행이 남지 않는다. 대가는 상단 크롬 182→207px — idle 화면은 `PageScroll`을 안 쓰고 `overflow-hidden`+`justify-center`라 패널이 아주 낮으면 밀리는 게 아니라 잘린다 |
| `src/sidepanel/tabs/IssueTab.tsx:552-561` | `capture-method-fullpage` 버튼(`ariaDisabled={busy}` :554) | 모드 ON이면 `ariaDisabled`. 잠금 사유 노출은 `TooltipIconButton`에 **옵션 prop 추가**가 필요하다 — 아래 |
| `src/sidepanel/components/TooltipIconButton.tsx` | `label` 하나가 `aria-label`(`:42`)과 `TooltipContent`(`:54`)를 겸하고, props에 사유 슬롯이 없다 | `disabledReason?: string` 추가 — 있으면 툴팁 본문만 그걸로 대체하고 `aria-label`은 `label` 유지 |
| `src/sidepanel/tabs/DraftingPanel.tsx:576-678` | `ReproEnvironmentSection` | 모드 ON 읽기전용 인디케이터 1개. `device.state.width != null`에서 파생하므로 전역 상태를 안 만든다 |
| `src/sidepanel/tabs/IssueTab.tsx:705-726` | `SessionExpiredDialog` — body가 `issue.sessionExpired.body` 고정 | handoff로 뜬 경우 body만 디바이스 모드 문구로 분기. 컴포넌트·`sessionExpired` 플래그·`onConfirm={() => reset()}`은 무변경 |
| `src/sidepanel/App.tsx:362-376` | `iframeUnsupported` 다이얼로그(`:367`이 body) | 모드 ON이면 body 문구를 `app.iframeUnsupported.bodyDeviceMode`로 교체 |
| `src/background/index.ts:120`·`:123`·`:145-186` | `onBeforeNavigate`/`onCommitted`의 frameId 게이트 + `navUrlPromise` | 아래 "래퍼 내부 same-origin 네비게이션" 절 — 두 분기를 모두 태우고 `navUrlPromise` 키를 `tabId:frameId`로 |
| `src/background/tab-bindings.ts` | — | frameId/documentId binding의 session 보존·복구 + parent 계보 조회 + document 열거 |
| `src/types/messages.ts`·`bgRequestTypes.ts` | `BgRequest` union + `BG_REQUEST_TYPES` 화이트리스트 | `device.arm`·`device.documents` 2종을 화이트리스트에 등록. **`device.frameReady`는 이 게이트를 통과 못 하고** 전용 push 리스너로 받는다 — 아래 절 참조. background→사이드패널 push `device.frameLoaded`/`device.frameBlocked`/`device.handoff` 3종도 추가 |
| `src/types/picker.ts` | `PickerMessage` union | `device.*` 메시지 **5종** 추가(수신 3 + push 2 — `frameLoadEvent`는 폐기했다) |
| `src/store/settings-ui-store.ts` | persist **version 9**(`:242`), `migrateSettingsUi`(`:131-151`) | `deviceModeWarned: boolean` 추가 + 기본값 `false` 등록 + version 10 bump. 최초 ON 1회 경고의 영속 슬롯이다 |
| `src/i18n/namespaces/app.ts`·`issue.ts` | ko/en 사전 | 신규 키(ko/en 동시) |

### 손 안 대는 곳

- `src/sidepanel/lib/environmentRows.ts`, `buildReportData.ts`, `buildIssueMarkdown.ts`, `liteSnapshot.ts` — **`Device` 행을 신설하지 않기로 했으므로 전부 무변경.** `Viewport` 행 값이 상류에서 바뀌므로 하류가 자동으로 따라온다. `DraftingPanel.tsx`는 인디케이터 때문에 예외적으로 변경 대상이지만, 그건 **행이 아니라 렌더 전용 표시**라 리포트 본문·마크다운 3경로에는 안 닿는다.
- `src/store/editor-store.ts` — `EDITOR_SNAPSHOT_KEYS`에 아무것도 더하지 않는다.
- `manifest.config.ts` — 권한·content_scripts 전부 무변경.

## 데이터 흐름

### 모드 ON (OFF→ON 경로)

폭 갱신(ON→ON)은 `device.set` 하나로 끝나므로 이 흐름을 타지 않는다 — 아래 `select()` 절의 경로 표 참조.

```
[사용자] 세그먼트 "390" 클릭
   │
   ▼
useDeviceViewport.select(390)
   │  ① locked(phase !== "idle" || unsupported) 또는 busy면 무시 (버튼이 이미 비활성)
   │  ② 최초 ON 진입 1회 확인 다이얼로그 → [계속] 시 local persist
   │  ③ syncAndSettleLogs(tabId)            ← 떠나는 로그 꼬리 확보
   │  ④ bgRequest("device.arm", { tabId, on: true })  ← 래퍼 커밋 감시창(3s) 개방
   │     (store clear는 여기가 아니라 stop ACK 뒤 — 아래 select() 10~12단계)
   │
   ▼
sendPickerTop(tabId, { type: "device.set", width: 390 })
   │
   ▼  [top 문서 / picker.ts]
device-frame.ts::mountDeviceFrame(390)   ← DOM만. 로드 판정을 하지 않는다
   │  <style id="__bugshot_device_style__">  body 자식 은닉 + 레이아웃
   │  <iframe id="__bugshot_device_frame__" src={location.href} style="width:390px">
   ▼
{ ok: true, width: 390, available: {...} }   ← "마운트했다"이지 "성공했다"가 아니다
   │
   ├─▶ [최초 래퍼 문서 / picker.ts]  window.frameElement?.id === "__bugshot_device_frame__"
   │        postToRuntime({ type: "device.frameReady" })
   │            → background 전용 리스너: {frameId, documentId}를 storage.session에 등록
   │            → 이후 same-origin 이동은 frameId 지속 + documentId 갱신으로 추적
   │
   ├─▶ [background / arm 창 안]  성공·차단 판정의 단일 주체
   │        device.frameReady            → 성공 (same-origin)
   │        onCommitted(래퍼 frameId, same-origin) → 성공 (redirect 포함)
   │        onCommitted(래퍼 frameId, cross-origin) → handoff
   │        onErrorOccurred(래퍼 frameId) → 차단
   │        3s 무신호                     → 차단
   │            → push: device.frameLoaded | device.frameBlocked | device.handoff
   │
   ├─▶ [사이드패널] device.frameLoaded 수신 후에만
   │        activateRecordersInDeviceTree(tabId)
   │            ① bgRequest("device.documents") 로 전 document 열거
   │            ② 전 document stop ACK
   │            ②-b store clear 3종 (stop 뒤·start 앞이어야 유령 로그가 안 남는다)
   │            ③ 래퍼 서브트리 documentId만 start ACK
   │        device.frameBlocked 수신 → device.set{width:null} 롤백 + 토스트
   │
   ├─▶ webNavigation.onCommitted(frameId≠0) → frameCommitted{frameId: 실제}
   │        → [사이드패널] 모드 ON이면 래퍼 서브트리 프레임에만
   │          rebroadcastSentinelsToFrame  ← 모드 OFF에서만 무변경 broadcast 성격
   │
   └─▶ [phase === "picking"이면] restartPickerInFrame(tabId, 래퍼 frameId)
          ← select()는 잠금 때문에 picking에서 안 도므로 이 분기는 재수립 경로 전용이다
          ← registry 등록 보장. 아래 "래퍼 registry 등록" 절
```

### 뷰포트 값 파생 (모드 무관 단일 경로)

```
getTopViewport(tabId)
   └─ chrome.scripting.executeScript({ target:{tabId}, func })
        func: () => {
          const f = document.getElementById("__bugshot_device_frame__");
          return f ? { width: f.clientWidth, height: f.clientHeight }
                   : { width: innerWidth, height: innerHeight };
        }
   │
   ├─ element     usePickerMessages.ts:160-167, :409-410   ← 기존 호출부 (frameId !== 0 게이트 뒤)
   ├─ screenshot  usePickerMessages.ts:206-223             ← 신규 경로
   ├─ freeform    picker-control.ts:844                    ← 기존 호출부
   ├─ video       video-recorder.ts:111-117                ← chrome.tabs.get → getTopViewport 교체 필요
   └─ replay      30s-replay/use-30s-replay.ts:153         ← 동일
```

**element 경로만 조건부다.** 두 호출부가 `frameId !== 0`일 때만 조회하는데(`usePickerMessages.ts:160`, `:409-410`), 모드 ON에서 선택은 예외 없이 래퍼 안이라 게이트가 항상 참이 되어 무변경으로 올바른 값을 받는다. 값도 일치한다 — `payload.viewport`(래퍼 내부 `innerWidth`)와 `f.clientWidth`(래퍼 요소 content box)가 둘 다 선택한 폭이라 교체가 사실상 항등이다. 게이트를 "이제 불필요하다"며 걷어내면 모드 OFF의 top 선택에서 없던 주입이 생기고, 반대로 모드 ON에서 frameId 0으로 새는 경로가 생기면 메타가 `payload.viewport`로 폴백해 **top 실폭이 조용히 기록된다**.

`func`는 직렬화·재평가되므로 클로저가 안 살아남는다(`CLAUDE.md` — `chrome.scripting.executeScript({func})`). 위 함수는 self-contained라 제약을 만족한다. 상수 `"__bugshot_device_frame__"`은 문자열 리터럴로 **인라인**해야 하고, `device-frame.ts`의 상수와 **복제**된다 — 동기화는 `picker-control` 유닛 테스트가 두 값을 대조해 고정한다(선례: `log-merge.ts` ↔ `trailing-throttle.ts` 복제+동기화 테스트 패턴).

### 가용 폭 추적

```
DeviceViewportBar 마운트
   └─ sendPickerTop(tabId, { type: "device.state" })
        → { width: number|null, available: { width, height } }
             available.width = document.documentElement.clientWidth  ← 세로 스크롤바 제외
   └─ picker.ts (top): window.addEventListener("resize")
        → postToRuntime({ type: "device.availableChanged", available })
   └─ 마지막 구독자가 사라지면 → { type: "device.watch", on: false }
```

**`watch`도 `pending`과 같은 이유로 모듈 스코프 refcount다.** 훅이 `DeviceViewportBar`와 `App.tsx` 다이얼로그 분기 두 곳에서 마운트되므로, "Bar 언마운트 = watch off"로 두면 아직 살아 있는 다른 구독자의 `availableChanged`까지 끊긴다. 실피해는 작지만(다이얼로그 분기는 `width`만 읽고, idle 복귀 때 `device.state`가 다시 조회된다) 소유 규칙을 `pending`·루프 카운터와 다르게 두면 리팩터에서 갈린다.

`innerWidth`가 아니라 `documentElement.clientWidth`를 쓴다 — 세로 스크롤바 15~17px을 빼지 않으면 래퍼가 가용 폭에 딱 맞을 때 가로 스크롤이 생긴다.

`chrome.windows.onBoundsChanged`는 **쓰지 않는다.** 창 bounds만 주고 사이드패널 리사이즈에는 발화하지 않는다. 폴링도 하지 않는다.

## 인터페이스 설계

### 메시지 (`src/types/picker.ts`)

`PickerMessage`에 **5종**을 더한다(수신 3 + push 2). 이 union은 이미 양방향이 섞여 있으므로(`types/picker.ts:131-136`이 push 타입) 컨벤션에 맞고, 응답 타입만 union 밖 별도 인터페이스로 둔다(`PrepareCaptureResponse` 선례). 여기에 더해 background 경유 **5종**(BgRequest 2 + push 3)이 `types/messages.ts`에 붙는다.

```ts
// 사이드패널 → top 프레임 (frameId 0 지정 송신)
| { type: "device.set"; width: number | null; title: string } // null = 전체(래퍼 제거)
//   title = 래퍼 iframe의 접근명. content script는 i18n 사전을 못 읽으므로 패널이 실어 보낸다
| { type: "device.state" }
| { type: "device.watch"; on: boolean }          // on:false가 unwatch. 별도 타입을 두지 않는다

// 응답
export interface DeviceSetResponse {
  // 래퍼 DOM을 만들었는가/지웠는가. **로드 성공 여부가 아니다** — 성공·차단 판정은 background가 한다
  ok: boolean;
  width: number | null;
  available: { width: number; height: number };
}
export interface DeviceStateResponse {
  width: number | null;
  available: { width: number; height: number };
}

// content → 사이드패널·background (push)
| { type: "device.availableChanged"; available: { width: number; height: number } }
| { type: "device.frameReady" }        // 래퍼 프레임 자신이 발화. sender.frameId가 래퍼 frameId
```

```ts
// types/messages.ts — 사이드패널 → background (BgRequest, 화이트리스트 등록 필요)
| { type: "device.arm"; tabId: number; on: boolean }   // 래퍼 커밋 감시창 개폐
| { type: "device.documents"; tabId: number }          // → DeviceDocumentsResponse

export interface DeviceDocumentsResponse {
  all: string[];         // 이 탭의 전 recorder document (documentId)
  deviceTree: string[];  // 래퍼 + 그 자손. 모드 OFF면 빈 배열
}

// background → 사이드패널 (push)
| { type: "device.frameLoaded"; tabId: number; frameId: number } // picker.start 재전송 대상
| { type: "device.frameBlocked"; tabId: number }
| { type: "device.handoff"; tabId: number; url: string; expiresAt: number } // 래퍼가 cross-origin으로 나갔다
```

**배선 제약 4개** — 전부 기존 코드가 강제한다.

1. **`device.set`은 비동기 응답이다.** mount 자체는 동기지만 `width: null`(전체 복귀)이 `location.reload()`까지 가므로, **reload보다 먼저 `sendResponse`가 나가야 한다** — 문서가 갈리면 응답 포트가 죽어 호출부가 전달 실패(`undefined`)로 읽는다. `case`에서 `void (async () => { … sendResponse(res) })(); return true;` 형태여야 한다(유일한 선례 `picker.collectTokens` `picker.ts:236-247`). `break`로 떨어뜨리면 스위치 밖 `:341`의 `sendResponse({ok:true})`가 먼저 나가고 두 번째 응답이 "message port closed"로 죽는다.
2. **각 case 첫 줄에 `if (window !== window.top) return;`**(선례 `annotation.show/setTool/hide` `picker.ts:321,325,334`). frameId 0 지정 송신이면 이론상 불필요하지만, 한 번이라도 broadcast 경로가 섞이면 래퍼가 같은 메시지에 두 번째 응답을 쏜다.
3. **`send`는 export되지 않는다**(`picker-control.ts:105`, 모듈 내부 전용). `sendPickerTop`을 picker-control 안에 두고 `deviceSet`/`deviceState`/`deviceWatch` export 래퍼를 노출한다(현행 `navigatePicker`·`prepareCapture` 패턴).
4. **`send`는 전달 실패를 `undefined`로 삼킨다**(`:114-116`). 호출부는 `undefined`(content script 미도달)와 `{ok:false}`(XFO 차단)를 **구분해서** 다뤄야 한다 — `ok === false`만 보면 `undefined`가 성공으로 새어나간다.

### `device.frameReady`가 background에 닿게 하는 배선

`background/index.ts:188-189`가 `if (!BG_REQUEST_TYPES.has(message.type)) return false;`로 화이트리스트 게이트를 건다(등록 누락으로 Asana 요청이 런타임 전량 차단된 회귀 전례가 주석에 남아 있다). 게다가 `messages.ts:198`의 `handleMessage(message, _sender)`는 **sender를 아예 안 읽는다** — 이 함수는 요청/응답 디스패처라 fire-and-forget push를 섞는 게 의미상 어색하다.

**따라서 background에 push 전용 `chrome.runtime.onMessage` 리스너를 하나 더 단다.** 기존 게이트를 안 흔들고 `sender.frameId`/`sender.tab.id`를 바로 읽는다.

`deviceFrameByTab`의 권위값은 `chrome.storage.session`에 `{ frameId, documentId }`로 보존하고 메모리 Map은 복제 캐시로만 쓴다. Chrome은 frame 생애 동안 navigation을 넘어 `frameId`를 유지하고 문서가 바뀔 때 `documentId`를 교체하므로, 등록 뒤의 same-origin redirect·링크 이동을 DOM 접근 없이 추적한다. SW 시작 시 복원 promise를 만들고 `webNavigation` 처리를 탭별 순서 큐에서 그 promise 뒤에 연결한다. 성능보다 정확성을 우선해 복구 전 이벤트를 동기 기본값으로 판정하지 않는다. top `onCommitted`, 탭 제거, 명시적 OFF에서는 저장값과 Map을 함께 지운다.

**`chrome.storage.session`이 견디는 건 SW hibernation까지다.** 확장 reload·업데이트에서는 session storage가 비워지고, 같은 사건으로 content script도 전부 orphan이 된다 — 래퍼는 페이지에 남아 있는데 binding은 사라진 상태다. 사이드패널이 마운트하면 `device.state` 전에 picker content script를 재주입해 페이지 DOM의 래퍼 폭을 읽는다. `device.documents`에 binding이 없으면 그 폭을 `pending`에 세우고 기존 래퍼를 제거해 top reload를 만든다. top `onCommitted`가 pending을 소비해 공용 `reestablish`를 호출한다. 기존 래퍼를 남긴 채 같은 폭으로 `device.set`하면 폭만 바뀔 뿐 commit이 생기지 않아 판정 타임아웃으로 끝난다.

**단 이 엇갈림 판정은 열거에 성공했을 때만 한다.** 복구가 실제로 하는 일이 "래퍼 제거 + top reload"라, 통신 실패를 빈 트리로 접으면 래퍼가 멀쩡한데도 **정상 동작 중인 페이지를 새로고침해 스크롤·입력값을 날린다**. 그래서 사이드패널은 `fetchDeviceTree`(1회 재시도 + in-flight 병합)의 `null`을 "판정 불가"로 읽고 아무것도 하지 않는다 — 같은 라운드를 우회해 직접 `device.documents`를 부르면 그 null 세만틱이 사라진다.

### 래퍼 registry 등록 (위험 8의 실제 배선)

`picker.start`는 **broadcast 1회뿐이고 재시도가 없다** — 그 시점에 리스너가 붙어 있는 프레임에만 배달되므로 **이후 생성된 프레임에는 절대 도달하지 않는다**. `ensureContentScript`의 ping도 `{frameId: 0}` 고정(`picker-control.ts:25`)이라 래퍼에 content script가 안 붙었어도 통과하고 재주입이 안 돈다. 등록에 실패하면 래퍼가 `isRegisteredChildFrame`을 통과 못 해 클릭이 `picker.ts:1080-1094`의 거부 경로로 가고, **모드 ON에서 아무 요소도 못 고르는** 상태가 된다.

**사용자 전이에서는** `phase !== "idle"` 잠금 덕에 mount가 항상 `picker.start`보다 앞서므로 순서 자체는 성립한다. **재수립은 그 보장이 없다** — 잠금을 우회하므로 picking 도중에 래퍼가 다시 서고, 그때 `picker.start`는 이미 지나간 뒤다. 어느 경우든 mount와 래퍼 content script의 `onMessage` 등록(document_idle) 사이에 창이 남는다. **`device.frameLoaded` 확정 직후 래퍼 frameId를 향해 `picker.start`를 `res?.ok`까지 재시도 송신한다** — 정확히 `restartPickerInFrame`(`picker-control.ts:286-303`, 10회×200ms) 패턴이다. 래퍼 frameId는 `device.frameReady`(same-origin) 또는 arm 창의 잠정 등록(즉시 redirect되는 사이트)으로 확정 시점에 이미 알려져 있다 — `device.set` 응답만 보고 쏘면 redirect 경로에서 타깃이 없다.

**broadcast는 절대 쓰지 않는다** — `setFrameToken`(`frame-geometry.ts:73`)이 `picker.start`마다 `childFrames` WeakSet을 새 인스턴스로 갈아치우므로, 실수로 broadcast하면 top registry가 통째로 비워져 방금 등록된 래퍼가 날아간다.

**element 캡처의 좌표 합성도 이 등록에 함께 걸린다.** 래퍼 안 요소의 rect는 래퍼 내부 좌표인데 크롭은 top 이미지 기준이라, 기존 offset 핸드셰이크(`frame-geometry.ts:114-167` — 사이드패널이 `picker.armFrameOffset`으로 1회 arm하고 부모가 **registry 등록 여부를 확인한 뒤에만** offset을 응답)가 top 좌표로 합성한다. 래퍼는 1-depth 등록 iframe이므로 이 경로를 그대로 타고 추가 배선이 0이지만, **등록이 실패하면 요소 선택뿐 아니라 캡처도 rect `null`로 죽는다** — 위험 8이 두 갈래로 번지는 지점이다.

### `src/content/device-frame.ts`

```ts
export const DEVICE_FRAME_ID = "__bugshot_device_frame__";
export const DEVICE_STYLE_ID = "__bugshot_device_style__";

/** 현재 래퍼 폭. 없으면 null. 모드의 단일 출처. */
export function currentDeviceWidth(): number | null;

/** 래퍼의 top 좌표계 rect. 없으면 null. area-select가 화면 캡처 rect로 쓴다. */
export function deviceFrameRect(): { x: number; y: number; width: number; height: number } | null;

/** 가용 폭·높이 (documentElement.clientWidth/clientHeight). */
export function availableViewport(): { width: number; height: number };

/**
 * 래퍼를 만든다. 이미 있으면 폭만 갱신(재로드 없음). **로드 판정을 하지 않는다** —
 * XFO/CSP 판정은 background가 하고(아래 "로드 검증"), 이 모듈은 순수 DOM으로 남는다.
 */
export function mountDeviceFrame(width: number): void;

/** 래퍼·스타일을 제거한다. 멱등. */
export function unmountDeviceFrame(): void;

/** 드래그 rect를 래퍼 영역 안으로 클램핑. 래퍼가 없으면 rect 그대로. 순수 함수 — 유닛 대상. */
export function clampToDeviceFrame(rect: Rect, frame: Rect | null): Rect;
```

**`전체` 복귀는 unmount 후 `location.reload()`까지 간다.** DOM 제거만 하면 원본 문서가 모드 진입 시점 상태로 남아, 모드 ON에서 한 로그인·장바구니 조작이 복귀 화면에 안 보인다. 진입·해제를 대칭으로 두면 상태 불일치 축이 사라진다. 최초 ON 진입 경고는 이 양방향 재로드와, 원본·래퍼 문서가 모드 ON 동안 함께 실행되어 timer·WebSocket·polling·자동저장·결제 동작이 중복될 수 있음을 명시한다.

**은닉은 스타일시트 한 장으로 한다.** 개별 요소의 인라인 스타일을 저장·복원하지 않으므로 복원이 무손실이고, 캡처 중 DOM이 바뀌어도 규칙이 계속 적용된다.

```css
html { overflow: hidden !important; }
body { margin:0 !important; padding:0 !important; height:100vh !important;
       overflow:hidden !important; background:hsl(210 40% 96.1%) !important;
       display:flex !important; justify-content:center !important; }
body > *:not(#__bugshot_device_frame__) { display: none !important; }
#__bugshot_device_frame__ { border:0 !important; display:block !important; height:100% !important; }

@media (prefers-color-scheme: dark) {
  body { background:hsl(0 0% 14.9%) !important; }
}
```

**여백 색은 `--muted`다** — 어노테이션 캔버스 영역이 쓰는 것과 같은 토큰이고(`AnnotationToolbar.tsx:158`의 `bg-muted`), 캡처 이미지의 여백이라는 역할도 같다. 값은 `globals.css:26`의 라이트 `210 40% 96.1%` / `:57`의 다크 `0 0% 14.9%`다. **라이트를 `0 0% 96.1%`로 쓰면 안 된다** — slate 틴트가 빠진 채도 0 값이라 이미 드리프트한 사본이 된다.

content에 주입하는 CSS는 토큰 표의 또 다른 사본이므로(`docs/DESIGN.md:27`, 기존 사본은 `content/overlay.ts:201`) 이 파일이 **네 번째 사본**이 된다. `src/styles/__tests__/tokens.test.ts`에 **등록한다** — 그 테스트의 존재 이유가 정확히 이 드리프트("세 번째 사본이 조용히 drift해 인스펙터 카드만 다른 색으로 떠 있었다", `:141-144` 주석)를 막는 것이고, 위 오기가 등록하지 않으면 어떻게 되는지를 보여준다.

`#171717` 같은 단색 near-black은 금지다 — 라이트 테마 페이지에 검은 슬래브가 깔리고 그게 영역 캡처·탭 녹화·30s Replay에 그대로 찍힌다.

`visibility: hidden`이 아니라 `display: none`을 쓴다 — 레이아웃이 살아 있으면 원본 문서의 옵저버·측정 코드가 계속 돌아 유령 로그가 늘어난다.

래퍼는 `document.body` 직속이다. **shadow root 안에 넣으면 안 된다** — `frame-geometry.ts:106`의 `findChildIframe`이 `document.querySelectorAll("iframe")`만 훑으므로 미등록이 되고, 그러면 `elementFromPoint`가 shadow retargeting으로 host를 돌려줘 `iframeUnsupported` 안내조차 안 뜬 채 **shadow host가 조용히 선택된다**(`picker.ts:1075`, `:1095-1105`).

`src`는 반드시 `location.href`다. **`srcdoc`/`about:blank` 금지** — `<all_urls>` 미매치라 content script가 안 붙어 로그·picker가 통째로 죽는다(`e2e/GOTCHAS.md:28`).

### 로드 검증 (XFO/CSP 감지)

**판정 주체는 background 하나다.** content가 `contentDocument.location.href`를 비교해 스스로 롤백하는 구버전 안은 정상 redirect를 차단으로 오판하고, 반대로 다른 origin으로 밀린 blank 문서는 DOM으로 들여다볼 수조차 없다. 그래서 `device.set`은 "마운트했다"만 응답하고(`DeviceSetResponse.ok`), 성공·차단은 아래 신호로 background가 정한다.

`select()`가 `device.set` **직전**에 `device.arm { on: true }`로 3초 감시창을 연다. 창이 열린 동안 background는 top(`frameId 0`)의 직속 자식 중 URL이 top URL과 같은 첫 `onBeforeNavigate`를 **잠정 래퍼**로 잡아둔다 — 즉시 redirect되는 사이트에서는 `device.frameReady`가 안 올 수 있는데, 그때 래퍼 frameId를 아는 유일한 시작점이 이 잠정 등록이다(성공·차단·handoff 세 판정의 공통 타깃). 창 밖에서는 이 추측을 하지 않으므로 일반 iframe을 래퍼로 오인할 여지가 없다.

| 신호 | 판정 |
|---|---|
| `device.frameReady` + arm 창 열림 | 성공 — 잠정 래퍼를 확정 binding으로 승격 |
| `device.frameReady` + arm 창 닫힘 | 판정이 아니다 — `documentId`만 갱신하고 push하지 않는다(래퍼 안 same-origin 이동의 재발화) |
| `onCommitted(래퍼 frameId)` + **same-origin** (경로·쿼리만 바뀐 redirect) | 성공 — `documentId`를 갱신하고 확정 |
| `onCommitted(래퍼 frameId)` + **cross-origin** | 성공도 차단도 아니다 → **handoff**(아래 절) |
| `onErrorOccurred(래퍼 frameId)` | 차단 (`ERR_BLOCKED_BY_RESPONSE` 등) |
| 3초 무신호 | 차단 |

판정 결과를 `device.frameLoaded`/`device.frameBlocked`로 사이드패널에 push하고, 사이드패널이 롤백(`device.set { width: null }`)과 토스트를 맡는다. same-origin redirect는 성공이지 별도 reason이 아니므로 `DeviceSetResponse`에 `reason` 필드를 두지 않는다.

**차단 청취는 감시창 밖에서도 계속한다.** 위 표는 진입 판정이고, binding이 확정된 뒤에도 `onErrorOccurred(래퍼 frameId)`는 상시 듣는다 — 안 그러면 모드 유지 중 래퍼 안 링크로 XFO 사이트에 도달했을 때 백지에 방치된다(prd 목표 9). 유지 중 차단은 **handoff와 같은 경로로 보낸다**: 프레임에 못 들어가는 URL이므로 top을 그리로 보내고, 그 사이트에서 재수립을 1회 시도해 그것도 차단되면 `전체`로 롤백 + `issue.device.blocked` 토스트. 별도 UX를 만들지 않는다.

~~`device.frameLoadEvent`(top의 iframe `load`)를 보조 신호로 둔다~~ — **구현에서 폐기했다.** iframe `load`는 최초 `about:blank`에서 먼저 발화해서, 이 신호를 성공을 앞당기는 데 쓰면 아직 뜨지도 않은 래퍼를 성공으로 접는다(반대로 CSP 차단된 프레임을 성공으로 오판하는 경로이기도 하다). 성공 앞당김은 래퍼 자신이 보내는 `device.frameReady`가 대신하며, 그쪽은 실제로 content script가 붙은 뒤라야 발화하므로 오판이 없다.

### cross-origin handoff

래퍼가 cross-origin으로 커밋되면(또는 그 목적지가 프레임 삽입을 막으면) 프레임 안에 두지 않고 **top 탭을 그 URL로 보낸다.** 그 뒤는 "top 문서가 교체됐다"는 단일 규칙으로 흡수된다.

```
[래퍼] cross-origin 링크 클릭
   │
   ├─ background: onBeforeNavigate(래퍼 frameId, cross-origin)   ← 빠른 경로
   │     또는 onCommitted(래퍼 frameId, cross-origin)             ← same-origin URL이 302로 밀린 경우의 폴백
   │        → binding 폐기
   │        → push: device.handoff { tabId, url, expiresAt }
   ▼
[사이드패널]
   ① expiresAt 전이면  → pending = { tabId, width }   ← 인메모리. 영속하지 않는다
   │ expiresAt 뒤면    → pending 폐기 + width = null   ← Full 강등. 재수립하지 않는다
   ②(공통) sessionExpired = true                       (녹화·미리보기·완료면 토스트 1개)
   ▼ (어느 쪽이든 ACK)
[background]
   ② chrome.tabs.update(tabId, { url })    ← ACK 내용도, 패널 부재도 이 이동을 막지 않는다
   ▼
[top onCommitted + pending 있음] → reestablish(tabId, pending.width, url)
```

**handoff는 재수립을 직접 하지 않는다.** background는 handoff 판정 즉시 binding을 폐기해 같은 이동의 `beforeNavigate`·`committed`가 top 이동을 중복 발화하지 못하게 한다. 사이드패널은 500ms `expiresAt` 전에 메시지를 처리했을 때만 pending을 세우고, background가 top 이동을 소유한다 — **응답값은 읽지 않는다**(cross-origin 문서를 래퍼에 남기지 않는 쪽이 이긴다). 패널이 닫혔거나 늦게 응답하면 top만 이동하는데, 그때 **패널은 스스로 폭을 `null`로 내려 Full로 강등한다** — 안 내리면 래퍼는 없는데 UI만 ON인 desync가 탭 세션 내내 굳는다(같은 폭 재선택은 `noop`, 페이지 전체 캡처는 영구 차단). 패널이 제때 응답하면 실제 재수립은 **top `onCommitted` 한 지점**이 맡는다.

**사용자 통보는 기한과 무관하게 같다.** top이 실제로 옮겨가는 건 ACK를 제때 했는지와 상관없으므로, 만료 경로도 `sessionExpired`(또는 녹화·미리보기·완료 phase의 토스트 1개)를 똑같이 띄운다. 그 다이얼로그는 확인 전용이고 [확인]이 `reset()`이라 **작성 중 draft를 파기한다** — 통보를 만료 경로에서 빼면 사용자는 페이지가 바뀐 것도, draft가 무의미해진 것도 모른 채 남는다. 반면 `blob:`·`data:` 등 top 이동 불가 URL은 background가 래퍼만 제거하고 **같은 URL로 reload**하므로 세션이 이어진다 — 그 경로는 폭 강등 + `issue.device.blocked` 토스트로 끝내고 `sessionExpired`를 띄우지 않는다.

**`onBeforeNavigate`를 1차 트리거로 둔다.** commit에서 잡으면 파티션된 로그아웃 화면이 이미 렌더되고 그 문서의 로그·요청이 수집된 뒤다. 다만 same-origin URL이 서버에서 cross-origin으로 302되는 경우는 beforeNavigate에 안 보이므로 `onCommitted` 폴백이 함께 필요하다. **네비게이션을 취소하는 경로는 없다** — MV3에 blocking webRequest가 없으므로 handoff는 사후 조치이고, 그래서 다이얼로그도 게이트가 아니라 통보다.

**주소창 이동과 같은 규칙이다.** 모드 ON에서 top이 어떤 이유로든 새 문서로 커밋되면 `pending.width`로 재수립한다. 래퍼 안 이동과 주소창 이동에 다른 규칙을 두지 않는다.

**`pending`의 폐기 조건을 명시한다** — 이게 없으면 인메모리 상태가 유령이 된다:

| 조건 | 이유 |
|---|---|
| 사용자가 `전체`를 선택 | 명시적 OFF |
| 탭 전환 | 모드는 탭 스코프다 |
| 미지원 URL 도달 | 행 자체가 미렌더인 곳에서 상태만 살아있으면 desync |
| 재수립이 `frameBlocked` | `전체`로 롤백 |
| 루프 가드 발동 | 아래 |
| 사이드패널 언마운트 | 인메모리라 자연 소멸 |

**루프 가드는 handoff가 아니라 재수립을 센다.** handoff 횟수만 세면 `a.com → b.com → a.com` 핑퐁은 잡지만 **frame-busting은 못 잡는다** — 래퍼가 `window.top.location = self.location`으로 탈출하면 handoff를 거치지 않고 top이 곧장 커밋되고, 재수립된 래퍼가 또 탈출해 무한 재로드가 된다(위험 5). 카운터를 `reestablish` 호출에 걸면 두 경로가 한 그물에 들어온다.

**연속 재수립 2회 초과 또는 직전 재수립 URL 재방문**이면 루프로 보고 다이얼로그를 띄우며, [확인]에서 모드를 해제하고 이슈 idle로 되돌린다. 리셋 조건은 둘이다 — 사용자의 명시적 세그먼트 조작, 그리고 재수립 성공 후 top 커밋 없이 10초 경과(정상 사용에서 카운터가 누적되지 않게).

**세션 만료는 기존 경로를 재사용한다.** `expireStylingSession`(`picker-control.ts:459`)이 쓰는 `sessionExpired` 플래그와 `SessionExpiredDialog`(`IssueTab.tsx:705-726` — 취소 없는 단일 [확인], `onConfirm={() => reset()}`)를 그대로 쓰고 **body 문구만 디바이스 모드용으로 분기**한다(i18n 키 2개, `App.tsx`의 2-depth 문구 분기와 같은 방식). phase 판정 없이 무조건 켜도 된다 — 렌더 분기가 capturing·drafting·SelectedPanel 셋뿐이라 idle에서는 안 뜨고, 다음 세션 시작 때 `reset()`이 내린다.

**로그는 기존 `logClear`에 기대되 그것만 믿지 않는다.** handoff는 실제 top cross-origin 네비게이션이라 `background/index.ts:174-185`의 `shouldClearLogs` → `logClear`가 대개 돈다. 다만 그 리스너는 `:130`의 `if (stored[key] == null) return;`으로 **editor 세션 스냅샷이 있을 때만** 발화하는데, 스냅샷은 store 변경 구독으로만 쓰이므로 패널을 막 열고 첫 로그가 오기 전 창에서는 없다. 그래서 `reestablish`가 stop ACK 뒤에 **무조건 store clear를 한 번 더 한다** — 두 번 비워도 둘 다 start ACK 전이라 무해하고, 이 이중 안전장치가 없으면 그 창에서 A 사이트 로그가 B에 섞인다.

**녹화 중에는 토스트 1개만.** `RecordingState`·`PreviewPanel`·`SubmitSuccessPanel`엔 다이얼로그 마운트 지점이 없고(`IssueTab.tsx:210-241`), 탭 녹화 스트림과 30s Replay 프레임 버퍼는 탭 단위라 handoff를 넘어 계속 담긴다. 결과물은 *영상엔 A+B / 로그엔 B만*이 되는데 이건 오늘 녹화 중 주소창 이동에서도 나는 기존 비대칭이라, 녹화를 끊는 새 축을 만들지 않고 통보만 한다.

### 래퍼에서 컨텍스트 확장을 여는 근거

`picker.ts:427`·`:490`이 `window === window.top`이 아니면 element 컨텍스트 확장 판정을 생략한다. 모드 ON에서 사용자가 고르는 요소는 **예외 없이** 래퍼 안이므로, 그대로 두면 확장이 100% 꺼져 bbox+24px 폴백만 남는다 — 반응형 버그는 대개 "컨테이너가 넘친다"류라 조상 컨테이너 범위가 가장 필요한 상황에서 사라진다.

원래 iframe을 제외한 이유는 주석에 있다: "게이트가 자기 뷰포트 기준이라 top 좌표에서의 완전 포함을 보장할 수 없다". **이 논거는 래퍼에는 성립하지 않는다** — 래퍼는 `height:100%`로 top 뷰포트를 세로로 꽉 채우고 가로는 자기 폭 그대로라, 래퍼 뷰포트가 top 뷰포트에 **항상 완전히 든다**. 따라서 게이트를 `window === window.top || isDeviceFrame()`으로 여는 것만으로 판정 논리가 유지되고, 40% 면적 게이트의 기준 뷰포트는 자기 뷰포트(= 디바이스 폭)를 그대로 쓰면 된다.

`isDeviceFrame()`은 `window.frameElement?.id === DEVICE_FRAME_ID`다. same-origin 불변식이 없으면 cross-origin 문서에서 `null`이 되어 성립하지 않았을 판정이고, handoff 결정이 이 확장을 싸게 만들었다.

### `src/sidepanel/lib/device-presets.ts`

```ts
export interface DevicePreset {
  /** 세그먼트의 뷰포트 폭이자 **라벨의 단일 출처**. 숫자를 그대로 찍으므로 사전을 거치지 않는다. */
  width: number;
  /** 보조 기호. 폭 숫자를 대체하지 않는다. */
  icon: LucideIcon;
}

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { width: 390, icon: Smartphone },
  { width: 768, icon: Tablet },
  { width: 1024, icon: Laptop },
];

/** 가용 폭 안에 들어가는가. availableWidth가 null(미조회)이면 낙관적으로 true. */
export function isPresetAvailable(width: number, availableWidth: number | null): boolean;
```

`430`을 뺐다 — `390`과 같은 브레이크포인트 구간이라 판정력이 거의 겹치는데 세그먼트 폭은 똑같이 먹는다. 3프리셋 + `전체`(`Monitor` 아이콘, 데스크톱 뷰포트를 겸한다)로 4세그먼트다.

`availableWidth`가 null일 때 `true`를 돌려주는 건 의도된 선택이다 — 조회 실패나 초기 프레임에 모든 세그먼트가 흐려지는 깜빡임을 막고, 실제로 안 들어가면 `mountDeviceFrame` 이후 `availableChanged`가 정정한다.

### `src/sidepanel/hooks/useDeviceViewport.ts`

```ts
export interface DeviceViewportState {
  width: number | null;              // 현재 폭 (null = 전체)
  availableWidth: number | null;     // 가용 폭
  locked: boolean;                   // phase !== "idle". 미지원 탭은 행 자체가 미렌더라
                                     // 이 축에 안 걸리지만, App.tsx의 다이얼로그 분기가
                                     // 같은 훅을 쓰므로 unsupported도 함께 잠근다
  busy: boolean;                     // 전환 진행 중
  select: (width: number | null) => Promise<void>;
}
export function useDeviceViewport(tabId: number | null): DeviceViewportState;
```

**`select()`는 세 경로로 갈린다.** 이 분기를 안 두면 폭 전환이 깨진다:

| 전이 | 경로 | 왜 |
|---|---|---|
| `전체` → 폭 (OFF→ON) | 아래 전체 순서 | 래퍼가 새로 로드된다 |
| 폭 → 다른 폭 (ON→ON) | **경량 경로** — `device.set { width }` 하나로 끝 | `mountDeviceFrame`이 기존 노드의 폭만 바꾸고 **재로드가 없다** |
| 폭 → `전체` (ON→OFF) | pending 폐기 → `device.set { width: null }`(unmount + reload) | 진입과 대칭 |

**폭 갱신에 `device.arm`·`frameLoaded` 대기·레코더 전환을 붙이면 안 된다.** 재로드가 없으니 `frameReady`도 `onCommitted`도 오지 않고, **3초 무신호 → 차단 판정 → 롤백**으로 끝난다 — 390에서 768을 누르면 모드가 통째로 풀리는 증상이다. 로그도 비우지 않는다: 같은 문서가 리사이즈된 것뿐이라 실제 브라우저 창 크기 변경과 동치이고, 경계를 그으면 오히려 연속된 디버깅 세션이 끊긴다.

아래는 **OFF→ON 경로**의 순서다(고정):

1. `locked || busy`면 **아무것도 하지 않고** 즉시 반환한다(카운터도 안 건드린다)
2. 통과했으면 루프 카운터를 0으로 리셋한다 — 사용자 조작이 "정상 사용 중" 신호다
3. **`width === null`(전체 복귀)이면 `pending`을 먼저 버린다.** OFF는 unmount + `location.reload()`인데 그 reload도 top 커밋이라, pending이 남아 있으면 곧바로 재수립이 걸려 OFF↔ON 무한 루프가 된다. 폐기가 `device.set`보다 앞이어야 한다
4. 최초 ON 진입 1회 확인 다이얼로그. `[계속]`을 누르면 `settings-ui-store.deviceModeWarned = true`를 `chrome.storage.local`에 즉시 영속한다(플래그 이름이 `deviceReloadWarned`가 아닌 이유는 경고가 재로드뿐 아니라 원본·래퍼 동시 실행까지 덮기 때문이다). 체크박스는 없다. 이 스토어는 현재 **version 9**(`settings-ui-store.ts:242`)이므로 `migrateSettingsUi`(`:131-151`) 기본값 `false` 등록 + version 10 bump가 함께 가야 한다. 문구는 진입·해제 재로드와 원본·래퍼 동시 실행의 중복 요청·자동저장·결제 위험을 모두 말한다.
5. `syncAndSettleLogs(tabId)` — 떠나는 페이지 로그 꼬리를 누적기에 밀어넣는다
6. `width != null`이면 `device.arm { on: true }` — `device.set`보다 **먼저** 열어야 첫 `onBeforeNavigate`를 놓치지 않는다
7. `sendPickerTop(tabId, { type: "device.set", width })`
8. 응답이 `undefined`거나 `ok === false`면 토스트 + `전체`로 되돌리고 arm 창을 닫는다 (마운트 자체가 실패한 경우)
9. `width != null`이면 `device.frameLoaded` / `device.frameBlocked` 중 하나를 기다린다(≤3s). `frameBlocked`면 `device.set { width: null }` 롤백 + `issue.device.blocked` 토스트
10. `frameLoaded`면 **전 document stop ACK**(`activateRecordersInDeviceTree`의 앞단)
11. `store.clearNetworkLog/clearConsoleLog/clearActionLog(tabId)` + 3종 persist `discard()` — 모드 전환은 네비게이션이라 `logClear`가 안 온다. 강제한다
12. **래퍼 서브트리 start ACK**. 실패해도 모드를 롤백하지 않고 `issue.device.recordersDegraded` 토스트만 띄운다 — 래퍼는 정상 로드됐고 레코더는 다음 inject 트리거에서 같은 게이트를 타고 스스로 재무장한다. 여기서 롤백하면 unmount + `location.reload()`라 **정상 동작 중인 페이지의 스크롤·입력값을 날린다**. 롤백은 래퍼가 실제로 못 선 경우(`frameBlocked`)에만 남긴다
13. arm 창을 닫는다(`device.arm { on: false }`)

**clear는 반드시 stop ACK 뒤, start ACK 앞이다.** 이유가 둘이고, 하나만 알고 순서를 되돌리면 나머지가 조용히 깨진다.

1. clear를 mount보다 앞에 두면 mount~stop ACK 사이에 숨겨진 원본이 뱉은 로그가 경계를 통과해 살아남는데, 래퍼와 top은 같은 origin이라 필터로도 못 가른다(위험 7·9).
2. **그 구간에서 sentinel 게이트가 일시적으로 "모드 OFF"로 판정한다.** 게이트의 모드 판정은 `deviceTree.length > 0`인데 mount~`frameReady` 사이엔 binding이 없어 빈 배열이고, 하필 그때가 `tabs.onUpdated(status === "complete")`로 activate 3종이 가장 잘 도는 구간이다(아래 "sentinel 발행 경로 단일 게이트"가 "전환 직후가 가장 잘 걸린다"고 쓴 그 지점). 즉 숨겨진 top이 broadcast로 잠깐 되살아나는 것을 **막을 수 없고**, stop ACK가 다시 죽인 뒤의 clear만이 그 창의 로그를 지운다.

래퍼의 pre-arm 버퍼는 start 시점에 flush되므로 clear를 뒤로 미뤄도 손실이 없다.

`busy`는 6~13 전 구간에서 `true`다 — 9가 최대 3초를 쓰므로 스피너가 이 구간을 덮어야 한다.

### 재수립 계약 (`reestablish`)

모드가 다시 서야 하는 사건이 셋이다 — **handoff**(top이 다른 origin으로 옮겨감), **차단 복구**(프레임에 못 들어가는 URL이라 top으로 내보냄), **확장 reload 복구**(페이지엔 래퍼가 있는데 binding이 사라짐). 셋을 각자 "재수립한다"고만 적어두면 구현에서 세 번 다르게 만들어지고, 그 차이가 전부 조용한 실패로 나온다. **하나의 함수로 못 박는다.**

```ts
/**
 * 사용자 조작이 아니라 "이미 벌어진 페이지 사실"에 대한 반응이다.
 * 호출 지점은 top onCommitted(pending 있음) 하나다.
 * handoff·확장 reload 복구는 pending을 세팅하고 top commit을 만들기만 하며 직접 부르지 않는다.
 */
async function reestablish(tabId: number, width: number, url: string): Promise<void>;
```

`select()`와 무엇이 같고 무엇이 다른가:

**표에 없는 축은 구현이 `select()`에서 그대로 복사해오거나 통째로 빠뜨린다.** 그래서 13축을 전부 적는다 — 빠진 축은 예외 없이 무증상 실패(모드가 안 서는데 UI는 켜져 보임)로 나온다.

| 축 | `select()` | `reestablish()` |
|---|---|---|
| 트리거 | 사용자 세그먼트 클릭 | 페이지 사실(top 문서 교체·binding 소실) |
| `locked`의 `phase !== "idle"` 축 | 거부 | **우회한다** |
| `locked`의 `unsupported` 축 | 거부 | **우회하지 않는다** — 폐기가 이긴다(pending을 버리고 끝) |
| `busy` | 거부 | 거부. **단 소비한 `pending`을 되돌려놓는다** |
| 최초 1회 경고 | 띄운다 | 띄우지 않는다 |
| `syncAndSettleLogs` | 한다 | **안 한다** — 떠나는 문서가 이미 없다 |
| `device.arm` 개방 | 연다 | **연다**(동일) |
| `device.arm` 폐쇄 | 13단계에서 닫는다 | 판정 후 닫는다. **handoff는 background가 판정과 같은 전이에서 닫는다**(패널은 관여하지 않는다) |
| stop ACK → clear → start ACK | 한다 | **한다**(동일 순서) |
| `picker.start` 재시도 | `frameLoaded` 뒤 래퍼 frameId로, `phase === "picking"`일 때만 (위험 8) | **동일** — 그리고 picking 중 재수립이 그 분기의 유일한 도달 지점이다 |
| 루프 카운터 | 0으로 리셋 | +1, 임계 초과면 중단 |
| 실패(`frameBlocked`·전달 실패) | `전체` 롤백 + 토스트 | 동일 |
| `pending`·카운터·`watch` refcount 소유 | — | **모듈 스코프 단일 인스턴스**(아래) |

**`locked`를 우회하는 것이 이 계약의 핵심이다.** `select()`의 잠금은 *사용자가 전환을 일으켜 draft·선택 요소·녹화를 깨는 것*을 막는 장치다. 재수립은 이미 문서가 갈린 뒤의 복구라, 잠금을 그대로 적용하면 drafting·recording 중 handoff에서 **top만 옮겨가고 래퍼가 안 서는데 세그먼트는 여전히 `390`을 가리키는** 상태가 된다 — 기각했던 desync가 바로 이 경로로 되살아난다. draft 파괴는 잠금이 아니라 `sessionExpired` 통보가 받는다.

**`device.arm`은 재수립에서도 반드시 연다.** arm 창이 없으면 잠정 등록이 없고, 그러면 즉시 redirect·차단 판정의 타깃 frameId가 없어 `frameLoaded`/`frameBlocked` 어느 쪽도 오지 않는다. `busy`가 3초 타임아웃으로 끝나고 모드는 조용히 안 선다.

**`reestablish` 호출 지점은 top `onCommitted` + `pending` 하나로 고정한다.** 패널 마운트 시 `device.state`(래퍼 있음)와 `device.documents`(binding 없음)가 엇갈리면 `device.state.width`를 pending에 세우고 래퍼를 제거해 top reload를 만든다. 그 commit이 공용 호출 지점으로 수렴한다. 확장 reload는 인메모리 pending을 함께 지우므로 폭의 소스는 페이지 DOM뿐이다.

**`pending`과 루프 카운터는 훅 인스턴스가 아니라 모듈 스코프에 둔다.** `useDeviceViewport`는 `DeviceViewportBar`와 `App.tsx`의 다이얼로그 분기에서 **두 번 마운트된다**(Task 13이 `device.state` 중복 요청으로 이미 인정한 사실). 상태를 훅에 두면 인스턴스마다 pending을 갖게 되어 top 커밋 한 번에 재수립이 2회 발사되고 루프 임계를 각각 절반씩 센다. 모듈 스코프 `Map<tabId, Pending>` 하나로 두고 훅은 읽기만 한다.

`pending`(`{ tabId, width }`)의 수명: `select()` 성공 시 세팅 → 위 "cross-origin handoff"의 폐기 조건에서 제거 → top `onCommitted`에서 **소비 즉시 삭제한 뒤** `reestablish`를 부르고 성공하면 다시 세팅한다(실패 경로에서 유령 pending이 남지 않게). **단 `busy` 거부는 실패가 아니다** — 되돌려놓지 않으면 `select()`가 도는 중에 온 top 커밋에서 모드가 조용히 유실된다.

**`unsupported`는 우회 대상이 아니다.** `locked`가 `phase !== "idle" || unsupported` 두 축이라(`useDeviceViewport` 타입 주석), 우회를 뭉뚱그리면 미지원 URL에서도 재수립을 시도하게 되고 폐기 조건 "미지원 URL 도달"과 충돌한다. 우회하는 건 `phase` 축뿐이고, unsupported면 pending을 버리고 끝낸다.

**arm 창은 `chrome.tabs.update` 전에 닫혀야 한다 — 소유자는 background다.** `select()`가 연 3초 창이 열린 채 남으면 타임아웃이 `frameBlocked`를 뒤늦게 쏘고, 그게 방금 성공한 재수립을 롤백시킨다. `reestablish`가 자기 창을 새로 여므로 이전 창은 반드시 닫혀 있어야 한다. 이 폐쇄는 `decideDeviceSignal`의 handoff 분기가 `armed: false`를 내고 `applyDeviceSignal`이 `clearArmTimer`를 부르는 것으로 이뤄진다 — **top 이동과 같은 전이 안이라 패널 왕복이 낄 자리가 없다.** 인플라이트 `select()`가 판정 대기 뒤에 보내는 `arm(false)`는 자기 정리 경로의 멱등 폐쇄일 뿐 이 순서 보장에 관여하지 않는다.

### `src/sidepanel/picker-control.ts` — `activateRecordersInDeviceTree`

```ts
/**
 * 현재 문서 전부를 정지한 뒤 래퍼 서브트리만 활성화한다. 각 단계는 응답 확인식이다.
 * 문서 목록은 인자로 받지 않고 bgRequest("device.documents")로 background에서 가져온다 —
 * 사이드패널은 프레임 트리를 알 수 없고(캐시를 두지 않기로 했다), background만 안다.
 */
export async function activateRecordersInDeviceTree(tabId: number): Promise<boolean>;
```

정확도가 우선이므로 broadcast 후 top만 재정지하는 경쟁 구조는 쓰지 않는다. 열거원은 background의 `chrome.webNavigation.getAllFrames({ tabId })`이고(`frameId`·`parentFrameId`·`documentId`·`parentDocumentId`를 한 번에 준다), 여기에 래퍼 binding을 얹어 `{ all, deviceTree }`로 갈라 응답한다. 사이드패널은 `chrome.tabs.sendMessage(..., { documentId })`로 `all`에 stop ACK를 받은 뒤 `deviceTree`에만 start ACK를 받는다. sidepanel 모듈 캐시는 두지 않는다.

### sentinel 발행 경로 단일 게이트

**stop/start를 한 번 맞춰놓는 것만으로는 로그 1벌이 유지되지 않는다.** sentinel을 발행하는 경로가 셋 있고 전부 서브트리를 모른다:

| 경로 | 트리거 | 그대로 두면 |
|---|---|---|
| `activate*Recorder` 3종 (`picker-control.ts:709-755`) | `useBackgroundRecorder.inject()` — visibilitychange, `tabs.onUpdated(status==="complete")`, idle 복귀 | `sendAll` broadcast라 숨겨진 top이 sentinel을 다시 받아 **되살아난다.** 래퍼 iframe 로드가 top 탭 status를 complete로 되돌리므로 전환 직후가 가장 잘 걸린다 |
| `rebroadcastSentinelsToFrame` (`:173-182`) | `frameCommitted` 수신 (`usePickerMessages.ts:271-272`) | 커밋된 **모든** 자식 프레임에 재발행 — 숨겨진 top의 자식 iframe이 커밋될 때마다 그 레코더가 살아난다 |
| `activateRecordersInDeviceTree` | 모드 전환 | 정상 |

호출 트리거를 하나씩 막는 방식은 새 트리거가 생길 때마다 샌다. **발행 지점 하나로 좁혀 게이트를 건다** — `picker-control` 안에 sentinel 송신 헬퍼를 두고, 모드 ON이면 `deviceTree` documentId 지정 송신으로, OFF면 기존 `sendAll`/frameId 지정으로 갈린다. 성공한 빈 트리는 OFF이고, `device.documents` 실패는 `null`로 구분해 fail-closed한다.

이 게이트가 **same-origin 이동 후 start 재전달의 정식 경로**이기도 하다: 래퍼가 같은 origin의 B로 이동하면 `frameCommitted(래퍼 frameId)` → 게이트 통과 → 새 documentId에 sentinel 재발행. pre-arm 절이 말하는 "정확성 계약은 `onCommitted` 뒤 documentId 지정 start ACK"의 구현 주체가 여기다.

### `DeviceViewportBar`

```tsx
export function DeviceViewportBar({ tabId }: { tabId: number | null }): JSX.Element | null;
```

**`TabsList` + `TabsTrigger`로 만든다** — `ToggleGroup`이 아니다. 코드베이스의 세그먼트 토글 정규 선례가 `StyleEditorPanel.tsx:239`의 `<TabsList className="grid h-9 w-full grid-cols-N">`(`TabsContent` 없이 store 값으로 구동)이고, `ToggleGroup`은 앱 사용처가 0인 미사용 primitive라 그 `segment` variant(`toggle.tsx:15-16`의 `border-input rounded-none -ml-px`)는 TabsList pill과 시각 언어가 전혀 다르다. ToggleGroup에 `h-9 rounded-lg bg-muted p-1`을 손으로 칠하면 TabsList 룩의 **네 번째 사본**이 되고 "직접 스타일링 금지"와 충돌한다. Tabs를 쓰면 부수적으로 `type="single"`의 재클릭 해제(`value=""`) 축도 사라진다.

**`<Tabs>` 래퍼를 반드시 자기가 들고 온다.** 이 행은 `DebugTab`의 `<Tabs value={sub}>`(`:67`) **안쪽**에 놓이므로 `TabsList`만 렌더하면 바깥 컨텍스트를 잡는다 — 세그먼트를 누르는 순간 `setSub("390")`이 돌아 **존재하지 않는 서브탭으로 전환되고 화면이 빈다.** 에러가 아니라 조용한 오동작이다. 선례(`StyleEditorPanel.tsx:234-249`)도 자기 `<Tabs value=… onValueChange=…>`를 들고 `TabsContent` 없이 `TabsList`만 쓴다. 결과적으로 App(`:278`) > DebugTab(`:67`) > 이 행의 3중 중첩이 되는데, Radix는 `Tabs`마다 Provider와 roving tabindex를 따로 두므로 안전하다.

**`CollapsingTabsList` + `TabLabel`을 쓴다** — 서브탭 바·메인 탭 바와 같은 컴포넌트다. 라벨이 셀을 넘치면 모든 라벨을 한꺼번에 감춰 아이콘만 남기는데(`ui/collapsing-tabs.tsx`), **여기서는 그게 의도된 동작이다.** 기기 아이콘을 넣은 이유가 정확히 접힘 상태의 표현 수단을 만들기 위해서고, 접혀도 `aria-label`이 폭을 그대로 말하므로 정보가 사라지지 않는다. 폭 예산을 맞추려고 프리셋을 줄이거나 패딩을 깎을 필요가 없어지고, 이 패널의 다른 탭 바와 좁은 폭에서의 거동이 같아진다.

- 첫 세그먼트 라벨은 `전체`/`Full`(`Monitor` 아이콘). `끔`이 아니다 — 사용자가 고르는 건 "브라우저 폭 전체"라는 뷰포트 선택지 하나이고 데스크톱 뷰포트를 겸한다.
- **아이콘 + 폭 숫자를 병기한다**(폭이 모자라면 라벨이 접혀 아이콘만 남는다 — 위 문단). 숫자만 두면 좁은 폭에서 남길 게 없고, 아이콘만 두면 넓은 폭에서도 기기 에뮬레이션으로 오해된다(prd "구현 방식이 제품 범위를 결정한다"). 아이콘은 `lucide-react`의 `Monitor`/`Smartphone`/`Tablet`/`Laptop` — 신규 의존성 0.
- **폭 예산은 접힘이 흡수한다.** 5세그먼트였을 때 세그먼트당 텍스트 가용 폭 ≈28.8px vs `1024` ≈31px로 적자였고, 4세그먼트면 세그먼트당 ≈68px(320px 패널 기준)이라 아이콘 14px + gap 4px + `1024` ≈31px가 들어간다. 못 들어가는 폭에서는 라벨이 접혀 아이콘만 남으므로 **잘림·줄바꿈이 원천적으로 없다**. `grid grid-cols-4`. Task 7의 320/360/400px 3점 검증은 "안 잘리는가"가 아니라 **"접힘 전환이 깔끔한가"**를 본다.
- 가용 폭 초과 세그먼트: `aria-disabled` + `opacity-50` + 툴팁. `disabled` 속성이 아니라 `aria-disabled`를 쓴다(DESIGN.md §14 — shadcn base의 `disabled:pointer-events-none`이 hover·툴팁을 죽인다). Radix Tabs는 `aria-disabled`를 동작 가드로 해석하지 않으므로 `onValueChange`와 오케스트레이터 `select()` 양쪽에서 locked/busy/초과 값을 거부한다.
- `locked`면 행 전체 `aria-disabled`.
- **`busy`면 선택 세그먼트에 `Loader2 motion-reduce:animate-none`** + 행 전체 `aria-disabled`·`aria-busy=true` + live status. XFO 사이트는 롤백까지 최대 3초라 무피드백 구간이 생긴다.
- 세그먼트 접근명은 숫자가 아니라 `aria-label`로 "너비 390픽셀"류를 준다. 비활성 사유는 `aria-describedby`로 병행(Radix Tooltip은 focus에서도 열린다).
- `tabId == null` 또는 미지원 탭이면 `null`을 반환해 행을 렌더하지 않는다. PRD의 기존 미지원 캡처 진입 정책과 맞춘다.

### 모드 ON 인디케이터

`hideSubTabs`는 `phase === styling|drafting|previewing|done`(`DebugTab.tsx:27-31`)이라, 뷰포트 행이 서브탭 바와 같은 `hideSubTabs` 게이트를 타는 이상 **캡처 직후부터 제출까지 통째로 사라진다.** 전역 배지를 2차로 미뤘으므로 그 구간에 ON 신호가 0이 되고, `Device` 행 신설도 기각했으므로 리포트 표면에도 신호가 없다.

1차는 **`DraftingPanel`의 재현 환경 근처에 읽기전용 표시 1개**로 갈음한다. 폭이 우연히 프리셋과 같은 전체 상태와 혼동하지 않도록 `device.state.width != null`로 ON을 판정하고 `뷰포트 390px`처럼 현재 폭을 표시한다. 접근명과 `data-testid="device-viewport-indicator"`를 제공한다.

## 기존 패턴 준수

| 규칙 | 이 기능에서 |
|---|---|
| `executeScript({func})`는 클로저가 안 살아남는다 | `getTopViewport`의 새 func은 self-contained. 프레임 id 문자열을 인라인하고 동기화 테스트로 고정 |
| pre-arm 청크는 외부 static import 0 | `recorders-entry` 그래프를 안 건드린다. `device-frame.ts`는 `picker.ts`가 import |
| manifest content_scripts 배열 순서 | 변경 없음. 신규 엔트리를 추가하지 않는다 |
| i18n ko/en 동시 갱신 | `app.ts`·`issue.ts` 양쪽. log-viewer 사전(`src/log-viewer/i18n.ts`)은 이 기능의 키를 안 쓰므로 무변경 |
| store가 `sidepanel/tabs`를 import하지 않는다 | `device-presets.ts`를 `sidepanel/lib/`에 둔다 |
| 신규 인터페이스는 테스트 먼저 | `device-presets.ts`·`device-frame.ts`가 대상. 브라우저 실동작(래퍼 로드·미디어쿼리)은 e2e |
| 세션 영속화 | **하지 않는다.** `EDITOR_SNAPSHOT_KEYS` 무변경 |
| 미지원 탭 게이트 | `useTabUnsupported` 재사용 |
| `aria-disabled` over `disabled` | 툴팁이 살아야 하는 모든 잠금 지점 |
| 주입 CSS 색 리터럴은 `tokens.test.ts`에 등록 | `device-frame.ts`가 **네 번째 사본**. 라이트 `210 40% 96.1%` / 다크 `0 0% 14.9%`(`--muted`) |
| 페이지 변경 통보는 기존 `sessionExpired` 경로 | handoff가 새 다이얼로그를 만들지 않는다. 문구만 분기 |

## 캡처 3축에서의 동작

| 방식 | 판정 | 근거 |
|---|---|---|
| 영역(드래그) 캡처 | **클램핑** | rect·viewport 모두 top CSS px이고 크롭 배율은 이미지에서 유도한다(`capture.ts:127`). top blocker가 iframe 위 드래그도 가로채므로 크롭 자체는 정확하지만(핸드오프는 `picker.ts:1036`의 `mode !== "hover"` 조기 반환에 막혀 **element hover 모드에서만** 돈다 — area-select 중에는 blocker가 래퍼 위에서도 pointer-events를 유지한다), 사용자가 래퍼 밖 여백까지 드래그할 수 있다 → 확정 rect(`area-select.ts:200-216`)를 래퍼 영역으로 클램핑한다 |
| 화면(뷰포트) 캡처 | **보정** | `area-select.ts:116`의 rect를 래퍼 rect로 교체. 안 하면 좌우 여백이 찍힌다. 중앙 정렬이라 `x`가 0이 아니므로 `{x:0,y:0,...viewport}` 스프레드를 풀어야 한다 |
| 페이지 전체 캡처 | **잠금** | 오케스트레이터가 frameId 0 고정(`scroll-capture.ts:41`)이라 모드 ON이면 "조용한 1타일"이 된다 — 에러도 truncated 배지도 안 뜬다. 1차에서는 명시적으로 잠근다 |

**크롭 배율용 viewport와 메타용 viewport를 분리한다.** 지금은 `picker.areaSelected`의 `msg.viewport` 하나가 둘 다를 맡는데, 크롭은 top 기준이어야 정확하고(`img.naturalWidth / viewport.width`) 메타는 디바이스 폭이어야 한다. `captureAndCrop(rect, cropViewport, metaViewport)`로 인자를 하나 늘리고, `metaViewport`는 `getTopViewport(tabId)`로 받는다. 모드 OFF에서는 두 값이 같아 무해하다.

`captureAndCrop`은 **`capture.ts`가 아니라 `usePickerMessages.ts:423`의 모듈 프라이빗 함수**다(`capture.ts`의 export는 `cropImage`뿐이고 호출부도 `:222` 한 곳). 따라서 이 변경은 `usePickerMessages.ts` 안에서 끝난다. 같은 파일의 `captureAndInsertInline`(`:442`)은 `cropImage`만 쓰고 메타를 안 쓰므로 무변경이고, 두 함수의 시그니처가 비대칭이 되므로 주석으로 이유를 남긴다.

## 래퍼 내부 same-origin 네비게이션 = top 네비게이션

**cross-origin은 이 절의 대상이 아니다** — handoff가 실제 top 네비게이션을 일으켜 기존 그물이 그대로 돈다. 여기서 다루는 건 래퍼가 그 자리에 남는 **same-origin 이동**뿐이다.

`tab-bindings.ts:317-332`의 세션·로그 리셋 그물이 전부 `tab.url` 변화에 걸려 있다. 래퍼가 이동해도 top URL은 안 바뀌므로 래퍼 안의 이동이 이 그물을 통째로 통과한다 — 그대로 두면 같은 조작인데 모드 ON/OFF에서 로그 범위가 달라져 리포트 재현성이 깨진다.

**해결**: background가 래퍼 frameId를 알고 top처럼 취급한다.

```ts
// background/tab-bindings.ts
type DeviceFrameBinding = { frameId: number; documentId: string };
const deviceFrameByTab = new Map<number, DeviceFrameBinding>();

export async function setDeviceFrame(tabId: number, binding: DeviceFrameBinding | null): Promise<void>;
export function armDeviceFrame(tabId: number, on: boolean): void;   // 3s 감시창 개폐

/**
 * 0 || 래퍼. **동기다** — 소비처가 리스너 최상단이기 때문이고, 대신 호출 전에 복원이
 * 끝나 있음을 탭별 순서 큐가 보장한다(아래 "게이트는 탭별 순서 큐로 직렬화한다").
 * 큐 밖에서 부르면 복원 전 오판이 되므로 큐 안에서만 호출한다.
 */
export function isTopLikeFrame(tabId: number, frameId: number): boolean;

/** getAllFrames + binding을 합쳐 전 document와 래퍼 서브트리를 가른다. device.documents의 구현. */
export async function listTabDocuments(tabId: number): Promise<{ all: string[]; deviceTree: string[] }>;
```

- 최초 등록: 같은 URL을 연 래퍼의 `picker.ts`만 `window.frameElement?.id === DEVICE_FRAME_ID`를 확인해 `device.frameReady`를 발화 → background가 `sender.frameId`/`sender.documentId`를 Map과 `chrome.storage.session`에 기록.
- **`frameReady`는 한 번만 오지 않는다.** same-origin 불변식 때문에 래퍼 안에서 링크를 타고 들어간 **후속 문서도 `frameElement`를 읽을 수 있어 매번 재발화한다.** 그래서 background는 수신 시 **arm 창이 열려 있는지로 갈린다**: 열려 있으면 진입 판정이므로 잠정 래퍼를 확정 승격하고 `device.frameLoaded`를 push하고, 닫혀 있으면 **binding의 `documentId`만 갱신하고 push하지 않는다**. 이 분기가 없으면 모드 유지 중 same-origin 이동마다 `frameLoaded`가 날아와 `busy`가 아닌 사이드패널이 전이 완료 처리를 다시 돈다. (부수 효과로 이 경로가 same-origin 이동의 documentId 갱신을 `onCommitted`와 이중으로 보장한다 — 멱등이라 무해하다.)
- 잠정 등록: arm 창 안에서 `parentFrameId === 0 && url === top URL`인 첫 `onBeforeNavigate`를 잠정 래퍼로 잡는다. 즉시 redirect돼 `device.frameReady`가 안 오는 사이트에서 래퍼 frameId를 아는 유일한 시작점(handoff·차단 판정의 타깃이 된다) (위 "로드 검증")
- 문서 이동: Chrome이 frame 생애 동안 유지하는 `frameId`를 권위값으로 삼고 `onCommitted.documentId`를 갱신한다. `parentFrameId`/`parentDocumentId`로 래퍼 자손 계보도 갱신한다
- SW 복구: 시작 시 storage 복원 promise 뒤에 navigation 이벤트를 탭별 큐잉한다. 복구 전에 Map이 비었다고 top-only로 판정하지 않는다
- 확장 reload 복구: storage.session이 비므로 패널 마운트에서 binding 엇갈림을 감지하면 기존 래퍼를 제거하고 pending을 남긴다. 이어지는 top commit이 단일 `reestablish` 호출 지점으로 수렴하며, binding 자체를 되살리는 경로는 없다
- 해제: `device.set { width: null }` 성공 시, top `onCommitted`, 탭 제거에서 Map과 storage를 함께 제거
- 소비: **아래 "무엇을 갈아끼우고 무엇을 그대로 두는가"**

### 무엇을 갈아끼우고 무엇을 그대로 두는가

`onCommitted` 리스너(`background/index.ts:143-186`)는 **두 책임이 얽혀 있어 boolean 하나로 뭉갤 수 없다.** `:145`의 자식 분기는 단순 early return이 아니라 **iframe 전용 `frameCommitted` 재발행 블록**(`:146-162`)이다.

| 축 | 처리 |
|---|---|
| `frameCommitted` push | **항상 실제 `details.frameId`로 보낸다.** 자식 분기(`:146-162`)를 래퍼에도 그대로 태운다 |
| 로그 라이프사이클 (`:129-140` 3종 sync, `:174-185` logClear) | `isTopLikeFrame(tabId, frameId)`을 적용해 래퍼를 top처럼 취급 |

래퍼를 top 분기로 보내면 두 가지가 조용히 깨진다:

1. `rebroadcastSentinelsToFrame`·`restartPickerInFrame`이 래퍼를 못 겨냥해 **래퍼 안 로그 레코더가 dormant**가 되고, picking 중 래퍼 재로드 시 클릭이 유실된다. (b)에서 짚은 유일한 사후 등록 경로가 죽는 것이다.
2. `:170`이 `frameId: 0`을 **하드코딩**해 push하므로 래퍼의 documentId가 frameId 0 슬롯에 들어간다(`usePickerMessages.ts:271`). 이후 진짜 top이 보낸 `picker.selected`/`cancelled`/`areaSelected`가 `isStalePickerDocument`(`:85-92`)에 걸려 **전부 드롭**된다 — 완전 무반응 회귀다.

### `navUrlPromise` 키 확장

`navUrlPromise`(`background/index.ts:120`)는 tabId 단일 키이고 이전 URL을 `chrome.tabs.get(tabId).url`로 뽑는다(`:126`). **래퍼가 이동해도 top URL은 안 바뀌므로 `prev`가 영원히 mount 시점 URL로 고정된다** — 래퍼 안 A→B→C 이동에서 두 번째 판정이 B가 아니라 A 기준으로 돌아 `shouldClearLogs`가 오판한다. top과 래퍼가 겹쳐 navigate하면 엔트리가 서로를 덮는 문제도 있다.

키를 `${tabId}:${frameId}`로 바꾸고, 래퍼의 prev URL은 `tabs.get`이 아니라 직전 `onCommitted` URL을 별도 추적한다.

**게이트는 탭별 순서 큐로 직렬화한다.** storage 복구와 각 navigation 처리를 같은 promise chain에 연결해 `navUrlPromise` 갱신과 `frameCommitted` 순서를 보존한다. 즉시성보다 SW 재기동 뒤 올바른 래퍼 판정을 우선한다.

이러면 래퍼 안의 이동에서도 3종 `sync` 꼬리 확보 + cross-origin/reload `logClear`가 동일하게 돌면서, iframe 재발행 경로도 살아남는다.

## 모드 전이 게이트

전이에는 **사용자 전이**(`select()`)와 **재수립**(`reestablish()`) 두 축이 있고, 게이트가 다르다. 잠금은 전자만 막는다.

| 위험 | 사용자 전이 게이트 | 재수립에서는 |
|---|---|---|
| (a) 로그 혼입 — 엔트리에 frameId 필드가 없어(`console-recorder.ts:29-37`) 전이 전후를 구분할 수 없다 | 전이 **직전** 3종 `sync` + settle, **stop ACK 뒤** store clear(`select()` 5·11) | `sync`는 생략(떠나는 문서가 없다), clear는 동일하게 stop ACK 뒤 |
| (b) draft·선택 요소 파괴 — 래퍼 재로드로 frameId가 재발급되면 `sameElementKey`(`element-key.ts:8-10`)가 어긋나 `applyStyles/applyClasses/applyText`가 **조용히 no-op**된다(반환값 미확인 — `tabs/styleEditor/StylePropEditors.tsx:45`가 `void`로 무시). `rebindStylingSession`은 URL(pageKey)만 보므로(`picker-control.ts:474-487`) 이 그물이 전이를 못 잡는다 | **`phase !== "idle"`이면 컨트롤 전체 잠금.** 사용자가 이 상태를 만드는 축을 제거한다. `element-key.ts`에 세대 축을 넣는 안은 소비처가 많아 비용이 크다 | 잠금이 **적용되지 않는다.** 대신 `sessionExpired` → `reset()`이 draft·선택 요소를 통째로 버려 no-op 유령 상태 자체를 없앤다 |
| (c) 녹화·리플레이 중 전이 — 한 스트림 안 해상도 불연속(`video-recorder.ts:111-117`), 30s 버퍼가 토글만으로 `clear()`(`30s-replay/use-30s-replay.ts:56`, cleanup은 `:110`) | (b)와 같은 잠금이 함께 막는다(`phase === "recording"`) | 잠금이 적용되지 않지만 **두 위험 모두 발생하지 않는다** — 탭 크기가 안 변해 해상도가 연속이고, 30s `clear()`는 토글 전용이라 재수립이 안 건드린다. 통보는 토스트 1개 |
| (d) 세션 복원 desync | **모드를 `chrome.storage`에 영속하지 않으므로 복원 축이 없다.** 마운트 시 `device.state`로 페이지에 물어본다 | 인메모리 `pending`이 top 커밋을 넘어 폭을 나르지만, 매 커밋마다 실제 re-mount로 조정되고 차단이면 `전체`로 롤백되므로 "래퍼 없는 ON"이 생기지 않는다. 폐기 조건 6개가 이 보장의 근거다 |

## pre-arm 상호작용

**same-origin 불변식이 pre-arm을 살렸다.** `__bugshot_recorder_active__`는 origin 스코프 `sessionStorage`(`recorder-prearm.ts:4`)인데, 래퍼는 항상 top과 같은 origin이라 top이 이미 armed한 플래그를 그대로 읽어 **document_start부터 버퍼링한다**. `device.frameLoaded` → start ACK까지의 창에서 로그가 새지 않는다. (cross-origin 래퍼를 허용했다면 목적지는 별도 저장소를 봐서 이 보장이 없었다.)

**숨겨진 원본의 유령 버퍼는 없다.** stop 핸들러가 dispatch 게이트(`recording`)뿐 아니라 적재 게이트(`capturing`)도 끄므로(`console-recorder.ts:320-322`) 적재 자체가 멈춘다. 플래그는 유지되는데(`:319` 주석 — reload 시 재-pre-arm) 그건 `전체` 복귀 reload에서 오히려 필요한 동작이다.

**handoff 목적지의 극초기 로그는 놓친다.** 새 origin엔 플래그가 없어 sentinel 도착 전 로그가 안 잡힌다. 오늘의 top cross-origin 이동과 동일하므로 새 손실이 아니고, 없애려면 origin을 넘는 사전 활성 신호가 필요해 잔여 위험으로 둔다.

경계 우회 위험은 남는다: `preArm: true` 마커가 붙은 엔트리는 `logClear` 경계를 우회한다(`sidepanel/lib/log-prearm-filter.ts:8`). 다만 전이 시 **전 document stop ACK를 확인한 뒤에 store를 clear**하므로(위 `select()` 10→11 순서) clear 이후 도착하는 preArm 엔트리는 전부 래퍼 서브트리 것이다. 회귀 그물은 `e2e/logs-prearm.spec.ts`가 맡는다.

## 2-depth 안내 문구 분기

거부 발화점은 `picker.ts:1070-1094` 한 곳이고, 모드 ON에서 손자 프레임 거부는 **이미 이 경로로 흐른다 — 추가 배선 0**. 현행 ko 문구가 "…다른 요소를 선택하거나 **스크린샷 모드**를 사용해 주세요"로 끝나는데, 모드 ON의 진짜 액션은 "디바이스 모드를 끄면 선택 가능"이다.

가장 싼 분기 지점은 `App.tsx:367` 렌더 시점이다. 스토어가 아니라 `useDeviceViewport(tabId).width`를 읽어 문구만 교체한다. content script 프로토콜 변경 0, i18n 키 2개(ko/en). `messages.ts:347-350`의 `fire()`에 reason을 싣는 안은 **발화 지점인 content script가 자신이 래퍼 안인지 모르므로** 더 비싸다.

## 대안 검토

### 렌더링 기법

| 기법 | `innerWidth` | 미디어쿼리 | `vw`/`100vh` | `fixed` | 판정 |
|---|:---:|:---:|:---:|:---:|---|
| `<html>` 고정 width + `transform: scale` | ✗ | ✗ | ✗ | ✗✗ transform된 조상이 containing block이 되어 **`fixed` 동작 자체가 깨진다** | 기각 |
| CSS `zoom` | ✗ | ✗ | ✗ | ✗ | 기각 |
| `chrome.tabs.setZoom` | ✓ | ✓ | ✓ | ✓ | **높이 독립 지정 불가.** 1512×800 창에서 390px 폭을 만들면 높이가 206px + 3.9배 확대 렌더가 된다 |
| **iframe 래핑** | ✓ | ✓ | ✓ | ✓ | **채택** |

`transform`/`zoom`은 미디어쿼리가 안 터진다 — 브레이크포인트가 안 바뀌면 "작게 그린 데스크톱 화면"일 뿐이라 반응형 검증 도구로서 무의미하다.

### 별도 확장 페이지(`chrome-extension://`)에 iframe

기각. `chrome-extension:`이 `SUPPORTED_SCHEMES`에 없어(`url-support.ts:1`) 캡처 5종·로그 서브탭·30s Replay·영상이 전부 잠기고, content_scripts가 `<all_urls>` 매칭이라 확장 페이지 top에는 picker도 레코더도 안 붙는다. 되살리려면 지원 URL 판정·주입 매칭·origin 기준이라는 단일 출처 3개를 동시에 흔들어야 하고, DNR/`webRequest` 신규 권한 + XFO/CSP 제거 justification이 심사에 걸린다.

### 래퍼 코드를 별도 content script로 주입

기각. `manifest.content_scripts`에 엔트리를 더하면 `picker-control.ts:64-74`의 `i > 0 && all_frames && world !== "MAIN"` find가 recorder-bridge 대신 새 엔트리를 잡아 **로그 브리지 자가복구가 조용히 죽는다.** `:35-36`의 index 0 하드코딩, `:86-90`의 MAIN find, `scripts/check-prearm-chunk.mjs:39`의 부분 문자열 매칭까지 4곳이 동시에 걸린다. `picker.ts`에 메시지 핸들러로 얹으면 이 축이 통째로 사라진다.

### 재현 환경에 `Device` 행 신설

기각(사용자 결정). 기존 `Viewport` 행에 디바이스 값을 오버라이트한다. 대가로 리포트를 받는 사람은 "1512 창에서 390으로 에뮬레이트"인지 "실제 390 기기"인지 구분하지 못하지만, 이 기능은 Web 디버깅 한정이므로 수용한다. 이 결정으로 재현 환경 빌더 3벌(`DraftingPanel.tsx:576-678`, `environmentRows.ts:34-58`, `buildReportData.ts:11-30`)과 `buildIssueMarkdown.ts`의 md/html/meta 3경로, `EditorSnapshot` 확장이 **전부 불필요**해진다.

### 래퍼를 cross-origin 문서에도 그대로 유지

기각. Chrome의 third-party storage partitioning(115+)으로 cross-site iframe의 localStorage·sessionStorage·IndexedDB가 top-level site 키로 파티션되고, SameSite=Lax(기본값) 쿠키가 실리지 않아 **로그아웃 상태의 다른 화면**이 뜬다. 그 화면을 캡처하면 재현 정보가 틀린다 — 리포트 도구로서 가장 하면 안 되는 실패다. 부수적으로 cross-origin 문서를 DOM 없이 추적하기 위한 계보 로직(잠정 등록 휴리스틱·`frameElement` null 분기·origin별 pre-arm 플래그 문제)이 전부 따라붙는다. handoff로 내보내면 이 축이 통째로 사라진다.

### 모드 상태를 `chrome.storage.session`에 영속

기각. 복원 경로(`useEditorSessionSync.ts:112-155`)가 페이지 DOM을 전혀 검증하지 않으므로, 탭 reload로 래퍼가 사라져도 "ON"이 살아남아 UI/DOM이 완전 desync된다. 반대로 `shouldPreserveSession`(`tab-bindings.ts:71-80`)은 `captureMode`/`phase`만 보므로 deactivate 분기에서 모드가 통째로 소실된다. 페이지 DOM을 단일 출처로 두면 두 문제가 동시에 없어진다.

## 위험 요소

1. **`getTopViewport`의 의미 변경이 캡처 5종에 동시 파급된다.** 시그니처는 그대로지만 반환값 의미가 "브라우저 뷰포트"에서 "캡처 대상 뷰포트"로 바뀐다. 주석을 반드시 갱신하고, 모드 OFF에서 값이 이전과 동일함을 유닛으로 고정한다. 영상·리플레이는 여기에 **새로 편입**되는 경로라 회귀 표면이 가장 넓다.
2. **프레임 id 문자열이 두 곳에 복제된다**(`device-frame.ts` 상수 / `getTopViewport`의 인라인 리터럴). 직렬화 제약상 불가피하므로 동기화 테스트를 반드시 붙인다. **상수를 import하면 typecheck·유닛이 전부 green인데 런타임에만 `ReferenceError`로 죽고, `picker-control.ts:820`의 `catch`가 그걸 삼켜 조용히 `null`로 폴백한다** — 이 기능에서 가장 탐지하기 어려운 회귀 축이다(`docs/ARCHITECTURE.md:465`가 "inject 경로 리팩터 시 실제 탭 수동 회귀 필수"라고 못박은 그 지점).
3. **래퍼와 top은 origin 필터에서 영원히 구분되지 않는다.** same-origin 불변식의 대가다(cross-origin 이동이 없으므로 "이동 뒤에는 갈린다"는 완화책도 없다). 실제 수집은 stop ACK로 1벌이 보장되지만 `e2e/logs-origin-filter.spec.ts:41-42`의 전제는 모드 ON에서 항상 합쳐진 상태다. 모드 OFF 기본이라 기존 spec은 green이다.
4. **`e2e/api-hosts-env-row.spec.ts:94-96`이 호스트 정렬 순서를 하드코딩한다.** 모드 ON에서 재로드로 요청 수가 2배가 되면 동률 호스트 정렬이 뒤집힐 수 있다(카운트 누적 `apiHostRow.ts:49`, 정렬 `:54-56`). 모드 OFF 기본이므로 기존 spec은 안전하지만 신규 spec에서 순서를 단언하지 않는다.
5. **iframe 프레임 프로토콜은 회귀 밀집 구간이다.** `docs/POSTMORTEM.md:371`이 "iframe picker·OAuth는 e2e 커버가 없는 영역 — 리포트 처방을 '유닛 green'을 근거로 적용하지 말 것"이라고 못박았다. 이 기능은 그 구간을 정면으로 지난다.
6. **`display: none`으로 숨긴 원본 문서의 타이머·폴링은 계속 돈다.** 레코더 stop이 로그는 막지만 CPU는 계속 쓴다. 재로드된 래퍼와 합쳐 리소스가 약 2배가 된다.
7. **`check:prearm`의 검출 한계.** `scripts/check-prearm-chunk.mjs:39`의 `includes("recorders-entry")` 부분 문자열 매칭이 새 파일 이름과 충돌하지 않는지 확인한다(`device-frame`은 충돌하지 않는다).
8. **top blocker의 pointerEvents 핸드오프가 래퍼에도 적용된다.** 래퍼가 `frame-geometry.ts` registry에 등록되므로 picker가 래퍼 위에서 핸드오프한다 — 이건 의도된 동작이지만, 등록 실패 시 래퍼 자체가 `iframeUnsupported`로 거부돼 **모드 ON에서 아무 요소도 못 고르는** 상태가 된다. 배선은 위 "래퍼 registry 등록" 절, e2e로 반드시 고정한다.
9. **래퍼와 top은 origin 필터에서 구분되지 않는다.** 전 document stop ACK 뒤 clear, 그다음 래퍼 서브트리만 start하므로 top 로그는 수집되지 않지만 필터 UI로는 못 가른다(위험 3과 같은 뿌리).
10. **sentinel 발행 게이트가 로그 격리의 단일 실패점이다.** 발행 경로 3개(activate 3종 / `rebroadcastSentinelsToFrame` / 전환)를 한 헬퍼로 좁혔으므로, 그 헬퍼를 우회하는 신규 발행 코드가 하나만 생겨도 숨겨진 top이 되살아나 로그가 2벌이 된다. 되살아난 로그는 **에러가 아니라 그냥 중복 엔트리**라 조용하다 — 유닛(게이트 통과 여부)과 e2e 시나리오 10·11 둘 다 필요하다.
11. **handoff는 사후 조치라 요청 1회를 되돌릴 수 없다.** `onBeforeNavigate`에서 잡으면 대부분 요청 전에 막지만, same-origin URL이 서버에서 cross-origin으로 302되는 경우는 `onCommitted` 폴백이라 목적지 요청이 이미 끝난 뒤다. POST 흐름은 재현 자체가 불가하다(prd 잔여 위험 4). 루프 가드가 없으면 리다이렉트 핑퐁 사이트에서 무한 재로드가 되므로 **연속 2회 + 직전 URL 재방문** 두 축을 모두 센다.
12. **`pending`이 인메모리 상태라 코드 리뷰에서 "원칙 위반"으로 보인다.** 개요의 "상태를 어디에 두지 않을 것인가"와 표면상 충돌하므로, 영속하지 않고·매 커밋마다 re-mount로 조정되며·차단 시 롤백된다는 세 조건을 주석으로 남긴다. 이 조건이 깨지면 기각했던 desync가 되살아난다.
13. **arm 창의 잠정 래퍼 추측은 휴리스틱이다.** `parentFrameId === 0 && url === top URL`인 첫 자식 커밋을 잡으므로, 감시창 3초 안에 페이지가 스스로 자기 URL을 iframe으로 여는 사이트라면 오탐할 수 있다. 창을 `device.set` 전후 3초로 좁힌 것과 `device.frameReady`가 오면 즉시 확정으로 승격하는 것이 완화책이고, 오탐 시 증상은 "래퍼가 아닌 프레임을 top처럼 취급"이라 로그 경계가 과하게 도는 쪽(안전 방향)이다.
14. **`ensureMainWorldRecorders`(`picker-control.ts:85-101`)는 `allFrames`가 없어 top만 재주입한다**(`ensureRecorderBridge`는 `allFrames: true`). 래퍼에는 MAIN world 레코더의 **자가복구 경로가 없고** 정적 content_scripts 주입 + pre-arm 플래그에만 의존한다. 실동작은 하지만 복구 그물이 한 겹 얇다. `allFrames: true`로 넓히는 것은 모드 OFF에서도 전 프레임 재주입이 되는 범위 외 회귀라 1차에서 하지 않는다.
