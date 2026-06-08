# 로그 꼬리 유실 보강 — 기술 설계

## 개요

각 MAIN world 레코더(console/network/action)에 **trailing throttle 자동 flush**를 추가한다. `pushEntry`로 버퍼에 entry가 추가될 때마다 throttle를 `schedule()`하고, throttle는 최대 `FLUSH_INTERVAL_MS`(≈200ms)마다 기존 `dispatch()`(전체 버퍼 CustomEvent)를 호출한다. 추가로 `visibilitychange(hidden)`에서 즉시 flush를 건다. 기존 `sync`/`stop`/`pagehide` flush 경로는 그대로 두고 그 위에 안전망을 얹는 형태다. 수신부(`mergeLogItems` id dedup)는 전체 버퍼 재전송을 흡수하므로 데이터·메시지 모델 변경이 없다.

## 변경 범위

### 1. `src/content/log-throttle.ts` (신규, 순수 유틸)
**역할**: trailing throttle 팩토리. 타이머 기반이지만 순수하게 분리해 단위테스트 가능하게 한다(타이머를 주입 가능한 형태).

```ts
export interface TrailingThrottle {
  schedule(): void;   // entry 추가 시 호출 — pending이면 무시, 아니면 interval 후 flush 예약
  flushNow(): void;   // 즉시 flush + 예약 취소 (pagehide/visibilitychange/sync/stop용)
  cancel(): void;     // 예약만 취소 (clear용)
}

export function createTrailingThrottle(
  flush: () => void,
  intervalMs: number,
  scheduleTimer?: (cb: () => void, ms: number) => number,  // 테스트 주입용 (기본 setTimeout)
  clearTimer?: (id: number) => void,                       // 기본 clearTimeout
): TrailingThrottle;
```

동작: `schedule()` 호출 시 타이머가 없으면 `intervalMs` 후 `flush()` 실행하는 타이머를 건다(trailing). 이미 타이머가 있으면 아무것도 안 한다 → **최대 `intervalMs`마다 한 번 flush 보장**(폭주에도 지연 없음). `flushNow()`는 타이머 취소 + 즉시 `flush()`. `cancel()`은 타이머만 취소.

### 2. `src/content/console-recorder.ts`
**현재 역할**: console.* wrap, 버퍼링, sentinel-bound `dispatch()`, `pagehide`→dispatch.
**변경 내용**:
- `createTrailingThrottle(dispatch, FLUSH_INTERVAL_MS)` 인스턴스 생성.
- `pushEntry` 끝에 `throttle.schedule()` 추가(단 `recording`일 때만 — `pushEntry`는 이미 `if (!recording) return` 가드).
- `setSentinel`의 `stopHandler`/`syncHandler`에서 `throttle.flushNow()`로 통일(즉시 flush 후 dispatch). `clearHandler`는 `throttle.cancel()` 추가.
- `pagehide` 핸들러를 `throttle.flushNow()`로 교체(동일 효과 + 예약 취소).
- `visibilitychange` 핸들러 신규: `if (document.visibilityState === "hidden") throttle.flushNow()`.

### 3. `src/content/network-recorder.ts`
**변경 내용**: console-recorder와 동일 패턴. `pushEntry`(in-flight pending entry push 지점)와 응답 갱신 지점 모두에서 `throttle.schedule()` — pending→complete 전이로 entry가 갱신될 때도 실시간 반영하기 위함. `pagehide`/`visibilitychange`/`stop`/`sync`/`clear`는 console과 동일.

### 4. `src/content/action-recorder.ts`
**변경 내용**: 동일 패턴 적용. action은 빈도가 낮아 throttle 효과는 작지만 일관성 위해 포함.

### 5. `src/sidepanel/hooks/usePickerMessages.ts`
**현재 역할**: `*.data` 수신 → `mergeLogItems` → store set + `saveNetworkLog/saveConsoleLog/saveActionLog`(IndexedDB).
**변경 내용**: 자동 flush로 수신 빈도가 ~200ms 주기로 증가하므로 **IndexedDB write를 매 메시지마다 하지 않도록 가드**. store set은 매번(메모리, 저렴), IndexedDB `save*`만 디바운스/throttle(예: 1s trailing) 또는 "다음 idle"로 지연. store가 단일 진실원이고 IndexedDB는 세션 복구용이므로 write 지연이 데이터 정합을 해치지 않는다. 구현은 수신부에 작은 throttle 래퍼 또는 `requestIdleCallback` 기반.

### 6. `manifest.config.ts` / 타입 / log-merge / UI
**변경 없음**.

## 데이터 흐름

```
[MAIN recorder]
 pushEntry(entry) ──▶ buffer.push  ──▶ throttle.schedule()
                                          │ (≤200ms trailing, recording 중)
                                          ▼
                                       dispatch()  ──CustomEvent(전체 buffer.slice)──▶
[ISOLATED bridge] handle*Data ──chrome.runtime.sendMessage(*.data)──▶
[sidepanel] usePickerMessages
   ├─ mergeLogItems (id dedup + 시간정렬)  ← 전체 재전송 흡수
   ├─ store.set*Log (매번, 메모리)
   └─ save*Log (IndexedDB, throttle ~1s)   ← 신규 write 가드

즉시 flush 트리거 (throttle 우회):
 visibilitychange(hidden) / pagehide / sync(onBeforeNavigate) / stop  ──▶ throttle.flushNow()
```

## 인터페이스 설계

신규 타입은 위 `TrailingThrottle` / `createTrailingThrottle`뿐. 메시지 타입(`PickerMessage`의 `*.data`)·entry 타입 변경 없음. payload 의미도 동일(전체 버퍼) — 단지 전송 빈도만 증가.

상수: `FLUSH_INTERVAL_MS = 200`(레코더 공통), IndexedDB write 가드 간격(예: `LOG_PERSIST_INTERVAL_MS = 1000`).

## 기존 패턴 준수

- **sentinel 활성화 모델**: throttle는 `recording=true`(sentinel 설정 후)일 때만 entry가 들어와 동작. 비녹화 시 상시비용 0.
- **id dedup 병합**(log-merge.ts): 전체 버퍼 재전송을 `mergeLogItems`가 흡수 — 증분 전송 불필요의 근거.
- **MAIN/ISOLATED 분리**: throttle는 MAIN world 레코더 내부 타이머. chrome API 미사용이라 MAIN world 제약과 무관.
- **테스트 우선**(CLAUDE.md): `createTrailingThrottle`는 타이머 주입형 순수 유틸 → `__tests__/log-throttle.test.ts`로 schedule 병합·flushNow·cancel 동작 단위테스트.
- **외과적 범위**: 기존 `dispatch()`/sentinel/pagehide 로직은 유지하고 throttle·visibilitychange만 가산.

## 대안 검토

**대안 A — 순수 디바운스(마지막 entry 후 200ms 조용하면 flush)** (채택 안 함)
사용자 초기 제안이지만, **네비 직전 로그 폭주가 정확히 위험 케이스**다. 디바운스는 연속 입력 중 flush를 계속 미루므로 폭주가 끝나기 전 네비가 일어나면 그동안 쌓인 전부가 유실된다 — 보강 목적과 정면 충돌. trailing throttle(최대 interval마다 강제 flush)이 폭주에 강건하다.

**대안 B — 증분 전송(마지막 flush 이후 새 entry만)** (채택 안 함)
IPC 페이로드를 줄이는 이점이 있으나, "마지막 전송 인덱스" 추적 + `clear`/네비 시 인덱스 리셋 race 처리로 복잡도가 오른다. 버퍼 cap(network 5000 / console 2000 / action 1000)이 전체 전송의 트래픽 상한을 이미 보장하고, 구조화 복제 비용은 수백 entry 규모에선 무시 가능하므로 전체 전송 + dedup이 더 단순·안전하다.

**대안 C — SW 실시간 적재(Jam식)** (채택 안 함)
로그 저장을 service worker로 옮기면 unload race가 근본 해소되나, 레코더→SW 실시간 스트림·SW 버퍼 관리·세션/IndexedDB 연동 전반을 재설계해야 한다. 현 페이지-저장 + flush 모델에 throttle만 얹어 유실 윈도우를 ~200ms로 줄이는 편이 비용 대비 효과가 크다.

**대안 D — 동기 저장** (불가)
MAIN world는 chrome API가 없고 ISOLATED bridge의 `chrome.runtime.sendMessage`·`chrome.storage`는 모두 비동기다. unload 시점에 동기적으로 영속화할 채널이 없어 원천적으로 불가.

## 위험 요소

- **수신부 write 폭증**: 자동 flush가 200ms 주기로 오면 `save*Log`(IndexedDB)가 그만큼 호출된다. **반드시 write 가드(throttle ~1s)**를 둬야 IndexedDB 과부하·메인스레드 지연을 막는다(변경 5번). store set은 메모리라 매번 OK.
- **throttle flush와 sync/stop race**: `onBeforeNavigate` sync나 `stop`이 throttle 예약과 겹칠 수 있다. `flushNow()`가 예약을 취소하고 즉시 dispatch하므로 중복은 id dedup이 흡수 — 데이터 정합엔 무해하나, dispatch 두 번이 불필요하게 나갈 수 있음(허용 범위).
- **network pending/complete 이중 schedule**: pending push와 complete 갱신 각각에서 schedule하면 같은 요청이 두 throttle 주기에 전송될 수 있으나, id가 같아 dedup이 최신본으로 덮는다(기존 동작).
- **visibilitychange 오발동**: 탭 전환·최소화에서도 `hidden`이 발화해 flush가 일어난다. flush 자체는 무해(전체 버퍼 재전송 + dedup)하나 빈도가 늘 수 있음 — 허용.
- **iframe 확장과의 상호작용**: [iframe-log-coverage](../iframe-log-coverage/) 적용 시 프레임마다 throttle·flush가 독립 동작해 dispatch 총량이 증가한다. 수신부 write 가드가 이를 흡수하는지 함께 검증. 두 피쳐를 병행하면 iframe 유실 표면 증가를 throttle가 상쇄한다.
- **타이머 정확도**: `setTimeout`은 백그라운드 탭에서 throttle될 수 있으나, 녹화는 활성 탭 대상이라 영향 미미.
