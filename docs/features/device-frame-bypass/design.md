# 디바이스 뷰포트 — 프레임 차단 헤더 우회 · 기술 설계

## 개요

`chrome.declarativeNetRequest`의 **세션 룰**로, 디바이스 모드가 켜진 탭의 **서브프레임 응답**에서
`X-Frame-Options`와 `Content-Security-Policy` 헤더를 제거한다. 룰의 수명은 디바이스 모드의 수명과
1:1로 묶고, 그 묶음은 이미 모드 라이프사이클을 단독으로 소유하고 있는
`background/device-frame-coordinator.ts`가 관리한다 — 새 라이프사이클을 만들지 않는다.

룰 등록은 `armDeviceFrame`(감시창 열기)과 같은 지점, 제거는 `clearDeviceFrame`(binding 폐기)과
`frameBlocked` 판정 지점이다. 이 셋이 이미 "모드가 서려 한다 / 모드가 끝났다 / 모드가 못 섰다"의
단일 관문이라, 여기 붙이면 새 누수 경로가 생기지 않는다.

## 변경 범위

### 새 파일: `src/background/frame-header-rules.ts`

DNR 세션 룰의 빌드·적용·제거를 담는 유일한 모듈.

- **현재 역할**: 없음(신규)
- **내용**:
  - `buildFrameUnblockRule(tabId)` — 순수 함수. 룰 객체를 만든다. 유닛 테스트의 대상이다.
  - `applyFrameUnblock(tabId)` — `updateSessionRules`로 등록. 실패는 삼킨다(fail-open).
  - `removeFrameUnblock(tabId)` — 같은 ID를 제거. 멱등.
  - `resetFrameUnblockRules()` — 확장 시작 시 잔여 룰 일괄 제거.
  - `ruleIdForTab(tabId)` — 룰 ID 파생. 탭당 1개라 `tabId`를 그대로 쓴다.

`chrome.*` 호출을 이 파일에 가두는 이유는 코디네이터의 테스트가 지금 `chrome.storage.session`과
`chrome.webNavigation`만 목킹하고 있어서다 — DNR 목을 코디네이터 테스트 전체에 퍼뜨리지 않는다.

### `src/background/device-frame-coordinator.ts`

- **현재 역할**: 디바이스 모드 판정의 단일 심판 + 탭별 상태·세션 영속화·순서 큐
- **변경**:
  - `armDeviceFrame(tabId, on, topUrl)`에서 `on === true`일 때 `applyFrameUnblock(tabId)` 호출.
    **이 함수는 현재 동기다.** 룰 적용은 비동기이므로 `void`로 발사하지 않고 함수를 `async`로
    바꾼 뒤 호출부(`messages.ts`의 `device.arm`)가 await한다 — 순서 보장이 필요하다(아래 참조).
  - `clearDeviceFrame(tabId)`에서 `removeFrameUnblock(tabId)` 호출. 이미 `async`다.
  - `applyDeviceSignal`에서 `push.type === "frameBlocked"`일 때 `removeFrameUnblock(tabId)` 호출.

### `src/background/messages.ts`

- **현재 역할**: background 요청 라우터
- **변경**: `device.arm` 케이스(현재 `:698`)에서 `armDeviceFrame`이 async가 되므로 `await`를 붙인다.
  이미 `await enqueueForTab(...)` 안이라 구조 변경은 없다.

### `src/background/index.ts`

- **현재 역할**: SW 엔트리. 리스너 등록
- **변경**: `chrome.runtime.onInstalled`·`onStartup` 리스너에 `void resetFrameUnblockRules()` 추가.
  기존 `disableGlobalSidePanel()`·`setupContextMenu()`와 같은 자리다.

### `manifest.config.ts`

- **변경**: `permissions` 배열에 `"declarativeNetRequestWithHostAccess"` 추가.
  `declarativeNetRequest`(정적 룰셋·전역 적용)는 **추가하지 않는다** — `modifyHeaders` 액션은
  host permission이 있으면 `WithHostAccess` 변형으로 충분하고, `<all_urls>`를 이미 required로
  보유한다.

### e2e 픽스처: `e2e/fixtures/extension.ts`

- **현재 역할**: 로컬 테스트 서버. `/e2e-xfo`가 `X-Frame-Options: DENY`를 낸다(`:70`)
- **변경**: CSP 경로용 라우트 `/e2e-csp-frame`을 추가한다
  (`content-security-policy: frame-ancestors 'none'`). XFO와 CSP는 브라우저 내부 차단 코드가
  달라 한쪽만으로는 두 갈래를 못 덮는다.

### `e2e/device-viewport.spec.ts`

- **변경**: 기존 "X-Frame-Options: DENY 페이지에서는 3초 안에 전체로 롤백된다"(`:379`)를
  **성공 검증으로 뒤집는다**. CSP 라우트 케이스를 하나 추가한다.

### 문서

`docs/PERMISSION.md`(새 권한 항목·사용처), `docs/privacy.{ko,en}.md`(응답 헤더 수정 사실),
`CLAUDE.md`(게이트웨이의 permissions 목록), `docs/DIRECTORY.md`(새 파일),
`guide/{ko,en}/device-viewport.md`(차단 사이트 문구 톤 조정)를 갱신한다.

## 데이터 흐름

```
[사이드패널] selectDeviceWidth(390)
     │
     ├─ arm(tabId, true) ──► [background] device.arm
     │                          └─ enqueueForTab
     │                               ├─ await applyFrameUnblock(tabId)   ★ 룰 등록
     │                               └─ armDeviceFrame(tabId, true, topUrl)
     │                                    └─ 감시창 3초 오픈
     │
     ├─ deviceSet(tabId, 390) ──► [content] mountDeviceFrame
     │                               └─ iframe.src = location.href
     │                                    └─ 네트워크 요청 (SUB_FRAME)
     │                                         └─ ★ DNR이 XFO·CSP 제거
     │
     └─ waitForVerdict()  ◄── [background] frameLoaded / frameBlocked
                                   └─ frameBlocked이면 removeFrameUnblock  ★ 룰 제거

[모드 종료]
  전체 선택 / handoff / 탭 종료
     └─ top 커밋 or forgetTab
          └─ clearDeviceFrame(tabId)
               ├─ setDeviceFrame(tabId, null)
               └─ ★ removeFrameUnblock(tabId)
```

### 룰 등록이 `device.set`보다 먼저여야 하는 이유

래퍼의 첫 요청이 나가기 전에 룰이 걸려 있어야 한다. 현재 `runTransition`이 이미
`await arm(tabId, true)` → `deviceSet(...)` 순서를 지키므로(`device-viewport-controller.ts:385`),
`device.arm` 핸들러가 룰 등록을 await하기만 하면 순서가 자동으로 보장된다.

**`armDeviceFrame`을 async로 바꾸는 것이 이 설계의 유일한 시그니처 변경이다.** 동기로 두고
`void applyFrameUnblock(tabId)`를 발사하면 룰 등록과 래퍼 요청이 경쟁해, 캐시된 페이지에서
간헐적으로 차단되는 재현 불가 버그가 된다.

## 인터페이스 설계

```ts
// src/background/frame-header-rules.ts

/**
 * 룰 ID. 탭당 정확히 하나이므로 tabId를 그대로 쓴다 — 현재 이 확장의 유일한 DNR 사용처라
 * 다른 용도와 충돌할 여지가 없고, 별도 매핑 테이블이 SW 재시작을 넘어 살아남을 필요도 없다.
 */
export function ruleIdForTab(tabId: number): number;

/**
 * 해당 탭의 서브프레임 응답에서 프레임 차단 헤더를 제거하는 세션 룰.
 *
 * `MAIN_FRAME`을 넣지 않는 것이 이 설계의 핵심 제약이다 — 래퍼만 새로 로드되므로 필요가 없고,
 * 넣으면 사용자가 보던 top 문서의 CSP까지 벗겨진다.
 *
 * CSP를 통째로 지우는 이유: DNR은 헤더 단위 remove/set만 지원하고 원본 값을 읽을 수 없어
 * `frame-ancestors` 지시어만 빼는 것이 불가능하다. MV3에는 blocking webRequest가 없다.
 */
export function buildFrameUnblockRule(tabId: number): chrome.declarativeNetRequest.Rule;

/** 룰 등록. 실패는 삼킨다 — 못 걸면 차단 사이트에서 기존과 같이 실패할 뿐이다(fail-open). */
export function applyFrameUnblock(tabId: number): Promise<void>;

/** 룰 제거. 멱등 — 없는 ID를 지우는 것은 DNR에서 에러가 아니다. */
export function removeFrameUnblock(tabId: number): Promise<void>;

/** 확장 시작 시 잔여 룰 일괄 제거. 세션 룰은 브라우저 세션을 넘지 않지만 확장 reload는 넘는다. */
export function resetFrameUnblockRules(): Promise<void>;
```

룰 객체의 형태:

```ts
{
  id: ruleIdForTab(tabId),
  priority: 1,
  action: {
    type: "modifyHeaders",
    responseHeaders: [
      { header: "x-frame-options", operation: "remove" },
      { header: "content-security-policy", operation: "remove" },
    ],
  },
  condition: {
    tabIds: [tabId],
    resourceTypes: ["sub_frame"],
  },
}
```

`@types/chrome@0.0.280`은 `RuleActionType`·`HeaderOperation`·`ResourceType`을 **enum**으로
선언한다. 문자열 리터럴을 그대로 넣으면 타입 에러가 나므로 `chrome.declarativeNetRequest.
RuleActionType.MODIFY_HEADERS` 형태의 enum 멤버를 쓴다(런타임에 존재한다).

### 시그니처 변경

```ts
// device-frame-coordinator.ts — 동기 → 비동기
export function armDeviceFrame(tabId: number, on: boolean, topUrl: string): void
export async function armDeviceFrame(tabId: number, on: boolean, topUrl: string): Promise<void>
```

## 기존 패턴 준수

- **fail-open vs fail-closed**: 이 기능은 **fail-open**이 맞다. 코디네이터의 다른 게이트들이
  fail-closed인 것과 다르다 — 그쪽은 "모르면 로그가 새거나 위조 binding이 굳는" 침묵 고장을
  막는 것이고, 여기는 못 걸어도 결과가 "기능 도입 전과 동일"이라 새 실패 모드가 없다.
  이 비대칭을 코드 주석에 남긴다.
- **모드 라이프사이클 단일 소유**: 룰 수명을 `armDeviceFrame`/`clearDeviceFrame`에 묶어
  "래퍼 binding이 있는 동안 룰이 있다"는 불변식을 만든다. 별도 타이머·플래그를 두지 않는다.
- **privacy 문서는 권한 문자열이 아니라 실제 동작에 묶인다**(CLAUDE.md 문서 신선도 규칙).
  이번엔 manifest diff도 있고 동작 변경도 있어 양쪽 다 트리거된다. **ko가 원본, en이 번역**이며
  상단 시행일도 함께 올린다.
- **테스트 2트랙**: 룰 빌더는 순수 함수라 `*.test.ts`(node). 적용·제거의 호출 계약은 chrome API
  목으로 같은 트랙에서 검증한다.

## 대안 검토

### 1. `X-Frame-Options`만 제거하고 CSP는 남긴다

대상 문서의 XSS 방어를 유지할 수 있어 매력적이다. **기각** — `frame-ancestors`를 쓰는 사이트가
막히고, 최신 사이트일수록 XFO 대신 CSP를 쓴다. 반쪽 우회는 "되는 사이트와 안 되는 사이트가
사용자에게 무작위로 보이는" 상태를 만들어 오히려 나쁘다.

### 2. CSP를 제거한 뒤 우리가 만든 대체 CSP를 `set`으로 주입

원본보다 약하지만 아무것도 없는 것보단 낫다는 발상. **기각** — DNR은 원본 값을 읽을 수 없어
사이트별로 무엇을 복원해야 하는지 알 수 없다. 임의의 대체 정책은 사이트를 깨뜨릴 위험이 있고
(스크립트 소스 화이트리스트를 우리가 알 수 없다), 보안상 이득도 불확실하다.

### 3. `urlFilter`로 래퍼 진입 URL만 정확히 매칭

노출면이 가장 작다. **기각** — 래퍼 안에서 링크를 타고 다른 경로로 이동하면 그 문서엔 룰이
안 걸려 그 시점에 차단된다. 모드 유지 중 이동은 이 기능의 핵심 사용 패턴이라 못 깬다.
(사용자 결정: `tabIds` + `SUB_FRAME`.)

### 4. Hoverify형 — 확장 소유 전용 탭에서 연다

헤더 제거의 영향이 확장 탭에 갇혀 보안상 가장 깔끔하다. **기각** — 사이드패널이 탭 스코프인
구조, picker의 frameId 기반 라우팅, 로그 레코더의 sentinel 게이트, 캡처의 `captureVisibleTab`
경로가 전부 "사용자가 보던 탭"을 전제로 서 있다. 아키텍처 재작성 수준이고, 그러면 디바이스
뷰포트가 "그 탭에서 캡처한다"는 제품 전제 자체가 바뀐다.

### 5. 사용자 토글 제공

**기각**(사용자 결정) — 모드를 켠 것 자체가 의사 표시이고, 껐을 때 기능이 반만 되는 상태를
설명할 방법이 없다.

## 위험 요소

### 보안 — 대상 문서의 CSP가 모드 ON 동안 사라진다

이 설계가 감수하는 유일한 실질 위험이다. 래퍼 안에서 열리는 문서는 사용자가 실제로 조작·캡처하는
바로 그 사이트이고, 그 문서의 XSS 방어가 모드가 켜진 동안 없다. 완화책은 범위 축소 셋뿐이다:
탭 한정 · `SUB_FRAME` 한정 · 모드 수명 한정. **privacy 문서에 이 사실을 그대로 적는다** —
숨기면 심사와 신뢰 양쪽에서 더 비싸다.

### 스토어 심사

`declarativeNetRequestWithHostAccess` 추가는 심사 사유 기재를 요구한다. "사용자가 명시적으로
켠 디바이스 뷰포트 모드에서, 그 탭의 확장 생성 프레임이 로드되도록 프레임 차단 헤더를
제거한다"는 목적을 권한 사유란과 privacy 문서 양쪽에 같은 문장으로 적는다.

### 룰 누수

모드 ON 상태에서 SW가 죽고, 그 탭이 top 네비게이션 없이 오래 유지되면 룰이 남는다.
세션 룰이라 브라우저 종료 시 사라지고 `forgetTab`이 탭 종료를 덮지만, 그 사이 구간에서는
그 탭의 서브프레임 CSP가 계속 벗겨진 상태다. **`onStartup`/`onInstalled` 리셋이 마지막 그물**이고,
`getSessionRules()`로 누적 0을 확인하는 e2e가 이 위험의 회귀 그물이다.

### `armDeviceFrame` async 전환의 파급

동기였던 함수가 비동기가 되면서, 호출부가 `await`를 빠뜨리면 룰 등록과 래퍼 요청이 경쟁한다.
호출부는 `messages.ts`의 `device.arm` 하나뿐이고 테스트가 그 await를 고정한다. **재수립 경로도
같은 `device.arm`을 타므로 별도 처리가 필요 없다.**

### 기존 e2e가 뒤집힌다

`device-viewport.spec.ts:379`는 지금 "XFO DENY면 롤백된다"를 **성공 조건으로** 고정하고 있다.
이 기능은 그 계약을 의도적으로 깬다. 테스트를 지우지 말고 **반대 방향으로 다시 쓴다** —
같은 픽스처에서 모드가 서는 것을 검증해, 우회가 실제로 동작함을 그 자리에서 증명하게 한다.

### DNR 룰과 캐시

이미 캐시된 응답이 서빙될 때도 modifyHeaders가 적용되는지는 브라우저 내부 동작이라
유닛으로 고정할 수 없다. e2e 픽스처는 매번 새 응답을 내므로 이 경로를 검증하지 못한다.
수동 확인 항목으로 남긴다(차단 사이트를 한 번 방문해 캐시를 만든 뒤 모드를 켜본다).
