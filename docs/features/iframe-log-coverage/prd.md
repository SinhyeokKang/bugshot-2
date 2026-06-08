# iframe 로그 커버리지 확장

## 배경

BugShot의 console/network/action 레코더는 `recorders-entry.ts`(MAIN world, `document_start`)와 로그 브리지(`picker.ts` 내, ISOLATED world)로 동작한다. 두 content script 모두 manifest에서 `all_frames`를 지정하지 않아 기본값 `false` — **top frame에서만 주입**된다.

결과로 iframe 내부에서 발생하는 로그를 **하나도 캡처하지 못한다**. 특히 cross-origin iframe(Stripe 결제, 임베드 위젯, 서드파티 SDK)에서 나는 console 에러·network 실패는 버그 재현에 핵심인데 전부 누락된다. 사용자가 "결제 버튼이 안 돼요" 같은 버그를 리포트해도 그 원인이 결제 iframe 안의 네트워크 실패면 로그에 흔적이 안 남는다.

경쟁 확장 Jam(5.64.1)은 `webNavigation.onCommitted` 기반으로 프레임마다 MAIN world 후크를 주입해 cross-origin iframe까지 커버한다. BugShot은 이미 동일한 MAIN world 후킹 아키텍처(안)를 top frame에 대해 완성해 두었으므로, 주입 범위만 모든 프레임으로 넓히면 격차를 메울 수 있다.

## 목표

- console/network/action 레코더를 **모든 프레임(cross-origin iframe 포함)** 의 MAIN world에 주입한다.
- 각 프레임에서 캡처된 로그를 기존 `mergeLogItems`(id dedup + 시간정렬) 경로로 **하나의 단일 타임라인에 병합**한다.
- 요소 선택(picker) 기능은 **top frame 동작을 그대로 유지**한다 — 이번 변경으로 picker가 iframe에 진입하지 않는다.
- manifest **권한 추가는 0**이다 (`<all_urls>`는 이미 content_scripts matches에 존재하고, `all_frames`는 권한이 아닌 주입 범위 플래그).
- sentinel 활성화 모델을 유지해 **상시 캡처 비용을 만들지 않는다** (레코더는 프레임마다 미리 주입되지만 녹화 트리거 전에는 dormant).

## 비목표 (Non-goals)

- **프레임 출처 필터 UI 미구현**: 프레임별 필터/토글/그룹핑 UI는 이번 스코프에서 제외한다. 나중에 필요하면 별도로 추가한다(`pageUrl`이 이미 각 entry에 저장돼 있어 후속 추가 가능).
- **프레임 출처 인라인 표시 안 함**: 개별 로그 항목에 프레임 도메인 배지 등을 추가하지 않는다. 기존 UI 그대로(Console만 `pageUrl` 링크 유지).
- **데이터 모델에 `frameId` 필드 추가 안 함**: 필터 UI가 없으므로 entry 타입(`ConsoleEntry`/`NetworkRequest`/`ActionEntry`)을 변경하지 않는다. 단일 타임라인 병합에는 기존 `id`(프레임마다 `crypto.randomUUID`라 충돌 없음)만으로 충분하다.
- **picker의 iframe 요소 선택 미지원**: iframe 내부 DOM 요소를 picker로 고르는 기능은 추가하지 않는다. `onPickerIframeUnsupported` 안내 로직은 그대로 둔다.
- **DevTools 수준 정확도 미달성**: monkey-patch의 구조적 한계(네이티브 콘솔 CORS/CSP 메시지, 비-fetch 네트워크 img/css/script/ws, 명시적 `console.error/warn` — 의도적 비-wrap)는 이번 범위 밖이다. 그 수준은 `chrome.debugger`(CDP) 기반의 별도 과제다.

## 사용자 시나리오

1. 사용자가 Stripe 결제 iframe이 포함된 페이지에서 버그를 만난다.
2. BugShot 사이드패널에서 screenshot/freeform/video 캡처 모드로 진입한다(기존 로그 정책 매트릭스: element 모드는 로그 미수집).
3. 레코더가 활성화되면(sentinel 발행) **top frame과 모든 iframe**(결제 iframe 포함)의 MAIN world 레코더가 동시에 활성화된다.
4. 결제 iframe 안에서 발생한 fetch 실패(예: 402)·console 에러가 캡처되어, top frame 로그와 **시간순으로 병합된 단일 타임라인**에 나타난다.
5. 사용자가 이슈를 등록하면 iframe 로그를 포함한 전체 로그가 첨부된다.

**엣지 케이스**
- 광고/트래커 iframe이 많은 페이지: 모든 프레임 로그가 단일 타임라인에 섞인다(필터 없음 — noise는 감수, 후속 필터 과제로 분리).
- iframe이 자체 네비게이션: 해당 프레임의 MAIN world가 파괴되기 직전 `pagehide`로 버퍼를 flush한다(기존 메커니즘이 프레임별로 동작).
- top frame 페이지 이동(cross-origin/reload): 기존 `shouldClearLogs`로 사이드패널 로그를 초기화한다. iframe 네비게이션은 `frameId !== 0` 필터로 초기화를 트리거하지 않는다(현행 유지).

## 성공 기준

- Stripe(또는 임의의 cross-origin iframe) 테스트 페이지에서 캡처 시, iframe 내부의 console·network 로그가 사이드패널 로그에 나타난다.
- top frame 로그와 iframe 로그가 시간순 단일 타임라인으로 정렬된다.
- 요소 선택(picker)을 실행해도 top frame에서만 동작하며 iframe 진입·중복 오버레이가 없다.
- manifest의 `permissions`·`host_permissions`·`optional_host_permissions` diff가 0이다.
- 서드파티 iframe(결제·임베드 위젯)이 레코더 주입 후에도 정상 동작한다(fetch/XHR 간섭으로 깨지지 않음).
- 기존 top-frame-only 로그 동작·30s replay trim·세션 영속화에 회귀가 없다.
