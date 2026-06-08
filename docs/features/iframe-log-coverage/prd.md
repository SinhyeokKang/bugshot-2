# iframe 로그 커버리지 확장

## 배경

BugShot의 console/network/action 레코더는 `recorders-entry.ts`(MAIN world, `document_start`)와 로그 브리지(`picker.ts` 내, ISOLATED world)로 동작한다. 두 content script 모두 manifest에서 `all_frames`를 지정하지 않아 기본값 `false` — **top frame에서만 주입**된다.

결과로 iframe 내부에서 발생하는 로그를 **하나도 캡처하지 못한다**. 특히 cross-origin iframe(Stripe 결제, 임베드 위젯, 서드파티 SDK)에서 나는 console 에러·network 실패는 버그 재현에 핵심인데 전부 누락된다. 사용자가 "결제 버튼이 안 돼요" 같은 버그를 리포트해도 그 원인이 결제 iframe 안의 네트워크 실패면 로그에 흔적이 안 남는다.

경쟁 확장 Jam(5.64.1)은 `webNavigation.onCommitted` 기반으로 프레임마다 MAIN world 후크를 주입해 cross-origin iframe까지 커버한다. BugShot은 이미 동일한 MAIN world 후킹 아키텍처(안)를 top frame에 대해 완성해 두었으므로, 주입 범위만 모든 프레임으로 넓히면 격차를 메울 수 있다.

## 목표

- console/network/action 레코더를 **모든 프레임(cross-origin iframe 포함)** 의 MAIN world에 주입한다.
- **캡처 시작 이후 생성된 iframe**(동적 결제 위젯·lazy-load)도 `webNavigation.onCommitted`(iframe) sentinel 재발행으로 활성화한다.
- 각 프레임에서 캡처된 로그를 기존 `mergeLogItems`(id dedup + 시간정렬) 경로로 **하나의 단일 타임라인에 병합**한다.
- **origin별 cap 격리(top-page-origin 우선 보존)** — **console/network만**: 광고/트래커 cross-origin iframe이 통합 `MAX_ENTRIES`를 채워도 캡처 대상 페이지(top) origin 로그가 FIFO에 밀려나지 않게 한다. action은 광고가 폭증시키지 않아 제외(순수 시간축 FIFO 유지).
- **origin별 필터** — **console/network만**: 로그 탭(`ConsoleLogContent`/`NetworkLogContent`)에 origin 필터를 추가한다. 이 컴포넌트는 **사이드패널 서브탭·로그 다이얼로그·log-viewer 셋이 공유**하므로 한 번 추가로 세 곳에 공통 적용된다. action은 시간순 재현 흐름이 본질이라 제외(origin 전환은 `navigation` 액션으로 간접 파악).
- 식별 키는 **frameId가 아니라 origin**이다 — 사용자는 "프레임 N"이 아니라 "stripe.com / doubleclick.net" 단위로 인식하고, origin은 기존 `pageUrl`에서 `originOf()`로 파생되므로 **데이터 모델 변경이 0**이다.
- 요소 선택(picker) 기능은 **top frame 동작을 그대로 유지**한다 — 이번 변경으로 picker가 iframe에 진입하지 않는다.
- manifest **권한 추가는 0**이다 (`<all_urls>`는 이미 content_scripts matches에 존재하고, `all_frames`는 권한이 아닌 주입 범위 플래그).
- sentinel 활성화 모델을 유지해 **상시 캡처 비용을 만들지 않는다** (레코더는 프레임마다 미리 주입되지만 녹화 트리거 전에는 dormant).

## 비목표 (Non-goals)

- **frameId 기반 식별·필터 미채택**: 식별/필터/cap을 frameId가 아닌 origin으로 한다. 같은 origin의 여러 iframe은 하나로 묶이며(광고망 일괄 차단에 유리), top frame과 same-origin iframe을 구분하지 않는다(자사 iframe은 noise가 아니라 격리 불필요).
- **데이터 모델에 새 필드 추가 안 함**: origin은 기존 `pageUrl`에서 `originOf()`로 런타임 파생하므로 entry 타입(`ConsoleEntry`/`NetworkRequest`/`ActionEntry`)을 변경하지 않는다. 단일 타임라인 병합에는 기존 `id`(프레임마다 `crypto.randomUUID`라 충돌 없음)만으로 충분하다.
- **origin 인라인 배지 미추가**: 개별 로그 항목에 도메인 배지를 상시 표시하지는 않는다(필터로 출처 구분). Console의 기존 `pageUrl` 링크는 유지.
- **프레임별 세밀 cap 미채택**: cap 격리는 "top-origin 우선 보존"까지만 한다. 광고 iframe끼리 공평 분배(프레임/origin별 균등 cap)는 needs가 없어 하지 않는다.
- **action-log origin cap·필터 미제공**: action은 시간순 재현 흐름이 본질이고 광고가 폭증시키지 않으므로, origin cap·필터를 적용하지 않고 기존 순수 시간축 FIFO·필터를 유지한다. origin 전환은 `navigation` 액션으로 간접 파악.
- **picker의 iframe 요소 선택 미지원**: iframe 내부 DOM 요소를 picker로 고르는 기능은 추가하지 않는다. `onPickerIframeUnsupported` 안내 로직은 그대로 둔다.
- **DevTools 수준 정확도 미달성**: monkey-patch의 구조적 한계(네이티브 콘솔 CORS/CSP 메시지, 비-fetch 네트워크 img/css/script/ws, 명시적 `console.error/warn` — 의도적 비-wrap)는 이번 범위 밖이다. 그 수준은 `chrome.debugger`(CDP) 기반의 별도 과제다.

## 사용자 시나리오

1. 사용자가 Stripe 결제 iframe이 포함된 페이지에서 버그를 만난다.
2. BugShot 사이드패널에서 screenshot/freeform/video 캡처 모드로 진입한다(기존 로그 정책 매트릭스: element 모드는 로그 미수집).
3. 레코더가 활성화되면(sentinel 발행) **캡처 시작 시점에 존재하는 top frame과 모든 iframe**(이미 떠 있는 결제 iframe 포함)의 MAIN world 레코더가 동시에 활성화된다.
4. 사용자가 결제 버튼을 눌러 **결제 iframe이 동적으로 새로 생성**되면, `webNavigation.onCommitted`(iframe) 보강이 그 프레임에 sentinel을 재발행해 레코더를 활성화한다 → 캡처 시작 이후 뜬 iframe도 커버된다.
5. 결제 iframe 안에서 발생한 fetch 실패(예: 402)·console 에러가 캡처되어, top frame 로그와 **시간순으로 병합된 단일 타임라인**에 나타난다.
6. 사용자가 이슈를 등록하면 iframe 로그를 포함한 전체 로그가 첨부된다.

7. 광고/트래커 iframe이 많은 페이지에서는, 로그 탭의 **origin 필터로 광고 도메인을 끄고** top·결제 origin만 본다. cap은 top-origin을 우선 보존하므로 광고 폭증에도 본문 핵심 로그가 남는다.

**엣지 케이스**
- 광고/트래커 iframe이 많은 페이지: 모든 프레임 로그가 단일 타임라인에 섞이지만, **top-origin 우선 cap**으로 본문 로그가 보존되고 **origin 필터**로 noise를 끌 수 있다. opaque origin(sandboxed)·`about:blank`는 필터 목록에서 "(unknown)"으로 묶거나 제외.
- **동적/지연 생성 iframe**(클릭 후 생성되는 결제 iframe, lazy-load 광고): `onCommitted`(iframe) 재발행으로 커버. 재발행이 실패하거나 매우 빠른 생성·파괴 시엔 일부 미커버 가능.
- iframe이 자체 네비게이션: 해당 프레임 MAIN world가 파괴되기 직전 `pagehide`로 버퍼를 flush한다. **단 iframe 네비는 `onBeforeNavigate` sync(`frameId !== 0` 제외)를 안 타므로 `pagehide` flush 단독 의존** → top frame보다 꼬리 유실 확률이 높다(`log-tail-reliability` 병행 시 완화).
- top frame 페이지 이동(cross-origin/reload): 기존 `shouldClearLogs`로 사이드패널 로그를 초기화한다. iframe 네비게이션은 `frameId !== 0` 필터로 초기화를 트리거하지 않는다(현행 유지).
- sandboxed iframe(`sandbox`에 `allow-scripts` 없음)·`about:blank`·`srcdoc`: content script 주입이 안 되거나 후크가 안 걸려 **조용히 미수집**된다(에러 없이). 의도된 한계.

## 성공 기준

- **정적 임베드 iframe**(YouTube/Google Maps embed 등, 페이지 로드 시 존재) 캡처 시 iframe 내부의 console·network 로그가 사이드패널 로그에 나타난다. (1차 검증 — 재현 용이)
- **동적 생성 iframe**(클릭 후 생성되는 Stripe Checkout 등) 캡처 시에도 `onCommitted` 재발행으로 로그가 나타난다. (2차 검증 — known limitation 분리 확인)
- top frame 로그와 iframe 로그가 시간순 단일 타임라인으로 정렬된다.
- **광고/트래커 iframe이 다수인 페이지에서 캡처해도 top-origin 핵심 로그가 `MAX_ENTRIES` FIFO에 밀려 유실되지 않는다**(top-origin 우선 보존 cap 동작 확인).
- **origin 필터(console/network)**: 로그 탭에서 origin을 선택하면 해당 origin 로그만 보인다. distinct origin 목록이 실제 캡처된 프레임 origin과 일치한다. **action 탭은 origin 필터 없이 기존 그대로**.
- **세 곳 동시 적용**: 사이드패널 서브탭·로그 다이얼로그·log-viewer 셋 다 동일한 origin 필터가 동작한다(공유 컴포넌트라 자동).
- 요소 선택(picker)을 실행해도 top frame에서만 동작하며 iframe 진입·중복 오버레이가 없다.
- manifest의 `permissions`·`host_permissions`·`optional_host_permissions` diff가 0이다.
- 서드파티 iframe(결제·임베드 위젯)이 레코더 주입 후에도 정상 동작한다(fetch/XHR 간섭으로 깨지지 않음).
- 기존 top-frame-only 로그 동작·30s replay trim·세션 영속화에 회귀가 없다.
