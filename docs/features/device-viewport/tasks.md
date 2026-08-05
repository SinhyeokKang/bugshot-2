# 디바이스 뷰포트 — 구현 태스크

## 선행 조건

- **신규 권한 0.** `<all_urls>` content_scripts + `scripting`으로 전부 커버된다. `manifest.config.ts`를 건드리지 않는다.
- **신규 env 0.** 외부 요청 0.
- **신규 의존성 0.** `ToggleGroup`이 `src/components/ui/`에 없으면 `npx shadcn@latest add toggle-group`으로 추가한다(직접 스타일링 금지).
- 착수 전 `docs/POSTMORTEM.md`를 `iframe`·`frameId`·`pre-arm`·`캡처 타이밍`으로 grep해 과거 함정을 소환한다. 이 기능은 회귀 밀집 구간 3개를 전부 스친다.
- `docs/ARCHITECTURE.md`의 "등록 핸드셰이크"·"캡처 3축" 절을 읽는다.

---

## 태스크

### Task 1: 프리셋 상수와 가용 폭 판정 (순수)

- **변경 대상**: `src/sidepanel/lib/device-presets.ts` (신규), `src/sidepanel/lib/__tests__/device-presets.test.ts` (신규)
- **작업 내용**: `DEVICE_PRESETS`(390/430/768/1024) + `isPresetAvailable(width, availableWidth)`. 테스트를 먼저 쓴다.
- **검증**:
  - [ ] `isPresetAvailable(390, 865) === true`
  - [ ] `isPresetAvailable(1024, 865) === false`
  - [ ] `isPresetAvailable(1024, 1024) === true` (경계 포함)
  - [ ] `isPresetAvailable(1024, null) === true` (미조회는 낙관적)
  - [ ] `pnpm test src/sidepanel/lib/__tests__/device-presets.test.ts` green

### Task 2: 래퍼 DOM 모듈

- **변경 대상**: `src/content/device-frame.ts` (신규), `src/content/__tests__/device-frame.test.ts` (신규, jsdom)
- **작업 내용**: `DEVICE_FRAME_ID`·`DEVICE_STYLE_ID` 상수, `currentDeviceWidth`·`deviceFrameRect`·`availableViewport`·`mountDeviceFrame`·`unmountDeviceFrame`. 은닉은 스타일시트 한 장(design.md 참조). 래퍼는 `document.body` 직속, `src = location.href`.
- **검증**:
  - [ ] `mountDeviceFrame(390)` 후 `document.getElementById(DEVICE_FRAME_ID)`가 `document.body`의 직속 자식이다
  - [ ] 래퍼의 `src`가 `location.href`다 (`srcdoc`·`about:blank`가 아니다)
  - [ ] `unmountDeviceFrame()` 후 `<style>`·iframe이 둘 다 제거되고, 원본 요소의 인라인 `style` 속성이 mount 이전과 **바이트 단위로 동일**하다
  - [ ] `unmountDeviceFrame()`을 2회 호출해도 throw하지 않는다 (멱등)
  - [ ] 래퍼가 있는 상태에서 `mountDeviceFrame(768)`을 호출하면 iframe 노드가 교체되지 않고 폭만 바뀐다
  - [ ] `currentDeviceWidth()`가 mount 전 `null`, mount 후 `390`

> 로드 검증(XFO/CSP)은 jsdom에서 재현 불가 — Task 15의 e2e가 유일한 그물이다.

### Task 3: 메시지 타입과 picker 핸들러

- **변경 대상**: `src/types/picker.ts`, `src/content/picker.ts`
- **작업 내용**: `device.set`·`device.state`·`device.watch` 수신 3종과 `device.availableChanged`·`device.frameReady` 발신 2종을 `PickerMessage`에 추가. `picker.ts:204`의 `handlePickerMessage` switch에 케이스를 얹되 **모두 `window === window.top` 게이트**를 건다(picker는 `all_frames`라 래퍼 안에서도 돈다). `device.watch`는 top의 `resize` 리스너를 켜고 끈다. 별도로 초기화 시점에 `window.frameElement?.id === DEVICE_FRAME_ID`면 `postToRuntime({ type: "device.frameReady" })`.
- **검증**:
  - [ ] `pnpm typecheck` green (union 누락 없음)
  - [ ] `device.set`이 `sendResponse` 비동기 응답을 위해 `return true`한다
  - [ ] 래퍼 프레임에서 `device.set`을 받아도 아무것도 하지 않는다

### Task 4: `getTopViewport`를 래퍼 인식으로 교체

- **변경 대상**: `src/sidepanel/picker-control.ts:809-824`, `src/sidepanel/__tests__/` 동기화 테스트
- **작업 내용**: 주입 `func`이 `document.getElementById("__bugshot_device_frame__")`를 먼저 보고, 있으면 `clientWidth/clientHeight`를 반환. 프레임 id는 **인라인 리터럴**이어야 한다(클로저가 안 살아남는다). 함수 주석을 "브라우저 뷰포트" → "캡처 대상 뷰포트"로 갱신.
- **검증**:
  - [ ] 인라인 리터럴이 `device-frame.ts`의 `DEVICE_FRAME_ID`와 같음을 단언하는 테스트가 있다 (`func.toString()`에 상수가 포함되는지)
  - [ ] 주입 함수가 self-contained다 — 외부 변수를 참조하지 않는다
  - [ ] 모드 OFF에서 반환값이 이전과 동일 (`window.innerWidth/innerHeight`)

### Task 5: 프레임 지정 레코더 정지

- **변경 대상**: `src/sidepanel/recorder-control.ts`, `src/sidepanel/picker-control.ts`
- **작업 내용**: `stopRecordersInFrame(tabId, frameId)` 신설(`chrome.tabs.sendMessage(tabId, msg, { frameId })`). `picker-control`에 모듈 레벨 `deviceModeTabs: Set<number>`를 두고, `activateNetworkRecorder`·`activateConsoleRecorder`·`activateActionRecorder` 3종이 `sendAll` broadcast 직후 해당 탭이 모드 ON이면 frameId 0을 다시 stop한다.
- **검증**:
  - [ ] 기존 `clearNetworkRecorder` 3종의 시그니처·동작이 무변경이다
  - [ ] `stopRecordersInFrame`이 3종 메시지를 모두 보내고, 실패를 삼킨다(탭 닫힘 케이스)
  - [ ] 모드 OFF에서 activate 3종의 동작이 무변경이다

### Task 6: 전환 오케스트레이션 훅

- **변경 대상**: `src/sidepanel/hooks/useDeviceViewport.ts` (신규)
- **작업 내용**: design.md의 `select()` 7단계를 그대로 구현. 마운트 시 `device.state` 조회, `device.availableChanged` 구독. 최초 1회 경고 플래그는 `settings-ui-store`에 `deviceReloadWarned: boolean`.
- **검증**:
  - [ ] `locked`가 `phase !== "idle" || unsupported`로 파생된다
  - [ ] `select()`가 `syncAndSettleLogs` → store clear 3종 → `device.set` 순서를 지킨다 (순서가 바뀌면 떠나는 로그 꼬리를 잃는다)
  - [ ] `ok === false` 응답에서 상태가 `전체`로 되돌아가고 토스트가 뜬다
  - [ ] 언마운트 시 `device.watch { on: false }`를 보낸다

### Task 7: 세그먼티드 컨트롤 UI

- **변경 대상**: `src/sidepanel/components/DeviceViewportBar.tsx` (신규), `src/sidepanel/components/__tests__/DeviceViewportBar.test.tsx` (신규, jsdom)
- **작업 내용**: shadcn `ToggleGroup type="single"`, `grid grid-cols-5 h-9 rounded-lg bg-muted p-1`. 첫 세그먼트 라벨 `전체`/`Full`. 초과·잠금은 `aria-disabled`(never `disabled` — 툴팁이 죽는다). `data-testid`: 행 `device-viewport-bar`, 세그먼트 `device-preset-full`·`device-preset-390`·….
- **검증**:
  - [ ] `availableWidth=865`에서 `device-preset-1024`가 `aria-disabled="true"`, 나머지는 아니다
  - [ ] `availableWidth`가 865→1200으로 바뀌면 재렌더 없이 `1024`가 활성화된다
  - [ ] `locked=true`에서 모든 세그먼트가 `aria-disabled`다
  - [ ] `aria-disabled` 세그먼트를 클릭해도 `select`가 호출되지 않는다
  - [ ] `tabId=null`이면 `null`을 반환한다

### Task 8: DebugTab 배선

- **변경 대상**: `src/sidepanel/tabs/DebugTab.tsx:73-92`
- **작업 내용**: 서브탭 바 `<div>` 다음, `<TabsContent>` 앞에 `sub === "issue" && !hideSubTabs && !unsupported`일 때만 `<DeviceViewportBar tabId={tabId} />` 행을 렌더.
- **검증**:
  - [ ] 콘솔·네트워크 서브탭으로 이동하면 행이 사라진다
  - [ ] `phase`가 drafting이면 행이 사라진다 (`hideSubTabs`와 동일 조건)
  - [ ] 미지원 탭에서 행이 렌더되지 않는다
  - [ ] `pnpm test e2e` 아님 — 이 단계는 `IssueTab.test.tsx`/`DebugTab` 렌더 테스트로 확인

### Task 9: 화면(뷰포트) 캡처 rect 보정

- **변경 대상**: `src/content/area-select.ts:114`, `src/content/__tests__/`
- **작업 내용**: `selectFullViewport`의 rect를 `deviceFrameRect() ?? { x:0, y:0, width: innerWidth, height: innerHeight }`로. **`viewport`(두 번째 인자)는 top 그대로 둔다** — 크롭 배율 기준이라 바꾸면 크롭이 깨진다.
- **검증**:
  - [ ] 모드 OFF에서 rect가 `{0,0,innerWidth,innerHeight}`로 이전과 동일
  - [ ] 모드 ON에서 rect가 래퍼의 `getBoundingClientRect()`와 일치
  - [ ] `onSelected`에 넘기는 `viewport`가 두 경우 모두 `{innerWidth, innerHeight}`

### Task 10: 크롭 배율 viewport와 메타 viewport 분리

- **변경 대상**: `src/sidepanel/capture.ts`, `src/sidepanel/hooks/usePickerMessages.ts:206-223`
- **작업 내용**: `captureAndCrop(rect, cropViewport, metaViewport)`로 인자 추가. `picker.areaSelected` 수신부가 `metaViewport = await getTopViewport(tabId)`를 넘긴다. `captureAndInsertInline`도 동일 판단이 필요한지 확인 — 인라인 이미지는 본문 삽입용이라 메타를 안 쓰면 무변경.
- **검증**:
  - [ ] `cropImage`의 스케일 계산이 `cropViewport`를 쓴다 (`img.naturalWidth / cropViewport.width`)
  - [ ] `onAreaCaptured`에 넘어가는 값이 `metaViewport`다
  - [ ] 모드 OFF에서 두 값이 같아 결과가 이전과 동일함을 유닛으로 고정
  - [ ] `getTopViewport`가 null을 반환하면 `cropViewport`로 폴백

### Task 11: 페이지 전체 캡처 잠금

- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx:552-563`
- **작업 내용**: `capture-method-fullpage`에 `ariaDisabled={busy || deviceMode}`. 모드 ON이면 툴팁 문구를 `issue.capturing.method.fullPageDeviceLocked`로 교체하고 `onFullPage`를 조기 반환.
- **검증**:
  - [ ] 모드 ON에서 버튼이 `aria-disabled="true"`다
  - [ ] 모드 ON에서 클릭해도 `runScrollCapture`가 호출되지 않는다 (**"조용한 1타일"이 절대 발생하지 않는다** — 이 항목이 이 태스크의 존재 이유다)
  - [ ] 모드 OFF에서 동작·툴팁이 이전과 동일

### Task 12: 래퍼 frameId를 top처럼 취급

- **변경 대상**: `src/background/tab-bindings.ts`, `src/background/index.ts:123`·`:145-163`, `src/types/messages.ts`
- **작업 내용**: `deviceFrameByTab: Map<number, number>` + `setDeviceFrame`·`isTopLikeFrame`. `device.frameReady` 수신 시 `sender.frameId`로 등록, `onCommitted(frameId: 0)`과 `device.set { width: null }` 성공 시 해제. `onBeforeNavigate`의 `if (details.frameId !== 0) return`과 `onCommitted`의 frameId≠0 early return을 `isTopLikeFrame(tabId, frameId)`으로 교체.
- **검증**:
  - [ ] 모드 OFF에서 Map이 비어 있어 `isTopLikeFrame`이 `frameId === 0`과 동치다 (기존 동작 100% 보존)
  - [ ] 래퍼 안에서 cross-origin 이동 시 3종 `sync`가 발화한다
  - [ ] 래퍼 안에서 reload 시 `logClear`가 발화한다
  - [ ] top 탭이 다른 URL로 이동하면 Map 엔트리가 지워진다
  - [ ] 일반 iframe(래퍼 아님)에서는 여전히 early return한다 — **`frameCommitted` 재발행 경로가 안 깨져야 한다**

### Task 13: 2-depth 안내 문구 분기

- **변경 대상**: `src/sidepanel/App.tsx:362-372`
- **작업 내용**: `useDeviceViewport(tabId).width != null`이면 body를 `app.iframeUnsupported.bodyDeviceMode`로 교체. content script 프로토콜·`messages.ts`의 `fire()` 변경 없음.
- **검증**:
  - [ ] 모드 OFF에서 다이얼로그 문구가 이전과 동일
  - [ ] 모드 ON에서 "디바이스 모드를 끄면 선택할 수 있습니다" 취지의 문구로 바뀐다
  - [ ] `data-testid="iframe-unsupported-dialog"`가 유지된다 (`e2e/picker-guard.spec.ts` 의존)

### Task 14: i18n

- **변경 대상**: `src/i18n/namespaces/app.ts`, `src/i18n/namespaces/issue.ts`
- **작업 내용**: ko/en 동시 추가.
  - `issue.device.full` / `issue.device.w390`~`w1024`
  - `issue.device.tooltip.tooNarrow` (창이 좁아 사용 불가)
  - `issue.device.tooltip.locked` (캡처·작성 중 전환 불가)
  - `issue.device.reloadWarning.title` / `.body` / `.dontAskAgain`
  - `issue.device.blocked` (XFO 롤백 토스트)
  - `issue.capturing.method.fullPageDeviceLocked`
  - `app.iframeUnsupported.bodyDeviceMode`
- **검증**:
  - [ ] 저장 시 PostToolUse 훅이 `src/i18n/__tests__/locales.test.ts`를 자동 실행해 통과 (ko/en 키 대칭·빈 값·placeholder 일치)
  - [ ] `src/log-viewer/i18n.ts`는 무변경 — 이 키들을 log-viewer가 안 쓴다

### Task 15: e2e

- **변경 대상**: `e2e/device-viewport.spec.ts` (신규), 필요 시 `e2e/fixtures/`에 XFO 응답 픽스처
- **작업 내용**: 아래 "테스트 계획"의 e2e 시나리오를 spec으로. `/e2e-write`가 green까지 자기완결.
- **검증**: `pnpm build:e2e && pnpm test:e2e` green

### Task 16: 문서

- **변경 대상**: `docs/privacy.ko.md`·`docs/privacy.en.md`, `docs/PERMISSION.md`, `CLAUDE.md`, `docs/DIRECTORY.md`, `docs/ARCHITECTURE.md`
- **작업 내용**:
  - **privacy ko/en 양쪽 본문 + 상단 시행일** — manifest diff가 0이어도 필수. 새 관측 동작 5개(같은 URL 재로드·쿠키 재전송·원본 문서 은닉·프레임 단위 로그 수집 대상 변경·에뮬레이트 화면 캡처). 대상 절: `### 페이지 데이터 및 디버그 정보` 표(창 크기 행·스크린샷 행), iframe 로그 수집, iframe 요소 선택, `### 광역 호스트 권한 사용처`
  - `docs/PERMISSION.md` §12 표에 `scripting`/`<all_urls>` 새 사용처 1행
  - `CLAUDE.md` "스택"에 디바이스 뷰포트 1항목, "게이트웨이"에 모드 ON 제약
  - `docs/DIRECTORY.md`에 신규 파일 4개
  - `docs/ARCHITECTURE.md`에 "디바이스 뷰포트" 절 — 단일 출처가 페이지 DOM인 이유, `srcdoc` 금지, shadow root 금지, 크롭/메타 viewport 분리
- **검증**:
  - [ ] privacy ko/en이 같은 줄 수·같은 절 구성으로 유지된다
  - [ ] `pnpm sync:agents:check` green (`CLAUDE.md` 편집 시 훅이 자동 sync하지만 최종 확인)

---

## 테스트 계획

### 단위 테스트

| 대상 | 케이스 |
|---|---|
| `device-presets.ts` | 가용 폭 경계(초과/딱맞음/미달), `null` 낙관적 판정 |
| `device-frame.ts` (jsdom) | mount/unmount 왕복 무손실, 멱등, 폭 갱신 시 노드 유지, `src === location.href`, body 직속 |
| `picker-control.ts` | 주입 `func`의 프레임 id 리터럴 ↔ `DEVICE_FRAME_ID` 동기화, self-contained(외부 참조 0) |
| `capture.ts` | `cropViewport ≠ metaViewport`일 때 크롭은 `cropViewport`, 메타는 `metaViewport` |
| `area-select.ts` | 래퍼 유/무에 따른 rect 분기, `viewport`는 항상 top |
| `DeviceViewportBar.tsx` (jsdom) | 초과 비활성, 잠금, `aria-disabled` 클릭 무시, `tabId=null` 미렌더 |
| `tab-bindings.ts` | `isTopLikeFrame`이 Map 비었을 때 `frameId === 0`과 동치 |

### e2e 시나리오

`/e2e-write`의 입력이다.

**모드 게이팅 (최우선)**
1. 뷰포트 행 기본 선택이 `전체`이면 페이지 DOM에 `#__bugshot_device_frame__`가 없다.
2. 기존 e2e 전 스위트가 무변경으로 green이다 — 특히 `capture-modes-layout.spec.ts`의 idle 버튼 정확 집합 단언.

**전환**
3. `390` 세그먼트를 누르면 페이지에 `#__bugshot_device_frame__`가 생기고 그 iframe 안의 `window.innerWidth`가 `390`이다.
4. `390` 선택 후 페이지 안에서 `matchMedia("(max-width: 767px)").matches`가 `true`다.
5. `390` 선택 후 원본 `body` 자식이 `display: none`이고 iframe만 보인다.
6. `전체`로 되돌리면 `#__bugshot_device_frame__`와 `#__bugshot_device_style__`가 둘 다 없어지고 원본이 복원된다.
7. 재로드 경고 다이얼로그가 최초 1회만 뜨고, [다시 보지 않기] 이후에는 안 뜬다.

**가용 폭**
8. 창을 좁혀 가용 폭을 1024 미만으로 만들면 `device-preset-1024`가 `aria-disabled`가 된다.
9. 다시 넓히면 사용자 조작 없이 `aria-disabled`가 풀린다.

**로그**
10. 모드 ON에서 페이지가 `console.log`를 1회 호출하면 콘솔 로그 탭에 **1건**만 쌓인다(2벌 아님).
11. 모드 ON에서 네트워크 요청 1건이 네트워크 로그 탭에 1건만 쌓인다.
12. 모드 전환 직후 이전 페이지의 로그가 남아 있지 않다.
13. 래퍼 안에서 cross-origin 링크로 이동하면 로그가 초기화된다(top 이동과 동일).

**캡처**
14. 모드 ON에서 `capture-method-fullpage`가 `aria-disabled`이고, 클릭해도 캡처가 시작되지 않는다.
15. 모드 ON에서 화면(뷰포트) 캡처를 하면 결과 이미지의 가로세로비가 래퍼 rect의 비와 일치한다(좌우 여백이 안 들어간다).
16. 모드 ON에서 요소를 선택해 캡처한 이슈의 재현 환경 `Viewport` 행이 `390×<창높이>`다.
17. 모드 OFF에서 같은 캡처의 `Viewport` 행이 브라우저 실제 폭이다.

**picker**
18. 모드 ON에서 래퍼 안의 요소를 정상적으로 선택할 수 있다 (래퍼가 registry에 등록돼 blocker 핸드오프가 열린다 — **이게 깨지면 모드 ON에서 아무것도 못 고른다**).
19. 모드 ON에서 래퍼 안의 iframe(2-depth)을 클릭하면 `iframe-unsupported-dialog`가 뜨고 문구가 디바이스 모드 전용이다.

**실패 경로**
20. `X-Frame-Options: DENY`를 주는 픽스처 페이지에서 `390`을 누르면 3초 안에 원본이 복원되고 세그먼트가 `전체`로 돌아간다.

**잠금**
21. `phase`가 capturing/drafting/recording일 때 세그먼트 전체가 `aria-disabled`다.
22. 미지원 탭(`chrome://`)에서 `device-viewport-bar`가 렌더되지 않는다.

### 수동 테스트 (자동화 불가)

Chrome에서 `pnpm build` 후 dist를 로드해 확인한다.

- [ ] 실제 반응형 사이트(예: 문서 사이트)에서 `390`↔`768`↔`전체` 전환이 시각적으로 매끄러운가
- [ ] 래퍼 좌우 여백 배경색이 라이트/다크 모드 양쪽에서 어색하지 않은가
- [ ] 모드 ON에서 탭 녹화 영상에 여백이 포함되는 정도가 리포트 품질을 해치지 않는가
- [ ] 모드 ON에서 30s Replay 프레임이 정상 인코딩되는가
- [ ] 로그인이 필요한 사이트에서 모드 진입 후 세션이 유지되는가 (쿠키·`sessionStorage` 보존 확인)
- [ ] SPA(라우터 기반)에서 래퍼 내부 라우팅 시 로그가 의도대로 동작하는가
- [ ] `position: fixed` 헤더가 있는 사이트에서 래퍼 안 fixed가 정상인가

---

## 구현 순서 권장

```
Task 1 ─┐
Task 2 ─┼─▶ Task 3 ─▶ Task 6 ─▶ Task 7 ─▶ Task 8   (모드 ON/OFF 동작)
Task 14 ┘        │
                 ├─▶ Task 4 ─▶ Task 10 ─▶ Task 16 (Viewport 메타)
                 ├─▶ Task 5                        (로그 2벌)
                 ├─▶ Task 9                        (화면 캡처 rect)
                 ├─▶ Task 11                       (전체 캡처 잠금)
                 ├─▶ Task 12                       (네비게이션 동등화)
                 └─▶ Task 13                       (2-depth 문구)
                                    ↓
                                 Task 15 (e2e) ─▶ Task 16 (문서)
```

- **Task 1·2·14는 병렬 가능** — 서로 의존 없음.
- **Task 3이 병목**이다. 메시지 타입이 확정돼야 사이드패널 쪽(4~13)이 전부 붙는다.
- **Task 4~13은 Task 3 이후 서로 독립**이라 병렬 가능하다. 단 Task 10은 Task 4에 의존한다.
- **Task 11(전체 캡처 잠금)을 늦추지 말 것.** 이걸 마지막에 하면 그 사이 개발·수동 검증에서 "조용한 1타일"을 정상 결과로 오인하게 된다.
- **Task 15는 반드시 Task 4~13 완료 후.** 부분 구현 상태에서 e2e를 쓰면 시나리오 3·10·16이 서로 다른 이유로 red가 나 원인 분리가 안 된다.
- 각 태스크 종료마다 `pnpm typecheck` + `pnpm test`. `pnpm build`는 사용자 요청 시에만.

## 가이드 영향

사용자 노출 기능이므로 갱신이 필요하다. 작성 전 `guide/AUTHORING.md`를 읽고, 구현 후 `/guide`로 처리한다.

- `guide/ko/element/…`·`guide/en/element/…` — 신규 페이지 "디바이스 뷰포트로 반응형 검증하기". IA상 캡처 계열 문서군에 붙인다.
  - 반드시 포함: **에뮬레이트되는 것(폭·미디어쿼리·`fixed`)과 안 되는 것(DPR·터치·UA)** 을 표로 명시. 없는 것을 있다고 말하면 리포트가 틀린다.
  - 모드 진입 시 페이지가 재로드된다는 것, 되돌릴 수 없는 화면에서 주의할 것
  - 모드 ON 동안의 알려진 제약: 페이지 내 iframe 요소 선택 불가, 페이지 전체 캡처 잠김
- 기존 캡처 가이드에서 "페이지 전체 캡처"를 설명하는 페이지에 잠금 조건 1줄 추가.
- 플랫폼 표·지원 플랫폼에는 변화가 없으므로 `guide/AUTHORING.md` 자체는 무변경.
