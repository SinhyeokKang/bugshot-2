# 레코더 게이트·무결성 (audit-refactor-3) — 기술 설계

## 개요

MAIN world 레코더 3종이 페이지와 같은 realm을 공유한다는 사실을 **전제로 받아들이고**, 그 위에서 (a) 페이지가 건드릴 수 있는 표면을 줄이고 (b) 건드려도 수집이 죽지 않게 만들고 (c) 게이트 밖으로 새는 적재·throttle 누락을 메운다. 전부 `src/content/` 안 외과적 수정이며 새 아키텍처 레이어를 만들지 않는다. **모든 변경은 `recorders-entry` 청크가 동기 IIFE로 emit되는 제약**(`scripts/check-prearm-chunk.mjs`) 안에서만 이뤄진다 — 새 모듈은 `src/content/` 안에 두고 레코더 그래프만 import하거나, 아예 레코더 파일 안에 인라인한다.

## 위협 모델 판정 (항목 6·7·9)

세 항목은 "페이지가 무엇을 할 수 있어야 하는가"의 결정이다. 코드를 읽고 내린 판정:

### 항목 6 — sentinel 부트스트랩 채널 (완전 차단 **불가**, 완화 채택)

- **원리적 한계**: MAIN 레코더는 자기가 arm될 sentinel(UUID)을 **모르는 상태로** document_start에 뜬다. ISOLATED 브리지(`recorder-bridge.ts:33`)가 그 값을 처음 건네는 채널은 필연적으로 **양쪽이 미리 아는 고정 이름**이어야 한다. 이름을 랜덤화하려면 그 랜덤값을 다시 고정 채널로 합의해야 해서 문제가 한 단계 뒤로 밀릴 뿐이다.
- **`isTrusted`로 못 가른다**: 브리지도 `document.dispatchEvent(new CustomEvent(...))`로 쏘므로 `isTrusted === false`다. 페이지 이벤트와 구별되지 않는다.
- **그러나 완화는 실효적이다.** 지금 피해가 큰 이유는 부트스트랩 채널이 뚫려서가 아니라, `setSentinel`이 **기존 세션을 파괴**하기 때문이다(`detachSentinelListeners()` + `currentSentinel` 단일 슬롯 교체). 이 둘을 없애면 위조 sentinel은 "무해한 추가 구독자"로 격하된다.
- **채택**: (a) sentinel을 **다중 등록**(`Set`, FIFO 캡 8)으로 바꿔 위조가 진짜 세션을 밀어내지 못하게 하고, (b) 레코더가 `EventTarget.prototype.addEventListener/removeEventListener/dispatchEvent`와 `CustomEvent` 생성자를 **document_start에 스냅샷**해 그것만 사용한다. (b)가 없으면 페이지가 나중에 `document.addEventListener`를 후킹해 진짜 sentinel 문자열(`__bugshot_net_stop__<uuid>` 등)을 관측하고 (a)를 그대로 우회한다 — 두 조치는 **짝**이다.
- **남는 위험(수용)**: 페이지는 여전히 자기 프레임 버퍼를 위조 sentinel로 구독해 읽을 수 있다. 그 내용은 그 프레임 자신의 fetch/console/action이라 페이지가 이미 접근 가능한 정보에 거의 수렴하고, 이는 ARCHITECTURE.md:212가 이미 수용한 "탭 로그 무결성 한정" 범위다. 위조 sentinel로 `capturing`이 켜지는 문제는 항목 9와 같은 성격이라 거기서 함께 다룬다.

### 항목 7 — `window.__bugshot_*_ctrl__` 함수 노출 (실질 **차단 가능**)

- 저장소 전수 grep 결과 이 전역을 **읽는 곳이 0**이다. 유일한 용도는 각 파일 첫 줄의 중복 초기화 가드(`if ((window as any)[CTRL_KEY]) return;`).
- MAIN world 전역의 **존재 자체**는 페이지에게 숨길 수 없지만(수용), 값이 `true`면 페이지가 호출할 함수가 사라진다. 이건 완화가 아니라 그 경로의 **실질 제거**다.
- **채택**: 세 파일 모두 `(window as any)[CTRL_KEY] = true;`로 교체. 함수 참조를 지우면 `setSentinel`/`clearBuffer`는 클로저 안에만 남는다.

### 항목 9 — pre-arm 플래그 위조 (완전 차단 **불가**, 피해 창 유한화 채택)

- **원리적 한계**: pre-arm은 document_start에 **동기로** 읽을 수 있어야 한다(`readPreArmFlag()`가 `capturing` 초기값을 정한다). 동기 접근 가능한 저장소는 `sessionStorage`/`localStorage`/`document.cookie`뿐이고 셋 다 same-origin 페이지가 읽고 쓴다. `chrome.storage.session`은 비동기, ISOLATED 브리지 왕복도 비동기라 그 시점에 못 쓴다. 키 변경·값 서명은 확장 번들이 공개돼 무의미.
- **실제 피해**는 "위조가 가능하다" 자체가 아니라 **그 상태가 무기한 지속된다**는 것이다: `installEwWrap()`으로 `error/warn` wrap이 상시 설치돼 `chrome://extensions`에 확장 attribution 경고가 누적되고(ARCHITECTURE.md:226이 명시한 바로 그 오염), `createPatchedFetch`가 `new Request` 재구성 경로로 들어가며(POSTMORTEM 2026-07-23 계열의 회귀 표면), 버퍼가 계속 자란다.
- **채택**: **pre-arm 유예 시한**. pre-arm으로 켜진 `capturing`은 `PREARM_GRACE_MS`(60초) 안에 `setSentinel`이 오지 않으면 자진 철수한다 — `capturing=false`, console은 `restoreConsoleWrap`, 버퍼는 비운다. 정당한 pre-arm은 "패널이 이미 열린 origin의 reload"이고, 재arm 트리거는 `useBackgroundRecorder`의 `tabs.onUpdated` `status === "complete"`다 — 즉 arm은 document_start 직후가 아니라 **페이지 load 완료** 시점에 온다(`rebroadcastSentinelsToFrame`은 `onCommitted` 시점이라 `document_idle`인 브리지가 아직 없어 무음 실패하고 재시도가 없다). 상한은 그 load까지를 덮어야 정상 로그를 안 자르므로 60초로 잡는다(구현 시점 정정 — 초안의 "수백 ms" 전제는 틀렸다).
- **문서 조정 동반**: ARCHITECTURE.md:214의 *"미armed origin·미활성 탭 트래픽에 일절 간섭하지 않는다"* 를 "페이지가 pre-arm 플래그를 위조하지 않는 한"으로 한정하고, 유예 시한을 명시한다.
- **남는 위험(수용)**: 60초 창 안의 wrap 오염·적재는 막지 못한다. 그 이상을 하려면 pre-arm 기능 자체를 포기해야 한다.

## 변경 범위

### `src/content/recorder-globals.ts` (신규)

- **역할**: document_start에 내장(built-in)을 스냅샷해 페이지 monkeypatch로부터 격리하는 단일 출처. **`src/content/` 안에 두고 레코더 3종 + 헬퍼만 import**하므로 self-contained 청크 제약을 깨지 않는다(현재 `log-throttle.ts`·`recorder-prearm.ts`·`*-recorder-helpers.ts`와 동일한 위치).
- **내용**: 모듈 평가 시점(= document_start, 페이지 인라인 스크립트보다 먼저)에 캡처.
  - `jsonParse` / `jsonStringify` — 항목 8
  - `URLSearchParamsCtor` — 항목 8(`maskBody`의 urlencoded 분기)
  - `addEventListener` / `removeEventListener` / `dispatchEvent`(모두 `EventTarget.prototype`에서) + `CustomEventCtor` — 항목 6(b)
- **주의**: 이 모듈은 **부수효과 없는 상수 캡처만** 한다. import 순서에 의존하지 않도록 `recorders-entry.ts`가 바꾸지 않아도 되게, 각 레코더가 자기 import로 끌어온다(rollup이 같은 청크에 인라인).

### `src/content/network-recorder-helpers.ts`

- **현재 역할**: 마스킹·본문 분류·fetch/XHR patch 팩토리(레코더 3종 공용 헬퍼).
- **변경**: `maskBody`(:118)와 `maskJsonBody` 경로가 전역 `JSON` 대신 `recorder-globals`의 스냅샷을 쓴다. urlencoded 분기의 `new URLSearchParams(body)`도 스냅샷 생성자 사용. 그 외 시그니처·동작 불변(항목 8).

### `src/content/network-recorder.ts`

- 항목 6: `currentSentinel: string | null` → sentinel 레지스트리(아래 인터페이스 설계). `detachSentinelListeners()` 제거, `dispatch()`가 등록된 모든 sentinel로 발화. 이벤트 등록/발화는 `recorder-globals` 스냅샷 경유.
- 항목 7: `:646` → `(window as any)[CTRL_KEY] = true;`
- 항목 9: pre-arm 유예 타이머 설치(`capturing`이 pre-arm 유래일 때만), `setSentinel`에서 해제.
- 항목 31: 에러·beacon 분기에서 `statusKind`를 **병기**(`statusText`는 그대로 유지).
  - `:401-404` — `kind === "error"` → `"networkError"`, `"abort"` → `"aborted"`, `"timeout"` → `"timeout"`.
  - `:448` — `queued ? "queued" : "queueFull"`.
  - `:204`(fetch 실패) — **`error instanceof Error`가 아닐 때만** `"networkError"`. Error면 `statusText`가 실제 메시지라 지금도 `isStatusHidden`이 false이므로 `statusKind`도 부여하지 않는다(회귀 감시 지점 7).
- 항목 35: `recordXhrSend`(:308) 첫 부분에서 `meta`가 없으면 **엔트리를 만들지 않고 return**한다(`totalSeen++`도 스킵). url·method를 모르는 엔트리는 로그 가치가 0이고, `captureXhr`의 `!meta` 가드(:358) 때문에 어차피 영구 pending이다.
- 항목 67: `pushEntry`(:122) 첫 줄에 `if (!capturing) return;` 추가. 호출부 4곳(`recordHook`:160 / `recordXhrSend`:296 게이트 / sendBeacon:426 / `attachWsRecorder`:568)의 기존 방어는 **그대로 둔다** — 호출부 게이트는 `totalSeen++`·`memoryUsed` 갱신까지 함께 막으므로 제거하면 계측이 바뀐다(외과적 범위).

### `src/content/console-recorder.ts`

- 항목 6·7·9: network과 동일한 3개 변경(`:311-336` 레지스트리화, `:350` 마커화, pre-arm 유예 — console은 철수 시 `restoreConsoleWrap(console, ewState)`도 호출).
- 항목 15: `counters`(:175)·`timers`(:194) Map에 **라벨 수 상한**(`MAX_LABELS = 200`, 초과 시 oldest 삭제)을 둔다. `console.count`의 카운트 누적·`console.time`의 시작 시각은 미armed 구간에도 정확해야 arm 후 값이 DevTools와 일치하므로, capturing 게이트로 옮기지 않고 캡으로 bound한다(대안 검토 참조). `clearBuffer`(:297-302)의 `counters.clear()`/`timers.clear()`는 그대로.

### `src/content/action-recorder.ts`

- 항목 6·7·9: 동일 3개 변경(`:598-623`, `:632`, 유예 타이머).
- 항목 16: `recordInput`의 dedup 분기(:261-267) 끝에 `throttle.schedule()` 추가.
- 항목 77: `:258` 주석의 "recording 게이트" → 코드 실제인 `capturing` 게이트로 수정.

### `src/content/picker.ts`

- 항목 77: `handleClear()`(:621)에서 `selectionUpdateTimer`(:1181)를 취소·null화. 현재는 콜백이 `ensureSelectedConnected()` 실패로 조기 return해 무해하지만, 취소 누락은 정리 종착점의 계약 위반이라 맞춘다.

### `src/types/network.ts`

- 항목 31: `NetworkStatusKind` union 신설 + `NetworkRequest.statusKind?` optional 필드 추가. **type-only 정의**라 `network-recorder.ts:5`의 기존 `import type`과 같은 경로이며 런타임 코드가 0이라 청크 제약과 무관하다.

### `src/lib/network-status.ts`

- 항목 31: `isStatusHidden`을 `statusKind` 우선 + `statusText` 폴백으로 강화(하위호환, 아래 인터페이스 설계).

### `src/sidepanel/components/NetworkLogContent.tsx`

- 항목 31: `:508`의 `${req.status} ${req.statusText}`를 "`statusKind`가 있으면 i18n 라벨, 없으면 기존 표현"으로 분기.

### `src/i18n/namespaces/logs.ts` + `src/log-viewer/i18n.ts`

- 항목 31: `networkLog.display.queued` / `queueFull` / `aborted` / `timeout` 4키를 ko·en 양쪽에 추가. **두 사전 모두** 갱신한다(`NetworkLogContent`를 log-viewer가 재사용 — ARCHITECTURE.md:256). `networkError`는 기존 `networkLog.display.blocked`/`blockedHint` 경로가 이미 담당하므로 새 키를 만들지 않는다.

### `src/sidepanel/lib/aiLogsManual.ts`

- 항목 31: `:46` 필드 목록에 `statusKind`를 한 줄 추가(logs.html에 박히는 AI 소비 매뉴얼 — 포맷을 바꾸면 손으로 맞춰야 하는 대조 테스트 없는 표면).

### `docs/ARCHITECTURE.md`

- 항목 66: `:169` 경고 블록은 이미 *"`frameToken`은 비밀이 아니다 … 인증이 아니라 힌트"* 로 정확하다. 문제는 **`:167` 본문**의 *"임의 iframe 스크립트의 무인증 postMessage 등록을 차단한다"* 가 코드 보장보다 강하다는 것 — `frame-geometry.ts:90`이 `postMessage({type, token}, "*")`로 방송해 부모 페이지도 token을 읽는다. `:167`을 "픽커 없는 iframe의 우발적 등록을 거른다(악의적 페이지에 대한 인증은 아니다 — 아래 경고 참조)"로 완화한다.
- 항목 9: `:214` 활성 게이트 문단에 pre-arm 위조 가능성과 유예 시한 명시.
- 항목 6: `:212` 괄호 서술("위조 주입 — 탭 로그 무결성 한정")에 "수집 무력화는 sentinel 다중 등록으로 막는다"를 추가.

## 데이터 흐름

### sentinel 등록 (변경 후)

```
사이드패널 activate*Recorder (crypto.randomUUID)
  → chrome.runtime → recorder-bridge (ISOLATED)
      handleSetSentinel: data 리스너 교체(기존 로직 불변)
      → dispatchEvent("__bugshot_net_setSentinel__", {sentinel})   ← 고정 이름(부트스트랩, 위조 가능)
        → MAIN 레코더 setSentinel(s)
             sentinels.add(s)  (FIFO 캡 8, 기존 항목 유지)
             s별 stop/sync/clear 리스너 등록  ← 스냅샷 addEventListener 사용
             capturing=true, recording=true, setPreArmFlag(), 유예 타이머 해제
        dispatch(): sentinels 전체를 순회하며 "__bugshot_net_data__"+s 발화
                    ← 스냅샷 dispatchEvent/CustomEvent 사용
```

위조 sentinel이 섞여도 진짜 s의 리스너와 dispatch가 그대로 살아 있다. 브리지는 자기 sentinel의 data만 받으므로(`recorder-bridge.ts:14`) 위조 채널의 발화를 무시한다.

### pre-arm 유예 (항목 9)

```
document_start: capturing = readPreArmFlag()
  ├─ false → 아무 일 없음(기존과 동일)
  └─ true  → armGraceTimer = setTimeout(PREARM_GRACE_MS)
                ├─ setSentinel 도착 → clearTimeout, 정상 arm (정상 경로)
                └─ 60s 경과      → capturing=false, 버퍼 clear,
                                    console은 restoreConsoleWrap
```

### `statusKind` 흐름 (항목 31)

```
레코더: statusText(기존 영문, 불변) + statusKind(신규 optional) 병기
  → recorder-bridge → 사이드패널 store(networkLog)
      ├─ UI: NetworkLogContent / TimelineRow  → statusKind 있으면 i18n 라벨
      ├─ isStatusHidden: statusKind 우선, 없으면 statusText 폴백(옛 저장 로그)
      ├─ buildHar(:119)          → statusText 그대로(HAR 표준 필드, 영문 유지)
      ├─ logToCodeBlock(:52)     → statusText 그대로(이슈 본문 코드블록, 8개 플랫폼 공통)
      ├─ buildLogSummary(:52) → draftRich(:150) → statusText 그대로(LLM 프롬프트, 안정 토큰)
      └─ IndexedDB networkLogs / chrome.storage.session → statusKind 없는 옛 레코드 공존
```

**설계 결론**: `statusText`를 치환하지 않고 `statusKind`를 **병기**한다. 치환하면 `isStatusHidden` 센티널이 죽고, HAR·프롬프트·이슈 본문 8곳이 동시에 흔들린다. 병기하면 소비처 전파 위험이 0이고 UI만 번역된다. 하위호환도 자동 — 옛 레코드는 `statusKind === undefined`라 기존 표현으로 폴백한다.

## 인터페이스 설계

```ts
// src/content/recorder-globals.ts (신규)
// document_start 스냅샷 — 페이지 monkeypatch 이전의 내장을 고정한다.
export const jsonParse: typeof JSON.parse;
export const jsonStringify: typeof JSON.stringify;
export const URLSearchParamsCtor: typeof URLSearchParams;
export const addEventListener: (t: EventTarget, type: string, fn: EventListener) => void;
export const removeEventListener: (t: EventTarget, type: string, fn: EventListener) => void;
export const dispatchEvent: (t: EventTarget, ev: Event) => boolean;
export const CustomEventCtor: typeof CustomEvent;

// src/content/sentinel-registry.ts (신규 — 순수 함수, 유닛 테스트 대상)
export interface SentinelRegistry {
  add(sentinel: string): boolean;   // 이미 있으면 false(멱등 재발행)
  list(): string[];                 // dispatch 순회용 스냅샷
  has(sentinel: string): boolean;
  evicted(): string[];              // 캡 초과로 밀려난 항목(리스너 해제용)
}
export function createSentinelRegistry(cap?: number): SentinelRegistry; // 기본 cap 8

// src/types/network.ts
// BugShot이 만든 statusText에만 붙는 분류 태그. 서버 유래 statusText에는 없다(undefined).
export type NetworkStatusKind =
  | "networkError"  // fetch reject(non-Error) / XHR error — CORS·연결 실패
  | "aborted"       // XHR abort
  | "timeout"       // XHR timeout
  | "queued"        // sendBeacon 큐 성공
  | "queueFull";    // sendBeacon 큐 실패
export interface NetworkRequest {
  // ...기존 필드 불변
  statusText: string;          // 유지 — HAR/프롬프트/본문/옛 저장분 호환
  statusKind?: NetworkStatusKind;
}

// src/lib/network-status.ts
// statusKind 우선, 없으면 옛 저장 로그를 위해 statusText 폴백.
export function isStatusHidden(
  req: Pick<NetworkRequest, "phase" | "status" | "statusText" | "statusKind">,
): boolean;
```

`console-recorder.ts`의 라벨 캡은 파일 내부 인라인(`MAX_LABELS = 200`)으로 두고, pre-arm 유예 상수도 각 레코더에 리터럴로 복제한다(`PREARM_GRACE_MS = 60000`) — `MAX_ENTRIES`가 이미 같은 이유로 3파일에 복제돼 있다(`console-recorder.ts:22-24` 주석).

## 기존 패턴 준수

- **pre-arm self-contained 청크**(CLAUDE.md "pre-arm 버퍼링", ARCHITECTURE.md:210): 신규 모듈 2개는 `src/content/` 안에 두고 레코더 그래프만 import한다. `src/lib/`·`src/sidepanel/`로 승격하면 공유 청크가 되어 async loader로 되돌아간다 — `trailing-throttle.ts` 복제가 존재하는 이유와 동일. `@/types/network`는 **type-only import**라 런타임 코드가 0이므로 예외(이미 `network-recorder.ts:5`가 그렇게 쓰고 있다).
- **페이지 무간섭 3원칙**(ARCHITECTURE.md:216): 원본 먼저 호출 / 기록 throw 격리 / 응답 read await 안 함. 항목 8·15·35가 wrap 내부를 건드리므로 각 태스크의 검증에 재확인 포함.
- **i18n 동시 갱신**: `src/i18n/namespaces/logs.ts` ko·en 동시 + `src/log-viewer/i18n.ts` 복제 사전 동시(CLAUDE.md "사전은 두 벌이다").
- **테스트 2트랙**(CLAUDE.md): 순수 함수는 `*.test.ts`(node), 실제 DOM이 필요한 것만 `*.test.tsx`(jsdom). 레코더 IIFE 본체는 export되지 않아 유닛 불가 → e2e/수동.
- **주석 최소화**: WHY가 비자명할 때만 한 줄(스냅샷 이유·유예 시한 이유 정도).

## 대안 검토

1. **항목 6 — sentinel 교체를 `prev` 인증으로 막는다** (브리지가 `{sentinel, prev}`를 실어 보내고, 레코더는 `currentSentinel === null || detail.prev === currentSentinel`일 때만 수락). 교체·detach·강제 stop을 전부 차단한다. **불채택**: 페이지가 **선점**(document_start 직후 가짜 sentinel 주입)하면 이후 진짜 arm이 `prev` 불일치로 거부돼, 지금보다 **가용성이 더 나빠진다**(현재는 진짜 arm이 위조를 덮어쓴다). 감사 지적의 핵심이 가용성이므로 채택안(다중 등록)이 목적에 정합.
2. **항목 6 — sentinel 이벤트 이름을 랜덤화한다.** **불채택**: MAIN 레코더와 ISOLATED 브리지가 그 랜덤값을 합의할 채널이 다시 고정 이름 DOM 이벤트뿐이라 문제가 한 단계 뒤로 밀릴 뿐이다. `chrome.*` 경로는 MAIN world에서 못 쓴다.
3. **항목 9 — 코드 무변경, ARCHITECTURE.md 서술만 완화**(항목 66이 택한 방식). **불채택은 아니지만 부분 채택**: 서술 완화는 하되, 위조 pre-arm의 **오염이 무기한 지속**되는 부분은 유예 타이머로 유한화한다. 이 타이머는 "arm 스코프로 wrap 오염 창을 좁힌다"는 원래 설계 의도(ARCHITECTURE.md:226)의 연장이지 새 정책이 아니다.
4. **항목 15 — `counters.set`/`timers.set`을 `safeRecord`(capturing 게이트) 안으로 옮긴다** (감사 원문의 제안). **불채택**: 미armed 구간에 카운트가 안 늘고 타이머 시작이 기록되지 않아, arm 후 `console.count` 로그 값이 DevTools 표시와 어긋나고 `console.timeEnd`가 `"?"`로 찍힌다. 무한 증가만 막으면 되므로 라벨 수 캡이 더 작은 부작용으로 같은 목표를 달성한다.
5. **항목 31 — `statusText`를 i18n 키로 치환한다.** **불채택**: `network-status.ts:8`이 `"Network Error"` 문자열 동등 비교를 센티널로 쓰고, `buildHar.ts:119`(HAR 표준)·`draftRich.ts:150`(LLM 프롬프트)·`logToCodeBlock.ts:52`(이슈 본문)가 같은 필드를 읽는다. 치환은 소비처 6곳을 동시에 흔든다. 병기가 위험 대비 이득이 명백히 크다.
6. **항목 35 — `xhr.responseURL`로 URL을 복구해 엔트리를 살린다.** **불채택**: `send` 시점에는 `responseURL`이 비어 있고, `load` 이후엔 `captured` 가드와 `!meta` 가드를 둘 다 풀어야 한다. url·method 없는 pending 행보다 "그 요청은 로그에 없음"이 정확하다.

## 위험 요소

1. **pre-arm self-contained 청크 제약 (최우선)** — 신규 `recorder-globals.ts`·`sentinel-registry.ts`가 `src/content/` 밖 런타임 값을 import하거나, 반대로 사이드패널 쪽에서 이 모듈을 import하면 crxjs가 `recorders-entry`를 async loader로 emit해 **pre-arm이 조용히 죽는다**(빌드·typecheck·유닛 전부 green). 그물은 `pnpm check:prearm`(형태) + `e2e/logs-prearm.spec.ts`(행동) 2단. 태스크마다 이 검사를 검증 항목에 넣는다.
2. **로그 스키마 하위호환** — `statusKind`는 optional 추가라 IndexedDB(`blob-db.ts`, `DB_VERSION=8`) 스키마 버전을 올릴 필요가 없다. 다만 **옛 저장 로그에는 필드가 없다**: `isStatusHidden`이 `statusText` 폴백을 잃으면 과거 draft의 CORS 실패 행이 "실패 · 상태 가려짐" 대신 `0 Network Error` 원문으로 퇴행한다. 폴백을 반드시 유지하고 테스트로 고정한다. `logs.html`로 **이미 내보낸 파일**은 빌드 시점 i18n·데이터가 박혀 소급 수정되지 않는다(POSTMORTEM 2026-08-05 계열).
3. **sentinel 캡 FIFO로 진짜 sentinel이 밀려날 수 있다** — 페이지가 8회 이상 위조하면 진짜 항목이 evict된다. 그 경우 복구 경로는 **재arm뿐이다** — evict는 그 sentinel의 `sync` 리스너도 함께 떼므로 사이드패널 1500ms 폴링(ARCHITECTURE.md:240)은 아무것도 못 한다(구현 시점 정정 — 초안의 "다음 sync에서 복구" 근거는 틀렸다. 이 근거를 남겨두면 다음 사람이 "sync가 받쳐준다"고 믿고 캡을 더 낮춘다). 재arm은 `tabs.onUpdated complete`·패널 visibilitychange·탭 활성화라 주기적이지 않고, 그 사이 dispatch가 유실된다. 캡을 낮추면 정상 재arm이 밀리고 높이면 위조 여지가 는다 — 8은 "정상 세션 수 « 캡 « 무제한"의 절충이며 evict 시 해당 sentinel의 stop/sync/clear 리스너를 함께 해제해 누수를 막는다.
4. **`EventTarget.prototype` 스냅샷의 부작용** — `addEventListener`를 `EventTarget.prototype`에서 떼어 `call`로 쓰면 페이지가 `document.addEventListener`를 **인스턴스 속성으로** 덮은 경우를 우회한다. 다만 페이지가 document_start **이전에** prototype 자체를 바꿀 수는 없다(레코더가 먼저 실행). 리팩터로 레코더가 loader 경유가 되면 이 전제가 깨진다 — 위험 1과 같은 뿌리.
5. **pre-arm 유예 타이머가 정상 로그를 자르는 경우** — arm이 60초 넘게 걸리는 환경(극도로 느린 페이지, load 이벤트가 영영 안 오는 페이지)에서 로드 초반 로그가 유실된다. action은 만료 시 `entryNavEmitted` 래치도 함께 내려야 진입 load 액션이 영구 유실되지 않는다. `e2e/logs-prearm.spec.ts`는 reload 후 즉시 arm되는 시나리오라 통과하지만, 실사용 회귀는 e2e로 안 잡힌다. 상한 값을 넉넉히 두고 수동 체크리스트에 포함.
6. **action 실시간 flush 부하** — 항목 16이 타이핑마다 `schedule()`을 켜면 200ms마다 **버퍼 전량**(`dispatch()`의 `buffer.slice()`)이 나간다. 수신부 IDB 가드(`log-persist-guard`, ~1s trailing)가 흡수하지만 대량 입력 시 메시지 크기를 수동 확인한다.
7. **레코더 IIFE 본체는 유닛 테스트 불가** — `networkRecorderScript`·`consoleRecorderScript`·`actionRecorderScript`는 export되지 않고 파일 끝에서 즉시 호출된다(`network-recorder.ts:649` 등). 기존 `__tests__/network-recorder.test.ts`도 **헬퍼만** 검증한다. 항목 6·9·15·16·35의 실제 배선은 e2e/수동이 유일한 그물이다(CLAUDE.md의 "브라우저 실동작은 jsdom으로도 못 잡는다" 계열).
8. **POSTMORTEM 2026-07-23 재발** — MAIN world 레코더 wrap 순서(비활성 gate → 원본 호출 우선 → 기록 전체 try/catch)를 깨면 페이지 요청이 깨진다. 항목 35(`recordXhrSend` 조기 return)와 항목 67(`pushEntry` 게이트)이 그 함수들을 직접 건드리므로, 원본 `send` 호출이 **어떤 경로에서도** 보장되는지 재확인한다(현재 `XHR.send`:295-306은 `recordXhrSend`를 try/catch로 감싸고 `originalSend`를 항상 호출 — 이 구조를 유지).
