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
**변경 내용**: console-recorder와 패턴 동일이되 **schedule 삽입 지점이 다르다**. network의 `pushEntry`에는 `recording` 가드가 없다(가드는 호출처 `recordHook`/XHR `send`/`sendBeacon`에 있음) — 따라서 `pushEntry` 끝이 아니라 **recording 게이트를 통과한 pending push 지점(호출처)에서만** `throttle.schedule()`을 건다. 응답 갱신(complete/error in-place)에는 schedule을 걸지 않는다 — 갱신본은 다음 trailing 주기(≤200ms)·sync·pagehide에 전체 버퍼로 나가고 `mergeLogItems` id dedup이 최신본으로 흡수하므로, complete 반영이 최대 200ms 늦는 것 외엔 무손실이고 코드가 단순하다. `pagehide`/`visibilitychange`/`stop`/`sync`/`clear`는 console과 동일.

### 4. `src/content/action-recorder.ts`
**변경 내용**: 동일 패턴 적용(action의 `pushEntry`는 console과 같이 `recording` 가드가 있어 `pushEntry` 끝에 schedule). action은 빈도가 낮아 throttle 효과는 작지만 일관성 위해 포함.

### 5. `src/sidepanel/hooks/usePickerMessages.ts` (수신부 write 가드)
**현재 역할**: `*.data` 수신 → `mergeLogItems` → store set + `saveNetworkLog/saveConsoleLog/saveActionLog`(IndexedDB).
**변경 내용**: 자동 flush로 수신 빈도가 ~200ms 주기로 증가하므로 **IndexedDB write를 매 메시지마다 하지 않도록 가드**. store set은 매번(메모리, 저렴), IndexedDB `save*`만 trailing throttle(`LOG_PERSIST_INTERVAL_MS≈1000`)로 지연한다.

- **순수 유틸 분리 + 테스트**: 가드 로직은 레코더의 `createTrailingThrottle`와 동형(또는 재사용)인 타이머 주입형 순수 유틸로 분리해 단위테스트한다(CLAUDE.md 테스트 우선 — 신규 인터페이스).
- **왜 throttle(1s)인가 — 기존 디바운스와 분기**: 기존 세션 영속화(`useEditorSessionSync`)는 300ms **디바운스**다. 그러나 로그 폭주 중 디바운스는 조용해질 때까지 write를 영영 미뤄 재진입 시 손실이 커진다. 주기적으로 흘려야 하므로 여기선 **trailing throttle**가 맞고, 영속화보다 느슨한 1s로 IDB 부하를 더 줄인다.
- **확정 시점 flush 트리거(누락 방지)**: freeze는 `stop` 메시지가 아니라 **store phase 전이(`isLogFrozen` → drafting/previewing/done)**로 일어나고, freeze 후엔 `*.data` 수신이 가드로 막혀 마지막 trailing write가 throttle 타이머에 갇힐 수 있다. 따라서 **phase가 frozen으로 전이되는 시점(store subscribe)에 pending save를 `flushNow`로 강제**한다. store가 단일 진실원이라 *동일 세션 내*엔 무해하지만 *세션 재진입* 시엔 IDB가 유일 출처이므로 이 트리거가 필수다.
- **30s replay trim과의 분리(덮어쓰기 race 방지)**: `save*Log`는 `use-30s-replay.ts`의 trim 경로에서도 **직접** 호출된다(trim된 더 작은 집합). write 가드는 **`usePickerMessages` 수신부에만** 두고 trim 경로의 직접 save는 가드 우회(즉시)로 유지하되, trim save 직전 수신부 pending write를 `cancel`/`flushNow`로 비워, trim 전 전체 버퍼 write가 trim 후 save를 덮어쓰지 않게 한다.

### 6. `manifest.config.ts` / 타입 / log-merge / UI
**변경 없음**.

## 데이터 흐름

```
[MAIN recorder]
 pushEntry/pending push ──▶ buffer.push ──▶ throttle.schedule()
   (console/action: pushEntry 끝 · network: recording 게이트 통과한 pending push만)
                                          │ (≤200ms trailing, recording 중)
                                          ▼
                                       dispatch()  ──CustomEvent(전체 buffer.slice)──▶
[ISOLATED bridge] handle*Data ──chrome.runtime.sendMessage(*.data)──▶
[sidepanel] usePickerMessages
   ├─ mergeLogItems (id dedup + 시간정렬)  ← 전체 재전송 흡수
   ├─ store.set*Log (매번, 메모리)
   └─ save*Log (IndexedDB, 수신부 throttle ~1s)   ← 신규 write 가드
        · phase frozen 전이 시 flushNow (마지막 상태 누락 방지)
        · 30s replay trim 경로는 가드 우회(직접 save) + 직전 pending write 무효화

즉시 flush 트리거 (레코더 throttle 우회):
 visibilitychange(hidden) / pagehide / sync(onBeforeNavigate) / stop  ──▶ throttle.flushNow()
```

## 인터페이스 설계

신규 타입은 위 `TrailingThrottle` / `createTrailingThrottle`뿐(수신부 write 가드도 이를 재사용). 메시지 타입(`PickerMessage`의 `*.data`)·entry 타입 변경 없음. payload 의미도 동일(전체 버퍼) — 단지 전송 빈도만 증가.

상수: `FLUSH_INTERVAL_MS = 200`(레코더 공통), IndexedDB write 가드 간격(예: `LOG_PERSIST_INTERVAL_MS = 1000`).

## 기존 패턴 준수

- **sentinel 활성화 모델**: throttle는 `recording=true`(sentinel 설정 후)일 때만 entry가 들어와 동작. 비녹화 시 상시비용 0.
- **id dedup 병합**(log-merge.ts): 전체 버퍼 재전송을 `mergeLogItems`가 흡수 — 증분 전송 불필요의 근거.
- **MAIN/ISOLATED 분리**: throttle는 MAIN world 레코더 내부 타이머. chrome API 미사용이라 MAIN world 제약과 무관.
- **테스트 우선**(CLAUDE.md): `createTrailingThrottle`는 타이머 주입형 순수 유틸 → `__tests__/log-throttle.test.ts`로 schedule 병합·flushNow·cancel·상태 리셋·예외 격리 단위테스트. 수신부 write 가드 유틸도 동형으로 단위테스트.
- **외과적 범위**: 기존 `dispatch()`/sentinel/pagehide 로직은 유지하고 throttle·visibilitychange만 가산.

## 대안 검토

**대안 A — 순수 디바운스(마지막 entry 후 200ms 조용하면 flush)** (채택 안 함)
사용자 초기 제안이지만, **네비 직전 로그 폭주가 정확히 위험 케이스**다. 디바운스는 연속 입력 중 flush를 계속 미루므로 폭주가 끝나기 전 네비가 일어나면 그동안 쌓인 전부가 유실된다 — 보강 목적과 정면 충돌. trailing throttle(최대 interval마다 강제 flush)이 폭주에 강건하다.

**대안 B — 증분 전송(마지막 flush 이후 새 entry만)** (채택 안 함)
IPC 페이로드를 줄이는 이점이 있으나, "마지막 전송 인덱스" 추적 + `clear`/네비 시 인덱스 리셋 race 처리로 복잡도가 오른다. 버퍼 cap(network 5000 / console 2000 / action 1000)이 전체 전송의 트래픽 상한을 보장하고, 일반 케이스(수백 entry)에선 구조화 복제·머지 비용이 무시 가능하다. **cap 근처(특히 network 5000)의 폭주 케이스에선 200ms마다 전체 clone + `mergeLogItems` O(n log n) 정렬이 반복돼 비용이 유의미해지지만**, 이는 수신부 write 가드(1s)가 IDB 머지/write 빈도를 낮춰 상쇄한다(아래 위험요소 참조). 따라서 전체 전송 + dedup이 더 단순·안전하다.

**대안 C — SW 실시간 적재(Jam식)** (채택 안 함)
로그 저장을 service worker로 옮기면 unload race가 근본 해소되나, 레코더→SW 실시간 스트림·SW 버퍼 관리·세션/IndexedDB 연동 전반을 재설계해야 한다. 현 페이지-저장 + flush 모델에 throttle만 얹어 유실 윈도우를 ~200ms로 줄이는 편이 비용 대비 효과가 크다.

**대안 D — 동기 저장** (불가)
MAIN world는 chrome API가 없고 ISOLATED bridge의 `chrome.runtime.sendMessage`·`chrome.storage`는 모두 비동기다. unload 시점에 동기적으로 영속화할 채널이 없어 원천적으로 불가.

## 위험 요소

- **수신부 write 폭증**: 자동 flush가 200ms 주기로 오면 `save*Log`(IndexedDB)가 그만큼 호출된다. **반드시 write 가드(throttle ~1s)**를 둬야 IndexedDB 과부하·메인스레드 지연을 막는다(변경 5번). store set은 메모리라 매번 OK.
- **대량 버퍼 머지 비용**: cap 근처(network 5000)의 폭주 시 200ms마다 전체 버퍼 structured clone + `mergeLogItems`의 Map 재구축·O(n log n) 정렬이 반복된다. content→runtime IPC clone은 dispatch마다 불가피하나, 수신부 write 가드(1s)가 IDB 머지/write 빈도를 1/5로 낮춰 메인스레드 부담을 상쇄한다. (이것이 대안 B 증분 전송을 기각하고도 성능을 지키는 근거.)
- **throttle flush와 sync/stop race**: `onBeforeNavigate` sync나 `stop`이 throttle 예약과 겹칠 수 있다. `flushNow()`가 예약을 취소하고 즉시 dispatch하므로 중복은 id dedup이 흡수 — 데이터 정합엔 무해하나, dispatch 두 번이 불필요하게 나갈 수 있음(허용 범위).
- **settle 구간과의 정합(의도된 동작)**: `FLUSH_INTERVAL_MS`(200) < `syncAndSettleLogs` 상한(300ms)이라 settle 중 자동 flush가 끼어 store `endedAt`을 올려 settle을 조기 탈출시킬 수 있다. 그러나 자동 flush는 데이터가 이미 도착했다는 신호이므로 조기 탈출은 무해(오히려 settle이 빨리 끝남) — throttle와 settle 모두 `endedAt` 증가로 수렴해 충돌하지 않는다.
- **network는 pending push 시점만 schedule**: 응답 갱신(complete/error)엔 schedule을 걸지 않아 이중 schedule이 없다. complete 반영은 다음 trailing 주기(≤200ms)·sync·pagehide에 전체 버퍼로 나가고 id dedup이 최신본으로 덮는다 — 반영 최대 200ms 지연 외 무손실.
- **visibilitychange 오발동(허용 — 안전망 다중화 목적)**: 탭 전환·최소화에서도 `hidden`이 발화해 flush가 일어나며, 이는 `tab-bindings`의 stop flush와 중복된다. 탭 전환은 풀 네비가 아니라 원래 유실 대상이 아니지만, trailing throttle가 놓치는 극단 꼬리(탭 숨김 직전 최신화)를 메우는 안전망으로 의도적으로 유지한다. flush 자체는 무해(전체 버퍼 재전송 + dedup)하고 빈도 증가는 수신부 write 가드가 흡수.
- **iframe 확장과의 상호작용(sync 비대칭 주의)**: [iframe-log-coverage](../iframe-log-coverage/) 적용 시 프레임마다 throttle·flush가 독립 동작해 dispatch 총량이 증가하나, **보조 안전망인 `onBeforeNavigate` sync는 `frameId !== 0` 가드로 메인 프레임 한정**이라 sub-frame 꼬리는 throttle 자동 flush + `pagehide`가 주 메커니즘이 된다. 이 비대칭 때문에 iframe 병행 시 throttle의 역할이 더 커지며, 수신부 write 가드가 증가한 dispatch를 흡수하는지 함께 검증.
- **타이머 정확도**: `setTimeout`은 백그라운드 탭에서 throttle될 수 있으나, 녹화는 활성 탭 대상이라 영향 미미.
- **UI 무영향(근거)**: 녹화 중 로그 패널(console/network 서브탭)은 `disabled`라 실시간 누적이 화면에 보이지 않고, 종료 후 표시 시점엔 바닥-pin auto-scroll 패턴이라 깜빡임·스크롤 점프가 없다. flush 빈도 증가가 사용자 체감 UX를 바꾸지 않는다("UI 변경 없음" 근거).
